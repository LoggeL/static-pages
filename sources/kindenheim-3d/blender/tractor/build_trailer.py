#!/usr/bin/env python3
"""
Hero Vehicle #2: Pfalz Weinlese-Kipper (Tandem-Axle Wine-Grape Harvest Trailer, ~4.4m x 2.12m x 2.25m).
Exports:
  - blender/tractor/trailer.blend
  - public/assets/models/tractor/trailer.glb
  - public/assets/models/tractor/manifest.json (complete vehicle rig contract for @threejs!)
  - Cycles 1280x720 preview of the Tractor coupled to the Grape Harvest Trailer!

STRICT COORDINATE & RIGGING CONTRACT (glTF Y-up):
- Ground contact at Y = 0.000m, centered at X = 0.0, FRONT drawbar eye facing +Z!
- Front towing eye (`trailerHitchOffset`) sits at [0.0, 0.62, +2.35] matching tractor's
  `rearHitchOffset.y = 0.62m` so @threejs couples drawbar eye straight onto tractor tow pin!
- Named nodes:
  * TrailerBody (red steel tandem chassis, V-drawbar + forged tow eye + parking jack + hydraulic hoses,
                 ribbed enameled green steel Bordwaende drop-sides w/ galvanized rails & corner posts,
                 rear DIN warning stripes + taillights + DÜW WL 26 plate, and an overflowing sculpted
                 3D mound of glossy deep-purple Palatinate wine grapes + vine leaves!)
  * Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR (4 tandem agricultural trailer wheels, R = 0.46m,
                                            each centered at its exact axle hub origin!)
"""

import json
import math
import sys
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from vehicle_utils import (
    ARTIFACT_DIR,
    GLB_OUT_DIR,
    TRACTOR_DIR,
    MultiMatMesh,
    build_agri_wheel,
    clear_scene,
    ensure_collection,
    get_pbr_mat,
    get_solid_pbr_mat,
    gl_to_bl,
    render_vehicle_preview,
    save_blend_and_export_glb,
)
from build_tractor import TRACTOR_SPECS, build_tractor_nodes


TRAILER_SPECS = {
    "trailerHitchOffset": [0.0, 0.62, 2.35],
    "trailerWheelRadius": 0.46,
    "trailerAxleOffsetZ": -0.78,
    "trailerWheelNames": ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"],
    "trailerWheelPositions": {
        "FL": [0.88, 0.46, -0.32],
        "FR": [-0.88, 0.46, -0.32],
        "RL": [0.88, 0.46, -1.24],
        "RR": [-0.88, 0.46, -1.24],
    },
}


def _add_sculpted_grape_mound(bm: bmesh.types.BMesh, width_x: float, len_z: float,
                              z_center: float, y_base: float, mound_h: float):
    """Build an organic heaped mound of freshly harvested Palatinate Spätburgunder wine grapes."""
    nx, nz = 18, 26
    grid = []
    for iz in range(nz + 1):
        vz = iz / nz  # 0..1
        gz = z_center - len_z * 0.5 + vz * len_z
        row = []
        for ix in range(nx + 1):
            ux = ix / nx  # 0..1
            gx = -width_x * 0.5 + ux * width_x
            # Smooth dome profile peaking nicely above side boards in center!
            dome_x = math.sin(ux * math.pi)
            dome_z = math.sin(vz * math.pi)
            dome = math.pow(max(0.0, dome_x * dome_z), 0.62)
            # Multi-frequency organic grape-cluster undulation
            bump = (
                0.065 * math.sin(ux * 19.0 + vz * 11.0)
                + 0.045 * math.cos(ux * 31.0 - vz * 23.0)
                + 0.025 * math.sin(ux * 47.0 + vz * 39.0)
            ) * dome
            gy = y_base + mound_h * dome + bump
            row.append(bm.verts.new(gl_to_bl(gx, gy, gz)))
        grid.append(row)

    for iz in range(nz):
        for ix in range(nx):
            bm.faces.new([grid[iz][ix], grid[iz][ix + 1], grid[iz + 1][ix + 1], grid[iz + 1][ix]])

    # Add ~22 plump 3D grape cluster clumps crowning the top ridge for rich close-up silhouette!
    for k in range(22):
        t = (k + 0.5) / 22.0
        gz = z_center - len_z * 0.36 + t * len_z * 0.72
        gx = math.sin(k * 2.39996) * (width_x * 0.32)
        ux = (gx + width_x * 0.5) / width_x
        vz = (gz - (z_center - len_z * 0.5)) / len_z
        dome = math.pow(max(0.0, math.sin(ux * math.pi) * math.sin(vz * math.pi)), 0.62)
        gy = y_base + mound_h * dome - 0.02
        r = 0.11 + (k % 3) * 0.03
        from mathutils import Matrix
        bmesh.ops.create_icosphere(
            bm, subdivisions=1, radius=r,
            matrix=Matrix.Translation(gl_to_bl(gx, gy, gz)) @ Matrix.Diagonal((1.2, 1.3, 0.72, 1.0))
        )


def build_trailer_nodes(col, z_shift_gl: float = 0.0):
    """Build all rigged Weinlese-Kipper trailer nodes inside `col` (optionally shifted in Z for coupled render)."""
    m_panel = get_pbr_mat("Trailer_Green_Steel", "trailer_green_panel", normal_strength=1.1, coat_weight=0.45)
    m_red = get_pbr_mat("Trailer_Red_Chassis", "trailer_red_chassis", normal_strength=0.6)
    m_yellow = get_pbr_mat("Trailer_Yellow_Rim", "tractor_yellow_rim", normal_strength=0.35, coat_weight=0.55)
    m_chrome = get_pbr_mat("Trailer_Galvanized_Steel", "tractor_chrome", normal_strength=0.3, rough_override=0.28)
    m_chassis = get_pbr_mat("Trailer_Dark_Steel", "tractor_chassis_steel", normal_strength=0.65)
    m_tire = get_pbr_mat("Trailer_Tire_Rubber", "tractor_tire_rubber", normal_strength=0.85)
    m_grapes = get_pbr_mat("Trailer_Wine_Grapes", "trailer_grapes", normal_strength=1.45)
    m_warn = get_pbr_mat("Trailer_Warning_Chevrons", "trailer_warning", normal_strength=0.2)
    m_plate = get_pbr_mat("Trailer_License_Plate", "plate_trailer", normal_strength=0.2)
    m_black = get_solid_pbr_mat("Trailer_Matte_Black", (0.018, 0.020, 0.023), roughness=0.62, metallic=0.10)
    m_taillight = get_solid_pbr_mat("Trailer_Taillight", (0.92, 0.08, 0.05), roughness=0.14,
                                    emission_color=(1.0, 0.10, 0.04), emission_strength=1.8)
    m_amber = get_solid_pbr_mat("Trailer_Reflector_Amber", (0.98, 0.56, 0.06), roughness=0.18,
                                emission_color=(1.0, 0.52, 0.05), emission_strength=0.8)

    tb = MultiMatMesh("TrailerBody")
    tb.ensure_mat("panel", m_panel, tile_u=1.4, tile_v=1.0, smooth=False)
    tb.ensure_mat("red", m_red, tile_u=1.2, tile_v=1.2, smooth=False)
    tb.ensure_mat("galv", m_chrome, tile_u=0.8, tile_v=0.8, smooth=False)
    tb.ensure_mat("chassis", m_chassis, tile_u=1.0, tile_v=1.0, smooth=False)
    tb.ensure_mat("black", m_black, smooth=False)
    tb.ensure_mat("grapes", m_grapes, tile_u=0.95, tile_v=0.95, smooth=True)
    tb.ensure_mat("warn", m_warn, fit_uv=True, smooth=False)
    tb.ensure_mat("plate", m_plate, fit_uv=True, smooth=False)
    tb.ensure_mat("red_led", m_taillight, smooth=False)
    tb.ensure_mat("amber", m_amber, smooth=False)

    # Cargo box spans Z = [-2.18 .. +1.28] (length = 3.46m), width = 2.08m, floor y = 1.06m, top wall y = 2.06m!
    bed_zc = -0.45
    bed_l = 3.46
    bed_w = 2.08
    bed_y0 = 1.04
    wall_h = 1.02

    # --- 1. Heavy Red Steel Tandem Chassis Frame, Axles & Tipping Hydraulics ---
    # Twin longitudinal I-beams
    for sgn in (-1.0, 1.0):
        tb.add_box_gl("red", sgn * 0.48, 0.88, -0.48, 0.12, 0.22, 3.35)
        # Leaf-spring tandem bogie rocker beam between front & rear trailer axles (z=-0.32 & z=-1.24)
        tb.add_box_gl("chassis", sgn * 0.56, 0.62, -0.78, 0.10, 0.16, 1.12)
    # Crossmembers
    for cz in (-2.05, -1.24, -0.32, 0.55, 1.15):
        tb.add_box_gl("red", 0.0, 0.92, cz, 1.12, 0.14, 0.12)
    # Twin tandem axles
    for az in (-0.32, -1.24):
        tb.add_cyl_gl("chassis", 0.0, 0.46, az, 0.075, 0.075, 1.56, axis='X', segments=12)
    # Central telescopic hydraulic tipping ram under bed
    tb.add_cyl_gl("red", 0.0, 0.78, -0.45, 0.085, 0.075, 0.48, axis='Y', segments=12)
    tb.add_cyl_gl("galv", 0.0, 0.96, -0.45, 0.055, 0.055, 0.24, axis='Y', segments=12)

    # --- 2. V-Drawbar (Deichsel) Extending Forward to Exact Hitch Eye [0.0, 0.62, +2.35]! ---
    hx, hy, hz = TRAILER_SPECS["trailerHitchOffset"]
    for sgn in (-1.0, 1.0):
        tb.add_tube_gl("red", (sgn * 0.48, 0.86, 1.15), (0.0, hy, hz - 0.16), 0.055, segments=8)
    # Forged steel towing eye collar (Zugöse) centered right at [0, 0.62, +2.35]!
    tb.add_box_gl("chassis", 0.0, hy, hz - 0.12, 0.14, 0.08, 0.24)
    # Circular tow ring built from 12 mini segments so the eye hole is genuinely open!
    ring_r = 0.068
    for i in range(12):
        a0 = 2.0 * math.pi * i / 12
        a1 = 2.0 * math.pi * (i + 1) / 12
        tb.add_tube_gl("chassis",
                       (ring_r * math.cos(a0), hy, hz + ring_r * math.sin(a0)),
                       (ring_r * math.cos(a1), hy, hz + ring_r * math.sin(a1)),
                       0.018, segments=6)
    # Folded galvanized parking jack leg + hand crank + flexible black hydraulic brake hoses
    tb.add_cyl_gl("galv", 0.22, 0.68, 1.58, 0.036, 0.036, 0.46, axis='Y', segments=10)
    tb.add_box_gl("galv", 0.22, 0.45, 1.58, 0.16, 0.03, 0.16)
    tb.add_tube_gl("black", (-0.12, 0.94, 1.24), (-0.06, 0.72, 2.08), 0.016, segments=6)
    tb.add_tube_gl("black", (-0.05, 0.96, 1.24), ( 0.04, 0.74, 2.08), 0.014, segments=6)

    # --- 3. Ribbed Enameled Green Steel Weinlese-Kipper Cargo Bed & Drop-Sides ---
    # Heavy steel flatbed floor deck
    tb.add_box_gl("chassis", 0.0, bed_y0, bed_zc, bed_w, 0.10, bed_l)
    # Side drop-boards (Bordwände) + Front & Rear boards
    wt = 0.075
    wall_yc = bed_y0 + 0.05 + wall_h * 0.5
    for sgn in (-1.0, 1.0):
        tb.add_box_gl("panel", sgn * (bed_w * 0.5 - wt * 0.5), wall_yc, bed_zc, wt, wall_h, bed_l)
        # Galvanized steel top rail & center stiffening rub-rail
        tb.add_box_gl("galv", sgn * (bed_w * 0.5 - wt * 0.4), bed_y0 + 0.05 + wall_h + 0.025, bed_zc, 0.09, 0.055, bed_l + 0.04)
        # Vertical steel corner & center stanchion posts + side lever latches
        for pz in (bed_zc - bed_l * 0.49, bed_zc, bed_zc + bed_l * 0.49):
            tb.add_box_gl("galv", sgn * (bed_w * 0.5 + 0.01), wall_yc, pz, 0.07, wall_h + 0.08, 0.08)
        # Amber side marker reflectors
        for rz in (bed_zc - 1.1, bed_zc + 1.0):
            tb.add_box_gl("amber", sgn * (bed_w * 0.5 + 0.02), bed_y0 + 0.02, rz, 0.02, 0.06, 0.14)
        # Black steel tandem wheel mudguards along underside of bed
        tb.add_box_gl("black", sgn * 0.88, 0.98, -0.78, 0.42, 0.04, 1.88)

    # Front bulkhead wall (with galvanized grape-harvest inspection ladder rungs!)
    front_z = bed_zc + bed_l * 0.5 - wt * 0.5
    tb.add_box_gl("panel", 0.0, wall_yc, front_z, bed_w - 0.04, wall_h, wt)
    tb.add_box_gl("galv", 0.0, bed_y0 + 0.05 + wall_h + 0.025, front_z, bed_w + 0.04, 0.055, 0.09)
    # Front galvanized steel platform step & ladder rungs
    for ry in (1.15, 1.48, 1.80):
        tb.add_tube_gl("galv", (-0.28, ry, front_z + 0.09), (0.28, ry, front_z + 0.09), 0.016, segments=6)
    for sx in (-0.28, 0.28):
        tb.add_tube_gl("galv", (sx, 0.98, front_z + 0.09), (sx, 2.08, front_z + 0.09), 0.018, segments=6)

    # Rear tailgate wall + rear under-run bumper bar + DIN warning stripes + taillights + DÜW WL 26 plate!
    rear_z = bed_zc - bed_l * 0.5 + wt * 0.5
    tb.add_box_gl("panel", 0.0, wall_yc, rear_z, bed_w - 0.04, wall_h, wt)
    tb.add_box_gl("galv", 0.0, bed_y0 + 0.05 + wall_h + 0.025, rear_z, bed_w + 0.04, 0.055, 0.09)
    # Rear steel bumper beam with taillights & license plate
    tb.add_box_gl("chassis", 0.0, 0.62, rear_z - 0.08, 1.96, 0.14, 0.10)
    for sgn in (-1.0, 1.0):
        tb.add_box_gl("red_led", sgn * 0.80, 0.62, rear_z - 0.14, 0.22, 0.10, 0.03)
        tb.add_box_gl("amber", sgn * 0.64, 0.62, rear_z - 0.14, 0.08, 0.10, 0.03)
        # DIN 11030 red/white diagonal warning stripe panels on rear corners of tailgate
        wx0 = sgn * 0.72
        tb.add_single_sided_quad_gl("warn", [
            (wx0 + 0.18, 1.18, rear_z - 0.048),
            (wx0 - 0.18, 1.18, rear_z - 0.048),
            (wx0 - 0.18, 1.54, rear_z - 0.048),
            (wx0 + 0.18, 1.54, rear_z - 0.048),
        ])
    # German trailer license plate "DÜW WL 26" centered on rear bumper
    tb.add_single_sided_quad_gl("plate", [
        ( 0.24, 0.56, rear_z - 0.14),
        (-0.24, 0.56, rear_z - 0.14),
        (-0.24, 0.68, rear_z - 0.14),
        ( 0.24, 0.68, rear_z - 0.14),
    ])

    # --- 4. Overflowing Sculpted Load of Rich Deep-Purple Palatinate Wine Grapes (Trauben)! ---
    _add_sculpted_grape_mound(
        tb.bms["grapes"],
        width_x=bed_w - 0.16,
        len_z=bed_l - 0.18,
        z_center=bed_zc,
        y_base=bed_y0 + wall_h - 0.14,
        mound_h=0.46,
    )

    body_obj = tb.build_object(col, location_gl=(0.0, 0.0, z_shift_gl), keep_winding_keys={"warn", "plate"})

    # --- 5. 4 Individually Rigged Tandem Agricultural Trailer Wheels (R = 0.46m) ---
    twp = TRAILER_SPECS["trailerWheelPositions"]
    tr = TRAILER_SPECS["trailerWheelRadius"]
    wheels = []
    for key, is_left in [("FL", True), ("FR", False), ("RL", True), ("RR", False)]:
        px, py, pz = twp[key]
        w_obj = build_agri_wheel(
            f"Wheel_{key}", col, (px, py, pz + z_shift_gl),
            outer_radius=tr, width=0.34, is_left=is_left,
            mat_tire=m_tire, mat_rim=m_yellow, mat_hub=m_chassis, mat_chrome=m_chrome,
            lug_pairs=14, lug_height=0.032, rim_ratio=0.58
        )
        wheels.append(w_obj)

    return [body_obj] + wheels


def write_manifest(tractor_glb: Path, trailer_glb: Path):
    """Inspect exported GLBs for exact bounds and write public/assets/models/tractor/manifest.json."""
    import struct

    def glb_bounds(path: Path):
        data = path.read_bytes()
        jlen, _ = struct.unpack('<I4s', data[12:20])
        gltf = json.loads(data[20:20 + jlen].decode('utf-8'))
        # Walk full glTF node parent-child hierarchy so parented nodes (SteeringPivot -> SteeringWheel) use world transforms!
        nodes = gltf.get("nodes", [])
        meshes = gltf.get("meshes", [])
        accs = gltf.get("accessors", [])
        parents = {}
        for p_idx, nd in enumerate(nodes):
            for c_idx in nd.get("children", []):
                parents[c_idx] = p_idx

        def world_trans(idx):
            t = list(nodes[idx].get("translation", [0.0, 0.0, 0.0]))
            cur = idx
            while cur in parents:
                cur = parents[cur]
                pt = nodes[cur].get("translation", [0.0, 0.0, 0.0])
                t = [t[i] + pt[i] for i in range(3)]
            return t

        mins = [1e9, 1e9, 1e9]
        maxs = [-1e9, -1e9, -1e9]
        for idx, nd in enumerate(nodes):
            if "mesh" not in nd:
                continue
            tx, ty, tz = world_trans(idx)
            for prim in meshes[nd["mesh"]].get("primitives", []):
                pos_idx = prim["attributes"].get("POSITION")
                if pos_idx is None:
                    continue
                a = accs[pos_idx]
                for i, t in enumerate((tx, ty, tz)):
                    mins[i] = min(mins[i], a["min"][i] + t)
                    maxs[i] = max(maxs[i], a["max"][i] + t)
        return {
            "min": [round(v, 3) for v in mins],
            "max": [round(v, 3) for v in maxs],
            "size": [round(maxs[i] - mins[i], 3) for i in range(3)],
        }

    manifest = {
        "coordinateSystem": "Three.js Y-up, ground contact Y=0.0, vehicle centered X=0, forward +Z, left +X, right -X",
        "forwardAxis": "+Z",
        "tractorGlbPath": "/assets/models/tractor/tractor.glb",
        "trailerGlbPath": "/assets/models/tractor/trailer.glb",
        "tractorBlendSource": "blender/tractor/tractor.blend",
        "trailerBlendSource": "blender/tractor/trailer.blend",
        "tractorBounds": glb_bounds(tractor_glb),
        "trailerBounds": glb_bounds(trailer_glb),
        "frontWheelRadius": TRACTOR_SPECS["frontWheelRadius"],
        "rearWheelRadius": TRACTOR_SPECS["rearWheelRadius"],
        "wheelPositions": TRACTOR_SPECS["wheelPositions"],
        "cabCameraOffset": TRACTOR_SPECS["cabCameraOffset"],
        "steeringWheelOrigin": TRACTOR_SPECS["steeringWheelOrigin"],
        "steeringWheelSpinAxis": TRACTOR_SPECS["steeringWheelSpinAxis"],
        "exhaustTipOffset": TRACTOR_SPECS["exhaustTipOffset"],
        "beaconOffset": TRACTOR_SPECS["beaconOffset"],
        "headlightOffsets": TRACTOR_SPECS["headlightOffsets"],
        "taillightOffsets": TRACTOR_SPECS["taillightOffsets"],
        "rearHitchOffset": TRACTOR_SPECS["rearHitchOffset"],
        "trailerHitchOffset": TRAILER_SPECS["trailerHitchOffset"],
        "trailerWheelRadius": TRAILER_SPECS["trailerWheelRadius"],
        "trailerAxleOffsetZ": TRAILER_SPECS["trailerAxleOffsetZ"],
        "trailerWheelNames": TRAILER_SPECS["trailerWheelNames"],
        "trailerWheelPositions": TRAILER_SPECS["trailerWheelPositions"],
    }
    out = GLB_OUT_DIR / "manifest.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"Wrote vehicle manifest: {out}")


def main():
    # 1. Export standalone trailer.blend + trailer.glb
    clear_scene()
    col_tr = ensure_collection("Kindenheim_Weinlese_Trailer")
    trailer_objs = build_trailer_nodes(col_tr, z_shift_gl=0.0)
    save_blend_and_export_glb(
        TRACTOR_DIR / "trailer.blend",
        GLB_OUT_DIR / "trailer.glb",
        trailer_objs,
    )

    # 2. Write unified manifest.json (using freshly exported tractor.glb + trailer.glb)
    write_manifest(GLB_OUT_DIR / "tractor.glb", GLB_OUT_DIR / "trailer.glb")

    # 3. Render coupled Tractor + Grape Harvest Trailer hero 1280x720 preview!
    clear_scene()
    col_combo = ensure_collection("Tractor_And_Trailer_Preview")
    build_tractor_nodes(col_combo)
    # Exact coupling offset: place trailer so its hitch eye (+2.35) meets tractor rear tow pin (-2.02)!
    couple_z = TRACTOR_SPECS["rearHitchOffset"][2] - TRAILER_SPECS["trailerHitchOffset"][2]
    build_trailer_nodes(col_combo, z_shift_gl=couple_z)

    render_vehicle_preview(
        ARTIFACT_DIR / "preview_tractor_trailer_combo.png",
        cam_pos_gl=(8.4, 3.25, 3.4),
        look_at_gl=(0.0, 1.38, -1.75),
        lens_mm=38.0,
        samples=48,
    )


if __name__ == "__main__":
    main()

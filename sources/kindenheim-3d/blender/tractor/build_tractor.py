#!/usr/bin/env python3
"""
Hero Vehicle #1: Realistic Modern German Pfalz Tractor (Fendt/Deere-inspired, ~4.55m x 2.36m x 3.18m).
Exports blender/tractor/tractor.blend + public/assets/models/tractor/tractor.glb.

STRICT RIGGING & COORDINATE CONTRACT (glTF Y-up):
- Ground contact at Y = 0.000m, centered at X = 0.0, FRONT facing +Z, LEFT = +X, RIGHT = -X.
- Exact named nodes for Three.js real-time animation:
  * Chassis       (hood, grille, cast-iron front weights, chassis/axles, steps, exhaust stack,
                   fenders, 3-point rear hitch, ROPS cab frame, clear single-sided cab glass,
                   illuminated dashboard, driver seat, side mirrors, DÜW KH 26 license plate)
  * Wheel_FL      (origin at [+0.88, 0.58, +1.42], R=0.58m — steer rotation.y + roll rotation.x)
  * Wheel_FR      (origin at [-0.88, 0.58, +1.42], R=0.58m)
  * Wheel_RL      (origin at [+0.88, 0.88, -1.26], R=0.88m — roll rotation.x)
  * Wheel_RR      (origin at [-0.88, 0.88, -1.26], R=0.88m)
  * SteeringPivot -> SteeringWheel (tilted 28° toward driver; spin SteeringWheel.rotation.z!)
  * Beacon        (origin at [+0.56, 3.06, +0.26] — amber Rundumleuchte w/ inner spinning reflector!)
  * Headlights    (separate emissive-ready lens mesh on front grille + cab work lights)
  * Taillights    (separate emissive-ready ruby-red brake/tail lenses on rear fenders)
"""

import math
import sys
from pathlib import Path
import bpy

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


TRACTOR_SPECS = {
    "forwardAxis": "+Z",
    "frontWheelRadius": 0.58,
    "rearWheelRadius": 0.88,
    "wheelPositions": {
        "FL": [0.88, 0.58, 1.42],
        "FR": [-0.88, 0.58, 1.42],
        "RL": [0.88, 0.88, -1.26],
        "RR": [-0.88, 0.88, -1.26],
    },
    "cabCameraOffset": [0.0, 2.24, -0.58],
    "steeringWheelOrigin": [0.0, 1.88, -0.02],
    "steeringWheelSpinAxis": "z",
    "exhaustTipOffset": [-0.74, 2.74, 0.50],
    "beaconOffset": [0.56, 3.06, 0.24],
    "headlightOffsets": [
        [0.34, 1.44, 2.23],
        [-0.34, 1.44, 2.23],
    ],
    "taillightOffsets": [
        [0.82, 1.56, -1.84],
        [-0.82, 1.56, -1.84],
    ],
    "rearHitchOffset": [0.0, 0.62, -2.02],
}


def build_tractor_nodes(col):
    """Build all rigged tractor nodes inside `col` and return list of Blender objects."""
    # Materials
    m_green = get_pbr_mat("Tractor_Green_Enamel", "tractor_green", normal_strength=0.35, coat_weight=0.75)
    m_yellow = get_pbr_mat("Tractor_Yellow_Rim", "tractor_yellow_rim", normal_strength=0.35, coat_weight=0.65)
    m_roof = get_pbr_mat("Tractor_Roof_Silver", "tractor_roof_silver", normal_strength=0.30, coat_weight=0.55)
    m_chrome = get_pbr_mat("Tractor_Chrome", "tractor_chrome", normal_strength=0.25)
    m_chassis = get_pbr_mat("Tractor_Chassis_Steel", "tractor_chassis_steel", normal_strength=0.65)
    m_tire = get_pbr_mat("Tractor_Tire_Rubber", "tractor_tire_rubber", normal_strength=0.85)
    m_grille = get_pbr_mat("Tractor_Grille_Mesh", "tractor_grille_mesh", normal_strength=1.1)
    m_dash = get_pbr_mat("Tractor_Dashboard", "tractor_dashboard", normal_strength=0.2,
                         emission_strength=0.65)
    m_plate = get_pbr_mat("Tractor_License_Plate", "plate_tractor", normal_strength=0.2)
    m_beacon = get_pbr_mat("Tractor_Beacon_Amber", "beacon_amber", normal_strength=0.9,
                           rough_override=0.14, emission_color=(1.0, 0.45, 0.04),
                           emission_strength=2.2, alpha=0.88)
    m_rubber_black = get_solid_pbr_mat("Tractor_Matte_Black", (0.018, 0.020, 0.023), roughness=0.62, metallic=0.12)
    m_seat = get_solid_pbr_mat("Tractor_Seat_Fabric", (0.032, 0.035, 0.040), roughness=0.86, metallic=0.0)
    m_red_accent = get_solid_pbr_mat("Tractor_Red_Accent", (0.72, 0.08, 0.06), roughness=0.28, metallic=0.35)
    # Ultra-clean transparent single-sided cab glass (subtle exterior reflection, crystal clear 1st-person POV!)
    m_glass = get_solid_pbr_mat("Tractor_Cab_Glass", (0.64, 0.80, 0.84), roughness=0.05, metallic=0.05,
                                alpha=0.11, coat=0.15)
    m_headlight = get_solid_pbr_mat("Tractor_Headlight_LED", (1.0, 0.97, 0.88), roughness=0.08, metallic=0.1,
                                    emission_color=(1.0, 0.95, 0.82), emission_strength=3.2)
    m_taillight = get_solid_pbr_mat("Tractor_Taillight_LED", (0.92, 0.08, 0.05), roughness=0.12, metallic=0.1,
                                    emission_color=(1.0, 0.10, 0.04), emission_strength=2.2)

    # ==================================================================
    # 1. CHASSIS NODE (Hood, Frame, Weights, Fenders, Exhaust, ROPS Cab, Glass, Interior)
    # ==================================================================
    ch = MultiMatMesh("Chassis")
    ch.ensure_mat("green", m_green, tile_u=1.6, tile_v=1.6, smooth=True)
    ch.ensure_mat("yellow", m_yellow, tile_u=1.2, tile_v=1.2, smooth=False)
    ch.ensure_mat("roof", m_roof, tile_u=1.6, tile_v=1.6, smooth=True)
    ch.ensure_mat("chrome", m_chrome, tile_u=0.6, tile_v=0.6, smooth=True)
    ch.ensure_mat("chassis", m_chassis, tile_u=1.2, tile_v=1.2, smooth=False)
    ch.ensure_mat("black", m_rubber_black, tile_u=1.0, tile_v=1.0, smooth=False)
    ch.ensure_mat("grille", m_grille, tile_u=0.35, tile_v=0.35, smooth=False)
    ch.ensure_mat("seat", m_seat, tile_u=0.6, tile_v=0.6, smooth=True)
    ch.ensure_mat("red", m_red_accent, tile_u=0.5, tile_v=0.5, smooth=False)
    ch.ensure_mat("dash", m_dash, fit_uv=True, smooth=False)
    ch.ensure_mat("plate", m_plate, fit_uv=True, smooth=False)
    ch.ensure_mat("glass", m_glass, tile_u=1.0, tile_v=1.0, smooth=False)

    # --- Heavy Engine Block, Main Frame Rails & Axles ---
    # Longitudinal frame & engine crankcase
    ch.add_box_gl("chassis", 0.0, 0.90, 0.45, 0.86, 0.56, 3.15)
    # Lower oil sump & transmission housing
    ch.add_box_gl("chassis", 0.0, 0.64, -0.15, 0.64, 0.34, 2.25)
    # Front steerable axle beam + differential pumpkin + steering rams (at z=+1.42, y=0.58)
    ch.add_cyl_gl("chassis", 0.0, 0.58, 1.42, 0.13, 0.13, 1.48, axis='X', segments=14)
    ch.add_cyl_gl("chassis", 0.0, 0.58, 1.42, 0.21, 0.21, 0.36, axis='Z', segments=14)
    ch.add_cyl_gl("chrome", 0.0, 0.56, 1.24, 0.028, 0.028, 1.26, axis='X', segments=8)
    # Rear heavy differential axle housing (at z=-1.26, y=0.88)
    ch.add_cyl_gl("chassis", 0.0, 0.88, -1.26, 0.20, 0.20, 1.38, axis='X', segments=16)
    ch.add_box_gl("chassis", 0.0, 0.94, -1.32, 0.72, 0.58, 0.62)

    # --- Cast-Iron Front Ballast Weight Block (Frontgewicht, 10 plates at z=+2.28..+2.54!) ---
    ch.add_box_gl("chassis", 0.0, 0.82, 2.18, 0.76, 0.26, 0.44)  # mounting bracket
    for i in range(10):
        wx = -0.405 + i * 0.090
        ch.add_box_gl("chassis", wx, 0.88, 2.38, 0.078, 0.46, 0.36)
    ch.add_box_gl("yellow", 0.0, 0.88, 2.56, 0.92, 0.06, 0.05)  # high-vis yellow bumper stripe
    ch.add_cyl_gl("red", 0.0, 0.88, 2.57, 0.045, 0.045, 0.12, axis='Y', segments=10)  # front tow pin

    # --- Sculpted Tapered Green Enamel Engine Hood (Aerodynamic Modern German Profile!) ---
    # Lofted from cab cowl (z=+0.45, y_top=1.90) sloping down cleanly to nose (z=+2.22, y_top=1.68)!
    ch.add_tapered_hood_gl("green", [
        (0.40, 0.54, 0.45, 1.12, 1.90),
        (1.05, 0.50, 0.42, 1.10, 1.84),
        (1.75, 0.46, 0.38, 1.08, 1.76),
        (2.14, 0.43, 0.34, 1.08, 1.69),
        (2.22, 0.39, 0.29, 1.10, 1.62),
    ])
    # Iconic golden-yellow & silver racing stripe accent along both flanks of the green hood!
    for sgn in (-1.0, 1.0):
        ch.add_box_gl("yellow", sgn * 0.495, 1.50, 1.28, 0.03, 0.085, 1.62, rot_x_deg=3.5, rot_y_deg=-sgn * 3.8)
        ch.add_box_gl("chrome", sgn * 0.498, 1.56, 1.28, 0.025, 0.026, 1.60, rot_x_deg=3.5, rot_y_deg=-sgn * 3.8)
        # Black perforated side engine cooling vent louvers
        ch.add_box_gl("grille", sgn * 0.505, 1.28, 1.48, 0.03, 0.26, 0.92, rot_y_deg=-sgn * 3.8)

    # Bold recessed black honeycomb front radiator grille + chrome bezel surround!
    ch.add_box_gl("grille", 0.0, 1.36, 2.21, 0.74, 0.46, 0.06, rot_x_deg=-8.0)
    ch.add_box_gl("chrome", 0.0, 1.61, 2.20, 0.76, 0.045, 0.06)
    ch.add_box_gl("chrome", 0.0, 1.12, 2.23, 0.76, 0.045, 0.06)
    for sgn in (-1.0, 1.0):
        ch.add_box_gl("chrome", sgn * 0.37, 1.36, 2.22, 0.045, 0.48, 0.06, rot_x_deg=-8.0)
    # Front circular German agricultural badge emblem on nose
    ch.add_cyl_gl("yellow", 0.0, 1.54, 2.24, 0.085, 0.085, 0.03, axis='Z', segments=16)

    # --- Fuel Tank, Cab Entry Steps & Iconic Vertical Exhaust Stack (Auspuff) ---
    # Side black molded diesel tank (left side) + hydraulic tank (right side)
    ch.add_box_gl("black",  0.60, 0.92, 0.18, 0.34, 0.48, 0.88)
    ch.add_box_gl("black", -0.60, 0.92, 0.18, 0.34, 0.48, 0.88)
    # Perforated steel entry steps on BOTH sides below cab doors
    for sgn in (-1.0, 1.0):
        for sy, sx_off in [(0.56, 0.74), (0.86, 0.68), (1.16, 0.64)]:
            ch.add_box_gl("chassis", sgn * sx_off, sy, -0.05, 0.22, 0.04, 0.48)
        ch.add_tube_gl("chassis", (sgn * 0.74, 0.56, 0.17), (sgn * 0.62, 1.24, 0.17), 0.022)
        ch.add_tube_gl("chassis", (sgn * 0.74, 0.56, -0.27), (sgn * 0.62, 1.24, -0.27), 0.022)

    # Vertical matte-black Exhaust Stack along Right A-pillar (`exhaustTipOffset = [-0.74, 2.74, 0.50]`)
    ch.add_cyl_gl("black", -0.68, 1.48, 0.54, 0.105, 0.105, 0.84, axis='Y', segments=14)  # muffler body
    ch.add_cyl_gl("grille", -0.68, 1.48, 0.54, 0.118, 0.118, 0.68, axis='Y', segments=14)  # perforated heat guard
    ch.add_cyl_gl("black", -0.72, 2.24, 0.52, 0.055, 0.052, 0.88, axis='Y', segments=12)  # upper stack pipe
    ch.add_tube_gl("black", (-0.72, 2.66, 0.52), (-0.75, 2.76, 0.48), 0.048, segments=10)  # curved exhaust tip
    ch.add_cyl_gl("chrome", -0.74, 2.77, 0.47, 0.058, 0.058, 0.015, axis='Y', segments=10)  # exhaust rain flap

    # --- Wide Smooth Curved Rear Mudguard Fenders (Kotflügel) & Front Fenders ---
    for sgn in (-1.0, 1.0):
        # Smooth continuous lofted wrap-around rear mudguard curving cleanly around rear 0.88m tire!
        # Arc sweeps from front-top (-38 deg) over crown (0 deg) down the rear (+68 deg)!
        r_in, r_out = 0.96, 1.02
        arc_degs = [-38, -22, -6, 10, 26, 42, 56, 68]
        outer_x = sgn * 1.19
        inner_x = sgn * 0.56
        # Green inner painted fender shoulder (from inner_x to mid_x) + satin-black outer flare!
        mid_x = sgn * 0.78
        for mat_k, xa, xb in [("green", min(inner_x, mid_x), max(inner_x, mid_x)),
                              ("black", min(mid_x, outer_x), max(mid_x, outer_x))]:
            pts_yz = []
            for deg in arc_degs:
                a = math.radians(deg)
                pts_yz.append((0.88 + r_out * math.cos(a), -1.26 - r_out * math.sin(a)))
            for deg in reversed(arc_degs):
                a = math.radians(deg)
                pts_yz.append((0.88 + r_in * math.cos(a), -1.26 - r_in * math.sin(a)))
            ch.add_prism_yz_gl(mat_k, pts_yz, xa, xb)
        # Rear mudflap + taillight housing bracket at z=-1.78, y=1.56
        ch.add_box_gl("black", sgn * 0.82, 1.56, -1.78, 0.28, 0.16, 0.12)
        ch.add_box_gl("black", sgn * 0.88, 0.94, -2.18, 0.60, 0.38, 0.03)
        # Curved sleek black front fender hugging the top of the front 0.58m tire!
        f_degs = [-32, -12, 8, 28]
        f_yz = [(0.58 + 0.66 * math.cos(math.radians(d)), 1.42 - 0.66 * math.sin(math.radians(d))) for d in f_degs]
        f_yz += [(0.58 + 0.625 * math.cos(math.radians(d)), 1.42 - 0.625 * math.sin(math.radians(d))) for d in reversed(f_degs)]
        ch.add_prism_yz_gl("black", f_yz, min(sgn * 0.66, sgn * 1.10), max(sgn * 0.66, sgn * 1.10))

    # --- Rear 3-Point Hydraulic Hitch (Dreipunkt-Kraftheber) + Tow Clevis at [0, 0.62, -2.02] ---
    ch.add_box_gl("chassis", 0.0, 0.72, -1.76, 0.44, 0.56, 0.28)  # hitch carrier tower
    # Twin heavy lower lift arms + vertical hydraulic lift rods
    for sgn in (-1.0, 1.0):
        ch.add_tube_gl("chassis", (sgn * 0.26, 0.56, -1.52), (sgn * 0.40, 0.48, -2.08), 0.042, segments=8)
        ch.add_tube_gl("chassis", (sgn * 0.28, 1.18, -1.60), (sgn * 0.36, 0.52, -1.86), 0.032, segments=8)
        ch.add_box_gl("chassis", sgn * 0.28, 1.22, -1.55, 0.10, 0.14, 0.36)
    # Upper central top-link turnbuckle
    ch.add_tube_gl("chrome", (0.0, 1.12, -1.68), (0.0, 1.06, -2.08), 0.028, segments=8)
    # Yellow PTO driveshaft shield stub
    ch.add_cyl_gl("yellow", 0.0, 0.72, -1.88, 0.075, 0.065, 0.16, axis='Z', segments=12)
    # Heavy rear tow clevis jaw + bright red drop tow pin at EXACT `rearHitchOffset = [0.0, 0.62, -2.02]`!
    ch.add_box_gl("chassis", 0.0, 0.67, -1.96, 0.16, 0.045, 0.24)
    ch.add_box_gl("chassis", 0.0, 0.57, -1.96, 0.16, 0.045, 0.24)
    ch.add_cyl_gl("red", 0.0, 0.66, -2.02, 0.028, 0.028, 0.24, axis='Y', segments=10)
    # German rear license plate "DÜW · KH 26" mounted on rear cab panel
    ch.add_box_gl("black", 0.0, 1.48, -1.62, 0.54, 0.15, 0.03)
    ch.add_single_sided_quad_gl("plate", [
        ( 0.25, 1.415, -1.64),
        (-0.25, 1.415, -1.64),
        (-0.25, 1.545, -1.64),
        ( 0.25, 1.545, -1.64),
    ])

    # --- Panoramic ROPS Glass Cab (Spacious Interior Built Specifically for 1st-Person POV!) ---
    # Cab floor platform (y = 1.24, z = -1.36 to +0.44)
    ch.add_box_gl("black", 0.0, 1.24, -0.46, 1.32, 0.09, 1.76)
    # Lower front firewall & sculpted dashboard console (below windshield sightline!)
    ch.add_box_gl("black", 0.0, 1.50, 0.28, 1.20, 0.44, 0.36)
    ch.add_box_gl("black", 0.0, 1.75, 0.22, 0.78, 0.24, 0.22)
    # Illuminated instrument cluster cleanly mounted PROUD on the rear-facing dashboard binnacle!
    ch.add_single_sided_quad_gl("dash", [
        ( 0.29, 1.73, 0.08),
        (-0.29, 1.73, 0.08),
        (-0.29, 1.94, 0.16),
        ( 0.29, 1.94, 0.16),
    ])
    # Instrument binnacle glare hood shading the top of the gauges
    ch.add_box_gl("black", 0.0, 1.955, 0.14, 0.64, 0.03, 0.12)
    # Steering column pedestal from floor to SteeringPivot [0.0, 1.88, -0.02]
    ch.add_tube_gl("black", (0.0, 1.32, 0.20), (0.0, 1.86, -0.01), 0.048, segments=12)

    # Contoured driver seat behind cabCameraOffset (z = -0.78 -> camera at z=-0.58 sees cleanly forward!)
    ch.add_box_gl("chassis", 0.0, 1.36, -0.72, 0.38, 0.24, 0.38)  # air suspension base
    ch.add_box_gl("seat", 0.0, 1.54, -0.70, 0.54, 0.12, 0.50)     # seat cushion
    ch.add_box_gl("seat", 0.0, 1.88, -0.94, 0.52, 0.62, 0.12, rot_x_deg=-10.0)  # backrest
    ch.add_box_gl("seat", 0.0, 2.26, -0.99, 0.32, 0.20, 0.10)     # headrest
    # Right-hand multifunction joystick armrest console (iconic Fendt Vario detail!)
    ch.add_box_gl("black", -0.44, 1.68, -0.58, 0.18, 0.12, 0.56)
    ch.add_cyl_gl("yellow", -0.44, 1.82, -0.38, 0.032, 0.042, 0.16, axis='Y', segments=10)
    ch.add_box_gl("green", -0.44, 1.76, -0.54, 0.08, 0.05, 0.12)

    # 4 Slim Structural ROPS Cab Pillars (Front A-pillars angled gracefully back; Rear C-pillars)
    # Bottom corners at y=1.30; Top corners at y=2.76!
    fl_b, fr_b = ( 0.62, 1.30,  0.42), (-0.62, 1.30,  0.42)
    fl_t, fr_t = ( 0.56, 2.76,  0.22), (-0.56, 2.76,  0.22)
    rl_b, rr_b = ( 0.64, 1.30, -1.28), (-0.64, 1.30, -1.28)
    rl_t, rr_t = ( 0.58, 2.76, -1.20), (-0.58, 2.76, -1.20)
    for a, b in [
        (fl_b, fl_t), (fr_b, fr_t), (rl_b, rl_t), (rr_b, rr_t),
        (fl_t, fr_t), (rl_t, rr_t), (fl_t, rl_t), (fr_t, rr_t),
        (fl_b, rl_b), (fr_b, rr_b),
    ]:
        ch.add_tube_gl("black", a, b, 0.036, segments=8)
    # Lower rear cab steel bulkhead below rear window
    ch.add_box_gl("black", 0.0, 1.54, -1.30, 1.24, 0.52, 0.08)

    # Sculpted Contrasting Light-Silver/White Fendt-Style Cab Roof Canopy (y = 2.76..2.96) + Sun Visor!
    ch.add_box_gl("roof", 0.0, 2.86, -0.46, 1.38, 0.18, 1.78)
    ch.add_box_gl("green", 0.0, 2.77, -0.46, 1.30, 0.06, 1.66)
    # Aerodynamic overhanging front roof sun visor + rear roof lip
    ch.add_box_gl("roof", 0.0, 2.86, 0.48, 1.34, 0.12, 0.24, rot_x_deg=14.0)
    ch.add_box_gl("black", 0.0, 2.80, 0.44, 0.92, 0.08, 0.10)  # front cab work-light bar housing
    ch.add_box_gl("black", 0.0, 2.80, -1.36, 0.96, 0.08, 0.08)  # rear cab work-light housing

    # Telescoping Black Exterior Side Mirrors (great depth cue in BOTH Chase & 1st-Person Cab POV!)
    for sgn in (-1.0, 1.0):
        ch.add_tube_gl("black", (sgn * 0.59, 2.48, 0.30), (sgn * 0.96, 2.44, 0.38), 0.018, segments=6)
        ch.add_tube_gl("black", (sgn * 0.61, 2.08, 0.35), (sgn * 0.96, 2.18, 0.38), 0.016, segments=6)
        ch.add_box_gl("black", sgn * 0.97, 2.31, 0.39, 0.16, 0.34, 0.045, rot_y_deg=-sgn * 14.0)
        ch.add_box_gl("chrome", sgn * 0.96, 2.31, 0.365, 0.14, 0.31, 0.012, rot_y_deg=-sgn * 14.0)

    # Single-Sided Outward-Facing Panoramic Cab Glass (winding CCW viewed from OUTSIDE!)
    # Front windshield (outward normal ~ +Z, +Y): BL(-X), BR(+X), TR(+X), TL(-X) -> check cross product!
    # Wait: in Blender coords gl_to_bl(x,y,z) = (x, -z, y):
    # Viewed from +Z (Blender -Y), right is +X, left is -X, up is +Z_bl.
    # For normal pointing toward -Y_bl (+Z_gl): CCW order from -Y_bl is (-X, bot) -> (+X, bot) -> (+X, top) -> (-X, top)!
    ch.add_single_sided_quad_gl("glass", [
        (-0.59, 1.72, 0.36),
        ( 0.59, 1.72, 0.36),
        ( 0.55, 2.74, 0.22),
        (-0.55, 2.74, 0.22),
    ])
    # Rear window (outward normal -Z_gl = +Y_bl): CCW from +Y_bl is (+X, bot) -> (-X, bot) -> (-X, top) -> (+X, top)
    ch.add_single_sided_quad_gl("glass", [
        ( 0.60, 1.80, -1.26),
        (-0.60, 1.80, -1.26),
        (-0.56, 2.74, -1.20),
        ( 0.56, 2.74, -1.20),
    ])
    # Left cab door glass (outward normal +X_gl = +X_bl): CCW from +X_bl is (-Y_bl/+Z_gl, bot) -> (+Y_bl/-Z_gl, bot) -> top
    ch.add_single_sided_quad_gl("glass", [
        (0.62, 1.34,  0.38),
        (0.63, 1.34, -1.25),
        (0.57, 2.74, -1.20),
        (0.56, 2.74,  0.22),
    ])
    # Right cab door glass (outward normal -X_gl = -X_bl): reversed order!
    ch.add_single_sided_quad_gl("glass", [
        (-0.63, 1.34, -1.25),
        (-0.62, 1.34,  0.38),
        (-0.56, 2.74,  0.22),
        (-0.57, 2.74, -1.20),
    ])

    chassis_obj = ch.build_object(col, keep_winding_keys={"glass", "dash", "plate"})

    # ==================================================================
    # 2. 4 INDIVIDUALLY RIGGED DEEP-LUGGED AGRICULTURAL WHEELS
    # ==================================================================
    wp = TRACTOR_SPECS["wheelPositions"]
    rf = TRACTOR_SPECS["frontWheelRadius"]
    rr = TRACTOR_SPECS["rearWheelRadius"]

    wheel_fl = build_agri_wheel("Wheel_FL", col, wp["FL"], rf, 0.42, True,  m_tire, m_yellow, m_chassis, m_chrome, lug_pairs=14, lug_height=0.044)
    wheel_fr = build_agri_wheel("Wheel_FR", col, wp["FR"], rf, 0.42, False, m_tire, m_yellow, m_chassis, m_chrome, lug_pairs=14, lug_height=0.044)
    wheel_rl = build_agri_wheel("Wheel_RL", col, wp["RL"], rr, 0.58, True,  m_tire, m_yellow, m_chassis, m_chrome, lug_pairs=18, lug_height=0.062)
    wheel_rr = build_agri_wheel("Wheel_RR", col, wp["RR"], rr, 0.58, False, m_tire, m_yellow, m_chassis, m_chrome, lug_pairs=18, lug_height=0.062)

    # ==================================================================
    # 3. STEERING WHEEL (Parented to Tilted SteeringPivot -> spins cleanly on local Z!)
    # ==================================================================
    sw_pivot = bpy.data.objects.new("SteeringPivot", None)
    sw_pivot.location = gl_to_bl(*TRACTOR_SPECS["steeringWheelOrigin"])
    # Tilt steering column 32° so wheel face angles ergonomically UPWARD toward driver's eyes!
    sw_pivot.rotation_euler = (math.radians(32.0), 0.0, 0.0)
    col.objects.link(sw_pivot)

    sw = MultiMatMesh("SteeringWheel")
    sw.ensure_mat("grip", m_rubber_black, smooth=True)
    sw.ensure_mat("cap", m_yellow, smooth=True)
    sw.ensure_mat("chrome", m_chrome, smooth=True)
    # Smooth sculpted torus steering wheel rim in local XY plane (Z=0), radius 0.20m!
    bm_sw = sw.bms["grip"]
    rim_r, tube_r = 0.205, 0.019
    n_maj, n_min = 32, 10
    tor_rings = []
    for i in range(n_maj):
        a = 2.0 * math.pi * i / n_maj
        ca, sa = math.cos(a), math.sin(a)
        ring = []
        for j in range(n_min):
            b = 2.0 * math.pi * j / n_min
            rr = rim_r + tube_r * math.cos(b)
            zz = tube_r * math.sin(b)
            ring.append(bm_sw.verts.new(gl_to_bl(rr * ca, rr * sa, zz)))
        tor_rings.append(ring)
    for i in range(n_maj):
        inext = (i + 1) % n_maj
        for j in range(n_min):
            jnext = (j + 1) % n_min
            bm_sw.faces.new([tor_rings[i][j], tor_rings[inext][j], tor_rings[inext][jnext], tor_rings[i][jnext]])
    # 3 ergonomic spokes + center horn hub + classic tractor steering spinner knob!
    for a_deg in (-90, 28, 152):
        a = math.radians(a_deg)
        sw.add_tube_gl("grip", (0.0, 0.0, 0.0), (rim_r * 0.96 * math.cos(a), rim_r * 0.96 * math.sin(a), 0.0), 0.017, segments=6)
    sw.add_cyl_gl("grip", 0.0, 0.0, 0.0, 0.055, 0.050, 0.045, axis='Z', segments=14)
    sw.add_cyl_gl("cap", 0.0, 0.0, -0.024, 0.032, 0.032, 0.012, axis='Z', segments=12)
    # Tractor palm spinner knob on rim
    sw.add_cyl_gl("chrome", rim_r * 0.72, rim_r * 0.69, -0.035, 0.018, 0.024, 0.055, axis='Z', segments=10)
    sw_obj = sw.build_object(col, location_gl=(0.0, 0.0, 0.0), parent=sw_pivot)

    # ==================================================================
    # 4. BEACON (Amber Rundumleuchte w/ Internal Spinning Mirror Reflector!)
    # ==================================================================
    bc = MultiMatMesh("Beacon")
    bc.ensure_mat("base", m_rubber_black, smooth=True)
    bc.ensure_mat("reflector", m_chrome, smooth=False)
    bc.ensure_mat("amber", m_beacon, tile_u=0.5, tile_v=0.5, smooth=True)
    # Flexible black mounting stalk + cylindrical base collar
    bc.add_cyl_gl("base", 0.0, -0.11, 0.0, 0.022, 0.022, 0.14, axis='Y', segments=10)
    bc.add_cyl_gl("base", 0.0, -0.03, 0.0, 0.072, 0.068, 0.055, axis='Y', segments=16)
    # Internal angled chrome parabolic reflector + bright bulb (spins with Beacon.rotation.y!)
    bc.add_box_gl("reflector", 0.0, 0.055, 0.025, 0.065, 0.085, 0.015, rot_x_deg=-12.0)
    # Translucent fluted amber Fresnel dome
    bc.add_cyl_gl("amber", 0.0, 0.065, 0.0, 0.066, 0.056, 0.135, axis='Y', segments=18)
    bc.add_cyl_gl("amber", 0.0, 0.142, 0.0, 0.056, 0.020, 0.026, axis='Y', segments=18)
    beacon_obj = bc.build_object(col, location_gl=TRACTOR_SPECS["beaconOffset"])

    # ==================================================================
    # 5. HEADLIGHTS & TAILLIGHTS (Separate Emissive-Ready Meshes!)
    # ==================================================================
    hl = MultiMatMesh("Headlights")
    hl.ensure_mat("led", m_headlight, smooth=False)
    # Main front nose grille LED headlights
    for hx, hy, hz in TRACTOR_SPECS["headlightOffsets"]:
        hl.add_box_gl("led", hx, hy, hz, 0.17, 0.095, 0.035, rot_x_deg=-8.0)
    # Upper cab roof work lights
    for sgn in (-1.0, 1.0):
        hl.add_box_gl("led", sgn * 0.34, 2.80, 0.49, 0.13, 0.065, 0.03)
    headlights_obj = hl.build_object(col)

    tl = MultiMatMesh("Taillights")
    tl.ensure_mat("red_led", m_taillight, smooth=False)
    tl.ensure_mat("amber_led", m_beacon, smooth=False)
    for tx, ty, tz in TRACTOR_SPECS["taillightOffsets"]:
        tl.add_box_gl("red_led", tx, ty, tz, 0.16, 0.09, 0.035)
        tl.add_box_gl("amber_led", tx + (0.10 if tx > 0 else -0.10), ty, tz, 0.07, 0.09, 0.035)
    taillights_obj = tl.build_object(col)

    return [chassis_obj, wheel_fl, wheel_fr, wheel_rl, wheel_rr, sw_pivot, sw_obj, beacon_obj, headlights_obj, taillights_obj]


def main():
    clear_scene()
    col = ensure_collection("Kindenheim_Tractor")
    objs = build_tractor_nodes(col)
    save_blend_and_export_glb(
        TRACTOR_DIR / "tractor.blend",
        GLB_OUT_DIR / "tractor.glb",
        objs,
    )
    # 1. Exterior 3/4 hero studio-sunlit preview (full tractor from front weights to beacon & rear fender!)
    render_vehicle_preview(
        ARTIFACT_DIR / "preview_tractor_hero.png",
        cam_pos_gl=(5.4, 2.35, 5.2),
        look_at_gl=(0.0, 1.48, 0.15),
        lens_mm=40.0,
        samples=48,
    )
    # 2. Actual 1st-Person Cockpit Cab POV (verifying clear unobstructed view past SteeringWheel, gauges & hood!)
    cx, cy, cz = TRACTOR_SPECS["cabCameraOffset"]
    render_vehicle_preview(
        ARTIFACT_DIR / "preview_tractor_cab_pov.png",
        cam_pos_gl=(cx, cy, cz),
        look_at_gl=(0.0, 1.54, 5.5),
        lens_mm=24.0,
        samples=44,
    )


if __name__ == "__main__":
    main()

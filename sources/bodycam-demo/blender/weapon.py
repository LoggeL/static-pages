# Karabiner (AR-15/M4-Bauart, 14,5") – Treiber.
# Aufruf: blender -b --python-exit-code 1 -P weapon.py -- [--stage geo|full] [--tex 1024] [--samples 32]
#   [--geometry-ratio 0.52] [--image-format WEBP] [--quality 92] [--data-quality 95]
#   [--out-dir <models>] [--blend <carbine.blend>]
# Stufen: geo  = nur Geometrie + Hierarchie + Empties + .blend (schnell, mit Vorschau-Materialien)
#         full = zusätzlich UV-Atlanten, prozedurale Materialien, Bake (albedo/ORM/normal), GLB-Exporte
import bpy, sys, os, math, time, argparse
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
for m in ("weapon_geo", "weapon_parts", "weapon_mat"):
    if m in sys.modules:
        del sys.modules[m]
import weapon_geo as G
import weapon_parts as P
from mathutils import Vector, Matrix

REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
WORK = "/Users/logge/Documents/Projects/bodycam-work/codex/C9"

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--stage", choices=("geo", "full"), default="full")
ap.add_argument("--tex", type=int, default=1024, help="Base atlas edge; detail atlas uses 1.5x, others follow area")
ap.add_argument("--samples", type=int, default=32)
ap.add_argument("--geometry-ratio", type=float, default=0.52)
ap.add_argument("--image-format", choices=("WEBP", "JPEG"), default="WEBP")
ap.add_argument("--quality", type=int, default=92, help="Albedo image quality")
ap.add_argument("--data-quality", type=int, default=95, help="ORM and normal image quality")
ap.add_argument("--out-dir", default=os.path.join(REPO, "public", "bodycam-demo", "models"))
ap.add_argument("--blend", default=os.path.join(WORK, "blend", "carbine.blend"))
ap.add_argument("--work", default=os.path.join(WORK, "bake"))
ARGS = ap.parse_args(argv)
if ARGS.tex < 128 or ARGS.samples < 1 or not 0 < ARGS.geometry_ratio <= 1 or not 1 <= ARGS.quality <= 100 or not 1 <= ARGS.data_quality <= 100:
    ap.error("tex >= 128, samples >= 1, 0 < geometry-ratio <= 1, 1 <= quality <= 100 required")
MM = 0.001
T0 = time.time()


def log(*a):
    print("[weapon %6.1fs]" % (time.time() - T0), *a, flush=True)


# ------------------------------------------------------------------ Szene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.render.engine = 'CYCLES'
    return sc


def new_coll(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


# ------------------------------------------------------------------ Hierarchie
# Bewegliche Teile: Name -> Drehpunkt (mm, Baurahmen) für den Objekt-Ursprung
MOVING = {
    "W_Mag": (0.0, P.MAGWELL_Y, -21.0),
    "W_Bolt": (0.0, 52.0, 0.0),
    "W_ChargingHandle": (0.0, 0.0, 18.9),
    "W_Trigger": (0.0, 74.0, -36.0),        # dreht um X (Abzugsstift)
    "W_Selector": (-14.0, 45.0, -30.0),     # dreht um X: 0 = SAFE (nach vorn), +90° = FIRE
    "W_BoltCatch": (-15.75, 110.5, -21.5),  # dreht um X
    "W_DustCover": (15.6, 137.0, -12.6),    # dreht um Y (Scharnier)
}
SPECIAL = ("W_SightGlass", "W_Reticle", "W_LightLens")


def set_origin(ob, p_mm):
    """Objekt-Ursprung auf p (mm, Baurahmen) setzen, ohne Geometrie zu verschieben."""
    p = Vector(p_mm) * MM
    ob.data.transform(Matrix.Translation(-p))
    ob.matrix_world = Matrix.Translation(p) @ ob.matrix_world


def empties(root, coll):
    O = Vector(P.ORIGIN) * MM
    E = {}

    def emp(name, p_mm, rot=(0, 0, 0), size=0.02, parent=None):
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = 'ARROWS'
        e.empty_display_size = size
        coll.objects.link(e)
        e.parent = parent or root
        e.location = Vector(p_mm) * MM - O
        e.rotation_euler = [math.radians(r) for r in rot]
        E[name] = e
        return e

    # Mündung: lokale +Y = Schussrichtung (wie die Waffe)
    emp("W_Muzzle", (0.0, P.FH_END, 0.0))
    # Auswurf: lokale +X = Auswurfrichtung (nach rechts, leicht nach vorn/oben wie beim echten AR)
    emp("W_Ejection", (16.5, 138.0, 0.0), rot=(0, -10, 25))
    # STYLE §5.2: 130 mm behind the rear of the sight hood.
    emp("W_SightEye", (0.0, P.EYE_Y, P.SIGHT_Z))
    emp("W_LightEmitter", (P.LIGHT_C[0], P.LIGHT_Y1 + 0.5, P.LIGHT_C[1]))
    # Rechte Hand: Griffmitte (=Ursprung), Handfläche hinten am Griff
    emp("W_Grip_R", P.ORIGIN, rot=(-21, 0, 0))
    # Linke Hand: am Winkelgriff (Daumen auf Handschutz)
    emp("W_Grip_L", (0.0, 318.0, -32.0), rot=(30, 0, 0))
    emp("W_MagWell", (0.0, P.MAGWELL_Y, -73.0))
    return E


def main():
    sc = reset()
    coll = new_coll("Carbine")
    G.set_collection(coll)
    P.PARTS.clear()
    log("baue Teile …")
    parts = P.build_all()
    missing = set(MOVING) - {"W_Mag"} - parts.keys()
    assert not missing, "Missing moving objects: " + str(missing)
    assert set(coll.objects) == set(parts.values()), "Unregistered loose geometry"
    log("Teile:", len(parts), "Dreiecke (mit Modifiern):", G.tri_count(list(parts.values())))
    import weapon_mat as WM
    # Atlas-Aufteilung: große Gehäuseteile (A), Kleinteile/Visier/Licht (S), Kunststoff (B), Magazin (C)
    BIG = ("Upper", "Lower", "Handguard", "BufferTube", "Tower")
    for n, o in parts.items():
        if o.get("atlas") == "A" and n not in BIG:
            o["atlas"] = "S"
    WM.assign_materials(parts)
    for o in parts.values():
        if o.modifiers:
            G.apply_mods(o)
        if o.get("atlas") and len(o.data.polygons) > 80 and ARGS.geometry_ratio < 1:
            # Reapply the existing weighted-normal recipe after decimation,
            # keeping flat receiver/stock faces flat.
            dec = o.modifiers.new("ExportLOD", 'DECIMATE')
            dec.ratio = ARGS.geometry_ratio
            dec.use_collapse_triangulate = True
            G.apply_mods(o)
            transfer = o.modifiers.new('RestoreSurfaceNormals', 'WEIGHTED_NORMAL')
            transfer.keep_sharp = True
            transfer.weight = 50
            transfer.mode = 'FACE_AREA'
            G.apply_mods(o)
        tr = o.modifiers.new("T", 'TRIANGULATE')
        if hasattr(tr, "keep_custom_normals"):
            tr.keep_custom_normals = True
        tr.quad_method = 'BEAUTY'
        G.apply_mods(o)
        o.data.name = o.name
    # bewegliche Teile: W_Mag aus Magazin + Patrone (Operator-Join erhält Custom Normals + Materialslots)
    mag_objs = [parts.pop(n) for n in list(parts) if n.startswith("MagRound") or n == "MagBody"]
    mag_objs.sort(key=lambda o: o.name != "MagBody")
    mag = WM.join_objs(mag_objs, "W_Mag")
    mag["wmat"] = "poly_mag"
    mag["atlas"] = "C"
    parts["W_Mag"] = mag
    root = bpy.data.objects.new("W_Root", None)
    root.empty_display_size = 0.05
    coll.objects.link(root)
    O = Vector(P.ORIGIN) * MM
    for name, ob in parts.items():
        ob.data.transform(Matrix.Translation(-O))
    for name, piv in MOVING.items():
        if name in parts:
            set_origin(parts[name], tuple(piv[i] - P.ORIGIN[i] for i in range(3)))
    for ob in parts.values():
        ob.parent = root
    E = empties(root, coll)
    root["units"] = "meters"
    root["forward"] = "-Z (glTF)"
    root["origin"] = "pistol grip, trigger-finger height"
    for name in MOVING:
        parts[name]["movingPart"] = True
    return sc, coll, root, parts, E


if __name__ == "__main__":
    sc, coll, root, parts, E = main()
    import weapon_mat as WM
    WM.run(ARGS, sc, coll, root, parts, E, log)

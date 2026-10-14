# UNIT 27 · Bodycam-Tech-Demo — PROPS-KÜCHE-BAD ("kitchenbath")
# Prozedurale, abgenutzte Küchen-, Bad- und Waschküchen-Props für das verlassene Haus.
#
#   blender -b -P props_kitchenbath.py -- [--only a,b,c] [--no-export] [--no-blend] [--no-bake]
#
# Ergebnis: public/bodycam-demo/models/props/<name>.glb   (je Prop ein Mesh-Objekt <name>, mehrere Materialien)
#           sources/bodycam-demo/blender/props_kitchenbath.json (Katalogfragment)
#           $WORK/blend/props_kitchenbath.blend (alle Props, je Collection <name>)
# Konventionen (CONTRACT.md): Meter, Ursprung Boden mittig (Mitte der Korpus-Grundfläche), Vorderseite Blender −Y,
# UV in Weltmetern (Box-Projektion) für M_<key>; Unikate MU_<name>:
#   - MU_<bild>  : Imagegen-Bild (Etikett/Bedienblende), eigene 0..1-UV
#   - MU_<prop>  : je Prop gebackene, nicht kachelnde Schmutztextur (Albedo + ORM) auf eigenem UV-Atlas
# COLOR_0 = gebackene AO + Schmutz (linear, multiplikativ). Objekt-Property "surface".
# Teile: props_kitchenbath_lib.py (Werkzeuge), props_kitchenbath_kitchen.py, _bath.py, _laundry.py (Props).
import bpy, os, sys, json, time, random

REPO = '/Users/logge/Documents/Projects/static-pages'
WORK = '/Users/logge/Documents/Projects/bodycam-work'
OUT_DIR = REPO + '/public/bodycam-demo/models/props'
CATALOG = REPO + '/sources/bodycam-demo/blender/props_kitchenbath.json'
IMG_SRC = REPO + '/sources/bodycam-demo/blender/props_kitchenbath_img'   # Imagegen-Quellbilder (JPG, verkleinert)
BAKE_DIR = WORK + '/props_kitchenbath/bake'                   # gebackene Schmutztexturen (reproduzierbar)
BLEND_OUT = WORK + '/blend/props_kitchenbath.blend'
HERE = os.path.dirname(os.path.abspath(__file__))

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith('--') else True
    return default


exec(compile(open(os.path.join(HERE, 'props_kitchenbath_lib.py')).read(), 'props_kitchenbath_lib.py', 'exec'), globals())

# ----------------------------------------------------------------------------------------------
PROPS = {}


def prop(name, surface, room, notes, mount=None):
    def deco(fn):
        PROPS[name] = dict(fn=fn, surface=surface, room=room, notes=notes, mount=mount)
        return fn
    return deco


def finalize(ob, name, surface, center=None, ao=None, tint_fn=None, masks=None, bake=None, seed=0,
             smooth_angle=60, floor_dirt=0.35, grime=0.15):
    """Ursprung (Boden, Mitte von center=(x0,x1,y0,y1) oder Bounding-Box), UV, Normalen, AO/Schmutz, Backen."""
    apply_mods(ob)
    apply_tf(ob)
    me = ob.data
    co = np.array([v.co[:] for v in me.vertices], np.float32)
    if center:
        cx, cy = (center[0] + center[1]) / 2, (center[2] + center[3]) / 2
    else:
        cx, cy = (co[:, 0].min() + co[:, 0].max()) / 2, (co[:, 1].min() + co[:, 1].max()) / 2
    me.transform(Matrix.Translation((-cx, -cy, -co[:, 2].min())))
    me.update()
    # Glättung: weich bis smooth_angle, dann gewichtete Normalen (flache Flächen bleiben flach)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=radians(smooth_angle))
    wn = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
    wn.mode = 'FACE_AREA'
    wn.weight = 50
    wn.keep_sharp = True
    apply_mods(ob)
    me = ob.data
    # UV
    box_uv(ob, seed=seed)
    bake_mats = [m.name for m in me.materials if m and m.get('kb_bake')]
    if bake_mats:
        smart_uv_faces(ob, set(bake_mats))
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[1])
    ob.name = name
    me.name = name
    # AO + Konvexität
    a = dict(rays=24, dist=0.25, strength=0.85)
    a.update(ao or {})
    aov = vertex_ao(ob, rays=a['rays'], dist=a['dist'])
    cvx = vertex_convexity(ob)
    KB_CACHE[name + ':ao'] = aov
    KB_CACHE[name + ':cvx'] = cvx
    co = np.array([v.co[:] for v in me.vertices], np.float32)
    nrm = np.array([v.normal[:] for v in me.vertices], np.float32)
    vmat = np.zeros(len(co), np.int32)
    for p in me.polygons:
        for vi in p.vertices:
            vmat[vi] = p.material_index
    mnames = np.array([(m.name if m else '') for m in me.materials] + [''])[vmat]
    for at in list(me.attributes):
        if at.name.startswith('kbm_') and at.domain == 'POINT':
            arr = np.zeros(len(me.vertices), np.float32)
            at.data.foreach_get('value', arr)
            KB_CACHE[name + ':m_' + at.name[4:]] = arr
    for at in [a.name for a in me.attributes if a.name.startswith('kbm_')]:
        me.attributes.remove(me.attributes[at])
    if masks:
        for mk, fn in masks.items():
            KB_CACHE[name + ':m_' + mk] = fn(co, nrm).astype(np.float32)
    # Vertexfarbe: AO * Bodenschmutz * leichter Schmutz * Tönung
    val = 1.0 - a['strength'] * (1.0 - aov)
    off = np.array([seed * 3.3, seed * 1.7, seed * 5.1], np.float32)
    g = nfbm(co + off, 4.0, 3, seed)
    zmin = co[:, 2].min()
    fd = floor_dirt * np.exp(-(co[:, 2] - zmin) / 0.06) * (0.6 + 0.4 * g)
    gm = np.clip((g - 0.45) * 2.0, 0, 1) * grime
    d = np.clip(gm + fd, 0, 0.85)
    tintc = np.array([0.92, 0.84, 0.70], np.float32)
    cols = val[:, None] * (1 - d[:, None] * (1 - tintc) - d[:, None] * 0.3)
    isbake = np.isin(mnames, bake_mats) if bake_mats else np.zeros(len(co), bool)
    # gebackene Flächen tragen den Schmutz in der Textur: dort nur AO
    cols[isbake] = val[isbake, None]
    if tint_fn:
        cols = cols * tint_fn(co, nrm, mnames)
    write_vcol(ob, np.clip(cols, 0.12, 1.0))
    # Backen
    if bake_mats and not arg('--no-bake'):
        for mn in bake_mats:
            k = mn[3:]
            rec = UNIQUE_BAKE[k]
            bake_unique(ob, mn, rec['res'], rec['recipe'], BAKE_DIR)
    ob.name = name
    me.name = name
    ob['surface'] = surface
    return ob


def clean_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def export_glb(ob, path):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_extras=True, export_yup=True, export_normals=True, export_tangents=False,
                              export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=85,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_animations=False, export_skins=False, export_morph=False,
                              export_cameras=False, export_lights=False)


def dims_of(ob):
    co = np.array([v.co[:] for v in ob.data.vertices], np.float32)
    return [round(float(co[:, i].max() - co[:, i].min()), 3) for i in range(3)]


for _f in ('props_kitchenbath_kitchen.py', 'props_kitchenbath_bath.py', 'props_kitchenbath_laundry.py'):
    _p = os.path.join(HERE, _f)
    if os.path.exists(_p):
        exec(compile(open(_p).read(), _f, 'exec'), globals())


def main():
    only = arg('--only')
    names = list(PROPS.keys()) if not only or only is True else [n for n in only.split(',') if n]
    keep_blend = os.path.exists(BLEND_OUT) and only and only is not True and not arg('--fresh')
    if keep_blend:
        bpy.ops.wm.open_mainfile(filepath=BLEND_OUT)
        for n in names:   # alte Fassung entfernen
            c = bpy.data.collections.get(n)
            if c:
                for o in list(c.objects):
                    remove(o)
                bpy.data.collections.remove(c)
        for m in list(bpy.data.materials):
            if m.users == 0:
                bpy.data.materials.remove(m)
        for im in list(bpy.data.images):
            if im.users == 0:
                bpy.data.images.remove(im)
    else:
        clean_scene()
    os.makedirs(OUT_DIR, exist_ok=True)
    cat = []
    if os.path.exists(CATALOG):
        try:
            cat = json.load(open(CATALOG))
        except Exception:
            cat = []
    catd = {c['name']: c for c in cat}
    for name in names:
        info = PROPS[name]
        t0 = time.time()
        random.seed(name)
        ob = info['fn']()
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        col.objects.link(ob)
        # Reste der Arbeitssammlung entfernen
        w = bpy.data.collections.get('_WORK')
        if w:
            for o in list(w.objects):
                remove(o)
        mats = [m.name for m in ob.data.materials if m]
        tris = tri_count(ob)
        dims = dims_of(ob)
        entry = dict(name=name, dims=dims, surface=info['surface'], materials=mats, roomHint=info['room'],
                     notes=info['notes'], tris=tris)
        if info.get('mount'):
            entry['mount'] = info['mount']
        catd[name] = entry
        if not arg('--no-export'):
            # GLB: Material-Fallbackfarbe als baseColorFactor (glTF-Exporter nimmt Principled-Werte)
            export_glb(ob, os.path.join(OUT_DIR, name + '.glb'))
        sz = os.path.getsize(os.path.join(OUT_DIR, name + '.glb')) if os.path.exists(os.path.join(OUT_DIR, name + '.glb')) else 0
        print(f'PROP {name}: {tris} tris, dims {dims}, mats {mats}, {sz/1024:.0f} KB, {time.time()-t0:.1f}s', flush=True)
    order = [n for n in PROPS if n in catd] + [n for n in catd if n not in PROPS]
    json.dump([catd[n] for n in order], open(CATALOG, 'w'), indent=1, ensure_ascii=False)
    w = bpy.data.collections.get('_WORK')
    if w:
        bpy.data.collections.remove(w)
    if not arg('--no-blend'):
        os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT, compress=True)
    print('DONE', len(names), 'props')


main()

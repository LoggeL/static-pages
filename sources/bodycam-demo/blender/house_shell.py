"""house_shell.py - Rohbau des verlassenen Vorstadthauses (UNIT 27 Bodycam-Demo, Baustein SHELL).

Aufruf (headless):
  blender -b -P house_shell.py -- [--blend OUT.blend] [--layout OUT.json] [--glb OUT.glb]

Erzeugt Architektur ohne lose Props: Innenraeume (Boden/Waende/Decken mit Verfall), Tueren (DOOR_*),
Fenster (WIN_*/GLASS_*/BOARDS_*), Aussenhuelle (Fassade, Dach, Veranda), Grundstueck/Strasse/Nachbarn.
Materialien heissen M_<textureId> (ohne Bildtexturen, baseColor als Fallback), UV in Weltmetern.
Koordinaten: Blender Z-up, Meter. Strasse liegt bei -Y, Haustuer zeigt nach -Y.
"""
import bpy, sys, os, math, json, random
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib
import shell_lib as L
importlib.reload(L)
from shell_lib import MB, V, Z, X, Y, rng, box, obox, beam, prism, cylinder, tube_path, grid_slab, surface_grid, jagged, coll, make_obj, bool_apply, world_uv, clip_poly_rect

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1] if i + 1 < len(ARGS) else default
    return default


SCRATCH = '/Users/logge/Documents/Projects/bodycam-work'
OUT_BLEND = arg('--blend', SCRATCH + '/blend/house_shell.blend')
OUT_LAYOUT = arg('--layout', os.path.join(HERE, 'layout.json'))
OUT_GLB = arg('--glb', None)

# ------------------------------------------------------------------ Grundmasse
FFL = 0.60          # Oberkante Fertigfussboden
CEIL = 3.20         # Unterkante Decke (FFL + 2.60)
DW = 0.0125         # Gipskarton
FIN = 0.015         # Bodenbelag-Dicke
JT = 0.019          # Futterbrett (Zarge)
CAS_W = 0.07        # Bekleidung innen
CAS_T = 0.016
EXT = (-6.5, 0.0, 6.5, 10.0)   # Aussenmass x0,y0,x1,y1
WALL_EXT = 0.20
WALL_INT = 0.12
SHEATH = 0.012
ROOF_S = 5.0 / 12.0  # Dachneigung
ROOF_Z0 = 3.62       # OK Dachhaut ueber Aussenwandflucht
EAVE = 0.5
RAKE = 0.3
SIDING_Z0 = 0.4

# ------------------------------------------------------------------ Materialien
TEX = {  # lineare Mittelwerte der Albedo + Rauheit (aus textures/*/albedo.jpg, orm.jpg)
    "concrete_floor": [0.258, 0.24, 0.215, 0.83], "asphalt_wet": [0.065, 0.061, 0.059, 0.4], "grass_dead": [0.145, 0.101, 0.056, 0.88],
    "dirt_mud": [0.095, 0.066, 0.048, 0.65], "wood_floor_worn": [0.255, 0.15, 0.08, 0.51], "carpet_stained": [0.31, 0.236, 0.171, 0.97],
    "tile_floor_dirty": [0.485, 0.402, 0.309, 0.38], "tile_wall_white": [0.588, 0.557, 0.482, 0.2], "wallpaper_peeling": [0.46, 0.322, 0.189, 0.83],
    "plaster_painted_dirty": [0.574, 0.497, 0.403, 0.87], "plaster_damaged": [0.481, 0.431, 0.369, 0.91], "ceiling_stained": [0.493, 0.431, 0.338, 0.97],
    "wood_door_painted": [0.625, 0.582, 0.521, 0.48], "siding_vinyl_dirty": [0.315, 0.291, 0.232, 0.58], "roof_shingles": [0.097, 0.082, 0.067, 0.9],
    "wood_trim_painted": [0.556, 0.495, 0.401, 0.55], "metal_rusty": [0.203, 0.12, 0.062, 0.81], "fabric_sofa_dirty": [0.194, 0.109, 0.043, 0.96],
    "mattress_stained": [0.44, 0.345, 0.233, 0.93], "cardboard": [0.399, 0.251, 0.138, 0.89], "laminate_counter": [0.6, 0.458, 0.215, 0.31],
    "cabinet_wood": [0.095, 0.053, 0.026, 0.5], "brick_red": [0.236, 0.097, 0.066, 0.89], "wood_planks_raw": [0.227, 0.193, 0.162, 0.87],
}
EXTRA_MATS = {  # Materialien ohne Kacheltextur (nur baseColor)
    'M_insulation': ((0.36, 0.29, 0.21, 1), 0.95, 0.0),
    'M_wire': ((0.55, 0.52, 0.42, 1), 0.6, 0.0),
    'M_metal_galv': ((0.30, 0.30, 0.29, 1), 0.55, 0.85),
    'M_metal_dark': ((0.03, 0.03, 0.03, 1), 0.6, 0.6),
    'M_rubber_black': ((0.015, 0.015, 0.015, 1), 0.8, 0.0),
    'M_porcelain': ((0.55, 0.55, 0.52, 1), 0.3, 0.0),
    'M_paint_red': ((0.30, 0.03, 0.02, 1), 0.6, 0.1),
    'M_paint_yellow_road': ((0.45, 0.33, 0.05, 1), 0.7, 0.0),
    'M_void': ((0.0, 0.0, 0.0, 1), 1.0, 0.0),
}
_MATS = {}


def M(name):
    """Material holen/anlegen. name = 'wood_trim_painted' -> M_wood_trim_painted, oder voller Name."""
    full = name if name.startswith(('M_', 'MU_', 'ME_')) else 'M_' + name
    if full in _MATS:
        return _MATS[full]
    m = bpy.data.materials.get(full) or bpy.data.materials.new(full)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    tid = full[2:]
    if full in EXTRA_MATS:
        col, rough, metal = EXTRA_MATS[full]
    elif tid in TEX:
        t = TEX[tid]
        col, rough, metal = (t[0], t[1], t[2], 1), t[3], (0.5 if tid == 'metal_rusty' else 0.0)
        m['textureId'] = tid
    else:
        col, rough, metal = (0.5, 0.5, 0.5, 1), 0.7, 0.0
    if full == 'M_glass_dirty' or full == 'M_glass':
        col, rough, metal = (0.32, 0.34, 0.30, 0.35), 0.18, 0.0
        bsdf.inputs['Alpha'].default_value = 0.35
        try:
            m.blend_method = 'BLEND'
        except Exception:
            pass
        m.use_backface_culling = False
    if full == 'ME_sodium':
        col, rough, metal = (1.0, 0.55, 0.18, 1), 0.4, 0.0
        bsdf.inputs['Emission Color'].default_value = (1.0, 0.50, 0.15, 1)
        bsdf.inputs['Emission Strength'].default_value = 25.0
    if full == 'ME_window_warm':
        col, rough, metal = (0.6, 0.4, 0.2, 1), 0.4, 0.0
        bsdf.inputs['Emission Color'].default_value = (1.0, 0.62, 0.30, 1)
        bsdf.inputs['Emission Strength'].default_value = 1.2
    if full == 'MU_chainlink':
        col, rough, metal = (0.35, 0.34, 0.32, 1), 0.5, 0.8
        m.use_backface_culling = False
        _chainlink_texture(m, bsdf)
    bsdf.inputs['Base Color'].default_value = col
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    m.diffuse_color = col
    _MATS[full] = m
    return m


def _chainlink_texture(m, bsdf):
    """Maschendraht als RGBA-Unikat (1 Kachel = 1 m), wird von Blender gepackt."""
    import numpy as np
    path = os.path.join(HERE, 'shell_tex', 'chainlink.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    N = 512
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / N
    p = 1.0 / 16.0
    # Rauten: zwei diagonale Drahtscharen
    d1 = np.abs(((xx + yy) / p) % 1.0 - 0.5)
    d2 = np.abs(((xx - yy) / p) % 1.0 - 0.5)
    w = 0.5 - 0.075
    a = np.clip(np.maximum(d1, d2) - w, 0, 0.03) / 0.03
    img = bpy.data.images.new('MU_chainlink_tex', N, N, alpha=True)
    px = np.zeros((N, N, 4), np.float32)
    px[..., 0] = 0.42; px[..., 1] = 0.41; px[..., 2] = 0.38
    px[..., 3] = a
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.pack()
    nt = m.node_tree
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = img
    nt.links.new(tn.outputs['Alpha'], bsdf.inputs['Alpha'])
    try:
        m.blend_method = 'CLIP'
    except Exception:
        pass


# ------------------------------------------------------------------ Raeume
def R(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


ROOMS = {
    'LIV': dict(name='Wohnzimmer', poly=R(-6.3, 0.2, -1.0, 5.0), rects=[(-6.3, 0.2, -1.0, 5.0)], floor='carpet_stained', walls='wallpaper',
                reverb=dict(preset='room_medium_soft', rt60=0.55, sizeM3=round(5.3 * 4.8 * 2.6, 1))),
    'KIT': dict(name='Kueche und Essbereich', poly=R(-6.3, 5.12, -1.0, 9.8), rects=[(-6.3, 5.12, -1.0, 9.8)], floor='tile_floor_dirty', walls='paint',
                reverb=dict(preset='room_medium_hard', rt60=0.8, sizeM3=round(5.3 * 4.68 * 2.6, 1))),
    'HAL': dict(name='Flur', poly=[(-0.88, 0.2), (0.32, 0.2), (0.32, 4.40), (6.3, 4.40), (6.3, 5.50), (0.32, 5.50), (0.32, 8.0), (-0.88, 8.0)],
                rects=[(-0.88, 0.2, 0.32, 8.0), (0.32, 4.40, 6.3, 5.50)], floor='wood_floor_worn', walls='paint',
                reverb=dict(preset='hallway', rt60=0.65, sizeM3=round((1.2 * 7.8 + 6.0 * 1.1) * 2.6, 1))),
    'BED1': dict(name='Schlafzimmer 1', poly=[(0.44, 0.2), (6.3, 0.2), (6.3, 4.28), (0.44, 4.28), (0.44, 3.72), (1.18, 3.72), (1.18, 1.38), (0.44, 1.38)],
                 rects=[(0.44, 0.2, 6.3, 1.38), (1.18, 1.38, 6.3, 3.72), (0.44, 3.72, 6.3, 4.28)], floor='wood_floor_worn', walls='paint',
                 reverb=dict(preset='room_medium_hard', rt60=0.75, sizeM3=round(5.86 * 4.08 * 2.6, 1))),
    'CLO1': dict(name='Einbauschrank', poly=R(0.44, 1.50, 1.06, 3.60), rects=[(0.44, 1.50, 1.06, 3.60)], floor='carpet_stained', walls='paint',
                 reverb=dict(preset='closet', rt60=0.25, sizeM3=round(0.62 * 2.1 * 2.6, 1))),
    'BATH': dict(name='Bad', poly=R(0.44, 5.62, 2.58, 8.0), rects=[(0.44, 5.62, 2.58, 8.0)], floor='tile_floor_dirty', walls='tile',
                 reverb=dict(preset='bathroom_tile', rt60=1.0, sizeM3=round(2.14 * 2.38 * 2.6, 1))),
    'BED2': dict(name='Schlafzimmer 2 (Kinderzimmer)', poly=R(2.70, 5.62, 6.3, 9.8), rects=[(2.70, 5.62, 6.3, 9.8)], floor='carpet_stained', walls='wallpaper',
                 reverb=dict(preset='room_small_soft', rt60=0.5, sizeM3=round(3.6 * 4.18 * 2.6, 1))),
    'UTIL': dict(name='Waschkueche / Abstellraum', poly=R(-0.88, 8.12, 2.58, 9.8), rects=[(-0.88, 8.12, 2.58, 9.8)], floor='concrete_floor', walls='paint',
                 reverb=dict(preset='utility_concrete', rt60=0.9, sizeM3=round(3.46 * 1.68 * 2.6, 1))),
}
FLOOR_SURF = {'carpet_stained': 'carpet', 'wood_floor_worn': 'wood', 'tile_floor_dirty': 'tile', 'concrete_floor': 'concrete'}

# ------------------------------------------------------------------ Oeffnungen
# axis: Richtung der Wand ('x' = Wand laeuft entlang X, Normale Y). band = (lo, hi) entlang der Normalen.
# side: Raum auf lo-/hi-Seite ('EXT' = aussen). Tueren: hinge 'lo'/'hi' (u-Ende), swing 'lo'/'hi' (Normalenseite).
DOOR_W = 0.906   # lichte Breite (Blatt 0.90 + Luft)
DOOR_H = 2.05
OPENINGS = [
    dict(id='front', kind='door', axis='x', band=(0.0, 0.2), u=-0.28, w=DOOR_W, h=DOOR_H, lo='EXT', hi='HAL',
         hinge='lo', swing='hi', angle=28, ext=True),
    dict(id='back', kind='door', axis='x', band=(9.8, 10.0), u=1.60, w=DOOR_W, h=DOOR_H, lo='UTIL', hi='EXT',
         hinge='lo', swing='lo', angle=0, ext=True),
    dict(id='bed1', kind='door', axis='x', band=(4.28, 4.40), u=4.30, w=DOOR_W, h=DOOR_H, lo='BED1', hi='HAL',
         hinge='hi', swing='lo', angle=0),
    dict(id='bed2', kind='door', axis='x', band=(5.50, 5.62), u=3.40, w=DOOR_W, h=DOOR_H, lo='HAL', hi='BED2',
         hinge='lo', swing='hi', angle=65),
    dict(id='bath', kind='door', axis='y', band=(0.32, 0.44), u=6.75, w=DOOR_W * 0.9, h=DOOR_H, lo='HAL', hi='BATH',
         hinge='hi', swing='hi', angle=12),
    dict(id='util', kind='door', axis='x', band=(8.0, 8.12), u=-0.28, w=DOOR_W, h=DOOR_H, lo='HAL', hi='UTIL',
         hinge='hi', swing='hi', angle=95),
    dict(id='clo1', kind='door', axis='y', band=(1.06, 1.18), u=2.55, w=0.80, h=DOOR_H, lo='CLO1', hi='BED1',
         hinge='lo', swing='hi', angle=105),
    dict(id='liv_hal', kind='cased', axis='y', band=(-1.0, -0.88), u=2.40, w=1.50, h=2.10, lo='LIV', hi='HAL'),
    dict(id='liv_kit', kind='cased', axis='x', band=(5.0, 5.12), u=-3.0, w=2.40, h=2.18, lo='LIV', hi='KIT'),
    dict(id='kit_util', kind='doorway', axis='y', band=(-1.0, -0.88), u=8.95, w=DOOR_W * 0.9, h=DOOR_H, lo='KIT', hi='UTIL'),
    # Fenster: sill/head absolute z (Rohbauoeffnung), state: intact | broken | boarded | open
    dict(id='liv_f1', kind='window', axis='x', band=(0.0, 0.2), u=-4.30, w=1.80, sill=FFL + 0.62, head=FFL + 2.10, lo='EXT', hi='LIV', state='boarded', panes=2),
    dict(id='liv_f2', kind='window', axis='x', band=(0.0, 0.2), u=-2.00, w=0.90, sill=FFL + 0.90, head=FFL + 2.10, lo='EXT', hi='LIV', state='broken'),
    dict(id='liv_w', kind='window', axis='y', band=(-6.5, -6.3), u=2.60, w=0.90, sill=FFL + 0.90, head=FFL + 2.10, lo='EXT', hi='LIV', state='intact'),
    dict(id='kit_b', kind='window', axis='x', band=(9.8, 10.0), u=-4.00, w=1.00, sill=FFL + 1.07, head=FFL + 2.10, lo='KIT', hi='EXT', state='broken'),
    dict(id='kit_w', kind='window', axis='y', band=(-6.5, -6.3), u=6.40, w=1.20, sill=FFL + 0.90, head=FFL + 2.10, lo='EXT', hi='KIT', state='boarded', panes=2),
    dict(id='bed1_f1', kind='window', axis='x', band=(0.0, 0.2), u=2.60, w=0.90, sill=FFL + 0.90, head=FFL + 2.10, lo='EXT', hi='BED1', state='intact'),
    dict(id='bed1_f2', kind='window', axis='x', band=(0.0, 0.2), u=5.00, w=0.90, sill=FFL + 0.90, head=FFL + 2.10, lo='EXT', hi='BED1', state='broken'),
    dict(id='bed1_e', kind='window', axis='y', band=(6.3, 6.5), u=2.20, w=0.90, sill=FFL + 0.90, head=FFL + 2.10, lo='BED1', hi='EXT', state='boarded'),
    dict(id='hal_e', kind='window', axis='y', band=(6.3, 6.5), u=4.95, w=0.60, sill=FFL + 1.00, head=FFL + 2.10, lo='HAL', hi='EXT', state='intact'),
    dict(id='bed2_b', kind='window', axis='x', band=(9.8, 10.0), u=4.60, w=0.90, sill=FFL + 0.90, head=FFL + 2.10, lo='BED2', hi='EXT', state='open'),
    dict(id='bed2_e', kind='window', axis='y', band=(6.3, 6.5), u=7.70, w=0.90, sill=FFL + 0.90, head=FFL + 2.10, lo='BED2', hi='EXT', state='broken'),
    dict(id='util_b', kind='window', axis='x', band=(9.8, 10.0), u=-0.10, w=0.60, sill=FFL + 1.20, head=FFL + 2.10, lo='UTIL', hi='EXT', state='boarded'),
]
OP = {o['id']: o for o in OPENINGS}


def op_rough(o):
    """Rohbauoeffnung (u0,u1,z0,z1) inkl. Futter."""
    if o['kind'] == 'window':
        return (o['u'] - o['w'] / 2, o['u'] + o['w'] / 2, o['sill'], o['head'])
    w = o['w'] + 2 * JT
    return (o['u'] - w / 2, o['u'] + w / 2, FFL - FIN, FFL + o['h'] + JT)


def axis_vecs(o):
    """(U = Wandrichtung, N = Normale lo->hi)"""
    return (X, Y) if o['axis'] == 'x' else (Y, X)


def wpt(o, u, n, z):
    """Weltpunkt aus Oeffnungskoordinaten (u entlang Wand, n entlang Normale)."""
    return Vector((u, n, z)) if o['axis'] == 'x' else Vector((n, u, z))


# ------------------------------------------------------------------ Schaeden (Weltkoordinaten)
# Wandloecher: room, p=(x,y) Punkt auf der Raumwand, z, rx, rz, through (beidseitig)
WALL_HOLES = [
    dict(room='HAL', p=(-0.88, 4.15), z=FFL + 1.05, rx=0.24, rz=0.30, through=True, seed='h1'),
    dict(room='HAL', p=(0.32, 0.85), z=FFL + 0.38, rx=0.17, rz=0.13, through=False, seed='h2'),
    dict(room='KIT', p=(-1.0, 6.55), z=FFL + 1.30, rx=0.20, rz=0.17, through=True, seed='h3'),
    dict(room='LIV', p=(-5.5, 5.0), z=FFL + 0.75, rx=0.38, rz=0.45, through=False, seed='h4'),
    dict(room='LIV', p=(-6.3, 4.1), z=FFL + 0.45, rx=0.30, rz=0.30, through=False, seed='h5'),
    dict(room='BED2', p=(2.70, 7.05), z=FFL + 1.35, rx=0.20, rz=0.16, through=True, seed='h6'),
    dict(room='BED1', p=(2.10, 4.28), z=FFL + 1.20, rx=0.16, rz=0.20, through=False, seed='h7'),
    dict(room='BED1', p=(6.3, 3.6), z=FFL + 0.35, rx=0.26, rz=0.22, through=False, seed='h8'),
    dict(room='UTIL', p=(-0.88, 9.0), z=FFL + 1.6, rx=0.30, rz=0.40, through=False, seed='h9'),
    dict(room='BED2', p=(5.8, 9.8), z=FFL + 0.5, rx=0.22, rz=0.18, through=False, seed='h10'),
    dict(room='HAL', p=(4.6, 5.50), z=FFL + 0.95, rx=0.14, rz=0.12, through=False, seed='h11'),
    dict(room='HAL', p=(1.9, 4.40), z=FFL + 0.45, rx=0.20, rz=0.16, through=False, seed='h12'),
    dict(room='HAL', p=(-0.88, 7.3), z=FFL + 1.5, rx=0.13, rz=0.11, through=False, seed='h13'),
    dict(room='KIT', p=(-6.3, 8.4), z=FFL + 1.3, rx=0.32, rz=0.4, through=False, seed='h14'),
]
# Tapetenabrisse (nur Tapetenraeume): room, p, z, rx, rz
TEARS = [
    dict(room='LIV', p=(-6.3, 1.2), z=FFL + 1.5, rx=0.55, rz=0.65, seed='t1'),
    dict(room='LIV', p=(-6.3, 3.6), z=FFL + 2.2, rx=0.45, rz=0.35, seed='t2'),
    dict(room='LIV', p=(-5.4, 5.0), z=FFL + 1.9, rx=0.70, rz=0.45, seed='t4'),
    dict(room='LIV', p=(-1.0, 0.9), z=FFL + 0.9, rx=0.40, rz=0.75, seed='t5'),
    dict(room='LIV', p=(-1.0, 4.3), z=FFL + 2.1, rx=0.35, rz=0.40, seed='t6'),
    dict(room='LIV', p=(-3.0, 0.2), z=FFL + 0.4, rx=0.40, rz=0.30, seed='t7'),
    dict(room='BED2', p=(6.3, 6.4), z=FFL + 1.4, rx=0.55, rz=0.70, seed='t8'),
    dict(room='BED2', p=(3.6, 9.8), z=FFL + 1.8, rx=0.60, rz=0.50, seed='t9'),
    dict(room='BED2', p=(2.7, 8.8), z=FFL + 0.8, rx=0.45, rz=0.55, seed='t10'),
    dict(room='BED2', p=(5.0, 5.62), z=FFL + 2.0, rx=0.50, rz=0.35, seed='t11'),
]
# Deckenloecher: room, c=(x,y), rx, ry, panel: Kante (n/s/e/w) an der eine Platte haengt, angle
CEIL_HOLES = [
    dict(room='LIV', c=(-3.3, 3.5), rx=0.75, ry=0.55, panel='s', angle=58, seed='c1'),
    dict(room='KIT', c=(-4.6, 7.2), rx=0.85, ry=0.65, panel='e', angle=50, seed='c2'),
    dict(room='KIT', c=(-2.0, 9.0), rx=0.35, ry=0.30, panel=None, angle=0, seed='c3'),
    dict(room='HAL', c=(2.6, 4.95), rx=0.55, ry=0.40, panel='w', angle=40, seed='c4'),
    dict(room='BED2', c=(4.3, 8.4), rx=0.50, ry=0.45, panel='n', angle=65, seed='c5'),
    dict(room='BATH', c=(1.3, 7.3), rx=0.30, ry=0.25, panel=None, angle=0, seed='c6'),
]
# Teppichrisse: room, c, rx, ry (Unterboden sichtbar) + umgeschlagene Lasche
CARPET_TEARS = [
    dict(room='LIV', c=(-2.4, 3.9), rx=0.65, ry=0.45, seed='k1'),
    dict(room='BED2', c=(5.2, 6.6), rx=1.0, ry=0.75, seed='k2'),
    dict(room='BED2', c=(3.5, 9.2), rx=0.45, ry=0.35, seed='k3'),
]
# fehlende Fliesen (Raster 0.30 m, an Texturfugen ausgerichtet): (room, i, j) -> Fliese [i*0.3, (i+1)*0.3] x [j*0.3, ...]
MISSING_TILES = [('KIT', -12, 21), ('KIT', -11, 21), ('KIT', -12, 22), ('KIT', -16, 19), ('KIT', -8, 27), ('KIT', -7, 27), ('KIT', -9, 25),
                 ('KIT', -19, 30), ('BATH', 3, 22), ('BATH', 4, 22), ('BATH', 6, 25)]

# ------------------------------------------------------------------ Helfer
C_INT = None
C_EXT = None
C_SITE = None
C_DOORS = None
C_GLASS = None
C_ATTIC = None
OBJS = []


def mk(name, mb, col, surface, props=None, uv='auto'):
    ob = make_obj(name, mb, col, surface=surface, props=props, uv=uv)
    if ob is not None:
        OBJS.append(ob)
    return ob


def room_edges(rid):
    poly = ROOMS[rid]['poly']
    out = []
    n = len(poly)
    for i in range(n):
        p0 = Vector((poly[i][0], poly[i][1], 0)); p1 = Vector((poly[(i + 1) % n][0], poly[(i + 1) % n][1], 0))
        d = p1 - p0
        Lg = d.length
        A = d / Lg
        nrm = Vector((A.y, -A.x, 0))
        out.append(dict(p0=p0, p1=p1, A=A, n=nrm, L=Lg, i=i))
    # Namen
    cnt = {}
    for e in out:
        k = 's' if e['n'].y < -0.5 else 'n' if e['n'].y > 0.5 else 'e' if e['n'].x > 0.5 else 'w'
        cnt[k] = cnt.get(k, 0) + 1
        e['dir'] = k
        e['k'] = cnt[k]
    for e in out:
        e['name'] = e['dir'] + (str(e['k']) if cnt[e['dir']] > 1 else '')
    return out


def is_exterior_line(e):
    """Liegt die Raumkante auf der Innenflucht einer Aussenwand?"""
    p = e['p0']
    if abs(e['n'].y) > 0.5:
        return abs(p.y - (EXT[1] + WALL_EXT)) < 1e-4 or abs(p.y - (EXT[3] - WALL_EXT)) < 1e-4
    return abs(p.x - (EXT[0] + WALL_EXT)) < 1e-4 or abs(p.x - (EXT[2] - WALL_EXT)) < 1e-4


def edge_openings(e):
    """Oeffnungen in dieser Raumkante -> Liste (a0,a1,z0,z1,o)."""
    res = []
    horiz = abs(e['n'].y) > 0.5
    for o in OPENINGS:
        if (o['axis'] == 'x') != horiz:
            continue
        line = e['p0'].y if horiz else e['p0'].x
        if not (o['band'][0] - 1e-4 <= line <= o['band'][1] + 1e-4):
            continue
        u0, u1, z0, z1 = op_rough(o)
        pu0 = e['p0'].x if horiz else e['p0'].y
        s = e['A'].x if horiz else e['A'].y
        a0 = (u0 - pu0) * s; a1 = (u1 - pu0) * s
        if a0 > a1:
            a0, a1 = a1, a0
        if a1 <= 1e-4 or a0 >= e['L'] - 1e-4:
            continue
        res.append((a0, a1, z0, z1, o))
    return res


def edge_a(e, p):
    return (Vector((p[0], p[1], 0)) - e['p0']).dot(e['A'])


def find_edge(rid, p):
    best = None
    for e in room_edges(rid):
        a = edge_a(e, p)
        if a < -0.01 or a > e['L'] + 0.01:
            continue
        dist = abs((Vector((p[0], p[1], 0)) - e['p0']).dot(e['n']))
        if best is None or dist < best[0]:
            best = (dist, e)
    return best[1] if best else None


def wall_point(e, a, z, c=0.0):
    return e['p0'] + e['A'] * a + Vector((0, 0, z)) + e['n'] * c


# ------------------------------------------------------------------ Innenwaende
def wall_mat_fn(rid, e):
    kind = ROOMS[rid]['walls']

    def fn(a, b, side):
        if side > 0:
            return M('cardboard')
        if kind == 'wallpaper':
            return M('plaster_damaged')
        if kind == 'tile':
            if e['dir'] == 'e' or b < FFL + 1.25:   # Duschwand (Ost) raumhoch gefliest
                return M('tile_wall_white')
            return M('plaster_painted_dirty')
        if rid == 'KIT' and e['dir'] == 'n' and FFL + 0.92 < b < FFL + 1.45:
            pa = wall_point(e, a, 0)
            if pa.x < -1.9:
                return M('tile_wall_white')   # Fliesenspiegel hinter der Arbeitsplatte
        return M('plaster_painted_dirty')
    return fn


def build_walls():
    # Loecher sammeln je (room, edge-index)
    cuts = {}
    framing = MB()
    insul = MB()
    for h in WALL_HOLES:
        e = find_edge(h['room'], h['p'])
        targets = [(h['room'], e)]
        if h['through']:
            for rid in ROOMS:
                if rid == h['room']:
                    continue
                for e2 in room_edges(rid):
                    if e2['n'].dot(e['n']) > -0.99:
                        continue
                    dist = (e2['p0'] - e['p0']).dot(e['n'])
                    if abs(dist - WALL_INT) > 0.01:
                        continue
                    pw = Vector((h['p'][0], h['p'][1], 0)) + e['n'] * WALL_INT
                    a2 = edge_a(e2, pw)
                    if 0 < a2 < e2['L']:
                        targets.append((rid, e2))
        r = rng(h['seed'])
        for k, (rid, ee) in enumerate(targets):
            p = Vector((h['p'][0], h['p'][1], 0))
            if k > 0:
                p = p + e['n'] * WALL_INT
            a = edge_a(ee, p)
            rr = rng(h['seed'] + str(k))
            sc = 1.0 if k == 0 else 0.75   # Austrittsseite kleiner
            pts = jagged(rr, a, h['z'], h['rx'] * sc, h['rz'] * sc, n=26, rough=0.18, spikes=0.35)
            cuts.setdefault((rid, ee['i']), []).append(('hole', pts))
        # Staender/Schwellen/Kabel in der Wand hinter dem Loch
        ext = is_exterior_line(e)
        depth = (WALL_EXT - SHEATH) if ext else WALL_INT
        a_c = edge_a(e, h['p'])
        horiz = abs(e['n'].y) > 0.5
        lo = a_c - h['rx'] - 0.55; hi = a_c + h['rx'] + 0.55
        lo = max(lo, 0.0); hi = min(hi, e['L'])
        # Staender auf Welt-Raster 0.406
        w0 = wall_point(e, lo, 0); w1 = wall_point(e, hi, 0)
        u0 = w0.x if horiz else w0.y; u1 = w1.x if horiz else w1.y
        if u0 > u1: u0, u1 = u1, u0
        k0 = math.ceil(u0 / 0.406); k1 = math.floor(u1 / 0.406)
        for k in range(k0, k1 + 1):
            u = k * 0.406 + r.uniform(-0.03, 0.03)
            pw = Vector((u, e['p0'].y, 0)) if horiz else Vector((e['p0'].x, u, 0))
            a = edge_a(e, pw)
            cen = wall_point(e, a, (FFL - FIN + CEIL) / 2, DW + (depth - 2 * DW) / 2 + DW * 0)
            cen = wall_point(e, a, (FFL - FIN + CEIL) / 2, DW + (depth - DW - (0 if ext else DW)) / 2)
            obox(framing, cen, e['A'], e['n'], (0.038, depth - DW - (0 if ext else DW) - 0.002, CEIL - FFL + FIN - 0.08), M('wood_planks_raw'))
        cmid = DW + (depth - DW - (0 if ext else DW)) / 2
        dd = depth - DW - (0 if ext else DW) - 0.002
        for zc, hh in ((FFL - FIN + 0.019, 0.038), (CEIL - 0.04, 0.076)):
            cen = wall_point(e, (lo + hi) / 2, zc, cmid)
            obox(framing, cen, e['A'], e['n'], (hi - lo, dd, hh), M('wood_planks_raw'))
        # Kabel (NM-Leitung) quer durch die Staender
        zc = FFL + 0.32 + r.uniform(-0.05, 0.1)
        pa = wall_point(e, lo, zc, cmid); pb = wall_point(e, hi, zc + r.uniform(-0.05, 0.05), cmid)
        cylinder(framing, pa, pb, 0.006, M('wire'), seg=6, caps=False)
        if ext:   # Daemmung: zerfetzte Matte im Hohlraum
            for q in range(5):
                a = a_c + r.uniform(-h['rx'], h['rx']) * 1.2
                zq = h['z'] + r.uniform(-h['rz'], h['rz'])
                cen = wall_point(e, a, zq, DW + 0.11)
                obox(insul, cen, e['A'], e['n'], (r.uniform(0.2, 0.35), r.uniform(0.04, 0.08), r.uniform(0.2, 0.4)), M('insulation'))
    for t in TEARS:
        e = find_edge(t['room'], t['p'])
        rr = rng(t['seed'])
        a = edge_a(e, t['p'])
        pts = jagged(rr, a, t['z'], t['rx'], t['rz'], n=34, rough=0.22, spikes=0.45)
        cuts.setdefault((t['room'], e['i']), []).append(('tear', pts))

    for rid, room in ROOMS.items():
        strips = MB()
        for e in room_edges(rid):
            mb = MB()
            holes = [(a0, a1, z0, z1) for a0, a1, z0, z1, o in edge_openings(e)]
            extra_b = [FFL + 1.25] if room['walls'] == 'tile' else []
            if rid == 'KIT':
                extra_b += [FFL + 0.92, FFL + 1.45]
            grid_slab(mb, e['p0'], e['A'], Z, 0.0, DW, (0.0, e['L']), (FFL - FIN, CEIL), holes, M('plaster_painted_dirty'),
                      mat_side=M('plaster_damaged'), mat_fn=wall_mat_fn(rid, e), extra_b=extra_b)
            if room['walls'] == 'wallpaper':
                grid_slab(mb, e['p0'], e['A'], Z, -0.0016, -0.0004, (0.0, e['L']), (FFL - FIN + 0.09, CEIL - 0.002), holes,
                          M('wallpaper_peeling'), mat_side=M('wallpaper_peeling'),
                          mat_fn=lambda a, b, s: M('wallpaper_peeling') if s < 0 else M('plaster_damaged'))
            name = f'{rid}_wall_{e["name"]}'
            ob = mk(name, mb, C_INT, 'plaster', props={'room': rid})
            cl = cuts.get((rid, e['i']), [])
            if cl:
                cut = MB()
                for kind, pts in cl:
                    if kind == 'hole':
                        prism(cut, pts, e['p0'], e['A'], Z, -0.03, DW + 0.02, M('plaster_damaged'))
                    else:
                        prism(cut, pts, e['p0'], e['A'], Z, -0.004, -0.0002, M('plaster_damaged'))
                        _peel_strips(strips, e, pts, rng(name + str(len(pts))))
                bool_apply(ob, cut)
        if not strips.empty():
            mk(f'{rid}_wallpaper_strips', strips, C_INT, 'plaster', props={'room': rid})
    mk('WALL_framing', framing, C_INT, 'wood')
    mk('WALL_insulation', insul, C_INT, 'fabric')


def _peel_strips(mb, e, pts, r):
    """Abgeloeste Tapetenbahnen: gewoelbte, nach unten/aussen haengende Streifen an der Abrisskante."""
    top = max(pts, key=lambda p: p[1])
    xs = [p[0] for p in pts]
    for k in range(r.randint(1, 3)):
        a0 = r.uniform(min(xs) + 0.05, max(xs) - 0.15)
        w = r.uniform(0.07, 0.2)
        # Kantenhoehe an dieser Stelle (oberer Rand des Abrisses) ~ naechster Punkt
        cand = [p for p in pts if a0 - 0.12 < p[0] < a0 + w + 0.12]
        zt = max((p[1] for p in cand), default=top[1]) - 0.02
        ln = r.uniform(0.18, 0.45)
        segs = 6
        curl = r.uniform(0.04, 0.12)
        rows = []
        for s in range(segs + 1):
            t = s / segs
            zz = zt - ln * t
            out = -(0.002 + curl * (t ** 1.6))     # in den Raum hinein (c negativ)
            twist = r.uniform(-0.01, 0.01) * t
            rows.append([wall_point(e, a0 + twist, zz, out), wall_point(e, a0 + w + twist * 2, zz - 0.02 * t, out * 1.1)])
        mb.new_part()
        for s in range(segs):
            p00, p01 = rows[s]; p10, p11 = rows[s + 1]
            mb.poly([p00, p01, p11, p10], M('wallpaper_peeling'), expect=-e['n'])
            off = e['n'] * 0.0008
            mb.poly([p00 + off, p01 + off, p11 + off, p10 + off], M('plaster_damaged'), expect=e['n'])


# ------------------------------------------------------------------ Boden / Decke
def build_floors():
    sub = MB()
    grid_slab(sub, (0, 0, FFL - FIN - 0.019), X, Y, 0, 0.019, (EXT[0] + 0.01, EXT[2] - 0.01), (EXT[1] + 0.01, EXT[3] - 0.01), [],
              M('wood_planks_raw'), mat_side=M('wood_planks_raw'))
    mk('SUBFLOOR', sub, C_INT, 'wood')
    for rid, room in ROOMS.items():
        fm = room['floor']
        mb = MB()
        holes = []
        for (r_, i, j) in MISSING_TILES:
            if r_ == rid:
                holes.append((i * 0.3, (i + 1) * 0.3, j * 0.3, (j + 1) * 0.3))
        for (x0, y0, x1, y1) in room['rects']:
            grid_slab(mb, (0, 0, FFL - FIN), X, Y, 0, FIN, (x0, x1), (y0, y1), holes, M(fm), mat_side=M('dirt_mud') if fm == 'tile_floor_dirty' else M(fm),
                      mat_fn=lambda a, b, s, fm=fm: M(fm) if s > 0 else M('wood_planks_raw'))
        ob = mk(f'{rid}_floor', mb, C_INT, FLOOR_SURF[fm], props={'room': rid})
        tears = [t for t in CARPET_TEARS if t['room'] == rid]
        if tears:
            cut = MB(); flap = MB()
            for t in tears:
                rr = rng(t['seed'])
                pts = jagged(rr, t['c'][0], t['c'][1], t['rx'], t['ry'], n=22, rough=0.15, spikes=0.3)
                prism(cut, pts, (0, 0, 0), X, Y, FFL - FIN - 0.002, FFL + 0.01, M('carpet_stained'))
                # zurueckgeschlagene Teppichlasche: Wulst an der Risskante, dann flach (Rueckseite oben) auf dem Teppich
                cx, cy = t['c']
                y0 = cy + t['ry'] * 0.55
                xs_ = sorted(p[0] for p in pts if abs(p[1] - y0) < t['ry'] * 0.6)
                xa, xb = (xs_[0], xs_[-1]) if len(xs_) >= 2 else (cx - t['rx'] * 0.7, cx + t['rx'] * 0.7)
                xa += 0.05; xb -= 0.05
                Rr = 0.035
                prof = []
                for k in range(7):
                    th = math.radians(-90 - 180 * k / 6)
                    prof.append((y0 + Rr * math.cos(th), FFL + Rr + Rr * math.sin(th)))
                lf = rr.uniform(0.3, 0.5)
                for k in range(1, 5):
                    prof.append((y0 + lf * k / 4, FFL + 2 * Rr - (2 * Rr - 0.016) * (k / 4) ** 0.7))
                nx = 8
                flap.new_part()
                grid = []
                for k, (yy, zz) in enumerate(prof):
                    row = []
                    for i in range(nx + 1):
                        x = xa + (xb - xa) * i / nx
                        # ausgefranste Endkante: letzte Reihe unregelmaessig kuerzen
                        y_ = yy - (rr.uniform(0.0, 0.1) if k == len(prof) - 1 else 0.0)
                        wv = 0.012 * math.sin(i * 1.7 + k) if k > 6 else 0.0
                        row.append(Vector((x, y_, zz + wv)))
                    grid.append(row)
                for k in range(len(prof) - 1):
                    for i in range(nx):
                        q = [grid[k][i], grid[k][i + 1], grid[k + 1][i + 1], grid[k + 1][i]]
                        nrm = (q[1] - q[0]).cross(q[3] - q[0])
                        # Innenseite der Rolle = Flor (Teppich), Aussenseite = Ruecken
                        flap.poly(q, M('carpet_stained'), expect=nrm)
                        off = nrm.normalized() * -0.006
                        flap.poly([v + off for v in q], M('carpet_stained'), expect=-nrm)
            bool_apply(ob, cut)
            mk(f'{rid}_carpet_flap', flap, C_INT, 'carpet', props={'room': rid})
    # Schwellen in Durchgaengen
    th = MB()
    for o in OPENINGS:
        if o['kind'] == 'window':
            continue
        u0, u1, _, _ = op_rough(o)
        n0, n1 = o['band']
        room = o['hi'] if o['hi'] != 'EXT' else o['lo']
        fm = ROOMS[room]['floor']
        if o.get('ext'):
            nn0, nn1 = (n0 - 0.03, n1) if o['lo'] == 'EXT' else (n0, n1 + 0.03)
            box(th, wpt(o, u0, nn0, FFL - FIN), wpt(o, u1, nn1, FFL + 0.012), M('wood_trim_painted'))
        else:
            box(th, wpt(o, u0, n0, FFL - FIN), wpt(o, u1, n1, FFL), M(fm))
    mk('THRESHOLDS', th, C_INT, 'wood')


def ceiling_hole_pts(h):
    rr = rng(h['seed'])
    return jagged(rr, h['c'][0], h['c'][1], h['rx'], h['ry'], n=26, rough=0.14, spikes=0.3)


def build_ceilings():
    for rid, room in ROOMS.items():
        mb = MB()
        for (x0, y0, x1, y1) in room['rects']:
            grid_slab(mb, (0, 0, CEIL), X, Y, 0, DW, (x0, x1), (y0, y1), [], M('ceiling_stained'), mat_side=M('plaster_damaged'),
                      mat_fn=lambda a, b, s: M('ceiling_stained') if s < 0 else M('cardboard'))
        ob = mk(f'{rid}_ceiling', mb, C_INT, 'plaster', props={'room': rid})
        hs = [h for h in CEIL_HOLES if h['room'] == rid]
        if hs:
            cut = MB(); hang = MB()
            for h in hs:
                pts = ceiling_hole_pts(h)
                prism(cut, pts, (0, 0, 0), X, Y, CEIL - 0.03, CEIL + 0.05, M('plaster_damaged'))
                if h['panel']:
                    _hanging_panel(hang, h, pts)
            bool_apply(ob, cut)
            if not hang.empty():
                mk(f'{rid}_ceiling_panel', hang, C_INT, 'plaster', props={'room': rid})


def _hanging_panel(mb, h, pts):
    """Herabhaengende, durchnaesste Gipsplatte: Teil der Lochflaeche, um die Lochkante gekippt und durchgebogen."""
    cx, cy = h['c']
    side = h['panel']
    r = rng(h['seed'] + 'p')
    sub = [(cx + (p[0] - cx) * 0.93, cy + (p[1] - cy) * 0.93) for p in pts]
    if side in ('n', 's'):
        hl = cy + (h['ry'] * 0.55 if side == 'n' else -h['ry'] * 0.55)
        sub = clip_poly_rect(sub, -99, -99, 99, hl) if side == 'n' else clip_poly_rect(sub, -99, hl, 99, 99)
        piv = Vector((cx, hl, CEIL)); ax = 'X'; sgn = 1 if side == 'n' else -1
    else:
        hl = cx + (h['rx'] * 0.55 if side == 'e' else -h['rx'] * 0.55)
        sub = clip_poly_rect(sub, -99, -99, hl, 99) if side == 'e' else clip_poly_rect(sub, hl, -99, 99, 99)
        piv = Vector((hl, cy, CEIL)); ax = 'Y'; sgn = -1 if side == 'e' else 1
    if len(sub) < 3:
        return
    ang = math.radians(h['angle'])
    rot = Matrix.Rotation(-ang * sgn, 4, 'X') if ax == 'X' else Matrix.Rotation(ang * sgn, 4, 'Y')
    T = Matrix.Translation(piv) @ rot @ Matrix.Translation(-piv)
    gx = sum(p[0] for p in sub) / len(sub); gy = sum(p[1] for p in sub) / len(sub)
    rings = [0.0, 0.33, 0.66, 1.0]
    ph = r.uniform(0, 6.28)

    def place(x, y, off):
        d = abs((y - piv.y) if ax == 'X' else (x - piv.x))
        t = abs((x - gx) if ax == 'X' else (y - gy))
        sag = -0.22 * d * d - 0.05 * d * math.sin(t * 6.0 + ph) - 0.03 * t * t
        return T @ Vector((x, y, CEIL + 0.001 + sag + off))
    n = len(sub)

    def ring_pt(k, i):
        t = rings[k]
        if k == 0:
            return (gx, gy)
        return (gx + (sub[i][0] - gx) * t, gy + (sub[i][1] - gy) * t)
    mb.new_part()
    lo = {}; hi = {}
    for k in range(len(rings)):
        for i in range(n if k else 1):
            x, y = ring_pt(k, i)
            lo[(k, i)] = mb.vert(place(x, y, 0.0))
            hi[(k, i)] = mb.vert(place(x, y, DW))
    under = M('plaster_damaged')
    for i in range(n):
        j = (i + 1) % n
        mb.face([lo[(0, 0)], lo[(1, j)], lo[(1, i)]], under)
        mb.face([hi[(0, 0)], hi[(1, i)], hi[(1, j)]], M('cardboard'))
        for k in range(1, len(rings) - 1):
            mb.face([lo[(k, i)], lo[(k, j)], lo[(k + 1, j)], lo[(k + 1, i)]], under)
            mb.face([hi[(k, i)], hi[(k + 1, i)], hi[(k + 1, j)], hi[(k, j)]], M('cardboard'))
        K = len(rings) - 1
        mb.face([lo[(K, i)], lo[(K, j)], hi[(K, j)], hi[(K, i)]], M('plaster_damaged'))


# ------------------------------------------------------------------ Dachboden
def roof_z(y):
    return ROOF_Z0 + ROOF_S * min(y - EXT[1], EXT[3] - y)


def build_attic():
    fr = MB()
    ins = MB()
    r = rng('attic')
    x = -6.3
    xs = []
    k0 = math.ceil((EXT[0] + 0.1) / 0.406); k1 = math.floor((EXT[2] - 0.1) / 0.406)
    for k in range(k0, k1 + 1):
        xs.append(k * 0.406)
    zj0 = CEIL + DW
    for xx in xs:
        box(fr, (xx - 0.0225, EXT[1] + 0.02, zj0), (xx + 0.0225, EXT[3] - 0.02, zj0 + 0.185), M('wood_planks_raw'))
        # Sparren vorn/hinten
        for sgn in (1, -1):
            if sgn == 1:
                ya, yb = EXT[1] - EAVE + 0.02, (EXT[1] + EXT[3]) / 2
            else:
                ya, yb = EXT[3] + EAVE - 0.02, (EXT[1] + EXT[3]) / 2
            za = roof_z(ya) - 0.04 - 0.075; zb = roof_z(yb) - 0.04 - 0.075 - 0.02
            nrm = Vector((0, -ROOF_S * sgn, 1)).normalized()
            beam(fr, (xx, ya, za), (xx, yb, zb), 0.045, 0.14, M('wood_planks_raw'), up=nrm)
    # Firstpfette
    zr = roof_z(5.0)
    box(fr, (EXT[0] - RAKE, 4.98, zr - 0.30), (EXT[2] + RAKE, 5.02, zr - 0.05), M('wood_planks_raw'))
    # Kehlbalken jeder 3. Sparren
    for xx in xs[::3]:
        box(fr, (xx + 0.0225, 3.2, zr - 0.95), (xx + 0.06, 6.8, zr - 0.80), M('wood_planks_raw'))
    mk('ATTIC_framing', fr, C_ATTIC, 'wood')
    # Daemmung zwischen den Balken (Loecher unter Deckenloechern, zerfaserte Raender)
    holes = []
    for h in CEIL_HOLES:
        holes.append((h['c'][0] - h['rx'] * 0.7, h['c'][0] + h['rx'] * 0.7, h['c'][1] - h['ry'] * 0.7, h['c'][1] + h['ry'] * 0.7))

    def disp(a, b):
        return 0.03 * math.sin(a * 2.3 + b * 0.7) * math.sin(b * 1.9 - a * 0.4) + 0.015 * math.sin(a * 7.1 + b * 5.3)
    grid_slab(ins, (0, 0, zj0 + 0.05), X, Y, 0.0, 0.11, (EXT[0] + 0.25, EXT[2] - 0.25), (EXT[1] + 0.25, EXT[3] - 0.25), holes,
              M('insulation'), cell=0.4, disp=disp)
    # Fasern/Lappen, die durch die Deckenloecher haengen (flache, verdrehte Fetzen)
    for h in CEIL_HOLES:
        rr = rng(h['seed'] + 'i')
        for q in range(rr.randint(1, 3)):
            ax = h['c'][0] + rr.uniform(-h['rx'], h['rx']) * 0.5
            ay = h['c'][1] + rr.uniform(-h['ry'], h['ry']) * 0.5
            ln = rr.uniform(0.12, 0.3)
            w = rr.uniform(0.08, 0.18)
            tw = rr.uniform(-0.6, 0.6)
            rows = []
            for s_ in range(5):
                t = s_ / 4
                a = tw * t + rr.uniform(0, 3.14)
                ww = w * (1 - 0.6 * t)
                c = Vector((ax + 0.03 * math.sin(t * 3), ay, zj0 + 0.06 - ln * t))
                d = Vector((math.cos(a), math.sin(a), 0)) * ww / 2
                rows.append((c - d, c + d))
            ins.new_part()
            for s_ in range(4):
                (a0, a1), (b0, b1) = rows[s_], rows[s_ + 1]
                nrm = (a1 - a0).cross(b0 - a0)
                ins.poly([a0, a1, b1, b0], M('insulation'), expect=nrm)
                ins.poly([a0 + nrm.normalized() * 0.01, a1 + nrm.normalized() * 0.01, b1 + nrm.normalized() * 0.01, b0 + nrm.normalized() * 0.01], M('insulation'), expect=-nrm)
    mk('ATTIC_insulation', ins, C_ATTIC, 'fabric')


# ------------------------------------------------------------------ Zargen, Tueren
def build_frames():
    hinges_all = {}
    for o in OPENINGS:
        if o['kind'] == 'window':
            continue
        mb = MB()
        U, N = axis_vecs(o)
        u0, u1, z0, z1 = op_rough(o)
        n0, n1 = o['band']
        zt = FFL + o['h']
        trim = M('wood_trim_painted')
        # Futterbretter
        box(mb, wpt(o, u0, n0, FFL), wpt(o, u0 + JT, n1, zt + JT), trim)
        box(mb, wpt(o, u1 - JT, n0, FFL), wpt(o, u1, n1, zt + JT), trim)
        box(mb, wpt(o, u0, n0, zt), wpt(o, u1, n1, zt + JT), trim)
        # Bekleidung beidseitig (aussen: Fassadenbekleidung macht build_exterior)
        r = rng('frame' + o['id'])
        for side in ('lo', 'hi'):
            if o[side] == 'EXT':
                continue
            nf = n0 if side == 'lo' else n1
            d = -1 if side == 'lo' else 1
            nn0, nn1 = (nf + d * CAS_T, nf) if d < 0 else (nf, nf + d * CAS_T)
            if d < 0:
                nn0, nn1 = nf - CAS_T, nf
            else:
                nn0, nn1 = nf, nf + CAS_T
            # Seiten
            box(mb, wpt(o, u0 - CAS_W + 0.006, nn0, FFL), wpt(o, u0 + 0.006, nn1, zt + JT + CAS_W - 0.006), trim)
            box(mb, wpt(o, u1 - 0.006, nn0, FFL), wpt(o, u1 + CAS_W - 0.006, nn1, zt + JT + CAS_W - 0.006), trim)
            # Kopf mit kleinem Ueberstand + Profilleiste
            box(mb, wpt(o, u0 - CAS_W - 0.004, nn0, zt + JT - 0.006), wpt(o, u1 + CAS_W + 0.004, nn1, zt + JT + CAS_W + 0.004), trim)
            cap_n = (nn0 - 0.01, nn1) if d < 0 else (nn0, nn1 + 0.01)
            box(mb, wpt(o, u0 - CAS_W - 0.012, cap_n[0], zt + JT + CAS_W + 0.004), wpt(o, u1 + CAS_W + 0.012, cap_n[1], zt + JT + CAS_W + 0.022), trim)
            # Sockelbloecke
            box(mb, wpt(o, u0 - CAS_W + 0.002, (nn0 - 0.006) if d < 0 else nn0, FFL), wpt(o, u0 + 0.008, nn1 if d < 0 else nn1 + 0.006, FFL + 0.16), trim)
            box(mb, wpt(o, u1 - 0.008, (nn0 - 0.006) if d < 0 else nn0, FFL), wpt(o, u1 + CAS_W - 0.002, nn1 if d < 0 else nn1 + 0.006, FFL + 0.16), trim)
        if o['kind'] in ('door', 'doorway'):
            # Anschlagleiste (Stop) ~ Blattdicke vom Schwenkseiten-Rand entfernt
            T = 0.045 if o.get('ext') else 0.035
            sw = o.get('swing', 'hi')
            ns = (n1 - T - 0.004 - 0.012, n1 - T - 0.004) if sw == 'hi' else (n0 + T + 0.004, n0 + T + 0.004 + 0.012)
            box(mb, wpt(o, u0 + JT, ns[0], FFL), wpt(o, u0 + JT + 0.035, ns[1], zt), trim)
            box(mb, wpt(o, u1 - JT - 0.035, ns[0], FFL), wpt(o, u1 - JT, ns[1], zt), trim)
            box(mb, wpt(o, u0 + JT, ns[0], zt - 0.035), wpt(o, u1 - JT, ns[1], zt), trim)
            # Scharnierlappen am Futter
            hu = (u0 + JT) if o.get('hinge', 'lo') == 'lo' else (u1 - JT)
            hd = 1 if o.get('hinge', 'lo') == 'lo' else -1
            nh = n1 - 0.002 if sw == 'hi' else n0 + 0.002
            for zh in (FFL + 0.25, FFL + 1.05, FFL + 1.85):
                if o['kind'] == 'doorway' and zh > FFL + 1.0 and zh < FFL + 1.5:
                    continue
                box(mb, wpt(o, hu, nh - 0.03, zh - 0.045), wpt(o, hu + hd * 0.003, nh, zh + 0.045), M('metal_rusty'))
            # Schliessblech
            lu = (u1 - JT) if o.get('hinge', 'lo') == 'lo' else (u0 + JT)
            box(mb, wpt(o, lu - hd * 0.002, nh - 0.035, FFL + 0.87), wpt(o, lu, nh - 0.01, FFL + 0.96), M('metal_rusty'))
        mk(f'FRAME_{o["id"]}', mb, C_INT, 'wood', props={'opening': o['id']})


def build_doors():
    for o in OPENINGS:
        if o['kind'] != 'door':
            continue
        U, N = axis_vecs(o)
        u0, u1, z0, z1 = op_rough(o)
        n0, n1 = o['band']
        ext = o.get('ext', False)
        T = 0.045 if ext else 0.035
        W = o['w'] - 0.006
        H = o['h'] - 0.017
        swing = N if o['swing'] == 'hi' else -N
        hinge_u = u0 + JT + 0.003 if o['hinge'] == 'lo' else u1 - JT - 0.003
        latch_dir = U if o['hinge'] == 'lo' else -U
        nf = n1 - 0.002 if o['swing'] == 'hi' else n0 + 0.002     # Blattflaeche schwenkseitig, nahezu buendig
        pivot = wpt(o, hinge_u, nf, FFL + 0.012)
        th = math.atan2(-swing.x, swing.y)
        locX = Vector((math.cos(th), math.sin(th), 0))
        if locX.dot(latch_dir) > 0:
            xs0, xs1, odir = 0.0, W, 1
        else:
            xs0, xs1, odir = -W, 0.0, -1
        mb = MB()
        _door_leaf(mb, xs0, xs1, T, H, ext, o['id'], odir)
        props = dict(hinge=[round(pivot.x, 4), round(pivot.y, 4), round(pivot.z, 4)], openAngle=float(o['angle']), openDir=odir,
                     closedRotZ=round(math.degrees(th), 3), maxAngle=105.0 if o['id'] != 'clo1' else 110.0, width=round(W, 3), height=round(H, 3),
                     opening=o['id'], rooms=f"{o['lo']}|{o['hi']}", exterior=1 if ext else 0)
        ob = mk(f'DOOR_{o["id"]}', mb, C_DOORS, 'wood', props=props)
        ob.location = pivot
        ob.rotation_euler = (0, 0, th + math.radians(o['angle']) * odir)


def _door_leaf(mb, x0, x1, T, H, ext, did, odir):
    """Tuerblatt in lokalen Koordinaten: x in [x0,x1] (Scharnier bei x=0), y in [-T,0] (+Y = Schwenkseite), z in [0,H]."""
    paint = M('wood_door_painted')
    W = x1 - x0
    box(mb, (x0, -T, 0), (x1, 0, H), paint)
    # Fuellungen (6 Felder innen / 4 Felder aussen) als erhabene Kassetten beidseitig
    hx = 0.0 if x0 == 0 else x1      # Scharnierkante
    sx = 1 if x0 == 0 else -1         # Richtung zum Schloss

    def lx(d):
        return hx + sx * d
    st = 0.115
    mid = 0.10
    if ext:
        rows = [(0.16, 0.95), (1.10, H - 0.14)]
    else:
        rows = [(0.16, 0.76), (0.90, 1.55), (1.66, H - 0.13)]
    pw = (W - 2 * st - mid) / 2
    for (za, zb) in rows:
        for c in range(2):
            da = st + c * (pw + mid)
            xa, xb = sorted((lx(da), lx(da + pw)))
            for face in (0, 1):
                y = 0.0 if face == 0 else -T
                dy = 1 if face == 0 else -1
                _raised_panel(mb, xa, xb, za, zb, y, dy, paint)
    # Beschlaege: Knauf beidseitig auf Schlossseite
    kx = lx(W - 0.065)
    kz = 0.91
    metal = M('metal_rusty')
    for face in (0, 1):
        y = 0.0 if face == 0 else -T
        dy = 1 if face == 0 else -1
        cylinder(mb, (kx, y, kz), (kx, y + dy * 0.01, kz), 0.031, metal, seg=16)
        cylinder(mb, (kx, y + dy * 0.01, kz), (kx, y + dy * 0.045, kz), 0.011, metal, seg=10)
        cylinder(mb, (kx, y + dy * 0.045, kz), (kx, y + dy * 0.072, kz), 0.029, metal, seg=16, r1=0.026)
        if ext and face == 1:
            cylinder(mb, (kx, y, kz + 0.15), (kx, y + dy * 0.012, kz + 0.15), 0.029, metal, seg=16)   # Riegelschloss
    # Scharnierknoepfe
    for zh in (0.24, 1.04, 1.84):
        cylinder(mb, (hx, 0.004, zh - 0.045), (hx, 0.004, zh + 0.045), 0.0065, metal, seg=8)
    # Kratz-/Trittspuren: angeschlagene Ecke unten auf der Schlossseite
    if did in ('front', 'bed2'):
        box(mb, (min(lx(W - 0.02), lx(W)), -T - 0.001, 0.0), (max(lx(W - 0.02), lx(W)), 0.001, 0.06), M('wood_planks_raw'))


def _raised_panel(mb, xa, xb, za, zb, y, dy, mat):
    inset = 0.022
    h = 0.005 * dy
    mb.new_part()
    b = [mb.vert((xa, y, za)), mb.vert((xb, y, za)), mb.vert((xb, y, zb)), mb.vert((xa, y, zb))]
    t = [mb.vert((xa + inset, y + h, za + inset)), mb.vert((xb - inset, y + h, za + inset)),
         mb.vert((xb - inset, y + h, zb - inset)), mb.vert((xa + inset, y + h, zb - inset))]
    if dy > 0:
        faces = [(t[0], t[3], t[2], t[1]), (b[0], t[0], t[1], b[1]), (b[1], t[1], t[2], b[2]), (b[2], t[2], t[3], b[3]), (b[3], t[3], t[0], b[0])]
    else:
        faces = [(t[0], t[1], t[2], t[3]), (b[0], b[1], t[1], t[0]), (b[1], b[2], t[2], t[1]), (b[2], b[3], t[3], t[2]), (b[3], b[0], t[0], t[3])]
    for f in faces:
        mb.face(f, mat)
    # Gegen Erwartung pruefen: Oberseite soll in dy zeigen
    from shell_lib import newell
    nv = newell([Vector(mb.v[i]) for i in mb.f[-5]])
    if nv.y * dy < 0:
        for k in range(1, 6):
            mb.f[-k] = mb.f[-k][::-1]


# ------------------------------------------------------------------ Fenster
def build_windows():
    for o in OPENINGS:
        if o['kind'] != 'window':
            continue
        U, N = axis_vecs(o)
        u0, u1, zs, zh = op_rough(o)
        n0, n1 = o['band']
        ext_lo = o['lo'] == 'EXT'
        room = o['hi'] if ext_lo else o['lo']
        # Normalenkoordinaten: aussen (Aussenflucht Beplankung) -> innen (Raumflucht)
        n_out = n0 if ext_lo else n1
        n_in = n1 if ext_lo else n0
        d_in = 1 if ext_lo else -1                 # Richtung nach innen

        def nn(d):   # Abstand d von Aussenflucht nach innen
            return n_out + d_in * d
        trim = M('wood_trim_painted')
        fr = MB(); gl = MB(); bd = MB()
        r = rng('win' + o['id'])
        depth = WALL_EXT

        def bx(mb, ua, ub, da, db, za, zb, mat):
            box(mb, wpt(o, ua, nn(da), za), wpt(o, ub, nn(db), zb), mat)
        # Blendrahmen / Futter
        bx(fr, u0, u0 + 0.03, -0.0, depth, zs, zh, trim)
        bx(fr, u1 - 0.03, u1, -0.0, depth, zs, zh, trim)
        bx(fr, u0, u1, 0.0, depth, zh - 0.03, zh, trim)
        # Fensterbank aussen (Sohlbank, schraeg) + innen (Bank + Schuerze)
        sill_pts = [(0.0, zs + 0.035), (-0.06, zs + 0.012), (-0.06, zs - 0.012), (0.0, zs - 0.0), (0.12, zs), (0.12, zs + 0.035)]
        for k in range(len(sill_pts)):
            pass
        bx(fr, u0 - 0.04, u1 + 0.04, -0.065, 0.12, zs - 0.03, zs + 0.0, trim)
        bx(fr, u0, u1, 0.0, depth - 0.0, zs, zs + 0.025, trim)
        bx(fr, u0 - CAS_W - 0.025, u1 + CAS_W + 0.025, depth - 0.01, depth + 0.045, zs + 0.0, zs + 0.025, trim)   # Fensterbank innen
        bx(fr, u0 - CAS_W + 0.005, u1 + CAS_W - 0.005, depth, depth + CAS_T, zs - 0.075, zs, trim)              # Schuerze
        # Innenbekleidung
        bx(fr, u0 - CAS_W, u0 + 0.004, depth, depth + CAS_T, zs + 0.025, zh + CAS_W, trim)
        bx(fr, u1 - 0.004, u1 + CAS_W, depth, depth + CAS_T, zs + 0.025, zh + CAS_W, trim)
        bx(fr, u0 - CAS_W - 0.006, u1 + CAS_W + 0.006, depth, depth + CAS_T, zh - 0.004, zh + CAS_W + 0.004, trim)
        bx(fr, u0 - CAS_W - 0.014, u1 + CAS_W + 0.014, depth, depth + CAS_T + 0.012, zh + CAS_W + 0.004, zh + CAS_W + 0.02, trim)
        # Schiebefluegel (Double-Hung): oberer aussen, unterer innen
        panes = o.get('panes', 1)
        iu0, iu1 = u0 + 0.03, u1 - 0.03
        iz0, iz1 = zs + 0.025, zh - 0.03
        midz = (iz0 + iz1) / 2
        state = o['state']
        lift = 0.0
        if state == 'open':
            lift = (iz1 - iz0) * 0.42
        sash = [('upper', midz - 0.02, iz1, 0.045, 0.085), ('lower', iz0 + lift, midz + 0.02 + lift, 0.09, 0.13)]
        cols = [(iu0 + (iu1 - iu0) * k / panes, iu0 + (iu1 - iu0) * (k + 1) / panes) for k in range(panes)]
        broken_ids = []
        for (nm, za, zb, da, db) in sash:
            for ci, (ca, cb) in enumerate(cols):
                sw = 0.05
                bx(fr, ca, ca + sw, da, db, za, zb, trim)
                bx(fr, cb - sw, cb, da, db, za, zb, trim)
                bx(fr, ca + sw, cb - sw, da, db, zb - (0.05 if nm == 'upper' else 0.04), zb, trim)
                bx(fr, ca + sw, cb - sw, da, db, za, za + (0.04 if nm == 'upper' else 0.07), trim)
                ga0, ga1 = ca + sw, cb - sw
                gz0 = za + (0.04 if nm == 'upper' else 0.07); gz1 = zb - (0.05 if nm == 'upper' else 0.04)
                # Sprossen im oberen Fluegel (2x2)
                if nm == 'upper':
                    um = (ga0 + ga1) / 2
                    bx(fr, um - 0.011, um + 0.011, da + 0.008, db - 0.008, gz0, gz1, trim)
                gm = (da + db) / 2
                pane = dict(u0=ga0, u1=ga1, z0=gz0, z1=gz1, n=gm, sash=nm, col=ci)
                broken = (state == 'broken' and (nm == 'lower' or r.random() < 0.5)) or (state == 'boarded' and r.random() < 0.7)
                if state == 'open' and nm == 'lower':
                    broken = False
                gone = state == 'boarded' and broken and r.random() < 0.5
                if gone:
                    continue
                g = MB()
                box(g, wpt(o, ga0 - 0.006, nn(gm - 0.002), gz0 - 0.006), wpt(o, ga1 + 0.006, nn(gm + 0.002), gz1 + 0.006), M('glass_dirty'))
                if broken:
                    rr = rng(o['id'] + nm + str(ci))
                    cx = rr.uniform(ga0 + (ga1 - ga0) * 0.35, ga1 - (ga1 - ga0) * 0.35)
                    cz = rr.uniform(gz0 + (gz1 - gz0) * 0.35, gz1 - (gz1 - gz0) * 0.35)
                    big = rr.uniform(0.55, 0.85)
                    pts = jagged(rr, cx, cz, (ga1 - ga0) * big * 0.75, (gz1 - gz0) * big * 0.75, n=18, rough=0.25, spikes=0.6, octaves=False)
                    cut = MB()
                    prism(cut, pts, wpt(o, 0, nn(gm), 0), U, Z, -0.02, 0.02, M('glass_dirty'))
                    # Prisma liegt in Ebene U/Z -> Normale U x Z; Tiefe +-0.02 genuegt in beide Richtungen
                    gl_ob = make_obj('_g', g, C_GLASS)
                    bool_apply(gl_ob, cut)
                    me = gl_ob.data
                    gmb = MB()
                    for p in me.polygons:
                        gmb.face([gmb.vert(me.vertices[i].co) for i in p.vertices], M('glass_dirty'))
                    bpy.data.objects.remove(gl_ob)
                    bpy.data.meshes.remove(me)
                    gl.extend(gmb)
                    broken_ids.append(nm)
                else:
                    gl.extend(g)
        # Scherben auf Fensterbank und Boden (innen, ausser bei boarded-Fenstern auch aussen)
        if broken_ids:
            for q in range(14):
                du = r.uniform(u0, u1)
                if q < 5:
                    dd = r.uniform(depth + 0.0, depth + 0.04); zz = zs + 0.026
                else:
                    dd = depth + r.uniform(0.05, 0.9); zz = FFL + 0.001
                s = r.uniform(0.02, 0.07)
                c = wpt(o, du, nn(dd), zz)
                a = r.uniform(0, math.tau)
                pts = [c + Vector((math.cos(a + k * 2.1 + r.uniform(-0.4, 0.4)) * s * r.uniform(0.5, 1.0),
                                   math.sin(a + k * 2.1 + r.uniform(-0.4, 0.4)) * s * r.uniform(0.5, 1.0), 0.002)) for k in range(3)]
                box_pts = pts + [p + Vector((0, 0, 0.003)) for p in pts]
                gl.new_part()
                i = [gl.vert(p) for p in box_pts]
                gl.poly([box_pts[3], box_pts[4], box_pts[5]], M('glass_dirty'), expect=Z)
                gl.poly([box_pts[0], box_pts[1], box_pts[2]], M('glass_dirty'), expect=-Z)
        if state == 'boarded':
            # Bretter aussen ueber der Bekleidung, teils schraeg, mit Spalten
            nb = r.randint(4, 6)
            span = (zh + 0.12) - (zs - 0.06)
            for k in range(nb):
                zc = zs - 0.03 + span * (k + 0.5) / nb + r.uniform(-0.03, 0.03)
                bw = r.uniform(0.14, 0.2)
                tilt = r.uniform(-0.06, 0.06) if k % 2 else r.uniform(-0.02, 0.02)
                if k == nb - 2 and r.random() < 0.6:
                    tilt = r.uniform(0.25, 0.4)   # ein Brett diagonal
                Lb = (u1 - u0) + 0.32 + r.uniform(-0.05, 0.08)
                cen = wpt(o, (u0 + u1) / 2 + r.uniform(-0.04, 0.04), nn(-0.05 - 0.01 * (k % 2)), zc)
                xa = U * math.cos(tilt) + Z * math.sin(tilt)
                obox(bd, cen, xa, -N if d_in > 0 else N, (Lb, 0.02, bw), M('wood_planks_raw'))
                # Naegel
                for s_ in (-1, 1):
                    pn = cen + xa * (s_ * (Lb / 2 - 0.06))
                    cylinder(bd, pn + (N if d_in < 0 else -N) * 0.009, pn + (N if d_in < 0 else -N) * 0.013, 0.005, M('metal_rusty'), seg=6)
        mk(f'WIN_{o["id"]}', fr, C_INT, 'wood', props={'opening': o['id'], 'room': room, 'state': state})
        if not gl.empty():
            mk(f'GLASS_{o["id"]}', gl, C_GLASS, 'glass', props={'opening': o['id'], 'room': room, 'state': state})
        if not bd.empty():
            mk(f'BOARDS_{o["id"]}', bd, C_EXT, 'wood', props={'opening': o['id']})


# ------------------------------------------------------------------ Leisten, Vorhangstangen
def build_trim():
    for rid, room in ROOMS.items():
        mb = MB()
        r = rng('trim' + rid)
        if room['walls'] == 'tile' or rid == 'UTIL':
            hb = 0.0
        else:
            hb = 0.09
        for e in room_edges(rid):
            if hb == 0:
                continue
            ex = []
            for a0, a1, z0, z1, o in edge_openings(e):
                if o['kind'] != 'window':
                    ex.append((a0 - CAS_W + 0.004, a1 + CAS_W - 0.004))
            # herausgerissene Stuecke
            nmiss = r.choice([0, 0, 1, 1, 2])
            for _ in range(nmiss):
                c = r.uniform(0.3, e['L'] - 0.3)
                ex.append((c - r.uniform(0.3, 0.9), c + r.uniform(0.3, 0.9)))
            ex.sort()
            segs = []
            cur = 0.0
            for a0, a1 in ex:
                if a0 > cur:
                    segs.append((cur, a0))
                cur = max(cur, a1)
            if cur < e['L']:
                segs.append((cur, e['L']))
            for (a0, a1) in segs:
                if a1 - a0 < 0.05:
                    continue
                a0c = max(a0, 0.0); a1c = min(a1, e['L'])
                # ein Stueck haengt lose (abgekippt)
                if r.random() < 0.12 and a1c - a0c > 0.6:
                    pv = wall_point(e, a0c, FFL)
                    ln = (a1c - a0c) * r.uniform(0.4, 0.8)
                    ang = r.uniform(0.25, 0.6)
                    xa = e['A']
                    ya = -e['n'] * math.cos(ang) + Z * 0.0
                    cen = pv + xa * (ln / 2) - e['n'] * (0.006 + math.sin(ang) * hb / 2) + Z * (math.cos(ang) * hb / 2)
                    obox(mb, cen, xa, e['n'] * math.sin(0) - e['n'], (ln, 0.012, hb), M('wood_trim_painted'))
                    # einfachheitshalber: lose Leiste leicht von der Wand weggeneigt
                    mb_last = mb
                    a0c = a0c + ln
                    if a1c - a0c < 0.05:
                        continue
                p0 = wall_point(e, a0c, FFL, -0.012)
                p1 = wall_point(e, a1c, FFL + hb, 0.0)
                box(mb, (min(p0.x, p1.x), min(p0.y, p1.y), FFL), (max(p0.x, p1.x), max(p0.y, p1.y), FFL + hb), M('wood_trim_painted'))
                # Viertelstab-Profil oben
                q0 = wall_point(e, a0c, FFL + hb, -0.006); q1 = wall_point(e, a1c, FFL + hb + 0.012, 0.0)
                box(mb, (min(q0.x, q1.x), min(q0.y, q1.y), FFL + hb), (max(q0.x, q1.x), max(q0.y, q1.y), FFL + hb + 0.012), M('wood_trim_painted'))
        # Vorhangstangen ueber Fenstern dieses Raums
        for o in OPENINGS:
            if o['kind'] != 'window' or room is None:
                continue
            if rid not in (o['lo'], o['hi']) or o['id'] in ('hal_e', 'util_b'):
                continue
            u0, u1, zs, zh = op_rough(o)
            n_in = o['band'][1] if o['lo'] == 'EXT' else o['band'][0]
            d_in = 1 if o['lo'] == 'EXT' else -1
            zr = zh + CAS_W + 0.13
            rr = rng('rod' + o['id'])
            fallen = rr.random() < 0.35
            ua, ub = u0 - CAS_W - 0.15, u1 + CAS_W + 0.15
            off = 0.09
            pa = wpt(o, ua, n_in + d_in * off, zr)
            pb = wpt(o, ub, n_in + d_in * off, zr)
            for uu in (ua + 0.03, ub - 0.03):
                b0 = wpt(o, uu, n_in, zr - 0.03); b1 = wpt(o, uu, n_in + d_in * (off + 0.01), zr + 0.012)
                box(mb, (min(b0.x, b1.x) - 0.006, min(b0.y, b1.y) - 0.006, zr - 0.03), (max(b0.x, b1.x) + 0.006, max(b0.y, b1.y) + 0.006, zr + 0.012), M('metal_rusty'))
            if fallen:
                pb = wpt(o, ub - 0.05, n_in + d_in * (off + 0.05), FFL + rr.uniform(0.6, 1.2))
            cylinder(mb, pa, pb, 0.011, M('metal_rusty'), seg=10)
            for p_ in (pa, pb):
                cylinder(mb, p_ + (pb - pa).normalized() * (-0.0 if p_ is pa else 0.0), p_ + (pb - pa).normalized() * (0.03 if p_ is pb else -0.03), 0.016, M('metal_rusty'), seg=10)
        if not mb.empty():
            mk(f'{rid}_trim', mb, C_INT, 'wood', props={'room': rid})


# ------------------------------------------------------------------ Elektro, Lueftung, Kleinteile am Rohbau
def build_fixtures():
    r = rng('fixtures')
    plastic = M('porcelain')
    for rid, room in ROOMS.items():
        mb = MB()
        for e in room_edges(rid):
            ops = edge_openings(e)
            blocked = [(a0 - CAS_W - 0.12, a1 + CAS_W + 0.12) for a0, a1, z0, z1, o in ops if o['kind'] != 'window' or z0 < FFL + 0.5]
            if e['L'] < 1.0 or rid == 'CLO1':
                continue
            n_out = max(1, int(e['L'] / 2.6))
            for k in range(n_out):
                a = (k + 0.5) * e['L'] / n_out + r.uniform(-0.3, 0.3)
                a = min(max(a, 0.35), e['L'] - 0.35)
                if any(b0 < a < b1 for b0, b1 in blocked):
                    continue
                z = FFL + (0.32 if not (rid == 'KIT' and e['dir'] == 'n') else 1.12)
                if rid == 'BATH':
                    z = FFL + 1.05
                _plate(mb, e, a, z, 'outlet', r)
        # Lichtschalter neben Durchgaengen (raumseitig, Schlossseite)
        for o in OPENINGS:
            if o['kind'] == 'window' or rid not in (o['lo'], o['hi']):
                continue
            side = 'lo' if o['lo'] == rid else 'hi'
            nf = o['band'][0] if side == 'lo' else o['band'][1]
            e = None
            for ee in room_edges(rid):
                horiz = abs(ee['n'].y) > 0.5
                line = ee['p0'].y if horiz else ee['p0'].x
                if (o['axis'] == 'x') == horiz and abs(line - nf) < 1e-3:
                    a_ = edge_a(ee, wpt(o, o['u'], nf, 0))
                    if 0 < a_ < ee['L']:
                        e = ee; break
            if e is None:
                continue
            u0, u1, _, _ = op_rough(o)
            latch = u1 if o.get('hinge', 'lo') == 'lo' else u0
            du = (CAS_W + 0.09) * (1 if latch == u1 else -1)
            a = edge_a(e, wpt(o, latch + du, nf, 0))
            if 0.1 < a < e['L'] - 0.1:
                _plate(mb, e, a, FFL + 1.22, 'switch', r)
        # Bodengitter (Heizung) unter dem ersten Aussenfenster
        for o in OPENINGS:
            if o['kind'] != 'window' or rid not in (o['lo'], o['hi']):
                continue
            U, N = axis_vecs(o)
            n_in = o['band'][1] if o['lo'] == 'EXT' else o['band'][0]
            d_in = 1 if o['lo'] == 'EXT' else -1
            c = wpt(o, o['u'] + r.uniform(-0.15, 0.15), n_in + d_in * 0.16, FFL)
            gone = r.random() < 0.3
            obox(mb, c + Vector((0, 0, 0.002)), U, N, (0.31, 0.13, 0.004), M('metal_galv') if not gone else M('void'))
            if not gone:
                for k in range(7):
                    obox(mb, c + U * (-0.12 + 0.04 * k) + Vector((0, 0, 0.0042)), U, N, (0.012, 0.09, 0.0005), M('metal_dark'))
            break
        if not mb.empty():
            mk(f'{rid}_fixtures', mb, C_INT, 'plaster', props={'room': rid})
    fx = MB()
    # Rauchmelder im Flur, haengt an den Draehten herunter
    cx, cy = -0.28, 4.95
    cylinder(fx, (cx, cy, CEIL), (cx, cy, CEIL - 0.008), 0.055, plastic, seg=16)
    dz = CEIL - 0.34
    cylinder(fx, (cx + 0.05, cy + 0.03, dz + 0.035), (cx + 0.05, cy + 0.03, dz - 0.0), 0.065, plastic, seg=16)
    tube_path(fx, [Vector((cx, cy, CEIL - 0.008)), Vector((cx + 0.02, cy + 0.03, CEIL - 0.15)), Vector((cx + 0.05, cy + 0.03, dz + 0.035))], 0.003, M('wire'), seg=5)
    tube_path(fx, [Vector((cx + 0.01, cy - 0.01, CEIL - 0.008)), Vector((cx + 0.05, cy - 0.0, CEIL - 0.2)), Vector((cx + 0.07, cy + 0.02, dz + 0.035))], 0.003, M('paint_red'), seg=5)
    # Dachbodenluke im Flur (Rahmen + Deckel)
    hx, hy, hs = -0.28, 6.6, 0.62
    tr = M('wood_trim_painted')
    for (a0, b0, a1, b1) in ((hx - hs / 2 - 0.06, hy - hs / 2 - 0.06, hx + hs / 2 + 0.06, hy - hs / 2), (hx - hs / 2 - 0.06, hy + hs / 2, hx + hs / 2 + 0.06, hy + hs / 2 + 0.06),
                             (hx - hs / 2 - 0.06, hy - hs / 2, hx - hs / 2, hy + hs / 2), (hx + hs / 2, hy - hs / 2, hx + hs / 2 + 0.06, hy + hs / 2)):
        box(fx, (a0, b0, CEIL - 0.014), (a1, b1, CEIL), tr)
    box(fx, (hx - hs / 2 + 0.004, hy - hs / 2 + 0.004, CEIL - 0.006), (hx + hs / 2 - 0.004, hy + hs / 2 - 0.004, CEIL - 0.0005), M('plaster_damaged'))
    # Thermostat im Flur
    obox(fx, Vector((-0.88 + 0.013, 5.7, FFL + 1.45)), Y, X, (0.11, 0.026, 0.075), plastic)
    # Abluftgitter im Bad
    box(fx, (1.6, 6.3, CEIL - 0.01), (1.85, 6.55, CEIL), plastic)
    for k in range(6):
        box(fx, (1.62, 6.32 + 0.035 * k, CEIL - 0.0105), (1.83, 6.335 + 0.035 * k, CEIL - 0.0101), M('metal_dark'))
    # Sicherungskasten Waschkueche (Suedwand, Tuer offen)
    gx, gy = 1.75, 8.12
    gz0, gz1 = FFL + 1.2, FFL + 1.78
    box(fx, (gx - 0.18, gy, gz0), (gx + 0.18, gy + 0.09, gz1), M('metal_galv'))
    box(fx, (gx - 0.15, gy + 0.0901, gz0 + 0.04), (gx + 0.15, gy + 0.0905, gz1 - 0.04), M('metal_dark'))
    for k in range(8):
        for sdx in (-0.06, 0.06):
            box(fx, (gx + sdx - 0.04, gy + 0.09, gz0 + 0.08 + k * 0.055), (gx + sdx + 0.04, gy + 0.105, gz0 + 0.11 + k * 0.055), M('rubber_black'))
    obox(fx, Vector((gx - 0.18 - 0.17 * math.cos(math.radians(70)), gy + 0.09 + 0.17 * math.sin(math.radians(70)), (gz0 + gz1) / 2)),
         Vector((math.cos(math.radians(110)), math.sin(math.radians(110)), 0)), Vector((-math.sin(math.radians(110)), math.cos(math.radians(110)), 0)),
         (0.34, 0.006, gz1 - gz0 - 0.01), M('metal_galv'))
    # Leitung vom Kasten zur Decke
    cylinder(fx, (gx, gy + 0.03, gz1), (gx, gy + 0.03, CEIL), 0.012, M('metal_galv'), seg=8)
    mk('INT_fixtures', fx, C_INT, 'metal')


def _plate(mb, e, a, z, kind, r):
    plastic = M('porcelain')
    gone = r.random() < 0.22
    c = wall_point(e, a, z, -0.003)
    if gone:
        # Dose ohne Abdeckung: dunkle Oeffnung + heraushaengende Adern
        obox(mb, wall_point(e, a, z, -0.0006), e['A'], e['n'], (0.055, 0.0012, 0.09), M('void'))
        p0 = wall_point(e, a, z - 0.02, -0.001)
        for k, col in enumerate(('wire', 'rubber_black')):
            pts = [p0 + e['A'] * (0.012 * k), wall_point(e, a + 0.01 + 0.012 * k, z - 0.06, -0.03), wall_point(e, a + 0.03 + 0.012 * k, z - 0.12, -0.035)]
            tube_path(mb, pts, 0.0025, M(col), seg=5)
        return
    obox(mb, c, e['A'], e['n'], (0.07, 0.006, 0.115), plastic)
    if kind == 'outlet':
        for dz in (-0.02, 0.02):
            for da in (-0.006, 0.006):
                obox(mb, wall_point(e, a + da, z + dz, -0.0061), e['A'], e['n'], (0.002, 0.0004, 0.01), M('void'))
    else:
        tilt = 0.3 if r.random() < 0.5 else -0.3
        cen = wall_point(e, a, z, -0.012)
        obox(mb, cen, e['A'], e['n'] * math.cos(tilt) + Z * math.sin(tilt), (0.012, 0.016, 0.022), plastic)


# ------------------------------------------------------------------ Aussen
def ext_faces():
    x0, y0, x1, y1 = EXT
    faces = [
        dict(id='s', O=Vector((x0, y0, 0)), A=Vector((1, 0, 0)), L=x1 - x0, axis='x', line=y0, gable=False),
        dict(id='n', O=Vector((x1, y1, 0)), A=Vector((-1, 0, 0)), L=x1 - x0, axis='x', line=y1, gable=False),
        dict(id='e', O=Vector((x1, y0, 0)), A=Vector((0, 1, 0)), L=y1 - y0, axis='y', line=x1, gable=True),
        dict(id='w', O=Vector((x0, y1, 0)), A=Vector((0, -1, 0)), L=y1 - y0, axis='y', line=x0, gable=True),
    ]
    for f in faces:
        f['n'] = Vector((f['A'].y, -f['A'].x, 0))
        ops = []
        for o in OPENINGS:
            if o['axis'] != f['axis']:
                continue
            if not (o['band'][0] - 1e-4 <= f['line'] <= o['band'][1] + 1e-4):
                continue
            u0, u1, z0, z1 = op_rough(o)
            pu = f['O'].x if f['axis'] == 'x' else f['O'].y
            s = f['A'].x if f['axis'] == 'x' else f['A'].y
            a0, a1 = sorted(((u0 - pu) * s, (u1 - pu) * s))
            ops.append((a0, a1, z0, z1, o))
        f['ops'] = ops
    return faces


def face_top(f, a):
    if not f['gable']:
        return CEIL   # unter der Traufe (Unterkante Gesims)
    p = f['O'] + f['A'] * a
    return roof_z(p.y) - 0.06


def build_exterior():
    faces = ext_faces()
    sid = MB(); trim = MB(); sh = MB(); plinth = MB()
    tr = M('wood_trim_painted')
    for f in faces:
        A = f['A']; n = f['n']; O = f['O']

        def P(a, z, out):
            return O + A * a + Vector((0, 0, z)) + n * out
        # Beplankung (innen sichtbar durch Wandloecher / im Dachraum)
        holes = [(a0, a1, z0, z1) for a0, a1, z0, z1, o in f['ops']]
        grid_slab(sh, O, A, Z, -SHEATH, 0.0, (0.0, f['L']), (0.45, CEIL + 0.25), holes, M('wood_planks_raw'))
        if f['gable']:
            ztop0 = CEIL + 0.25
            pts = [(0.0, ztop0), (f['L'], ztop0), (f['L'], face_top(f, f['L'])), (f['L'] / 2, face_top(f, f['L'] / 2)), (0.0, face_top(f, 0.0))]
            pts = [(a, max(z, ztop0)) for a, z in pts]
            prism(sh, [(a, z) for a, z in pts if True], O, A, Z, -SHEATH, 0.0, M('wood_planks_raw'))
        # Ausschlussbereiche fuer Fassade: Oeffnungen + Bekleidung
        excl = []
        for a0, a1, z0, z1, o in f['ops']:
            if o['kind'] == 'window':
                excl.append((a0 - 0.095, a1 + 0.095, z0 - 0.07, z1 + 0.13))
            else:
                excl.append((a0 - 0.095, a1 + 0.095, -1, z1 + 0.13))
        # Eckbretter
        cb_w = 0.10
        excl_corner = [(0, cb_w - 0.01), (f['L'] - cb_w + 0.01, f['L'])]
        k = 0
        while True:
            zb = SIDING_Z0 + 0.2 * k
            zt = zb + 0.2
            k += 1
            maxtop = max(face_top(f, a) for a in (0, f['L'] / 2, f['L']))
            if zb >= maxtop - 0.02:
                break
            # freie Intervalle in [cb_w, L-cb_w]
            iv = [(cb_w - 0.005, f['L'] - cb_w + 0.005)]
            for a0, a1, z0, z1 in excl:
                if z1 <= zb or z0 >= zt:
                    continue
                nv = []
                for s0, s1 in iv:
                    if a1 <= s0 or a0 >= s1:
                        nv.append((s0, s1)); continue
                    if a0 > s0: nv.append((s0, a0))
                    if a1 < s1: nv.append((a1, s1))
                iv = nv
            for s0, s1 in iv:
                if s1 - s0 < 0.01:
                    continue
                # Unterteilen an Giebelspitze / Schnitt mit Dachlinie
                brk = {s0, s1}
                if f['gable']:
                    brk.add(min(max(f['L'] / 2, s0), s1))
                    for side_a in (0.0, f['L']):
                        pass
                    # Schnittpunkte face_top(a) == zt (linear je Haelfte)
                    for half in ((0.0, f['L'] / 2), (f['L'] / 2, f['L'])):
                        za, zb_ = face_top(f, half[0] + 1e-6), face_top(f, half[1] - 1e-6)
                        if (za - zt) * (zb_ - zt) < 0:
                            ac = half[0] + (zt - za) / (zb_ - za) * (half[1] - half[0])
                            if s0 < ac < s1:
                                brk.add(ac)
                        if (za - zb - 0.02) * (zb_ - zb - 0.02) < 0:
                            ac = half[0] + (zb + 0.02 - za) / (zb_ - za) * (half[1] - half[0])
                            if s0 < ac < s1:
                                brk.add(ac)
                brk = sorted(brk)
                for i in range(len(brk) - 1):
                    a0, a1 = brk[i], brk[i + 1]
                    t0 = min(zt, face_top(f, a0)); t1 = min(zt, face_top(f, a1))
                    if t0 <= zb + 0.015 and t1 <= zb + 0.015:
                        continue
                    t0 = max(t0, zb + 0.015); t1 = max(t1, zb + 0.015)
                    d_bot, d_top = 0.024, 0.007

                    def dz(z):
                        return d_bot + (d_top - d_bot) * (z - zb) / 0.2
                    q = [P(a0, zb, dz(zb)), P(a1, zb, dz(zb)), P(a1, t1, dz(t1)), P(a0, t0, dz(t0))]
                    sid.poly(q, M('siding_vinyl_dirty'), expect=n)
                    sid.poly([P(a0, zb, 0.004), P(a1, zb, 0.004), P(a1, zb, dz(zb)), P(a0, zb, dz(zb))], M('siding_vinyl_dirty'), expect=-Z)
        # Eckbretter (beide Enden der Flaeche)
        for a in (0.0, f['L'] - cb_w):
            top = min(face_top(f, a), face_top(f, a + cb_w))
            box(trim, (0, 0, 0), (0, 0, 0), tr) if False else None
            q0 = P(a, SIDING_Z0 - 0.02, 0.0); q1 = P(a + cb_w, top, 0.03)
            box(trim, (min(q0.x, q1.x), min(q0.y, q1.y), SIDING_Z0 - 0.02), (max(q0.x, q1.x), max(q0.y, q1.y), top), tr)
        # Fries unter dem Gesims (Traufseiten)
        if not f['gable']:
            q0 = P(0.0, CEIL - 0.14, 0.0); q1 = P(f['L'], CEIL, 0.028)
            box(trim, (min(q0.x, q1.x), min(q0.y, q1.y), CEIL - 0.14), (max(q0.x, q1.x), max(q0.y, q1.y), CEIL + 0.02), tr)
        # Bekleidungen aussen
        for a0, a1, z0, z1, o in f['ops']:
            cw = 0.09
            zb0 = z0 if o['kind'] == 'window' else FFL
            for (aa, ab) in ((a0 - cw, a0), (a1, a1 + cw)):
                q0 = P(aa, zb0 - (0.0 if o['kind'] == 'window' else 0.0), 0.0); q1 = P(ab, z1 + cw, 0.03)
                box(trim, (min(q0.x, q1.x), min(q0.y, q1.y), zb0), (max(q0.x, q1.x), max(q0.y, q1.y), z1 + cw), tr)
            q0 = P(a0 - cw - 0.01, z1, 0.0); q1 = P(a1 + cw + 0.01, z1 + cw, 0.03)
            box(trim, (min(q0.x, q1.x), min(q0.y, q1.y), z1), (max(q0.x, q1.x), max(q0.y, q1.y), z1 + cw), tr)
            q0 = P(a0 - cw - 0.02, z1 + cw, 0.0); q1 = P(a1 + cw + 0.02, z1 + cw + 0.03, 0.05)
            box(trim, (min(q0.x, q1.x), min(q0.y, q1.y), z1 + cw), (max(q0.x, q1.x), max(q0.y, q1.y), z1 + cw + 0.025), tr)   # Wasserschenkel
        # Sockel (Ziegel) mit Lueftungsoeffnungen
        vents = []
        r = rng('vent' + f['id'])
        nvent = int(f['L'] // 3.2)
        for i in range(nvent):
            ac = (i + 0.5) * f['L'] / nvent + r.uniform(-0.3, 0.3)
            vents.append((ac - 0.2, ac + 0.2, 0.14, 0.30))
        if f['id'] == 's':
            vents = [v for v in vents if not (2.5 < v[0] + 0.2 < 9.6)]   # hinter der Veranda keine
        grid_slab(plinth, O + n * 0.03, A, Z, -0.20, 0.0, (-0.03 if f['id'] in ('s', 'n') else -0.03, f['L'] + 0.03), (-0.3, SIDING_Z0 + 0.02), vents,
                  M('brick_red'), mat_side=M('concrete_floor'))
        # Abdeckung oben
        q0 = P(-0.03, SIDING_Z0, -0.02); q1 = P(f['L'] + 0.03, SIDING_Z0 + 0.03, 0.045)
        box(plinth, (min(q0.x, q1.x), min(q0.y, q1.y), SIDING_Z0 + 0.0), (max(q0.x, q1.x), max(q0.y, q1.y), SIDING_Z0 + 0.03), M('concrete_floor'))
        # Gitter in den Lueftungsoeffnungen (zurueckgesetzt) - eines fehlt
        for vi, (va, vb, vz0, vz1) in enumerate(vents):
            if vi == 1 and f['id'] == 'e':
                continue
            for k in range(6):
                zz = vz0 + (vz1 - vz0) * (k + 0.5) / 6
                q0 = P(va, zz - 0.006, -0.06); q1 = P(vb, zz + 0.006, -0.05)
                box(plinth, (min(q0.x, q1.x), min(q0.y, q1.y), zz - 0.006), (max(q0.x, q1.x), max(q0.y, q1.y), zz + 0.006), M('metal_rusty'))
            q0 = P(va, vz0, -0.17); q1 = P(vb, vz1, -0.16)
            box(plinth, (min(q0.x, q1.x), min(q0.y, q1.y), vz0), (max(q0.x, q1.x), max(q0.y, q1.y), vz1), M('void'))
    mk('EXT_siding', sid, C_EXT, 'plaster', uv='zup')
    mk('EXT_trim', trim, C_EXT, 'wood')
    mk('EXT_sheathing', sh, C_EXT, 'wood')
    mk('EXT_foundation', plinth, C_EXT, 'concrete')
    # Kriechkeller-Boden + Innenwaende des Sockels (dunkel)
    cs = MB()
    grid_slab(cs, (0, 0, -0.06), X, Y, 0, 0.02, (EXT[0] + 0.0, EXT[2] - 0.0), (EXT[1], EXT[3]), [], M('dirt_mud'))
    mk('EXT_crawlspace', cs, C_EXT, 'dirt')


# ------------------------------------------------------------------ Dach
PORCH = dict(x0=-3.1, x1=2.1, y0=-2.4, deck=FFL - 0.03)


def build_roof():
    rf = MB(); fas = MB(); gut = MB(); sof = MB()
    tr = M('wood_trim_painted')
    S = ROOF_S
    cs = 1 / math.sqrt(1 + S * S); sn = S * cs
    span = 5.0 + EAVE
    Lb = span / cs
    r = rng('roof')
    missing = set()
    for _ in range(9):
        ca = r.randint(0, 38); cb = r.randint(0, 14)
        for da in range(r.randint(1, 3)):
            for db in range(r.randint(1, 2)):
                missing.add((ca + da, cb + db, r.random() < 0.5))

    def mf_fn(front):
        def fn(a, b, side):
            if side < 0:
                return M('wood_planks_raw')
            ia = int(a / 0.35); ib = int(b / 0.35)
            if (ia, ib, front) in missing:
                return M('wood_planks_raw')
            return M('roof_shingles')
        return fn

    def sag(a, b):
        return -0.035 * math.sin(math.pi * min(max(a / 13.6, 0), 1)) * math.sin(math.pi * min(max(b / Lb, 0), 1))
    # vorne: Ebene ab Traufe (y=-EAVE) aufwaerts; Aussparung ueber der Veranda (Verandadach schliesst an)
    Of = Vector((EXT[0] - RAKE, EXT[1] - EAVE, roof_z(EXT[1] - EAVE)))
    Bf = Vector((0, cs, sn))
    notch_b = EAVE / cs
    grid_slab(rf, Of, X, Bf, -0.05, 0.0, (0.0, EXT[2] - EXT[0] + 2 * RAKE), (0.0, Lb), [(PORCH['x0'] - Of.x, PORCH['x1'] - Of.x, -1, notch_b)],
              M('roof_shingles'), mat_side=tr, mat_fn=mf_fn(True), cell=0.35, disp=sag)
    Ob = Vector((EXT[2] + RAKE, EXT[3] + EAVE, roof_z(EXT[3] + EAVE)))
    Bb = Vector((0, -cs, sn))
    grid_slab(rf, Ob, -X, Bb, -0.05, 0.0, (0.0, EXT[2] - EXT[0] + 2 * RAKE), (0.0, Lb), [], M('roof_shingles'), mat_side=tr, mat_fn=mf_fn(False), cell=0.35, disp=sag)
    # Firstkappe
    zr = roof_z(5.0)
    for sgn in (1, -1):
        p0 = Vector((EXT[0] - RAKE - 0.01, 5.0, zr + 0.012)); d = Vector((0, -sgn * cs, -sn))
        obox(rf, p0 + d * 0.09 + Vector((EXT[2] - EXT[0] + 2 * RAKE + 0.02, 0, 0)) / 2, X, d, (EXT[2] - EXT[0] + 2 * RAKE + 0.02, 0.18, 0.02), M('roof_shingles'))
    # Entlueftungsrohr
    cylinder(rf, (1.4, 7.5, roof_z(7.5) - 0.1), (1.4, 7.5, roof_z(7.5) + 0.35), 0.045, M('metal_galv'), seg=12)
    cylinder(rf, (1.4, 7.5, roof_z(7.5) - 0.02), (1.4, 7.5, roof_z(7.5) + 0.02), 0.14, M('rubber_black'), seg=12)
    # Traufbretter (Fascia) vorn/hinten
    for (yy, d) in ((EXT[1] - EAVE, -1), (EXT[3] + EAVE, 1)):
        zt = roof_z(yy) + 0.0
        segs = [(EXT[0] - RAKE, PORCH['x0']), (PORCH['x1'], EXT[2] + RAKE)] if d < 0 else [(EXT[0] - RAKE, EXT[2] + RAKE)]
        for xa, xb in segs:
            box(fas, (xa, yy + d * 0.025 if d > 0 else yy - 0.025, zt - 0.23), (xb, yy, zt - 0.0), tr)
            if d > 0:
                box(fas, (xa, yy, zt - 0.23), (xb, yy + 0.025, zt), tr)
        # Untersicht (Soffit) mit einem fehlenden Feld
        for xa, xb in segs:
            ys = (yy, EXT[1]) if d < 0 else (EXT[3], yy)
            holes = [(-4.95 - xa, -3.85 - xa, -1, 9)] if (d < 0 and xa < -4) else []
            grid_slab(sof, (xa, 0, CEIL + 0.0), X, Y, -0.012, 0.0, (0.0, xb - xa), (ys[0], ys[1]), holes, tr)
    # Ortgang (Rake) vorne/hinten je Giebelseite
    for xx in (EXT[0] - RAKE, EXT[2] + RAKE):
        for (ya, yb) in ((EXT[1] - EAVE, 5.0), (5.0, EXT[3] + EAVE)):
            pts = [(ya, roof_z(ya)), (yb, roof_z(yb)), (yb, roof_z(yb) - 0.2), (ya, roof_z(ya) - 0.2)]
            if ya < 5.0:
                pts[2] = (yb, roof_z(yb) - 0.2)
            prism(fas, pts, (xx, 0, 0), Y, Z, -0.025 if xx < 0 else 0.0, 0.0 if xx < 0 else 0.025, tr)
    # Dachrinnen (Kastenprofil) + Fallrohre
    metal = M('metal_galv')

    def gutter(xa, xb, yy, d, zt, droop=None):
        """Rinne entlang X an y=yy (Aussenkante fascia), d=-1 vorne / +1 hinten."""
        prof = [(0.0, 0.0), (0.0, -0.10), (0.11, -0.11), (0.13, -0.02), (0.135, 0.01)]
        L = xb - xa
        nseg = max(1, int(L / 0.5))
        for s in range(nseg):
            x0 = xa + L * s / nseg; x1 = xa + L * (s + 1) / nseg
            dz0 = droop(x0) if droop else 0.0; dz1 = droop(x1) if droop else 0.0
            for i in range(len(prof) - 1):
                (py0, pz0), (py1, pz1) = prof[i], prof[i + 1]
                q = [(x0, yy + d * py0, zt + pz0 + dz0), (x1, yy + d * py0, zt + pz0 + dz1), (x1, yy + d * py1, zt + pz1 + dz1), (x0, yy + d * py1, zt + pz1 + dz0)]
                nrm = Vector((0, d * (pz1 - pz0), -(py1 - py0)))
                gut.poly(q, metal, expect=nrm)
                gut.poly(q, metal, expect=-nrm)
        for xe in (xa, xb):
            dz = droop(xe) if droop else 0.0
            pts3 = [(xe, yy + d * py, zt + pz + dz) for py, pz in prof[:4]]
            gut.poly(pts3, metal, expect=X)
            gut.poly(pts3, metal, expect=-X)
    ztf = roof_z(EXT[1] - EAVE) - 0.03
    gutter(EXT[0] - RAKE, PORCH['x0'] - 0.02, EXT[1] - EAVE - 0.025, -1, ztf)
    # rechte vordere Rinne: an einem Ende abgerissen, haengt durch
    xa, xb = PORCH['x1'] + 0.02, EXT[2] + RAKE
    gutter(xa, xb, EXT[1] - EAVE - 0.025, -1, ztf, droop=lambda x: -0.9 * max(0.0, (x - (xb - 2.6)) / 2.6) ** 1.6)
    ztb = roof_z(EXT[3] + EAVE) - 0.03
    gutter(EXT[0] - RAKE, EXT[2] + RAKE, EXT[3] + EAVE + 0.025, 1, ztb)

    def downspout(x, y, ztop, zbot, out_d, kick=True):
        w, dpt = 0.075, 0.055
        box(gut, (x - w / 2, y - dpt / 2, zbot + 0.25), (x + w / 2, y + dpt / 2, ztop - 0.25), metal)
        # Bogen oben zur Rinne
        beam(gut, (x, y, ztop - 0.25), (x, y + out_d * 0.18, ztop - 0.05), 0.075, 0.055, metal)
        if kick:
            beam(gut, (x, y, zbot + 0.28), (x, y - out_d * 0.35, zbot + 0.04), 0.075, 0.055, metal)
    downspout(EXT[0] - 0.15, EXT[1] - 0.06, ztf, 0.0, -1)
    downspout(EXT[0] - 0.15, EXT[3] + 0.06, ztb, 0.0, 1)
    downspout(EXT[2] + 0.15, EXT[3] + 0.06, ztb, 0.0, 1)
    # vorne rechts: Fallrohr abgebrochen, unterer Teil liegt im Gras
    box(gut, (EXT[2] + 0.15 - 0.0375, -0.06 - 0.0275, 2.1), (EXT[2] + 0.15 + 0.0375, -0.06 + 0.0275, ztf - 0.25), metal)
    beam(gut, (EXT[2] + 0.4, -1.2, 0.05), (EXT[2] + 1.6, -2.9, 0.06), 0.075, 0.055, metal)
    mk('ROOF_main', rf, C_EXT, 'wood')
    mk('ROOF_fascia', fas, C_EXT, 'wood')
    mk('ROOF_soffit', sof, C_EXT, 'wood')
    mk('ROOF_gutters', gut, C_EXT, 'metal')


# ------------------------------------------------------------------ Veranda
def build_porch():
    x0, x1, y0 = PORCH['x0'], PORCH['x1'], PORCH['y0']
    deck = PORCH['deck']
    r = rng('porch')
    dk = MB(); st = MB(); rail = MB(); post = MB(); proof = MB(); skirt = MB()
    tr = M('wood_trim_painted'); raw = M('wood_planks_raw')
    # Dielen (quer zum Haus, entlang Y)
    bw, gap = 0.14, 0.006
    x = x0 + 0.03
    k = 0
    while x + bw <= x1 - 0.03 + 1e-6:
        k += 1
        if k in (9, 23):   # fehlende Dielen
            x += bw + gap
            continue
        ya = y0 - 0.03
        yb = -0.0
        if k == 16:        # gebrochene Diele: Stueck fehlt in der Mitte
            box(dk, (x, ya, deck - 0.025), (x + bw, -1.6, deck), raw)
            box(dk, (x, -0.95, deck - 0.025), (x + bw, yb, deck), raw)
            obox(dk, Vector((x + bw / 2, -1.28, deck - 0.09)), Vector((0, 1, -0.5)), X, (0.55, bw, 0.025), raw)
        else:
            dz = r.uniform(-0.004, 0.004)
            box(dk, (x, ya, deck - 0.025 + dz), (x + bw, yb, deck + dz), raw)
        x += bw + gap
    # Unterkonstruktion: Randbalken + Balken
    box(dk, (x0, y0 - 0.03, deck - 0.24), (x1, y0 - 0.01, deck - 0.025), tr)
    for xx in (x0, x1 - 0.04):
        box(dk, (xx, y0 - 0.01, deck - 0.24), (xx + 0.04, 0.0, deck - 0.025), tr)
    for yy in [y0 + 0.4 * i for i in range(1, 6)]:
        box(dk, (x0 + 0.04, yy, deck - 0.22), (x1 - 0.04, yy + 0.045, deck - 0.025), raw)
    # Schuerze (Lattenverkleidung) bis zum Boden, mit ausgebrochenem Feld
    for (ya, yb, xa, xb, along) in ((y0 - 0.05, y0 - 0.03, x0, x1, 'x'), (y0 - 0.03, 0.0, x0 - 0.02, x0, 'y'), (y0 - 0.03, 0.0, x1, x1 + 0.02, 'y')):
        if along == 'x':
            u = xa
            while u < xb:
                if not (-1.05 < u < 0.55) and not (1.0 < u < 1.5):
                    box(skirt, (u, ya, -0.1), (min(u + 0.06, xb), yb, deck - 0.24), tr)
                u += 0.1
        else:
            u = ya
            while u < yb:
                box(skirt, (xa, u, -0.1), (xb, min(u + 0.06, yb), deck - 0.24), tr)
                u += 0.1
    # Treppe: 3 Steigungen (Deck = 3.), Breite 1.5 vor der Tuer
    sx0, sx1 = -1.03, 0.47
    rise = deck / 3
    for i in range(2):
        ztop = deck - rise * (i + 1)
        ya = y0 - 0.03 - 0.28 * (i + 1); yb = y0 - 0.03 - 0.28 * i
        box(st, (sx0, ya - 0.02, ztop - 0.03), (sx1, yb, ztop), raw)          # Trittstufe
        box(st, (sx0 + 0.02, yb - 0.02, ztop - 0.0 - rise + 0.03), (sx1 - 0.02, yb, ztop - 0.03), tr)  # Setzstufe
    box(st, (sx0 + 0.02, y0 - 0.05, deck - rise - 0.0), (sx1 - 0.02, y0 - 0.03, deck - 0.025), tr)
    for xx in (sx0, sx1 - 0.04):
        pts = [(y0 - 0.03, deck - 0.03), (y0 - 0.03 - 0.62, -0.05), (y0 - 0.03, -0.05)]
        prism(st, [(-p[0], p[1]) for p in pts], (xx, 0, 0), -Y, Z, 0, 0.04, tr)
    # Verandastuetzen
    zb = deck
    beam_bot = 2.72
    posts_x = [x0 + 0.06, sx0 - 0.06, sx1 + 0.06, x1 - 0.06]
    for i, px in enumerate(posts_x):
        tilt = 0.0 if i != 3 else 0.025
        obox(post, Vector((px + tilt * 1.1, y0 + 0.06, (zb + beam_bot) / 2)), Vector((1, 0, 0)), Vector((0, 1, 0)), (0.1, 0.1, beam_bot - zb), tr)
        box(post, (px - 0.075, y0 + 0.06 - 0.075, zb), (px + 0.075, y0 + 0.06 + 0.075, zb + 0.12), tr)
        box(post, (px - 0.07, y0 + 0.06 - 0.07, beam_bot - 0.08), (px + 0.07, y0 + 0.06 + 0.07, beam_bot), tr)
    box(post, (x0 - 0.02, y0 + 0.0, beam_bot), (x1 + 0.02, y0 + 0.12, beam_bot + 0.22), tr)
    # Gelaender: Handlauf 0.9 ueber Deck, Staebe
    ht = 0.9

    def railing(pa, pb, z0a, z0b, missing=(), broken=False):
        pa = Vector((pa[0], pa[1], 0)); pb = Vector((pb[0], pb[1], 0))
        d = pb - pa; Lr = d.length; dn = d / Lr
        side = Vector((-dn.y, dn.x, 0))
        for zz, hh, ww in ((ht, 0.04, 0.09), (0.08, 0.04, 0.07)):
            p0 = pa + Vector((0, 0, z0a + zz)); p1 = pb + Vector((0, 0, z0b + zz))
            if broken and zz > 0.5:
                mid = p0 + (p1 - p0) * 0.55
                beam(rail, p0, mid, ww, hh, tr)
                beam(rail, mid + Vector((0, 0, -0.02)), mid + (p1 - p0).normalized() * 0.6 + Vector((0, 0, -0.55)), ww, hh, tr)
                continue
            beam(rail, p0, p1, ww, hh, tr)
        nb = int(Lr / 0.12)
        for i in range(1, nb):
            if i in missing:
                continue
            t = i / nb
            p = pa + d * t
            zb_ = z0a + (z0b - z0a) * t
            tilt = r.uniform(-0.02, 0.02)
            box(rail, (p.x - 0.019, p.y - 0.019, zb_ + 0.1), (p.x + 0.019, p.y + 0.019, zb_ + ht - 0.02), tr)
    railing((x0 + 0.06, y0 + 0.06), (sx0 - 0.06, y0 + 0.06), deck, deck, missing=(4, 5, 11))
    railing((sx1 + 0.06, y0 + 0.06), (x1 - 0.06, y0 + 0.06), deck, deck, missing=(7,), broken=True)
    railing((x0 + 0.06, y0 + 0.06), (x0 + 0.06, -0.05), deck, deck, missing=(9,))
    railing((x1 - 0.06, y0 + 0.06), (x1 - 0.06, -0.05), deck, deck)
    # Treppenhandlaeufe
    for xx in (sx0 - 0.02, sx1 + 0.02):
        pa = (xx, y0 + 0.02); pb = (xx, y0 - 0.62)
        box(rail, (xx - 0.045, y0 - 0.66, -0.05), (xx + 0.045, y0 - 0.57, ht + 0.1), tr)
        p0 = Vector((xx, y0 + 0.06, deck + ht)); p1 = Vector((xx, y0 - 0.62, ht + 0.05))
        beam(rail, p0, p1, 0.06, 0.04, tr)
    # Verandadach (flach geneigt, schliesst an Hauptdach an)
    Sp = 2.5 / 12
    zw = ROOF_Z0 - 0.04
    yf = y0 - 0.12

    def pz(y):
        return zw + Sp * y
    ln = math.hypot(-yf, zw - pz(yf))
    dirv = Vector((0, -1, -Sp)).normalized()
    grid_slab(proof, Vector((x0 - 0.06, 0.0, zw)), X, dirv, -0.05, 0.0, (0.0, x1 - x0 + 0.12), (0.0, ln), [], M('roof_shingles'),
              mat_side=tr, mat_fn=lambda a, b, s: M('roof_shingles') if s < 0 else M('wood_planks_raw'))
    # Achtung: Normale von X x dirv zeigt nach unten -> Oberseite ist c0-Seite
    # Decke der Veranda (Profilbretter) + Stirnbrett vorn + Seitenblenden
    box(proof, (x0, y0 - 0.0, beam_bot + 0.22), (x1, 0.0, beam_bot + 0.235), tr)
    box(proof, (x0 - 0.06, yf - 0.025, pz(yf) - 0.22), (x1 + 0.06, yf, pz(yf) - 0.02), tr)
    for xx, dd in ((x0 - 0.06, -0.025), (x1 + 0.06, 0.025)):
        pts = [(0.0, beam_bot + 0.22), (0.0, pz(0) - 0.05), (yf, pz(yf) - 0.05), (yf, beam_bot + 0.22)]
        prism(proof, pts, (xx, 0, 0), Y, Z, min(0, dd), max(0, dd), tr)
    # Verandarinne
    prof = [(0.0, 0.0), (0.0, -0.09), (0.1, -0.1), (0.12, 0.0)]
    for i in range(len(prof) - 1):
        (a0, b0), (a1, b1) = prof[i], prof[i + 1]
        q = [(x0 - 0.06, yf - 0.025 - a0, pz(yf) - 0.03 + b0), (x1 + 0.06, yf - 0.025 - a0, pz(yf) - 0.03 + b0),
             (x1 + 0.06, yf - 0.025 - a1, pz(yf) - 0.03 + b1), (x0 - 0.06, yf - 0.025 - a1, pz(yf) - 0.03 + b1)]
        nrm = Vector((0, -(b1 - b0), -(a1 - a0)))
        proof.poly(q, M('metal_galv'), expect=nrm)
        proof.poly(q, M('metal_galv'), expect=-nrm)
    mk('PORCH_deck', dk, C_EXT, 'wood')
    mk('PORCH_steps', st, C_EXT, 'wood')
    mk('PORCH_railing', rail, C_EXT, 'wood')
    mk('PORCH_posts', post, C_EXT, 'wood')
    mk('PORCH_roof', proof, C_EXT, 'wood')
    mk('PORCH_skirt', skirt, C_EXT, 'wood')


# ------------------------------------------------------------------ Grundstueck, Strasse, Nachbarn
STREET = dict(y0=-17.6, y1=-10.4, z=-0.25)
WALK = dict(y0=-9.2, y1=-7.7, z=-0.10)
DRIVE = dict(x0=7.4, x1=10.4, y1=6.0)


def ground_z(x, y):
    """Gelaendehoehe Grundstueck (vor Bodenbelag/Gehweg)."""
    z = 0.0
    if y < -2.6:
        t = min(1.0, (-2.6 - y) / (WALK['y1'] - 0.0 + 2.6 + 0.0) * -1) if False else min(1.0, (-2.6 - y) / 5.1)
        z += -0.13 * t
    # Wellen/Buckel
    dist = 0.0
    dx = max(EXT[0] - x, 0, x - EXT[2]); dy = max(EXT[1] - y, 0, y - EXT[3])
    dist = math.hypot(dx, dy)
    amp = min(1.0, dist / 2.5)
    z += amp * (0.035 * math.sin(x * 0.9 + 1.3) * math.sin(y * 0.7 - 0.4) + 0.02 * math.sin(x * 2.3 + y * 1.7) + 0.012 * math.sin(x * 5.1 - y * 3.7))
    # Reifenspuren im Vorgarten
    for (cx, w) in ((4.2, 0.22), (5.8, 0.22)):
        if -7.5 < y < -3.0 and abs(x - cx + (y + 5) * 0.25) < w:
            z -= 0.05 * (1 - abs(x - cx + (y + 5) * 0.25) / w)
    if dist < 1e-6:
        z = -0.05
    return z


def ground_mat(x, y):
    if EXT[0] < x < EXT[2] and EXT[1] < y < EXT[3]:
        return M('dirt_mud')
    if PORCH['x0'] - 0.1 < x < PORCH['x1'] + 0.1 and PORCH['y0'] - 0.1 < y < 0:
        return M('dirt_mud')
    dx = max(EXT[0] - x, 0, x - EXT[2]); dy = max(EXT[1] - y, 0, y - EXT[3])
    if math.hypot(dx, dy) < 0.45 + 0.25 * math.sin(x * 3.1 + y * 2.3):
        return M('dirt_mud')
    if abs(x) > 16 or y > 16:
        n = math.sin(x * 0.37 + 2.0) * math.sin(y * 0.41 - 1.0) + 0.5 * math.sin(x * 1.13 - y * 0.87)
        if n > 0.9:
            return M('dirt_mud')
    return M('grass_dead')


def ground_patch(mb, cx, cy, rx, ry, seed, lift=0.014):
    """Unregelmaessiger Erdfleck als Auflage auf dem Gelaende (bricht das Zellraster)."""
    r = rng(seed)
    pts = jagged(r, cx, cy, rx, ry, n=22, rough=0.2, spikes=0.25)
    rings = [0.0, 0.35, 0.7, 1.0]
    mb.new_part()
    vid = {}

    def P(k, i):
        t = rings[k]
        if k == 0:
            x, y = cx, cy
        else:
            x = cx + (pts[i][0] - cx) * t; y = cy + (pts[i][1] - cy) * t
        key = (k, 0 if k == 0 else i)
        if key not in vid:
            vid[key] = mb.vert((x, y, ground_z(x, y) + lift))
        return vid[key]
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        mb.face([P(0, i), P(1, i), P(1, j)], M('dirt_mud'))
        for k in range(1, len(rings) - 1):
            mb.face([P(k, i), P(k + 1, i), P(k + 1, j), P(k, j)], M('dirt_mud'))


def ground_strip(mb, pts, w, seed, lift=0.016):
    """Fahrspur/Trampelpfad als Streifen mit ausgefransten Raendern."""
    r = rng(seed)
    mb.new_part()
    prev = None
    for i, (x, y) in enumerate(pts):
        if i < len(pts) - 1:
            dx, dy = pts[i + 1][0] - x, pts[i + 1][1] - y
        else:
            dx, dy = x - pts[i - 1][0], y - pts[i - 1][1]
        ln = math.hypot(dx, dy)
        nx, ny = -dy / ln, dx / ln
        wl = w * r.uniform(0.6, 1.25); wr = w * r.uniform(0.6, 1.25)
        a = (x + nx * wl / 2, y + ny * wl / 2); b = (x - nx * wr / 2, y - ny * wr / 2)
        ia = mb.vert((a[0], a[1], ground_z(*a) + lift)); ib = mb.vert((b[0], b[1], ground_z(*b) + lift))
        ic = mb.vert((x, y, ground_z(x, y) + lift))
        if prev:
            pa, pb, pc = prev
            mb.face([pa, pc, ic, ia], M('dirt_mud'))
            mb.face([pc, pb, ib, ic], M('dirt_mud'))
        prev = (ia, ib, ic)


def build_site():
    g = MB()

    def rngs(a, b, step):
        out = []
        v = a
        while v < b - 1e-6:
            out.append(round(v, 4)); v += step
        out.append(b)
        return out
    xs = rngs(-44, -14, 2.5)[:-1] + rngs(-14, 16, 0.5)[:-1] + rngs(16, 46, 2.5)
    ys = rngs(WALK['y1'], 16, 0.5)[:-1] + rngs(16, 40, 2.0)

    def gm(x, y):
        if DRIVE['x0'] < x < DRIVE['x1'] and y < DRIVE['y1']:
            return None
        if abs(x + 0.28) < 0.6 and WALK['y1'] < y < PORCH['y0'] - 0.62:
            return M('dirt_mud')
        return ground_mat(x, y)
    surface_grid(g, xs, ys, ground_z, gm)
    # Strassenseitiger Gruenstreifen + gegenueber
    xs2 = rngs(-44, 46, 1.0)
    surface_grid(g, xs2, rngs(STREET['y1'] + 0.15, WALK['y0'], 0.35), lambda x, y: -0.115 + 0.01 * math.sin(x * 1.7),
                 lambda x, y: None if DRIVE['x0'] < x < DRIVE['x1'] else (M('dirt_mud') if math.sin(x * 0.6) > 0.7 else M('grass_dead')))
    surface_grid(g, xs2, rngs(-20.0 - 0.0, STREET['y0'] - 0.15, 0.35), lambda x, y: -0.115, lambda x, y: M('grass_dead'))
    surface_grid(g, rngs(-44, 46, 3.0), rngs(-48, -21.5, 3.0), lambda x, y: -0.12 + 0.05 * math.sin(x * 0.3) * math.sin(y * 0.4),
                 lambda x, y: M('dirt_mud') if math.sin(x * 0.21 + y * 0.3) > 0.8 else M('grass_dead'))
    mk('SITE_ground', g, C_SITE, 'grass', props={'note': 'Material je Zelle: M_grass_dead / M_dirt_mud'})
    # Erdflecken, Traufstreifen, Fahrspuren (Auflagen)
    dm = MB()
    r = rng('patches')
    # Traufstreifen rund ums Haus (ausgewaschene Erde unter der Dachkante)
    per = []
    x0, y0, x1, y1 = EXT
    o = 0.06
    ring = [(x0 - o, y0 - o), (x1 + o, y0 - o), (x1 + o, y1 + o), (x0 - o, y1 + o)]
    for k in range(4):
        (ax, ay), (bx, by) = ring[k], ring[(k + 1) % 4]
        ln = math.hypot(bx - ax, by - ay)
        nseg = int(ln / 0.35)
        for i in range(nseg):
            t = i / nseg
            per.append((ax + (bx - ax) * t, ay + (by - ay) * t))
    dm.new_part()
    n = len(per)
    cxh, cyh = (x0 + x1) / 2, (y0 + y1) / 2
    for i in range(n):
        j = (i + 1) % n
        def outer(p, seed_i):
            rr = rng('drip%d' % seed_i)
            dx, dy = p[0] - cxh, p[1] - cyh
            # Normale der Seite
            if abs(p[1] - (y0 - o)) < 1e-6 or abs(p[1] - (y1 + o)) < 1e-6:
                nx, ny = 0, (1 if dy > 0 else -1)
            else:
                nx, ny = (1 if dx > 0 else -1), 0
            w = 0.32 + 0.18 * math.sin(seed_i * 0.7) + rr.uniform(-0.08, 0.1)
            return (p[0] + nx * w, p[1] + ny * w)
        a, b = per[i], per[j]
        if PORCH['x0'] - 0.3 < a[0] < PORCH['x1'] + 0.3 and a[1] < 0 and b[1] < 0:
            continue
        oa, ob_ = outer(a, i), outer(b, j)
        q = [(a[0], a[1]), (b[0], b[1]), ob_, oa]
        dm.poly([(x, y, ground_z(x, y) + 0.015) for x, y in q], M('dirt_mud'), expect=Z)
    # Fahrspuren (Auto auf dem Rasen geparkt), mit Unterbrechungen
    for cx in (3.9, 5.6):
        for seg0, seg1 in ((0, 4), (5, 8), (9, 12)):
            pts = [(cx - (yy + 5) * 0.25 + 0.05 * math.sin(yy * 2.0), yy) for yy in [-7.6 + 0.4 * k for k in range(seg0, seg1)]]
            ground_strip(dm, pts, 0.26, 'rut%.1f%d' % (cx, seg0))
    # Trampelpfad neben dem Weg
    ground_strip(dm, [(-1.12 + 0.08 * math.sin(k), -7.6 + 0.45 * k) for k in range(11)], 0.38, 'path1')
    # verstreute Flecken
    for k in range(26):
        while True:
            px = r.uniform(-11.5, 12.0); py = r.uniform(-7.4, 15.0)
            if not (x0 - 1.0 < px < x1 + 1.0 and y0 - 3.2 < py < y1 + 1.0) and not (DRIVE['x0'] - 0.5 < px < DRIVE['x1'] + 0.5 and py < DRIVE['y1'] + 0.5):
                break
        ground_patch(dm, px, py, r.uniform(0.5, 1.6), r.uniform(0.4, 1.2), 'gp%d' % k)
    mk('SITE_ground_dirt', dm, C_SITE, 'dirt')
    # Gehwege (Platten 1.5 m mit Fugen, leicht versetzt) beidseitig, Hauszugang, Einfahrt
    cw = MB()
    r = rng('walk')
    for (ya, yb) in ((WALK['y0'], WALK['y1']), (-20.0, -18.6 + 0.1)):
        x = -44.0
        while x < 46.0:
            dz = r.uniform(-0.012, 0.012) if r.random() < 0.3 else 0.0
            tilt = r.uniform(-0.015, 0.015) if r.random() < 0.15 else 0.0
            box(cw, (x + 0.004, ya, -0.20), (x + 1.5 - 0.004, yb, WALK['z'] + dz), M('concrete_floor'))
            x += 1.5
    # Zugangsweg Treppe -> Gehweg
    y = PORCH['y0'] - 0.62 - 0.03
    k = 0
    while y > WALK['y1'] + 0.01:
        ya = max(WALK['y1'] + 0.006, y - 1.0)
        zt = ground_z(-0.28, (y + ya) / 2) + 0.02
        if k == 2:   # gebrochene, gekippte Platte
            obox(cw, Vector((-0.6, (y + ya) / 2, zt - 0.03)), Vector((1, 0, 0.04)), Vector((0, 1, -0.06)), (0.6, y - ya - 0.01, 0.1), M('concrete_floor'))
            obox(cw, Vector((0.05, (y + ya) / 2, zt - 0.06)), Vector((1, 0, -0.07)), Vector((0, 1, 0.03)), (0.62, y - ya - 0.01, 0.1), M('concrete_floor'))
        else:
            box(cw, (-0.88, ya, zt - 0.12), (0.32, y - 0.006, zt), M('concrete_floor'))
        y = ya - 0.006
        k += 1
    # Einfahrt
    y = WALK['y1']
    while y < DRIVE['y1']:
        yb = min(DRIVE['y1'], y + 3.0)
        zt = max(ground_z(DRIVE['x0'] + 1.5, (y + yb) / 2), -0.11) + 0.02
        box(cw, (DRIVE['x0'], y + 0.005, zt - 0.15), (DRIVE['x1'], yb - 0.005, zt), M('concrete_floor'))
        y = yb
    # Einfahrt ueber Gruenstreifen (abgesenkter Bord)
    box(cw, (DRIVE['x0'], STREET['y1'] + 0.15, -0.3), (DRIVE['x1'], WALK['y0'], -0.12), M('concrete_floor'))
    mk('SITE_concrete', cw, C_SITE, 'concrete')
    # Bordsteine
    cb = MB()
    for (yy, d) in ((STREET['y1'], 1), (STREET['y0'], -1)):
        segs = [(-44, DRIVE['x0'] - 0.3), (DRIVE['x1'] + 0.3, 46)] if d > 0 else [(-44, 46)]
        for xa, xb in segs:
            box(cb, (xa, yy if d > 0 else yy - 0.15, STREET['z'] - 0.1), (xb, yy + 0.15 if d > 0 else yy, -0.10), M('concrete_floor'))
        if d > 0:
            # abgesenkter Bord an der Einfahrt + Rampen
            box(cb, (DRIVE['x0'] - 0.3, yy, STREET['z'] - 0.1), (DRIVE['x1'] + 0.3, yy + 0.15, STREET['z'] + 0.03), M('concrete_floor'))
    mk('SITE_curb', cb, C_SITE, 'concrete')
    # Strasse mit Wolbung
    st = MB()
    syc = (STREET['y0'] + STREET['y1']) / 2
    hw = (STREET['y1'] - STREET['y0']) / 2

    def sz(x, y):
        t = (y - syc) / hw
        return STREET['z'] + 0.07 * (1 - t * t) + 0.006 * math.sin(x * 0.8) * math.sin(y * 1.3)
    surface_grid(st, rngs(-44, 46, 2.0), rngs(STREET['y0'], STREET['y1'], 0.6), sz, lambda x, y: M('asphalt_wet'))
    # verblasste Mittellinie (Strichelung)
    x = -44.0
    while x < 46:
        box(st, (x, syc - 0.06, sz(x, syc) - 0.01), (x + 3.0, syc + 0.06, sz(x, syc) + 0.004), M('paint_yellow_road'))
        x += 9.0
    mk('SITE_street', st, C_SITE, 'asphalt')
    build_fences()
    build_poles()
    build_mailbox()
    build_neighbors()


def build_fences():
    wf = MB(); cl = MB(); cp = MB()
    r = rng('fence')
    raw = M('wood_planks_raw')
    # Holz-Sichtschutzzaun Ost (zum Nachbarn rechts) + hinten
    def wood_fence(pa, pb, h=1.8, gaps=(), lean=0.0):
        pa = Vector((pa[0], pa[1], 0)); pb = Vector((pb[0], pb[1], 0))
        d = pb - pa; Lf = d.length; dn = d / Lf
        side = Vector((-dn.y, dn.x, 0))
        npost = int(Lf / 2.4) + 1
        for i in range(npost + 1):
            p = pa + dn * min(Lf, i * 2.4)
            zg = ground_z(p.x, p.y)
            box(wf, (p.x - 0.045, p.y - 0.045, zg - 0.3), (p.x + 0.045, p.y + 0.045, zg + h - 0.05), raw)
        for zz in (0.3, h - 0.35):
            p0 = pa + side * 0.07 + Vector((0, 0, ground_z(pa.x, pa.y) + zz))
            p1 = pb + side * 0.07 + Vector((0, 0, ground_z(pb.x, pb.y) + zz))
            beam(wf, p0, p1, 0.04, 0.09, raw)
        t = 0.0
        k = 0
        while t < Lf - 0.05:
            k += 1
            bwid = 0.14
            p = pa + dn * (t + bwid / 2) + side * 0.105
            zg = ground_z(p.x, p.y)
            if k in gaps:
                t += bwid + 0.01
                continue
            hh = h + r.uniform(-0.04, 0.03)
            ln = lean * (t / Lf)
            obox(wf, p + Vector((0, 0, zg + 0.03 + hh / 2)) + side * ln * hh / 2, dn, side, (bwid - 0.006, 0.018, hh), raw) if False else None
            up = (Vector((0, 0, 1)) + side * ln).normalized()
            cen = p + Vector((0, 0, zg + 0.03)) + up * hh / 2
            obox(wf, cen, dn, side, (bwid - 0.006, 0.018, hh), raw) if ln == 0 else _obox_up(wf, cen, dn, up, (bwid - 0.006, 0.018, hh), raw)
            t += bwid + 0.008
    wood_fence((12.5, 3.0), (12.5, 26.0), gaps=(17, 18, 52), lean=0.0)
    wood_fence((-12.0, 26.0), (12.5, 26.0), gaps=(30, 31, 32, 90), lean=0.12)
    mk('SITE_fence_wood', wf, C_SITE, 'wood')
    # Maschendrahtzaun West (Front bis hinten)
    gal = M('metal_galv')
    xa = -12.0
    pts = [(xa, -7.4), (xa, 26.0)]
    pa = Vector((xa, -7.4, 0)); pb = Vector((xa, 26.0, 0))
    Lf = (pb - pa).length
    npost = int(Lf / 3.0)
    h = 1.22
    for i in range(npost + 1):
        y = -7.4 + Lf * i / npost
        zg = ground_z(xa, y)
        cylinder(cp, (xa, y, zg - 0.3), (xa, y, zg + h + 0.05), 0.024, gal, seg=10)
        cylinder(cp, (xa, y, zg + h + 0.05), (xa, y, zg + h + 0.07), 0.032, gal, seg=10)
    # Oberrohr (ein Stueck durchgebogen)
    prev = None
    for i in range(npost * 4 + 1):
        y = -7.4 + Lf * i / (npost * 4)
        sag = -0.35 * max(0, 1 - abs(y - 6.0) / 2.5) ** 2
        p = Vector((xa, y, ground_z(xa, y) + h + sag))
        if prev is not None:
            cylinder(cp, prev, p, 0.017, gal, seg=8, caps=False)
        prev = p
    # Geflecht als Flaechenstreifen (MU_chainlink, Alpha)
    ys = [-7.4 + Lf * i / (npost * 4) for i in range(npost * 4 + 1)]
    for i in range(len(ys) - 1):
        ya, yb = ys[i], ys[i + 1]
        sa = -0.35 * max(0, 1 - abs(ya - 6.0) / 2.5) ** 2; sb = -0.35 * max(0, 1 - abs(yb - 6.0) / 2.5) ** 2
        q = [(xa + 0.02, ya, ground_z(xa, ya) + 0.03), (xa + 0.02, yb, ground_z(xa, yb) + 0.03),
             (xa + 0.02, yb, ground_z(xa, yb) + h + sb), (xa + 0.02, ya, ground_z(xa, ya) + h + sa)]
        if 14.0 < ya < 15.4:
            # aufgerissenes Feld: unten weggebogen
            q[0] = (xa + 0.35, ya, ground_z(xa, ya) + 0.25); q[1] = (xa + 0.35, yb, ground_z(xa, yb) + 0.25)
        cl.poly(q, M('MU_chainlink'), expect=X)
    mk('SITE_fence_chain_posts', cp, C_SITE, 'metal')
    mk('SITE_fence_chain_mesh', cl, C_SITE, 'metal', props={'alphaTest': 1})


def _obox_up(mb, center, xaxis, up, size, mat):
    """Quader mit Laengsachse xaxis, Hochachse up."""
    xa = Vector(xaxis).normalized(); za = Vector(up).normalized()
    ya = za.cross(xa).normalized()
    xa = ya.cross(za).normalized()
    Mx = Matrix(((xa.x, ya.x, za.x, center[0]), (xa.y, ya.y, za.y, center[1]), (xa.z, ya.z, za.z, center[2]), (0, 0, 0, 1)))
    sx, sy, sz = size
    box(mb, (-sx / 2, -sy / 2, -sz / 2), (sx / 2, sy / 2, sz / 2), mat, Mx)


POLES = [(-27.0, -9.75), (8.6, -9.75), (44.0, -9.75)]
LAMP_HEAD = None


def build_poles():
    global LAMP_HEAD
    mb = MB(); wires = MB(); lamp = MB()
    raw = M('wood_planks_raw')
    tops = []
    for i, (x, y) in enumerate(POLES):
        z0 = -0.12
        cylinder(mb, (x, y, z0 - 1.0), (x, y, z0 + 10.5), 0.15, raw, seg=12, r1=0.11)
        box(mb, (x - 1.2, y - 0.05, z0 + 9.6), (x + 1.2, y + 0.05, z0 + 9.75), raw)       # Querholm
        for dx in (-1.05, -0.35, 0.35, 1.05):
            cylinder(mb, (x + dx, y, z0 + 9.75), (x + dx, y, z0 + 9.92), 0.035, M('porcelain'), seg=8)
        tops.append([(x + dx, y, z0 + 9.92) for dx in (-1.05, 0.35, 1.05)])
        if i == 1:
            # Trafo-Kessel
            cylinder(mb, (x, y + 0.3, z0 + 7.9), (x, y + 0.3, z0 + 8.9), 0.28, M('metal_galv'), seg=16)
            # Auslegerarm + Kofferleuchte (Natriumdampf) zur Strasse
            arm0 = Vector((x, y - 0.12, z0 + 7.4)); arm1 = Vector((x, y - 2.1, z0 + 7.75))
            cylinder(mb, arm0, arm1, 0.03, M('metal_galv'), seg=8)
            cylinder(mb, arm0 + Vector((0, 0, -0.4)), arm0 + Vector((0, -0.8, 0.25)), 0.018, M('metal_galv'), seg=6)
            hc = Vector((x, y - 2.55, z0 + 7.72))
            obox(lamp, hc, Y, X, (0.75, 0.32, 0.16), M('metal_galv'))
            obox(lamp, hc + Vector((0, -0.02, -0.09)), Y, X, (0.5, 0.24, 0.04), M('ME_sodium'))
            LAMP_HEAD = (hc.x, hc.y, hc.z - 0.1)
    # Leitungen mit Durchhang
    for i in range(len(POLES) - 1):
        for k in range(3):
            pa = Vector(tops[i][k]); pb = Vector(tops[i + 1][k])
            pts = []
            for s in range(21):
                t = s / 20
                p = pa.lerp(pb, t)
                p.z -= 1.1 * 4 * t * (1 - t)
                pts.append(p)
            tube_path(wires, pts, 0.008, M('metal_dark'), seg=5)
    # Hausanschluss: vom Mast zum Dachstaender
    mast = Vector((5.6, 1.2, roof_z(1.2)))
    cylinder(mb, mast + Vector((0, 0, -0.1)), mast + Vector((0, 0, 1.1)), 0.03, M('metal_galv'), seg=8)
    pa = Vector((POLES[1][0], POLES[1][1], 8.6)); pb = mast + Vector((0, 0, 1.0))
    pts = []
    for s in range(17):
        t = s / 16
        p = pa.lerp(pb, t); p.z -= 0.9 * 4 * t * (1 - t)
        pts.append(p)
    tube_path(wires, pts, 0.01, M('metal_dark'), seg=5)
    mk('SITE_poles', mb, C_SITE, 'wood')
    mk('SITE_wires', wires, C_SITE, 'metal')
    mk('SITE_streetlight', lamp, C_SITE, 'metal', props={'light': 'sodium', 'lightPos': list(LAMP_HEAD)})


def build_mailbox():
    mb = MB()
    x, y = -2.3, -9.55
    zg = -0.115
    box(mb, (x - 0.045, y - 0.045, zg - 0.4), (x + 0.045, y + 0.045, zg + 1.0), M('wood_planks_raw'))
    box(mb, (x - 0.12, y - 0.22, zg + 0.98), (x + 0.12, y + 0.18, zg + 1.0), M('wood_planks_raw'))
    # Briefkasten: Halbrund-Tunnel entlang Y, Tuer vorne (Strassenseite, -Y) offen haengend
    seg = 10
    rad = 0.11
    L_ = 0.48
    met = M('metal_rusty')
    base = zg + 1.0
    mb.new_part()
    prof = []
    for k in range(seg + 1):
        a = math.pi * k / seg
        prof.append((x + rad * math.cos(a), base + 0.11 + rad * math.sin(a) * 0.9))
    prof = [(x + rad, base)] + prof + [(x - rad, base)]
    for i in range(len(prof) - 1):
        (xa, za), (xb, zb) = prof[i], prof[i + 1]
        q = [(xa, y - L_ / 2, za), (xb, y - L_ / 2, zb), (xb, y + L_ / 2, zb), (xa, y + L_ / 2, za)]
        mb.poly(q, met, expect=(xa + xb - 2 * x, 0, za + zb - 2 * base - 0.1))
        mb.poly(q, met, expect=(-(xa + xb - 2 * x), 0, -(za + zb - 2 * base - 0.1)))
    mb.poly([(p[0], y + L_ / 2, p[1]) for p in prof], met, expect=Y)
    mb.poly([(x - rad, y - L_ / 2, base), (x + rad, y - L_ / 2, base), (x + rad, y + L_ / 2, base), (x - rad, y + L_ / 2, base)], met, expect=Z)
    # Klappe offen (nach unten gekippt)
    door = [(p[0], y - L_ / 2 - (p[1] - base) * 0.95, base - (p[1] - base) * 0.3) for p in prof]
    mb.poly(door, met, expect=(0, -0.3, -1))
    mb.poly(door, met, expect=(0, 0.3, 1))
    # Fahne
    box(mb, (x + rad + 0.002, y + 0.05, base + 0.05), (x + rad + 0.008, y + 0.07, base + 0.25), M('paint_red'))
    box(mb, (x + rad + 0.002, y + 0.07, base + 0.18), (x + rad + 0.008, y + 0.16, base + 0.25), M('paint_red'))
    mk('SITE_mailbox', mb, C_SITE, 'metal')
    # Hydrant
    hy = MB()
    hx, hy_ = -9.5, -9.8
    cylinder(hy, (hx, hy_, -0.13), (hx, hy_, 0.45), 0.09, M('paint_red'), seg=14)
    cylinder(hy, (hx, hy_, 0.45), (hx, hy_, 0.58), 0.1, M('paint_red'), seg=14, r1=0.05)
    cylinder(hy, (hx, hy_, 0.2), (hx, hy_, 0.0), 0.12, M('paint_red'), seg=14, caps=True)
    for d in (X, -X, -Y):
        cylinder(hy, Vector((hx, hy_, 0.33)), Vector((hx, hy_, 0.33)) + d * 0.15, 0.04, M('paint_red'), seg=10)
    mk('SITE_hydrant', hy, C_SITE, 'metal')


def build_neighbors():
    specs = [  # cx, cy, w, d, rot (deg, Front zeigt nach -Y bei 0), lit
        (-25.5, 3.0, 12.0, 9.0, 0, False, 'nbr_w'),
        (27.0, 4.5, 13.0, 10.0, 0, True, 'nbr_e'),
        (-20.0, -33.0, 12.0, 9.0, 180, False, 'nbr_sw'),
        (1.5, -33.5, 14.0, 10.0, 180, True, 'nbr_s'),
        (23.0, -33.0, 12.0, 9.5, 180, False, 'nbr_se'),
        (-6.0, 40.0, 13.0, 9.0, 180, False, 'nbr_nw'),
        (20.0, 40.0, 12.0, 9.0, 180, False, 'nbr_ne'),
    ]
    for (cx, cy, w, d, rot, lit, nm) in specs:
        mb = MB(); gl = MB()
        r = rng(nm)
        Mx = Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(math.radians(rot), 4, 'Z')
        hgt = 3.1 + r.uniform(-0.1, 0.3)
        box(mb, (-w / 2, -d / 2, -0.3), (w / 2, d / 2, 0.45), M('brick_red') if r.random() < 0.5 else M('concrete_floor'), Mx)
        box(mb, (-w / 2, -d / 2, 0.45), (w / 2, d / 2, hgt), M('siding_vinyl_dirty'), Mx)
        S = 0.42 if r.random() < 0.6 else 0.3
        ov = 0.4
        rz = hgt + S * (d / 2 + ov)
        # Dach als zwei geneigte Platten
        for sgn in (1, -1):
            pts = [(-w / 2 - 0.3, sgn * (d / 2 + ov), hgt - S * ov), (w / 2 + 0.3, sgn * (d / 2 + ov), hgt - S * ov), (w / 2 + 0.3, 0, rz - S * ov), (-w / 2 - 0.3, 0, rz - S * ov)]
            P = [Mx @ Vector(p) for p in pts]
            mb.poly(P, M('roof_shingles'), expect=Mx.to_3x3() @ Vector((0, sgn * S, 1)))
            mb.poly([p - Vector((0, 0, 0.05)) for p in P], M('wood_planks_raw'), expect=Mx.to_3x3() @ Vector((0, -sgn * S, -1)))
        for sx in (1, -1):
            tri = [Mx @ Vector((sx * w / 2, -d / 2, hgt)), Mx @ Vector((sx * w / 2, d / 2, hgt)), Mx @ Vector((sx * w / 2, 0, rz - S * ov - 0.05))]
            mb.poly(tri, M('siding_vinyl_dirty'), expect=Mx.to_3x3() @ Vector((sx, 0, 0)))
        # Fenster (dunkel) + ein warm erleuchtetes
        nwin = int(w / 2.6)
        for side in (-1, 1):
            for k in range(nwin):
                u = -w / 2 + (k + 0.5) * w / nwin
                if side == -1 and abs(u) < 1.0:
                    # Haustuer + Vorbau
                    box(mb, (u - 0.45, -d / 2 - 0.02, 0.5), (u + 0.45, -d / 2, 2.55), M('wood_door_painted'), Mx)
                    box(mb, (u - 1.4, -d / 2 - 1.8, 0.0), (u + 1.4, -d / 2, 0.45), M('wood_planks_raw'), Mx)
                    continue
                mat = M('ME_window_warm') if (lit and side == -1 and k == nwin - 1) else M('glass_dirty')
                box(gl, (u - 0.45, side * (d / 2 + 0.005), 1.35), (u + 0.45, side * (d / 2 + 0.012), 2.55), mat, Mx)
                box(mb, (u - 0.55, side * (d / 2 + 0.0), 1.25), (u + 0.55, side * (d / 2 + 0.03), 1.35), M('wood_trim_painted'), Mx)
                box(mb, (u - 0.55, side * (d / 2 + 0.0), 2.55), (u + 0.55, side * (d / 2 + 0.03), 2.65), M('wood_trim_painted'), Mx)
        mk(f'NBR_{nm}', mb, C_SITE, 'wood', uv='zup')
        mk(f'NBR_{nm}_windows', gl, C_SITE, 'glass')


# ------------------------------------------------------------------ layout.json
def build_layout():
    rooms = []
    for rid, r in ROOMS.items():
        xs = [p[0] for p in r['poly']]; ys = [p[1] for p in r['poly']]
        rooms.append(dict(id=rid, name=r['name'], polygon=[[round(x, 3), round(y, 3)] for x, y in r['poly']],
                          aabb=[round(min(xs), 3), round(min(ys), 3), round(FFL, 3), round(max(xs), 3), round(max(ys), 3), round(CEIL, 3)],
                          rects=[list(rc) for rc in r['rects']], floorZ=FFL, ceilingZ=CEIL, floor='M_' + r['floor'], floorSurface=FLOOR_SURF[r['floor']],
                          walls={'paint': 'M_plaster_painted_dirty', 'wallpaper': 'M_wallpaper_peeling', 'tile': 'M_tile_wall_white'}[r['walls']],
                          reverb=r['reverb']))
    rooms.append(dict(id='PORCH', name='Veranda', polygon=[[PORCH['x0'], PORCH['y0']], [PORCH['x1'], PORCH['y0']], [PORCH['x1'], 0.0], [PORCH['x0'], 0.0]],
                      aabb=[PORCH['x0'], PORCH['y0'], PORCH['deck'], PORCH['x1'], 0.0, 2.72], floorZ=PORCH['deck'], floor='M_wood_planks_raw', floorSurface='wood',
                      reverb=dict(preset='outdoor_covered', rt60=0.3), outdoor=True))
    rooms.append(dict(id='OUT', name='Aussen', outdoor=True, reverb=dict(preset='outdoor_suburb_night', rt60=0.15)))
    doors = []
    for o in OPENINGS:
        if o['kind'] == 'window':
            continue
        u0, u1, z0, z1 = op_rough(o)
        ent = dict(id=o['id'], kind=o['kind'], rooms=[o['lo'], o['hi']], center=[round(c, 3) for c in wpt(o, o['u'], sum(o['band']) / 2, FFL)],
                   axis=o['axis'], width=round(o['w'], 3), height=o['h'])
        if o['kind'] == 'door':
            ob = bpy.data.objects.get('DOOR_' + o['id'])
            ent.update(object='DOOR_' + o['id'], hinge=[round(v, 4) for v in ob['hinge']], closedRotZ=ob['closedRotZ'], openDir=ob['openDir'], openAngle=ob['openAngle'],
                       maxAngle=ob['maxAngle'], swingInto=o[o['swing']], exterior=bool(o.get('ext')),
                       note='rotZ(Blender, Grad) = closedRotZ + openDir * Winkel; three.js: rotation.y = gleicher Wert (rad)')
        doors.append(ent)
    windows = []
    for o in OPENINGS:
        if o['kind'] != 'window':
            continue
        U, N = axis_vecs(o)
        out = -N if o['lo'] == 'EXT' else N
        windows.append(dict(id=o['id'], room=o['hi'] if o['lo'] == 'EXT' else o['lo'], state=o['state'],
                            center=[round(c, 3) for c in wpt(o, o['u'], sum(o['band']) / 2, (o['sill'] + o['head']) / 2)],
                            width=o['w'], sill=round(o['sill'], 3), head=round(o['head'], 3), outward=[out.x, out.y, 0.0],
                            objects=[n for n in ('WIN_' + o['id'], 'GLASS_' + o['id'], 'BOARDS_' + o['id']) if bpy.data.objects.get(n)]))
    F = FFL

    def A(name, prop, x, y, rot, z=None, note=None, planned=False, anchor='floor'):
        d = dict(name=name, prop=prop, pos=[round(x, 3), round(y, 3), round(F if z is None else z, 3)], rotZ=rot, anchor=anchor)
        if note: d['note'] = note
        if planned: d['planned'] = True
        return d
    C = CEIL
    furniture = {
        'LIV': [A('sofa', 'sofa_torn', -5.72, 2.55, 90), A('coffee_table', 'coffee_table', -4.45, 2.6, 92), A('armchair', 'armchair_worn', -5.55, 0.95, 125),
                A('tv_stand', 'tv_stand', -1.26, 4.2, -90), A('tv', 'tv_crt', -1.3, 4.2, -95, z=F + 0.52), A('floor_lamp', 'floor_lamp_bare', -6.0, 4.65, 30),
                A('bookshelf_down', 'bookshelf_toppled', -3.0, 1.15, 12), A('ceiling_fan', 'ceiling_fan', -3.65, 2.6, 0, z=C, anchor='ceiling'),
                A('picture', 'wall_picture_crooked', -5.6, 4.99, 180, z=F + 1.55, anchor='wall'),
                A('curtain_f1', 'curtain_torn', -4.3, 0.33, 180, z=F + 0.35, anchor='wall', note='an Vorhangstange ueber WIN_liv_f1'),
                A('blinds_w', 'blinds_bent', -6.27, 2.6, -90, z=F + 0.8, anchor='wall'),
                A('pizza', 'pizza_box_stack', -4.4, 2.9, 30, z=F + 0.465, note='auf dem Couchtisch'), A('trash_1', 'trash_bag_a', -1.5, 0.7, 20),
                A('papers', 'papers_loose_a', -3.5, 3.4, 40), A('bottles', 'bottle_beer_lying', -4.0, 2.0, 70), A('box', 'box_open', -6.0, 0.6, 15)],
        'KIT': [A('base_1', 'kitchen_base_cab_60', -6.0, 9.48, 180, note='Unterschraenke an der Rueckwand (y=9.8), Front -> +Y? siehe rotZ'),
                A('base_2', 'kitchen_base_cab_60', -5.4, 9.48, 180), A('base_3', 'kitchen_base_cab_45', -4.875, 9.48, 180),
                A('sink', 'kitchen_sink_cab_90', -4.0, 9.48, 180), A('base_4', 'kitchen_base_cab_45', -3.325, 9.48, 180),
                A('stove', 'stove_old', -2.7, 9.45, 180), A('hood', 'range_hood', -2.7, 9.55, 180, z=F + 1.65, anchor='wall'),
                A('wall_cab_1', 'kitchen_wall_cab_76', -5.7, 9.62, 180, z=F + 1.45, anchor='wall'), A('wall_cab_2', 'kitchen_wall_cab_60', -3.2, 9.62, 180, z=F + 1.45, anchor='wall'),
                A('fridge', 'fridge_open', -1.42, 7.6, -90, note='Tuer offen'), A('microwave', 'microwave', -6.0, 9.5, 170, z=F + 0.92),
                A('dining_table', 'dining_table', -4.2, 6.2, 90), A('chair_1', 'dining_chair', -4.2, 5.55, 0), A('chair_2', 'dining_chair', -3.65, 6.6, -80),
                A('chair_tipped', 'dining_chair_tipped', -5.0, 7.0, 130), A('lamp', 'ceiling_lamp_bulb', -4.2, 6.2, 0, z=C, anchor='ceiling'),
                A('pots', 'kitchen_pot', -2.6, 9.4, 0, z=F + 0.92), A('plates', 'kitchen_plate_stack', -4.9, 9.45, 0, z=F + 0.92),
                A('trash_1', 'trash_bag_b', -1.6, 9.2, 40), A('trash_2', 'trash_bag_a', -2.0, 8.6, 200), A('pizza', 'pizza_box', -3.4, 8.2, 75)],
        'HAL': [A('runner', 'rug_runner', -0.28, 2.6, 2), A('lamp_1', 'ceiling_lamp_bulb', -0.28, 2.0, 0, z=C, anchor='ceiling'),
                A('lamp_2', 'ceiling_lamp_bulb', 3.6, 4.95, 0, z=C, anchor='ceiling'), A('box', 'box_closed', 5.85, 4.75, 10), A('papers', 'papers_loose_b', 1.8, 5.0, 80),
                A('bottle', 'bottle_broken', -0.5, 6.4, 0)],
        'BED1': [A('bed', 'bed_frame', 5.22, 2.25, -90), A('nightstand', 'nightstand', 5.95, 3.55, -90), A('dresser', 'dresser_open', 3.8, 0.52, 0),
                 A('lamp', 'ceiling_lamp_bulb', 3.4, 2.3, 0, z=C, anchor='ceiling'), A('box', 'box_open', 1.8, 3.7, 25), A('trash', 'trash_bag_c', 2.0, 0.6, 0),
                 A('curtain', 'curtain_torn', 2.6, 0.33, 180, z=F + 0.35, anchor='wall'), A('bottle', 'bottle_liquor', 5.9, 3.5, 0, z=F + 0.58)],
        'CLO1': [A('boxes', 'box_closed', 0.75, 1.9, 5), A('bag', 'trash_bag_c', 0.72, 3.2, 0)],
        'BED2': [A('mattress', 'mattress_floor', 4.6, 8.55, 3), A('toy_box', 'toy_box', 3.2, 9.3, 180), A('wardrobe', 'wardrobe_open', 3.26, 7.7, 90),
                 A('dresser', 'dresser_open', 5.98, 6.4, -90), A('lamp', 'ceiling_lamp_bulb', 4.5, 7.7, 0, z=C, anchor='ceiling'),
                 A('syringe', 'syringe', 4.9, 7.6, 30), A('bottle', 'bottle_beer_lying', 5.3, 8.0, 100), A('papers', 'paper_pile', 3.6, 6.4, 0)],
        'BATH': [A('toilet', 'toilet', 1.05, 7.68, 0, planned=True), A('tub', 'bathtub', 2.2, 6.5, -90, planned=True, note='Wanne an Ostwand (Fliesen raumhoch), 1.52 x 0.76'),
                 A('vanity', 'bath_vanity', 1.35, 5.88, 180, planned=True), A('mirror_cab', 'mirror_cabinet', 1.35, 5.635, 180, z=F + 1.15, anchor='wall', planned=True),
                 A('lamp', 'ceiling_lamp_bulb', 1.5, 6.8, 0, z=C, anchor='ceiling')],
        'UTIL': [A('washer', 'washing_machine', -0.45, 9.45, 180, planned=True), A('dryer', 'dryer', 0.25, 9.45, 180, planned=True),
                 A('water_heater', 'water_heater', 2.22, 8.45, -90, planned=True), A('shelf', 'bookshelf', -0.6, 8.3, 0),
                 A('boxes', 'box_crushed', 2.1, 9.3, 20), A('trash', 'trash_bag_a', 0.8, 8.5, 0)],
        'PORCH': [A('trash', 'trash_bag_a', -2.6, -0.5, 30, z=PORCH['deck']), A('chair', 'dining_chair_tipped', 1.5, -1.0, 200, z=PORCH['deck']),
                  A('porch_light', 'ceiling_lamp_bulb', -0.28, -0.3, 0, z=PORCH['deck'] + 2.38, anchor='ceiling', note='Haustuerleuchte'),
                  A('cans', 'can_crushed_a', 0.9, -1.6, 0, z=PORCH['deck']), A('newspaper', 'newspaper_stack', -1.6, -0.6, 10, z=PORCH['deck'])],
        'OUT': [A('trash_curb_1', 'trash_bag_a', -3.6, -9.6, 10, z=-0.115), A('trash_curb_2', 'trash_bag_b', -3.1, -9.8, 80, z=-0.115),
                A('box_yard', 'box_crushed', 3.0, -5.0, 30, z=ground_z(3.0, -5.0)), A('can_street', 'can_crushed_b', -6.0, -12.0, 0, z=-0.2),
                A('bag_yard', 'plastic_bag', -5.0, -3.6, 0, z=ground_z(-5.0, -3.6)),
                A('dead_tree_1', 'tree_dead', -7.5, -5.0, 0, z=ground_z(-7.5, -5.0), planned=True), A('bush_dead_1', 'bush_dead', 4.5, -1.2, 0, z=ground_z(4.5, -1.2), planned=True),
                A('bush_dead_2', 'bush_dead', -5.0, -0.8, 0, z=ground_z(-5.0, -0.8), planned=True)],
    }
    decals = [
        dict(decal='water_stain', pos=[-3.3, 3.5, CEIL - 0.002], normal=[0, 0, -1], size=2.2, rot=20),
        dict(decal='water_stain', pos=[-4.5, 7.3, CEIL - 0.002], normal=[0, 0, -1], size=2.6, rot=-40),
        dict(decal='water_stain', pos=[4.3, 8.3, CEIL - 0.002], normal=[0, 0, -1], size=1.8, rot=75),
        dict(decal='water_stain', pos=[-6.298, 4.2, F + 1.9], normal=[1, 0, 0], size=1.5, rot=0),
        dict(decal='mold_patch', pos=[2.578, 7.6, F + 2.2], normal=[-1, 0, 0], size=0.8, rot=0),
        dict(decal='mold_patch', pos=[1.3, 7.3, CEIL - 0.002], normal=[0, 0, -1], size=1.0, rot=0),
        dict(decal='mold_patch', pos=[-0.6, 9.798, F + 0.4], normal=[0, -1, 0], size=0.7, rot=0),
        dict(decal='grime_corner', pos=[-6.298, 0.6, F + 0.4], normal=[1, 0, 0], size=0.8, rot=0),
        dict(decal='grime_corner', pos=[-1.002, 9.4, F + 0.4], normal=[-1, 0, 0], size=0.8, rot=0),
        dict(decal='graffiti_1', pos=[-3.8, 4.998, F + 1.4], normal=[0, -1, 0], size=1.3, rot=0, note='LIV Nordwand'),
        dict(decal='graffiti_2', pos=[0.318, 6.0, F + 1.3], normal=[-1, 0, 0], size=1.3, rot=0, note='Flur Ostwand'),
        dict(decal='graffiti_1', pos=[-6.53, 7.6, 1.8], normal=[-1, 0, 0], size=1.6, rot=0, note='Fassade West aussen'),
        dict(decal='footprints_mud', pos=[-0.3, 1.2, F + 0.001], normal=[0, 0, 1], size=0.6, rot=0),
        dict(decal='footprints_mud', pos=[-0.2, 3.4, F + 0.001], normal=[0, 0, 1], size=0.6, rot=5),
        dict(decal='papers_scattered', pos=[-3.0, 2.0, F + 0.001], normal=[0, 0, 1], size=0.8, rot=30),
        dict(decal='papers_scattered', pos=[4.0, 1.5, F + 0.001], normal=[0, 0, 1], size=0.8, rot=-60),
    ]
    spawn_pos = (4.6, -11.0, STREET['z'] + 0.03)
    tgt = (-0.28, -1.0)
    yaw = math.degrees(math.atan2(-(tgt[0] - spawn_pos[0]), tgt[1] - spawn_pos[1]))
    layout = dict(
        version=1,
        coords='Blender Z-up, Meter. three.js: (x, z, -y). rotZ in Grad um +Z (Blender) = rotation.y in three.js. Props: Vorderseite -Y bei rotZ=0.',
        constants=dict(floorZ=FFL, ceilingZ=CEIL, ceilingHeight=round(CEIL - FFL, 3), groundZ=0.0, streetZ=STREET['z'], sidewalkZ=WALK['z'],
                       porchDeckZ=PORCH['deck'], exteriorAABB=[EXT[0], EXT[1], EXT[2], EXT[3]], wallExt=WALL_EXT, wallInt=WALL_INT),
        rooms=rooms, doors=doors, windows=windows, furniture=furniture, decals=decals,
        lights=dict(streetlight=dict(pos=[round(c, 3) for c in LAMP_HEAD], color='sodium', emissiveMaterial='ME_sodium'),
                    porchLight=dict(pos=[-0.28, -0.3, PORCH['deck'] + 2.33])),
        playerSpawn=dict(pos=list(spawn_pos), yawDeg=round(yaw, 1), note='yaw: 0 = Blick +Y (zum Haus), positiv = nach links (gegen Uhrzeiger)'),
        policeCar=dict(pos=[0.9, -11.75, STREET['z'] + 0.05], rotZ=-90, note='am Bordstein geparkt, Fahrtrichtung -X (rechts am Bordstein), Prop-Front -Y'),
        suspects=[
            dict(id='S1', room='KIT', pos=[-1.75, 8.95, FFL], yawDeg=180.0, stance='crouch_cover', note='hinter Kuehlschrank/Durchgang zur Waschkueche, Blick auf Essbereich/Wohnzimmer-Durchgang'),
            dict(id='S2', room='BED2', pos=[5.75, 9.25, FFL], yawDeg=150.0, stance='aim', note='Kinderzimmer hinterste Ecke, zielt auf Tuer (Querflur)'),
            dict(id='S3', room='CLO1', pos=[0.74, 2.2, FFL], yawDeg=-90.0, stance='hide', note='im Einbauschrank von BED1, tritt heraus wenn Spieler im Raum'),
        ],
        suspectsAlt=[
            dict(id='A1', room='UTIL', pos=[1.9, 9.2, FFL], yawDeg=135.0, note='neben Hintertuer'),
            dict(id='A2', room='BATH', pos=[2.15, 6.55, FFL], yawDeg=90.0, note='in der Wanne geduckt'),
            dict(id='A3', room='LIV', pos=[-5.9, 4.55, FFL], yawDeg=-135.0, note='Ecke hinter Stehlampe, Blick auf Haustuer'),
        ],
        navHints=dict(stairs=dict(x=[-1.03, 0.47], y=[PORCH['y0'] - 0.62, PORCH['y0']], steps=3, rise=round(PORCH['deck'] / 3, 3)),
                      porchDeck=PORCH, frontWalk=dict(x=[-0.88, 0.32], y=[WALK['y1'], PORCH['y0'] - 0.62])),
    )
    with open(OUT_LAYOUT, 'w') as fh:
        json.dump(layout, fh, indent=1, ensure_ascii=False)
    print('layout ->', OUT_LAYOUT)


# ------------------------------------------------------------------ main
def main():
    global C_INT, C_EXT, C_SITE, C_DOORS, C_GLASS, C_ATTIC
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = coll('HOUSE_SHELL')
    C_INT = coll('SHELL_interior', root)
    C_DOORS = coll('SHELL_doors', root)
    C_GLASS = coll('SHELL_glass', root)
    C_ATTIC = coll('SHELL_attic', root)
    C_EXT = coll('SHELL_exterior', root)
    C_SITE = coll('SITE', root)
    import time
    t0 = time.time()
    for step in (build_walls, build_floors, build_ceilings, build_attic, build_frames, build_doors, build_windows, build_trim, build_fixtures,
                 build_exterior, build_roof, build_porch, build_site):
        t = time.time()
        step()
        print(f'{step.__name__}: {time.time() - t:.1f}s')
    # UVs in Weltmetern; Objekte mit Ursprung != 0 (Tueren) in lokalen Koordinaten (Massstab 1) -> ebenfalls Meter
    GRAIN = {'M_wood_trim_painted': 'u', 'M_wood_planks_raw': 'v'}
    for ob in OBJS:
        if ob.name.startswith(('FRAME_', 'WIN_', 'BOARDS_', 'PORCH_', 'ROOF_fascia', 'ROOF_soffit', 'EXT_trim', 'SITE_fence_wood', 'SITE_poles',
                               'ATTIC_framing', 'WALL_framing', 'THRESHOLDS', 'SITE_mailbox')) or ob.name.endswith('_trim'):
            ob['uvGrain'] = 1
    for ob in OBJS:
        if ob.type == 'MESH':
            world_uv(ob, GRAIN)
            if 'uvGrain' in ob:
                del ob['uvGrain']
    build_layout()
    # Statistik
    tris = 0
    for ob in OBJS:
        me = ob.data
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
    print(f'objects={len(OBJS)} tris={tris} time={time.time() - t0:.1f}s')
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, compress=True)
    print('blend ->', OUT_BLEND)
    if OUT_GLB:
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', export_extras=True, export_apply=True,
                                  export_image_format='AUTO', export_materials='EXPORT')
        print('glb ->', OUT_GLB)


main()

# Prozedurale Materialien, UV-Atlanten, Bake (albedo / ORM / normal) und GLB-Export für weapon.py
import bpy, os, math, time, json, zlib
import numpy as np

# ------------------------------------------------------------------ Material-Parameter
# base: Grundfarbe (linear), r: Rauheit, m: Metall; wear*: freigelegtes Material an Kanten
# grain: Mikrostruktur-Bump; scr: Kratzer; dirt: Schmutz in Vertiefungen; dust: Staub oben; smudge: Fett/Fingerabdrücke
MP = {
    "alu":      dict(base=(0.019, 0.020, 0.024), r=0.47, m=0.45, wear=(0.42, 0.42, 0.43), wr=0.32, wm=1.0, wamt=1.0,
                     grain=0.25, gscale=2600, scr=1.0, dirt=0.8, dust=0.7, smudge=0.8),
    "steel":    dict(base=(0.030, 0.030, 0.029), r=0.60, m=0.55, wear=(0.38, 0.38, 0.37), wr=0.32, wm=1.0, wamt=1.1,
                     grain=0.45, gscale=3600, scr=0.8, dirt=1.0, dust=0.6, smudge=0.6),
    "bcg":      dict(base=(0.024, 0.024, 0.024), r=0.36, m=0.80, wear=(0.45, 0.45, 0.44), wr=0.25, wm=1.0, wamt=1.4,
                     grain=0.2, gscale=3000, scr=1.4, dirt=1.6, dust=0.1, smudge=1.4),
    "poly":     dict(base=(0.024, 0.024, 0.025), r=0.62, m=0.0, wear=(0.050, 0.050, 0.051), wr=0.44, wm=0.0, wamt=0.9,
                     grain=0.55, gscale=1800, scr=0.5, dirt=0.9, dust=0.9, smudge=0.8),
    "poly_mag": dict(base=(0.027, 0.027, 0.026), r=0.62, m=0.0, wear=(0.060, 0.060, 0.058), wr=0.45, wm=0.0, wamt=1.2,
                     grain=0.5, gscale=1600, scr=0.8, dirt=1.0, dust=1.0, smudge=0.6),
    "rubber":   dict(base=(0.022, 0.022, 0.022), r=0.82, m=0.0, wear=(0.04, 0.04, 0.04), wr=0.7, wm=0.0, wamt=0.5,
                     grain=0.7, gscale=2200, scr=0.0, dirt=1.0, dust=1.2, smudge=0.3),
    "fabric":   dict(base=(0.030, 0.031, 0.030), r=0.88, m=0.0, wear=(0.06, 0.06, 0.058), wr=0.9, wm=0.0, wamt=0.6,
                     grain=0.0, gscale=1000, scr=0.0, dirt=0.8, dust=1.2, smudge=0.0, weave=1.0),
    "chrome":   dict(base=(0.80, 0.80, 0.80), r=0.08, m=1.0, wear=(0.8, 0.8, 0.8), wr=0.08, wm=1.0, wamt=0.0,
                     grain=0.0, gscale=1000, scr=0.0, dirt=0.2, dust=0.2, smudge=0.0),
    "led":      dict(base=(0.85, 0.78, 0.35), r=0.35, m=0.0, wear=(0.85, 0.78, 0.35), wr=0.35, wm=0.0, wamt=0.0,
                     grain=0.0, gscale=1000, scr=0.0, dirt=0.0, dust=0.0, smudge=0.0),
    "glassdark": dict(base=(0.008, 0.009, 0.012), r=0.08, m=0.0, wear=(0.01, 0.01, 0.01), wr=0.1, wm=0.0, wamt=0.0,
                      grain=0.0, gscale=1000, scr=0.3, dirt=0.3, dust=0.3, smudge=0.0),
    "brass":    dict(base=(0.75, 0.52, 0.22), r=0.30, m=1.0, wear=(0.85, 0.64, 0.32), wr=0.22, wm=1.0, wamt=0.6,
                     grain=0.15, gscale=4000, scr=0.6, dirt=0.6, dust=0.0, smudge=0.8, tarnish=1.0),
    "copper":   dict(base=(0.70, 0.40, 0.26), r=0.32, m=1.0, wear=(0.80, 0.50, 0.34), wr=0.25, wm=1.0, wamt=0.4,
                     grain=0.1, gscale=4000, scr=0.3, dirt=0.3, dust=0.0, smudge=0.5),
}
ATLAS = {  # Name, Größe, Export-Materialname
    "A": ("metal", 2048, "MW_metal"),
    "B": ("polymer", 2048, "MW_polymer"),
    "C": ("mag", 2048, "MW_mag"),
    "S": ("parts", 2048, "MW_parts"),
    "D": ("casing", 512, "MW_casing"),
}
BAKE_MARGIN = {}


# ------------------------------------------------------------------ Node-Helfer
class NB:
    def __init__(self, mat):
        self.nt = mat.node_tree
        self.N = self.nt.nodes
        self.L = self.nt.links
        self.x = -1600

    def n(self, t, **props):
        nd = self.N.new(t)
        for k, v in props.items():
            setattr(nd, k, v)
        nd.location = (self.x, 0)
        self.x += 30
        return nd

    def link(self, a, b):
        self.L.new(a, b)

    def val(self, v):
        nd = self.n('ShaderNodeValue')
        nd.outputs[0].default_value = v
        return nd.outputs[0]

    def rgb(self, c):
        nd = self.n('ShaderNodeRGB')
        nd.outputs[0].default_value = (c[0], c[1], c[2], 1)
        return nd.outputs[0]

    def _in(self, sock, x):
        if isinstance(x, (int, float)):
            sock.default_value = x
        elif isinstance(x, tuple):
            sock.default_value = x if len(x) == len(sock.default_value) else (*x, 1)
        else:
            self.link(x, sock)

    def math(self, op, a, b=None, clamp=False):
        nd = self.n('ShaderNodeMath', operation=op, use_clamp=clamp)
        self._in(nd.inputs[0], a)
        if b is not None:
            self._in(nd.inputs[1], b)
        return nd.outputs[0]

    def mr(self, x, a, b, c=0.0, d=1.0, interp='LINEAR'):
        nd = self.n('ShaderNodeMapRange', interpolation_type=interp, clamp=True)
        self._in(nd.inputs['Value'], x)
        nd.inputs['From Min'].default_value = a
        nd.inputs['From Max'].default_value = b
        nd.inputs['To Min'].default_value = c
        nd.inputs['To Max'].default_value = d
        return nd.outputs['Result']

    def mixf(self, fac, a, b):
        nd = self.n('ShaderNodeMix', data_type='FLOAT', clamp_factor=True)
        self._in(nd.inputs[0], fac)
        self._in(nd.inputs[2], a)
        self._in(nd.inputs[3], b)
        return nd.outputs[0]

    def mixc(self, fac, a, b, blend='MIX'):
        nd = self.n('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_factor=True)
        self._in(nd.inputs[0], fac)
        self._in(nd.inputs[6], a)
        self._in(nd.inputs[7], b)
        return nd.outputs[2]

    def noise(self, vec, scale, detail=4.0, rough=0.55, dist=0.0, dims='3D', w=None):
        nd = self.n('ShaderNodeTexNoise', noise_dimensions=dims)
        self.link(vec, nd.inputs['Vector'])
        nd.inputs['Scale'].default_value = scale
        nd.inputs['Detail'].default_value = detail
        nd.inputs['Roughness'].default_value = rough
        nd.inputs['Distortion'].default_value = dist
        return nd.outputs['Fac']

    def vor(self, vec, scale, feature='F1', out='Distance', rand=1.0):
        nd = self.n('ShaderNodeTexVoronoi', feature=feature)
        self.link(vec, nd.inputs['Vector'])
        nd.inputs['Scale'].default_value = scale
        nd.inputs['Randomness'].default_value = rand
        return nd.outputs[out]

    def mapping(self, vec, scale=(1, 1, 1), rot=(0, 0, 0), loc=(0, 0, 0)):
        nd = self.n('ShaderNodeMapping')
        self.link(vec, nd.inputs['Vector'])
        nd.inputs['Scale'].default_value = scale
        nd.inputs['Rotation'].default_value = rot
        nd.inputs['Location'].default_value = loc
        return nd.outputs[0]


def proc_material(key, atlas):
    """Prozedurales Material; liefert Material mit Ausgängen in mat['_socks'] (über Node-Namen)."""
    p = dict(MP[key])
    name = "P_%s_%s" % (key, atlas)
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    b = NB(m)
    tc = b.n('ShaderNodeTexCoord')
    geo = b.n('ShaderNodeNewGeometry')
    P = tc.outputs['Object']
    # Python hash() is randomized on every process start.
    seed = (zlib.crc32(key.encode('utf8')) % 97) * 0.37
    Ps = b.mapping(P, loc=(seed, seed * 0.7, seed * 1.3))

    # --- Kantenmaske über Bevel-Normale (gerundete Kante weicht von echter Normale ab)
    bev = b.n('ShaderNodeBevel', samples=12)
    bev.inputs['Radius'].default_value = 0.0011
    dotn = b.n('ShaderNodeVectorMath', operation='DOT_PRODUCT')
    b.link(bev.outputs[0], dotn.inputs[0])
    b.link(geo.outputs['Normal'], dotn.inputs[1])
    edge = b.mr(dotn.outputs['Value'], 0.97, 0.78)          # 0 flach .. 1 Kante
    # Aufbrechen der Kantenmaske: großflächige Zonen (Handhabung) x mittlere/feine Störung
    n_lo = b.noise(Ps, 55.0, 6.0, 0.6, 0.3)
    n_mid = b.noise(Ps, 260.0, 5.0, 0.6)
    n_fine = b.noise(Ps, 1400.0, 3.0, 0.6)
    zone = b.mr(b.noise(Ps, 9.0, 2.0, 0.5), 0.42, 0.62, 0.15, 1.0)
    brk = b.math('ADD', b.math('MULTIPLY', n_mid, 0.6), b.math('MULTIPLY', n_fine, 0.4))
    wear_raw = b.math('SUBTRACT', b.math('MULTIPLY', b.math('MULTIPLY', edge, zone), 1.2 * p["wamt"]), b.math('MULTIPLY', brk, 0.85))
    wear = b.mr(wear_raw, 0.22, 0.42)

    # --- Kavität (Schmutz/Öl in Vertiefungen)
    ao = b.n('ShaderNodeAmbientOcclusion', samples=12, only_local=True, inside=False)
    ao.inputs['Distance'].default_value = 0.004
    cav = b.math('SUBTRACT', 1.0, ao.outputs['AO'])
    dirt = b.math('MULTIPLY', b.mr(b.math('ADD', cav, b.math('MULTIPLY', n_mid, 0.35)), 0.25, 0.75), p["dirt"], clamp=True)

    # --- Staub auf nach oben gerichteten Flächen (Blender +Z), in Ecken stärker
    up = b.n('ShaderNodeSeparateXYZ')
    b.link(geo.outputs['Normal'], up.inputs[0])
    upm = b.mr(up.outputs['Z'], 0.2, 0.95)
    dust = b.math('MULTIPLY', b.math('MULTIPLY', upm, b.mr(b.math('ADD', b.math('MULTIPLY', n_lo, 0.6), b.math('MULTIPLY', cav, 0.9)), 0.55, 0.95)),
                  0.18 * p["dust"], clamp=True)

    # --- Kratzer: gestreckte Voronoi-Kanten, zwei Richtungen, dünn verteilt
    scr = None
    if p["scr"] > 0:
        def scr_layer(rot, sc, thr):
            v = b.mapping(Ps, scale=(1.0, 1.0, 22.0), rot=rot)
            d = b.vor(v, sc, 'DISTANCE_TO_EDGE')
            line = b.mr(d, 0.0, thr, 1.0, 0.0)
            msk = b.mr(b.noise(Ps, 30.0, 2.0, 0.5), 0.5, 0.68)
            return b.math('MULTIPLY', line, msk)
        s1 = scr_layer((0.3, 1.2, 0.2), 120.0, 0.012)
        s2 = scr_layer((1.4, 0.4, 2.1), 220.0, 0.010)
        scr = b.math('MULTIPLY', b.math('MAXIMUM', s1, s2), min(1.0, 0.8 * p["scr"]), clamp=True)

    # --- Fett/Fingerabdrücke: Flecken mit konzentrischem Rillenmuster (nur Rauheit)
    smudge = None
    if p["smudge"] > 0:
        blob = b.mr(b.noise(Ps, 18.0, 3.0, 0.5, 0.4), 0.55, 0.72)
        rid = b.noise(b.mapping(Ps, scale=(1, 1, 1)), 900.0, 1.0, 0.5, 6.0)
        ridges = b.mr(rid, 0.35, 0.65)
        smudge = b.math('MULTIPLY', blob, b.math('ADD', 0.55, b.math('MULTIPLY', ridges, 0.45)))
        smudge = b.math('MULTIPLY', smudge, p["smudge"], clamp=True)

    # --- Grundfarbe
    base = b.rgb(p["base"])
    var = b.mr(b.math('ADD', b.math('MULTIPLY', n_lo, 0.7), b.math('MULTIPLY', n_fine, 0.3)), 0.3, 0.7, 0.86, 1.14)
    cmul = b.n('ShaderNodeVectorMath', operation='SCALE')
    b.link(base, cmul.inputs[0])
    b.link(var, cmul.inputs['Scale'])
    col = cmul.outputs[0]
    if p.get("tarnish"):
        tar = b.mr(n_lo, 0.4, 0.75, 0.0, 0.55)
        col = b.mixc(tar, col, b.rgb((0.36, 0.22, 0.09)))
    if p.get("weave"):
        wv1 = b.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Y')
        b.link(P, wv1.inputs['Vector'])
        wv1.inputs['Scale'].default_value = 650.0
        wv2 = b.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z')
        b.link(P, wv2.inputs['Vector'])
        wv2.inputs['Scale'].default_value = 1100.0
        weave = b.math('MULTIPLY', wv1.outputs['Fac'], wv2.outputs['Fac'])
        col = b.mixc(b.math('MULTIPLY', weave, 0.35), col, b.rgb((0.055, 0.056, 0.055)))
    col = b.mixc(wear, col, b.rgb(p["wear"]))
    if scr is not None:
        col = b.mixc(b.math('MULTIPLY', scr, 0.55), col, b.rgb(tuple(0.5 * c + 0.5 * d for c, d in zip(p["wear"], p["base"]))))
    col = b.mixc(b.math('MULTIPLY', dirt, 0.65), col, b.rgb((0.012, 0.011, 0.010)))
    col = b.mixc(dust, col, b.rgb((0.20, 0.185, 0.165)))

    # --- Rauheit
    r = b.math('ADD', p["r"], b.math('MULTIPLY', b.math('SUBTRACT', n_mid, 0.5), 0.12))
    r = b.mixf(wear, r, p["wr"])
    if scr is not None:
        r = b.mixf(b.math('MULTIPLY', scr, 0.6), r, max(0.18, p["r"] - 0.2))
    if smudge is not None:
        r = b.math('SUBTRACT', r, b.math('MULTIPLY', smudge, 0.22))
    r = b.mixf(dirt, r, min(0.9, p["r"] + 0.12))
    r = b.mixf(dust, r, 0.92)
    r = b.math('MAXIMUM', b.math('MINIMUM', r, 1.0), 0.04)

    # --- Metall
    me = b.mixf(wear, p["m"], p["wm"])
    me = b.mixf(dust, me, 0.0)
    me = b.mixf(b.math('MULTIPLY', dirt, 0.5), me, 0.0)

    # --- Höhe (Bump): Mikrokorn + Kratzer + Stoff
    h = b.math('MULTIPLY', b.noise(Ps, p["gscale"], 2.0, 0.6), p["grain"])
    if scr is not None:
        h = b.math('SUBTRACT', h, b.math('MULTIPLY', scr, 0.35))
    if p.get("weave"):
        h = b.math('ADD', h, b.math('MULTIPLY', weave, 0.8))
    bev2 = b.n('ShaderNodeBevel', samples=16)
    bev2.inputs['Radius'].default_value = 0.0006
    bump = b.n('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.35
    bump.inputs['Distance'].default_value = 0.00012
    b.link(h, bump.inputs['Height'])
    b.link(bev2.outputs[0], bump.inputs['Normal'])

    bsdf = b.n('ShaderNodeBsdfPrincipled')
    bsdf.name = "BSDF"
    b.link(col, bsdf.inputs['Base Color'])
    b.link(r, bsdf.inputs['Roughness'])
    b.link(me, bsdf.inputs['Metallic'])
    b.link(bump.outputs[0], bsdf.inputs['Normal'])
    out = b.n('ShaderNodeOutputMaterial')
    out.name = "OUT"
    b.link(bsdf.outputs[0], out.inputs['Surface'])
    emi = b.n('ShaderNodeEmission')
    emi.name = "EMI"
    # Ausgänge merken (Reroute als Anker)
    for nm, sock in (("S_COL", col), ("S_R", r), ("S_M", me)):
        rr = b.n('NodeReroute')
        rr.name = nm
        b.link(sock, rr.inputs[0])
    for nd in list(nt.nodes):
        if nd.bl_idname == 'ShaderNodeMix' and not any(o.is_linked for o in nd.outputs):
            nt.nodes.remove(nd)
    m["proc"] = 1
    return m


def set_output(m, what):
    """what: 'bsdf' | 'col' | 'r' | 'm'"""
    nt = m.node_tree
    out = nt.nodes["OUT"]
    for l in list(out.inputs['Surface'].links):
        nt.links.remove(l)
    if what == 'bsdf':
        nt.links.new(nt.nodes["BSDF"].outputs[0], out.inputs['Surface'])
        return
    emi = nt.nodes["EMI"]
    for l in list(emi.inputs['Color'].links):
        nt.links.remove(l)
    src = nt.nodes[{"col": "S_COL", "r": "S_R", "m": "S_M"}[what]].outputs[0]
    nt.links.new(src, emi.inputs['Color'])
    emi.inputs['Strength'].default_value = 1.0
    nt.links.new(emi.outputs[0], out.inputs['Surface'])


# ------------------------------------------------------------------ Spezialmaterialien
def mat_holo_glass():
    m = bpy.data.materials.new("MW_holo_glass")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs['Base Color'].default_value = (0.06, 0.10, 0.11, 1)   # leicht blaugrüne Vergütung, dunkel
    b.inputs['Roughness'].default_value = 0.03
    b.inputs['Metallic'].default_value = 0.0
    b.inputs['Alpha'].default_value = 0.22
    b.inputs['IOR'].default_value = 1.52
    _blend(m)
    return m


def mat_lens():
    m = bpy.data.materials.new("MW_lens")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs['Base Color'].default_value = (0.9, 0.92, 0.95, 1)
    b.inputs['Roughness'].default_value = 0.03
    b.inputs['Alpha'].default_value = 0.22
    _blend(m)
    return m


def _blend(m):
    for attr, val in (("surface_render_method", 'BLENDED'), ("blend_method", 'BLEND')):
        try:
            setattr(m, attr, val)
        except Exception:
            pass


def reticle_image(path, size=512, half_mm=4.0, eye_dist_mm=280.8):
    """65-MOA-Ring + 1-MOA-Punkt (rot, mit leichtem Glühen) als RGBA-PNG."""
    moa = math.radians(1 / 60.0)
    px_per_mm = size / (2 * half_mm)
    r_ring = eye_dist_mm * math.tan(32.5 * moa) * px_per_mm
    r_dot = eye_dist_mm * math.tan(0.5 * moa) * px_per_mm
    w_ring = max(1.2, eye_dist_mm * math.tan(1.0 * moa) * px_per_mm)   # Linienbreite ~2 MOA
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) + 0.5
    c = size / 2
    d = np.sqrt((xx - c) ** 2 + (yy - c) ** 2)
    ring = np.clip(1.0 - np.abs(d - r_ring) / w_ring, 0, 1) ** 0.8
    dot = np.clip(1.0 - (d - r_dot) / 1.5, 0, 1)
    glow = 0.35 * np.exp(-((d - r_ring) / (w_ring * 3.0)) ** 2) + 0.5 * np.exp(-(d / (r_dot * 4 + 2)) ** 2)
    a = np.clip(np.maximum(np.maximum(ring, dot), glow), 0, 1)
    img = np.zeros((size, size, 4), np.float32)
    img[..., 0] = 1.0
    img[..., 1] = 0.10 + 0.25 * np.maximum(ring, dot)
    img[..., 2] = 0.06 + 0.15 * np.maximum(ring, dot)
    img[..., 3] = a
    save_arr(img[::-1], path, 'PNG', True)
    return r_ring, r_dot


def save_arr(a, path, fmt='JPEG', alpha=False, quality=90, noncolor=True):
    """numpy (H, W, 3|4) 0..1, Zeile 0 = oben -> Datei über Blender-Image (kein PIL in Blender)."""
    h, w = a.shape[:2]
    if a.shape[2] == 3:
        a = np.concatenate([a, np.ones((h, w, 1), np.float32)], -1)
    im = bpy.data.images.new("_save", w, h, alpha=alpha)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(np.ascontiguousarray(a[::-1]).astype(np.float32).ravel())
    sc = bpy.context.scene
    st = sc.render.image_settings
    st.file_format = fmt
    st.color_mode = 'RGBA' if alpha else 'RGB'
    if fmt in ('JPEG', 'WEBP'):
        st.quality = quality
    st.color_management = 'OVERRIDE'
    st.view_settings.view_transform = 'Standard'
    st.display_settings.display_device = 'sRGB'
    try:
        st.linear_colorspace_settings.name = 'Non-Color'
    except Exception:
        pass
    im.filepath_raw = path
    im.file_format = fmt
    im.save(filepath=path, quality=quality) if fmt in ('JPEG', 'WEBP') else im.save(filepath=path)
    bpy.data.images.remove(im)


def mat_reticle(tex_path):
    m = bpy.data.materials.new("MW_reticle")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    im = nt.nodes.new('ShaderNodeTexImage')
    im.image = bpy.data.images.load(tex_path)
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    b.inputs['Roughness'].default_value = 1.0
    nt.links.new(im.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 6.0
    nt.links.new(im.outputs['Alpha'], b.inputs['Alpha'])
    _blend(m)
    return m


# ------------------------------------------------------------------ Zuweisung
def assign_materials(parts):
    special = {}
    for name, ob in parts.items():
        k = ob.get("wmat", "alu")
        at = ob.get("atlas", "")
        ob.data.materials.clear()
        if k == "holo_glass":
            special.setdefault(k, mat_holo_glass())
            ob.data.materials.append(special[k])
        elif k == "lens":
            special.setdefault(k, mat_lens())
            ob.data.materials.append(special[k])
        elif k == "reticle":
            pass  # später (braucht Textur)
        else:
            ob.data.materials.append(proc_material(k, at or "A"))


# ------------------------------------------------------------------ UV / Bake
def select_only(objs):
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    vl.objects.active = objs[0]


def uv_atlas(objs, size, log):
    select_only(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(52), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, margin_method='FRACTION',
                           margin=6.0 / size, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')


def uv_metrics(objs, size):
    area, uv_area, samples = 0.0, 0.0, []
    for ob in objs:
        me = ob.data
        me.calc_loop_triangles()
        uv = me.uv_layers.active.data
        for t in me.loop_triangles:
            a, b, c = (uv[i].uv for i in t.loops)
            ua = abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)) * 0.5
            if t.area > 1e-12 and ua > 1e-14:
                area += t.area
                uv_area += ua
                samples.append((size * math.sqrt(ua / t.area), t.area))
    if not samples:
        raise RuntimeError('Empty UV atlas')
    samples.sort()
    values = np.array([v for v, a in samples])
    weights = np.cumsum([a for v, a in samples]) / area
    return dict(area_m2=area, occupancy=uv_area, density_px_m=size * math.sqrt(uv_area / area),
                density_p10_p90=np.interp([0.1, 0.9], weights, values).tolist())


def uv_coverage(objs, size):
    """Rasterize triangle interiors; Blender bake alpha differs for multi-materials."""
    mask = np.zeros((size, size), dtype=bool)
    for ob in objs:
        me = ob.data
        me.calc_loop_triangles()
        uv = me.uv_layers.active.data
        for tri in me.loop_triangles:
            points = np.array([uv[i].uv[:] for i in tri.loops]) * size
            lo = np.maximum(0, np.floor(points.min(axis=0)).astype(int))
            hi = np.minimum(size, np.ceil(points.max(axis=0)).astype(int))
            if np.any(hi <= lo):
                continue
            a, b, c = points
            denominator = np.cross(b-a, c-a).item()
            if abs(denominator) < 1e-9:
                continue
            yy, xx = np.mgrid[lo[1]:hi[1], lo[0]:hi[0]]
            dx, dy = xx + 0.5 - a[0], yy + 0.5 - a[1]
            u = (dx * (c[1]-a[1]) - dy * (c[0]-a[0])) / denominator
            v = ((b[0]-a[0]) * dy - (b[1]-a[1]) * dx) / denominator
            mask[lo[1]:hi[1], lo[0]:hi[0]] |= (u >= 0) & (v >= 0) & (u+v <= 1)
    return mask


def new_img(name, size, noncolor, alpha=False):
    im = bpy.data.images.get(name)
    if im:
        bpy.data.images.remove(im)
    im = bpy.data.images.new(name, size, size, alpha=True, float_buffer=True)
    im.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
    return im


def set_bake_target(mats, img):
    for m in mats:
        nt = m.node_tree
        nd = nt.nodes.get("BAKE_IMG")
        if nd is None:
            nd = nt.nodes.new('ShaderNodeTexImage')
            nd.name = "BAKE_IMG"
        nd.image = img
        for n in nt.nodes:
            n.select = False
        nd.select = True
        nt.nodes.active = nd


def bake_group(key, objs, work, samples, log, quality=92, data_quality=95, image_format='WEBP'):
    aname, size, mname = ATLAS[key]
    sc = bpy.context.scene
    mats = []
    for o in objs:
        for m in o.data.materials:
            if m and m.get("proc") and m not in mats:
                mats.append(m)
    select_only(objs)
    sc.render.bake.margin = BAKE_MARGIN.get(key, 3)
    sc.render.bake.margin_type = 'EXTEND'
    sc.render.bake.use_clear = True
    res = {}
    for ch, btype, noncolor, smp in (("albedo", 'EMIT', False, max(8, samples // 2)), ("rough", 'EMIT', True, max(8, samples // 2)),
                                     ("metal", 'EMIT', True, 4), ("ao", 'AO', True, samples),
                                     ("normal", 'NORMAL', True, max(8, samples // 2))):
        # Bake into linear float buffers, then encode only albedo to sRGB.
        img = new_img("%s_%s" % (aname, ch), size, True)
        set_bake_target(mats, img)
        for m in mats:
            set_output(m, {"albedo": "col", "rough": "r", "metal": "m"}.get(ch, "bsdf"))
        sc.cycles.samples = smp
        t = time.time()
        kw = {}
        if btype == 'NORMAL':
            kw = dict(normal_space='TANGENT')
        bpy.ops.object.bake(type=btype, margin=sc.render.bake.margin, use_clear=True, **kw)
        log("  bake %s %s %dpx %.1fs" % (aname, ch, size, time.time() - t))
        res[ch] = img
    for m in mats:
        set_output(m, 'bsdf')
    # Compose ORM and store directly; no intermediate lossy encoding.
    os.makedirs(work, exist_ok=True)

    def arr(im):
        a = np.array(im.pixels[:], dtype=np.float32).reshape(size, size, 4)
        return a

    alb = arr(res["albedo"])
    coverage = uv_coverage(objs, size)
    if not coverage.any() or not np.isfinite(alb).all():
        raise RuntimeError('Invalid/empty albedo bake: ' + key)
    black = float(np.mean(np.max(alb[coverage, :3], axis=-1) < 1e-6))
    if black > 0.001:
        raise RuntimeError('Black albedo pixels in atlas %s: %.4f' % (key, black))
    alb[..., :3] = np.where(alb[..., :3] <= 0.0031308, alb[..., :3] * 12.92,
                            1.055 * np.maximum(alb[..., :3], 0) ** (1 / 2.4) - 0.055)
    r = arr(res["rough"])[..., 0]
    mt = arr(res["metal"])[..., 0]
    ao = arr(res["ao"])[..., 0]
    ao = 0.25 + 0.75 * ao  # Bake-AO weicher (Echtzeit-Licht macht Rest)
    nrm = arr(res["normal"])
    orm = np.stack([ao, r, mt, np.ones_like(r)], -1)
    log('  coverage %.1f%%; black albedo %.4f%%' % (coverage.mean() * 100, black * 100))
    with open(os.path.join(work, aname + '_bake_check.json'), 'w') as f:
        json.dump(dict(coverage=float(coverage.mean()), black_albedo_fraction=black,
                       albedo_linear_min=float(np.min(arr(res['albedo'])[coverage, :3]))), f, indent=2)
    paths = {}
    for ch, a in (("albedo", alb), ("orm", orm), ("normal", nrm)):
        suffix = 'webp' if image_format == 'WEBP' else 'jpg'
        p = os.path.join(work, "%s_%s.%s" % (aname, ch, suffix))
        if not np.isfinite(a).all():
            raise RuntimeError('Non-finite bake: ' + ch)
        save_arr(np.clip(a[::-1, :, :3], 0, 1), p, image_format, False, quality if ch == 'albedo' else data_quality)
        paths[ch] = p
    for im in res.values():
        bpy.data.images.remove(im)
    log("  atlas %s gespeichert" % aname)
    return paths


def gltf_output_group():
    g = bpy.data.node_groups.get("glTF Material Output")
    if g:
        return g
    g = bpy.data.node_groups.new("glTF Material Output", 'ShaderNodeTree')
    g.interface.new_socket("Occlusion", in_out='INPUT', socket_type='NodeSocketFloat')
    g.interface.new_socket("Thickness", in_out='INPUT', socket_type='NodeSocketFloat')
    return g


def export_material(key, paths):
    aname, size, mname = ATLAS[key]
    m = bpy.data.materials.get(mname) or bpy.data.materials.new(mname)
    m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(bsdf.outputs[0], out.inputs[0])

    def img(p, nc):
        im = bpy.data.images.load(p, check_existing=False)
        im.colorspace_settings.name = 'Non-Color' if nc else 'sRGB'
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = im
        return n

    ia = img(paths["albedo"], False)
    io = img(paths["orm"], True)
    inn = img(paths["normal"], True)
    nt.links.new(ia.outputs['Color'], bsdf.inputs['Base Color'])
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(io.outputs['Color'], sep.inputs[0])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(inn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    gg = nt.nodes.new('ShaderNodeGroup')
    gg.node_tree = gltf_output_group()
    nt.links.new(sep.outputs['Red'], gg.inputs['Occlusion'])
    return m


def join_objs(objs, name):
    select_only(objs)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def export_glb(objs, path, log):
    select_only(objs)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # Triangulate evaluated n-gons before the exporter's tangent calculation.
    temporary = []
    for ob in objs:
        if ob.type == 'MESH' and any(len(p.vertices) > 3 for p in ob.data.polygons):
            mod = ob.modifiers.new('ExportTriangles', 'TRIANGULATE')
            temporary.append((ob, mod))
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_extras=True,
                              export_image_format='AUTO', export_tangents=True, export_apply=True,
                              export_image_webp_fallback=False, export_image_quality=95,
                              export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials='EXPORT', export_animations=False, export_cameras=False,
                              export_lights=False)
    for ob, mod in temporary:
        ob.modifiers.remove(mod)
    from weapon_pack import pack_glb
    pack_glb(path)
    log("export", path, "%.2f MB" % (os.path.getsize(path) / 1e6))


def run(ARGS, sc, coll, root, parts, E, log):
    import weapon_parts as P
    os.makedirs(os.path.dirname(ARGS.blend), exist_ok=True)
    work = ARGS.work
    os.makedirs(work, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    # Absehen
    rpath = os.path.join(work, "reticle.png")
    rr, rd = reticle_image(rpath, 256, P.RET_HALF, P.RET_Y - P.EYE_Y)
    log("Absehen: Ring r=%.1fpx, Punkt r=%.1fpx" % (rr, rd))
    mret = mat_reticle(rpath)
    parts["W_Reticle"].data.materials.clear()
    parts["W_Reticle"].data.materials.append(mret)

    if ARGS.stage == "geo":
        p = ARGS.blend.replace(".blend", "_geo.blend")
        bpy.ops.wm.save_as_mainfile(filepath=p)
        log("gespeichert", p)
        return

    # Cycles/GPU
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'METAL'
        sc.cycles.device = 'GPU'
    except Exception as e:
        log("GPU?", e)
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    sc.world.light_settings.distance = 0.025
    sc.cycles.seed = 0
    sc.cycles.use_animated_seed = False
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 8

    # Hülse (eigene Gruppe D) und Ersatzmagazin
    cc = bpy.data.collections.new("Casing")
    sc.collection.children.link(cc)
    import weapon_geo as G
    G.set_collection(cc)
    case = P.build_round("Casing556", center=(0, -22.25, 0), with_bullet=False, fired=True)
    for o in case:
        G.apply_mods(o)
        o.data.materials.clear()
        o.data.materials.append(proc_material(o["wmat"], "D"))
    casing = join_objs(case, "Casing556")
    casing["atlas"] = "D"

    groups = {}
    for name, ob in parts.items():
        at = ob.get("atlas", "")
        if at:
            groups.setdefault(at, []).append(ob)
    groups["D"] = [casing]
    areas = {k: sum(p.area for o in obs for p in o.data.polygons) for k, obs in groups.items()}
    largest = max(areas.values())
    metrics = {}
    for k in sorted(groups):
        objs = groups[k]
        name, _, material = ATLAS[k]
        size = max(256, min(ARGS.tex, int(math.ceil(ARGS.tex * math.sqrt(areas[k] / largest) / 64)) * 64))
        if k == 'S':
            # Numerous tiny islands need extra room for padding, despite less area.
            size = int(math.ceil(ARGS.tex * 1.5 / 64)) * 64
        ATLAS[k] = (name, size, material)
        log("Atlas %s: %d Objekte, %.0f mm², %dpx" % (k, len(objs), areas[k] * 1e6, size))
        uv_atlas(objs, size, log)
        metrics[k] = uv_metrics(objs, size)
        log('  packed', metrics[k])
    # Match physical texel density across all atlases, leaving a safety border.
    density = min(m['density_px_m'] for k, m in metrics.items() if k != 'D')
    for k, objs in groups.items():
        factor = 1.0 if k == 'D' else min(1.0, density / metrics[k]['density_px_m'])
        if factor < 1 / 3:
            raise RuntimeError('UV layout wastes too much space: ' + k)
        BAKE_MARGIN[k] = max(1, math.floor(2.0 * factor))
        for ob in objs:
            for uv in ob.data.uv_layers.active.data:
                uv.uv = (uv.uv - __import__('mathutils').Vector((0.5, 0.5))) * factor + __import__('mathutils').Vector((0.5, 0.5))
        metrics[k] = dict(uv_metrics(objs, ATLAS[k][1]), size=ATLAS[k][1], bake_margin=BAKE_MARGIN[k])
    with open(os.path.join(work, 'uv_metrics.json'), 'w') as f:
        json.dump(metrics, f, indent=2)
    bpy.ops.wm.save_as_mainfile(filepath=ARGS.blend.replace(".blend", "_proc.blend"))
    exp_mats = {}
    for k in sorted(groups):
        paths = bake_group(k, groups[k], work, ARGS.samples, log, ARGS.quality, ARGS.data_quality, ARGS.image_format)
        exp_mats[k] = export_material(k, paths)
    # Export-Materialien zuweisen
    for k, objs in groups.items():
        for o in objs:
            o.data.materials.clear()
            o.data.materials.append(exp_mats[k])
    # Statische Teile zusammenführen
    moving = set(["W_Mag", "W_Bolt", "W_ChargingHandle", "W_Trigger", "W_Selector", "W_BoltCatch", "W_DustCover",
                  "W_SightGlass", "W_Reticle", "W_LightLens"])
    statA = [o for o in groups["A"] if o.name not in moving]
    statB = [o for o in groups["B"] if o.name not in moving]
    statS = [o for o in groups["S"] if o.name not in moving]
    rec = join_objs(statA, "W_Receiver")
    fur = join_objs(statB, "W_Furniture")
    acc = join_objs(statS, "W_Accessories")
    for o in (rec, fur, acc):
        o.parent = root
    # Prozedurale Materialien entfernen
    for m in list(bpy.data.materials):
        if m.get("proc") and m.users == 0:
            bpy.data.materials.remove(m)
    # Ersatzmagazin (Kopie, Ursprung = Magazin-Oberkante)
    mc = bpy.data.collections.new("MagSpare")
    sc.collection.children.link(mc)
    mag = bpy.data.objects["W_Mag"]
    sp = bpy.data.objects.new("MagSpare", mag.data.copy())
    sp.data.name = "MagSpare"
    mc.objects.link(sp)
    # Ursprung: Hülse in Mitte
    casing.data.transform(__import__("mathutils").Matrix.Translation((0, 0, 0)))
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=ARGS.blend)
    log("gespeichert", ARGS.blend)
    cobjs = [o for o in coll.all_objects]
    staging = os.path.join(work, 'exports')
    export_glb(cobjs, os.path.join(staging, "carbine.glb"), log)
    if os.path.getsize(os.path.join(staging, "carbine.glb")) > 3_000_000:
        raise RuntimeError('carbine.glb exceeds the 3 MB budget; lower --tex or --geometry-ratio')
    export_glb([sp], os.path.join(staging, "mag_spare.glb"), log)
    export_glb([casing], os.path.join(staging, "casing_556.glb"), log)
    os.makedirs(ARGS.out_dir, exist_ok=True)
    for name in ('carbine.glb', 'mag_spare.glb', 'casing_556.glb'):
        os.replace(os.path.join(staging, name), os.path.join(ARGS.out_dir, name))
    # Atlanten-Kopien (zur Kontrolle / evtl. Wiederverwendung)
    tri = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in cobjs:
        if o.type == 'MESH':
            tri += sum(len(p.vertices) - 2 for p in o.data.polygons)
    log("Dreiecke carbine:", tri)

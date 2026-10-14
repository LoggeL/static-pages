# Hilfsbibliothek fuer props_living.py (Blender 5.x, headless).
# Mesh-Generatoren (abgerundete Boxen mit Stuetzkanten, Drehkoerper, Rohre, Stoffgitter),
# Verformer (Delle, Durchhang, Rauschen), Welt-Meter-UVs, Vertex-AO/Dreck, Join + Export.
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, Euler, noise
from mathutils.bvhtree import BVHTree


def srgb(c):
    c = c / 255.0 if c > 1.0 else c
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip('#')
    return tuple(srgb(int(h[i:i + 2], 16)) for i in (0, 2, 4))


# ---------------------------------------------------------------- Materialien
def material(name, color='#808080', rough=0.8, metal=0.0, emit=None, emit_strength=0.0,
             image=None, alpha_image=False, transmission=0.0, ior=1.45, double_sided=True):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    col = hexcol(color) if isinstance(color, str) else tuple(color)
    bsdf.inputs['Base Color'].default_value = (*col, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if transmission > 0:
        bsdf.inputs['Transmission Weight'].default_value = transmission
        bsdf.inputs['IOR'].default_value = ior
    if emit is not None:
        ec = hexcol(emit) if isinstance(emit, str) else tuple(emit)
        bsdf.inputs['Emission Color'].default_value = (*ec, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if image:
        img = bpy.data.images.load(image, check_existing=True)
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        tex.location = (-400, 200)
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha_image:
            nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            try:
                m.surface_render_method = 'BLENDED'
            except Exception:
                pass
            m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    m.use_backface_culling = not double_sided
    m.diffuse_color = (*col, 1.0)
    m['tint'] = list(col)
    return m


# ---------------------------------------------------------------- Mesh-Generatoren
def _axis_rows(h, r, step):
    """Koordinaten -h..h mit Rundungs- und Stuetzreihen an den Enden."""
    rows = {-h, h}
    if r > 1e-6:
        for k in (0.5, 1.0, 1.6):
            c = -h + k * r
            if c < -1e-5:
                rows.add(c)
                rows.add(-c)
    lo = min([x for x in rows if x > -h + 1e-6] + [h])
    lo = -h + 1.6 * r if (r > 1e-6 and -h + 1.6 * r < 0) else -h
    hi = -lo
    if hi - lo > step:
        n = max(1, math.ceil((hi - lo) / step))
        for i in range(n + 1):
            rows.add(lo + (hi - lo) * i / n)
    rows.add(0.0) if h > 3 * max(r, 1e-3) and (hi - lo) > step * 0.6 else None
    out = sorted(rows)
    res = [out[0]]
    for x in out[1:]:
        if x - res[-1] > 1e-5:
            res.append(x)
    return res


def rbox(sx, sy, sz, r=0.01, step=0.15, rows=None):
    """Abgerundete Box (zentriert). Gitter auf allen Seiten -> Vertex-Farben/Verformung moeglich."""
    hs = [sx / 2, sy / 2, sz / 2]
    r = min(r, min(hs) * 0.97)
    ax_rows = rows or [_axis_rows(h, r, step) for h in hs]
    bm = bmesh.new()
    for a in range(3):
        b, c = [i for i in range(3) if i != a]
        for s in (-1, 1):
            grid = []
            for vb in ax_rows[b]:
                row = []
                for vc in ax_rows[c]:
                    co = [0, 0, 0]
                    co[a] = s * hs[a]
                    co[b] = vb
                    co[c] = vc
                    row.append(bm.verts.new(co))
                grid.append(row)
            for i in range(len(grid) - 1):
                for j in range(len(grid[0]) - 1):
                    q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
                    if s < 0:
                        q.reverse()
                    if a == 1:
                        q.reverse()
                    bm.faces.new(q)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    if r > 1e-6:
        inner = [h - r for h in hs]
        for v in bm.verts:
            p = v.co
            q = Vector([max(-inner[i], min(inner[i], p[i])) for i in range(3)])
            d = p - q
            if d.length > 1e-9:
                v.co = q + d.normalized() * r
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def lathe(profile, segs=16, cap_bottom=True, cap_top=True, arc=(0, 2 * math.pi)):
    """Drehkoerper um Z aus [(r, z), ...] von unten nach oben."""
    bm = bmesh.new()
    full = abs(arc[1] - arc[0] - 2 * math.pi) < 1e-6
    n = segs if full else segs + 1
    rings = []
    for (r, z) in profile:
        ring = []
        for i in range(n):
            t = arc[0] + (arc[1] - arc[0]) * i / segs
            ring.append(bm.verts.new((r * math.cos(t), r * math.sin(t), z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(n if full else n - 1):
            j = (i + 1) % n
            a, b, c, d = rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]
            try:
                bm.faces.new((a, b, c, d))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    if full:
        if cap_bottom and profile[0][0] > 1e-6:
            vs = [v for v in bm.verts if abs(v.co.z - profile[0][1]) < 1e-7 and abs(Vector((v.co.x, v.co.y)).length - profile[0][0]) < 1e-6]
            vs.sort(key=lambda v: -math.atan2(v.co.y, v.co.x))
            if len(vs) >= 3:
                bm.faces.new(vs)
        if cap_top and profile[-1][0] > 1e-6:
            vs = [v for v in bm.verts if abs(v.co.z - profile[-1][1]) < 1e-7 and abs(Vector((v.co.x, v.co.y)).length - profile[-1][0]) < 1e-6]
            vs.sort(key=lambda v: math.atan2(v.co.y, v.co.x))
            if len(vs) >= 3:
                bm.faces.new(vs)
    # Kappen-n-gons triangulieren (Fan) fuer saubere Normalen
    big = [f for f in bm.faces if len(f.verts) > 4]
    if big:
        bmesh.ops.poke(bm, faces=big)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def tube(points, radius, sides=8, caps=True, radii=None):
    """Rohr entlang Polylinie (parallel transport)."""
    pts = [Vector(p) for p in points]
    bm = bmesh.new()
    rings = []
    tangent = (pts[1] - pts[0]).normalized()
    ref = Vector((0, 0, 1)) if abs(tangent.z) < 0.9 else Vector((1, 0, 0))
    nrm = tangent.cross(ref).normalized()
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = ((pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()).normalized()
        nrm = (nrm - t * nrm.dot(t)).normalized()
        bin_ = t.cross(nrm)
        rr = radii[i] if radii else radius
        ring = [bm.verts.new(p + (nrm * math.cos(2 * math.pi * k / sides) + bin_ * math.sin(2 * math.pi * k / sides)) * rr) for k in range(sides)]
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(sides):
            bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def grid(nu, nv, fn):
    """Offenes Flaechengitter; fn(u, v) -> Vector, u,v in [0,1]. UV = Bogenlaenge in Metern."""
    bm = bmesh.new()
    vs = [[bm.verts.new(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    uvl = bm.loops.layers.uv.verify()
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
    # UV aus Kantenlaengen (Meter)
    U = [[0.0] * (nv + 1) for _ in range(nu + 1)]
    V = [[0.0] * (nv + 1) for _ in range(nu + 1)]
    for j in range(nv + 1):
        for i in range(1, nu + 1):
            U[i][j] = U[i - 1][j] + (vs[i][j].co - vs[i - 1][j].co).length
    for i in range(nu + 1):
        for j in range(1, nv + 1):
            V[i][j] = V[i][j - 1] + (vs[i][j].co - vs[i][j - 1].co).length
    idx = {}
    for i in range(nu + 1):
        for j in range(nv + 1):
            idx[vs[i][j]] = (U[i][j], V[i][j])
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = idx[l.vert]
    bm.normal_update()
    return bm, vs


def icoblob(radius, subdiv=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    return bm


# ---------------------------------------------------------------- Verformer
def deform(bm, fn):
    for v in bm.verts:
        v.co = fn(v.co.copy())
    bm.normal_update()


def noise_disp(bm, amp, freq, seed=0.0, octaves=3):
    bm.normal_update()
    off = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for v in bm.verts:
        n = noise.fractal(v.co * freq + off, 0.5, 2.0, octaves)
        v.co += v.normal * n * amp
    bm.normal_update()


def dent(bm, center, radius, depth, direction=None):
    c = Vector(center)
    for v in bm.verts:
        d = (v.co - c).length
        if d < radius:
            k = 0.5 + 0.5 * math.cos(math.pi * d / radius)
            dirv = Vector(direction) if direction else -v.normal
            v.co += dirv * depth * k
    bm.normal_update()


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- UVs
def uv_box(bm, grain=None, offset=None, rot90=False):
    """Box-Projektion in Metern (lokale Koordinaten). grain='x'|'y'|'z' laeuft entlang U."""
    uvl = bm.loops.layers.uv.verify()
    off = offset if offset is not None else (random.random() * 3, random.random() * 3)
    gi = {'x': 0, 'y': 1, 'z': 2}.get(grain, None)
    bm.normal_update()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        b, c = [i for i in range(3) if i != ax]
        if gi is not None and gi == c:
            b, c = c, b
        for l in f.loops:
            co = l.vert.co
            u, v = co[b], co[c]
            if rot90:
                u, v = v, u
            l[uvl].uv = (u + off[0], v + off[1])


def uv_cyl(bm, axis_center=(0, 0), offset=None):
    """Zylinder-Projektion um Z in Metern (Bogenlaenge, Hoehe)."""
    uvl = bm.loops.layers.uv.verify()
    off = offset if offset is not None else (random.random() * 3, random.random() * 3)
    for f in bm.faces:
        cen = f.calc_center_median()
        ac = math.atan2(cen.y - axis_center[1], cen.x - axis_center[0])
        for l in f.loops:
            co = l.vert.co
            r = max(0.005, math.hypot(co.x - axis_center[0], co.y - axis_center[1]))
            a = math.atan2(co.y - axis_center[1], co.x - axis_center[0])
            if a - ac > math.pi:
                a -= 2 * math.pi
            if ac - a > math.pi:
                a += 2 * math.pi
            l[uvl].uv = (a * max(r, 0.02) + off[0], co.z + off[1])


# ---------------------------------------------------------------- Objekte
_PARTS = []


def part(bm, mat, loc=(0, 0, 0), rot=(0, 0, 0), name='part', uv=None, grain=None, smooth=True, scale=None):
    """bmesh -> Objekt mit Material. uv: 'box' | 'cyl' | None (vorhanden lassen)."""
    if uv == 'box':
        uv_box(bm, grain=grain)
    elif uv == 'cyl':
        uv_cyl(bm)
    else:
        bm.loops.layers.uv.verify()
    for f in bm.faces:
        f.smooth = smooth
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = Euler(rot, 'XYZ')
    if scale:
        ob.scale = scale
    _PARTS.append(ob)
    return ob


def transform_obj(ob, loc=(0, 0, 0), rot=(0, 0, 0), pivot=(0, 0, 0)):
    """Dreht Objekt um Pivot (Welt) und verschiebt."""
    M = Matrix.Translation(Vector(loc)) @ Matrix.Translation(Vector(pivot)) @ Euler(rot, 'XYZ').to_matrix().to_4x4() @ Matrix.Translation(-Vector(pivot))
    ob.matrix_basis = M @ ob.matrix_basis  # matrix_world ist vor dem Depsgraph-Update veraltet


def group_transform(obs, loc=(0, 0, 0), rot=(0, 0, 0), pivot=(0, 0, 0)):
    for o in obs:
        transform_obj(o, loc, rot, pivot)


def take_parts():
    global _PARTS
    p = _PARTS
    _PARTS = []
    return p


def join(name, parts, collection):
    """Fuegt Teile zu einem Mesh-Objekt mit Ursprung (0,0,0) zusammen."""
    me = bpy.data.meshes.new(name)
    root = bpy.data.objects.new(name, me)
    collection.objects.link(root)
    vl = bpy.context.view_layer
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for p in parts:
        if p.name not in vl.objects:
            continue
        p.select_set(True)
    root.select_set(True)
    vl.objects.active = root
    with bpy.context.temp_override(active_object=root, selected_editable_objects=[root] + parts, selected_objects=[root] + parts):
        bpy.ops.object.join()
    for c in list(root.users_collection):
        if c != collection:
            c.objects.unlink(root)
    # UV-Layer vereinheitlichen
    return root


def drop_to_floor(ob, mode='floor'):
    """mode floor: min z -> 0, xy-Mitte der Bounding-Box -> 0. ceiling: max z -> 0. wall: max y -> 0, min z -> 0."""
    me = ob.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    cx = (min(xs) + max(xs)) / 2
    if mode == 'floor':
        off = Vector((-cx, -(min(ys) + max(ys)) / 2, -min(zs)))
    elif mode == 'floor_keep_y':
        off = Vector((-cx, 0, -min(zs)))
    elif mode == 'ceiling':
        off = Vector((-cx, -(min(ys) + max(ys)) / 2, -max(zs)))
    elif mode == 'wall':
        off = Vector((-cx, -max(ys), -min(zs)))
    me.transform(Matrix.Translation(off))
    me.update()
    return off


def dims_of(obs):
    pts = []
    for ob in obs:
        if ob.type != 'MESH':
            continue
        for v in ob.data.vertices:
            pts.append(ob.matrix_world @ v.co)
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def tri_count(obs):
    n = 0
    for ob in obs:
        if ob.type == 'MESH':
            ob.data.calc_loop_triangles()
            n += len(ob.data.loop_triangles)
    return n


# ---------------------------------------------------------------- Vertex-Farbe: Kontakt-AO + Dreck + Flecken
def _hemi(n, k, rnd):
    t = n.orthogonal().normalized()
    b = n.cross(t)
    out = []
    for i in range(k):
        u1, u2 = rnd.random(), rnd.random()
        r = math.sqrt(u1)
        phi = 2 * math.pi * u2
        x, y = r * math.cos(phi), r * math.sin(phi)
        z = math.sqrt(max(0.0, 1 - u1))
        out.append((t * x + b * y + n * z).normalized())
    return out


def bake_grime(obs, floor=True, ao_dist=0.18, ao_strength=0.55, dirt=0.22, dirt_freq=3.0,
               floor_dirt=0.18, stains=(), tint=(1.0, 0.94, 0.86), seed=1, rays=20, extra_occluders=(),
               ceiling=None, base_col=None):
    """Schreibt Farbattribut 'Color' (FLOAT, Punkt) = Kontakt-AO * Dreckrauschen * Flecken (multiplikativ, linear)."""
    rnd = random.Random(seed)
    # BVH ueber alle Objekte (Weltkoordinaten)
    verts, polys = [], []
    for ob in list(obs) + list(extra_occluders):
        if ob.type != 'MESH':
            continue
        mw = ob.matrix_world
        base = len(verts)
        verts += [mw @ v.co for v in ob.data.vertices]
        polys += [[base + i for i in p.vertices] for p in ob.data.polygons]
    bvh = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
    dirs_cache = {}
    soff = Vector((seed * 1.7, seed * 2.3, seed * 0.9))
    for ob in obs:
        if ob.type != 'MESH':
            continue
        me = ob.data
        mw = ob.matrix_world
        nm = mw.to_3x3().inverted().transposed()
        if 'Color' in me.color_attributes:
            me.color_attributes.remove(me.color_attributes['Color'])
        ca = me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
        vals = []
        for v in me.vertices:
            p = mw @ v.co
            n = (nm @ v.normal).normalized()
            occ = 0.0
            dirs = _hemi(n, rays, rnd)
            o = p + n * 0.0015
            for d in dirs:
                hit = bvh.ray_cast(o, d, ao_dist)
                dist = None
                if hit[0] is not None:
                    dist = hit[3]
                if floor and d.z < -1e-4 and o.z > -0.001:
                    tf = -o.z / d.z
                    if tf < ao_dist and (dist is None or tf < dist):
                        dist = tf
                if ceiling is not None and d.z > 1e-4:
                    tc = (ceiling - o.z) / d.z
                    if tc < ao_dist and (dist is None or tc < dist):
                        dist = tc
                if dist is not None:
                    occ += (1.0 - dist / ao_dist) ** 0.7
            occ /= rays
            k = 1.0 - ao_strength * occ
            # grossflaechiger Dreck
            nz = noise.fractal(p * dirt_freq + soff, 0.55, 2.1, 4)
            g = smoothstep(-0.25, 0.55, nz) * dirt
            # Bodennaehe: Schmutzrand
            if floor:
                g += floor_dirt * (1.0 - smoothstep(0.0, 0.16, p.z))
            # nach unten zeigende Flaechen etwas dunkler (Kanten, Unterseiten)
            g += 0.08 * max(0.0, -n.z)
            col = [k * (1 - g * (1 - tint[i])) * (1 - 0.55 * g) for i in range(3)]
            # Flecken
            for st in stains:
                c, rad, mul = Vector(st[0]), st[1], st[2]
                d = (p - c).length
                edge = rad * (1 + 0.35 * noise.noise(p * (6.0 / rad) + soff))
                if d < edge:
                    w = 1.0 - smoothstep(edge * 0.55, edge, d)
                    ring = 0.0
                    if len(st) > 3 and st[3] == 'ring':
                        ring = smoothstep(edge * 0.75, edge * 0.93, d) * (1 - smoothstep(edge * 0.93, edge, d))
                        w = 0.35 * w + 0.9 * ring
                    for i in range(3):
                        col[i] *= (1 - w) + w * mul[i]
            if base_col is not None:
                pass
            vals.extend((max(0.05, min(1.0, col[0])), max(0.05, min(1.0, col[1])), max(0.05, min(1.0, col[2])), 1.0))
        ca.data.foreach_set('color', vals)
        me.color_attributes.active_color = ca
        try:
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except Exception:
            pass


def set_vertex_tint(ob, fn):
    """Multipliziert vorhandene Farbe mit fn(world_pos) -> (r,g,b)."""
    me = ob.data
    ca = me.color_attributes['Color']
    mw = ob.matrix_world
    for i, v in enumerate(me.vertices):
        t = fn(mw @ v.co)
        if t is None:
            continue
        c = ca.data[i].color
        ca.data[i].color = (c[0] * t[0], c[1] * t[1], c[2] * t[2], 1.0)


# ---------------------------------------------------------------- Export
def export_glb(objs, path):
    vl = bpy.context.view_layer
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    vl.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_extras=True,
        export_apply=True, export_yup=True, export_vertex_color='ACTIVE',
        export_all_vertex_colors=False, export_animations=False, export_cameras=False,
        export_lights=False, export_image_format='AUTO', export_texcoords=True, export_normals=True,
        export_tangents=False, export_materials='EXPORT')

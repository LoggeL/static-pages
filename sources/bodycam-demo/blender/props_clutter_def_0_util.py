# Hilfsfunktionen für props_clutter (wird per exec in den Namespace von props_clutter.py geladen)

UNIQUE.update({
    'paint_label': ('paint_label.jpg', (0.55, 0.55, 0.50), 0.55),
    'box_label': ('box_label.jpg', (0.36, 0.24, 0.13), 0.88),
})


def bm_uv(bm):
    return bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')


def cyl_patch(name, a0, a1, z0, z1, nu, nv, rfn, mat, uv_rect=(0, 1, 0, 1), flip=False):
    """Zylinder-/Rotationsflächen-Patch mit eigener UV (für Etiketten). rfn(a, z) -> Radius."""
    bm = bmesh.new()
    uvl = bm_uv(bm)
    grid = []
    for j in range(nv + 1):
        z = z0 + (z1 - z0) * j / nv
        row = []
        for i in range(nu + 1):
            a = a0 + (a1 - a0) * i / nu
            r = rfn(a, z)
            row.append(bm.verts.new((r * cos(a), r * sin(a), z)))
        grid.append(row)
    u0, u1, v0, v1 = uv_rect
    for j in range(nv):
        for i in range(nu):
            vs = (grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i])
            if flip:
                vs = vs[::-1]
            f = bm.faces.new(vs)
            for lp in f.loops:
                # Parameter aus Gitterposition
                for (jj, ii) in ((j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i)):
                    if grid[jj][ii] is lp.vert:
                        lp[uvl].uv = (u0 + (u1 - u0) * ii / nu, v0 + (v1 - v0) * jj / nv)
                        break
    return mesh_obj(name, bm, mat)


def plane_patch(name, sx, sy, nx, ny, mat, uv_rect=(0, 1, 0, 1)):
    """Ebene (XY) mit 0..1-UV, Normal +Z, Mitte im Ursprung."""
    bm = bmesh.new()
    uvl = bm_uv(bm)
    grid = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            row.append(bm.verts.new(((i / nx - 0.5) * sx, (j / ny - 0.5) * sy, 0)))
        grid.append(row)
    u0, u1, v0, v1 = uv_rect
    for j in range(ny):
        for i in range(nx):
            vs = (grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i])
            f = bm.faces.new(vs)
            for lp, (jj, ii) in zip(f.loops, ((j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i))):
                lp[uvl].uv = (u0 + (u1 - u0) * ii / nx, v0 + (v1 - v0) * jj / ny)
    return mesh_obj(name, bm, mat)


def mat_index(ob, key):
    nm = key if key.startswith('MU_') else 'M_' + key
    for i, m in enumerate(ob.data.materials):
        if m and m.name == nm:
            return i
    ob.data.materials.append(get_mat(key))
    return len(ob.data.materials) - 1


def fix_inner_faces(ob, from_key, to_key, center=None):
    """Nach Solidify: Innenflächen eines MU-Materials auf ein anderes Material umsetzen."""
    me = ob.data
    fi = mat_index(ob, from_key)
    ti = mat_index(ob, to_key)
    c = Vector(center) if center else sum((v.co for v in me.vertices), Vector()) / max(1, len(me.vertices))
    for p in me.polygons:
        if p.material_index == fi and (p.center - c).dot(p.normal) < 0:
            p.material_index = ti


def remove_doubles(ob, d=0.0005):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=d)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def recalc_normals(ob, inside=False):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if inside:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def triangulate(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def decimate_to(ob, target_tris):
    t = tri_count(ob)
    if t > target_tris:
        mod_decimate(ob, target_tris / t)
        apply_mods(ob)
    return ob


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def crumple_ball(name, r, mat, seed=0, sub=2, amp=0.55):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    ob = mesh_obj(name, bm, mat)
    rnd = random.Random(seed)
    off = Vector((rnd.uniform(0, 50), rnd.uniform(0, 50), rnd.uniform(0, 50)))
    for v in ob.data.vertices:
        n = v.co.normalized()
        f = noise.noise(n * 1.6 + off) * 0.6 + noise.noise(n * 4.0 + off * 2) * 0.4
        v.co = n * r * (1.0 + amp * f) + nvec(n * 7 + off) * r * 0.12
    ob.data.update()
    # Knitterfalten: harte Facetten behalten
    ob['_flat'] = 1
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def rock(name, size, mat, seed=0, cuts=9, chip=0.08, voxel=None, target=320, flat_bottom=True):
    """Bruchstück: Box mit zufälligen Schnittebenen, leicht verrauscht, Kanten verrundet."""
    rnd = random.Random(seed)
    sx, sy, sz = size
    bm = bm_box(sx, sy, sz)
    for i in range(cuts):
        n = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.6, 1.0))).normalized()
        d = rnd.uniform(0.18, 0.42) * (abs(n.x) * sx + abs(n.y) * sy + abs(n.z) * sz)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=n * d, plane_no=n, clear_outer=True)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            try:
                bmesh.ops.holes_fill(bm, edges=edges, sides=0)
            except Exception:
                pass
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    ob = mesh_obj(name, bm, mat)
    vs = voxel or min(sx, sy, sz) / 9
    mod_remesh(ob, vs)
    apply_mods(ob)
    off = Vector((seed * 2.1, seed * 3.7, seed * 1.3))
    mx = max(sx, sy, sz)
    for v in ob.data.vertices:
        v.co += v.normal * (fbm(v.co / mx * 3.0 + off, 4) * chip * mx * 0.35)
    ob.data.update()
    mod_smooth(ob, 0.5, 2)
    apply_mods(ob)
    decimate_to(ob, target)
    if flat_bottom:
        zmin = min(v.co.z for v in ob.data.vertices)
        for v in ob.data.vertices:
            if v.co.z < zmin + 0.004:
                v.co.z = zmin
    return ob


def tube_curve(name, ctrl, radius, mat, sides=8, n=6, radii=None, taper=None, caps=True):
    pts = catmull(ctrl, n)
    rr = None
    if taper:
        rr = [radius * (taper[0] + (taper[1] - taper[0]) * i / (len(pts) - 1)) for i in range(len(pts))]
    if radii:
        rr = radii
    return tube_path(name, pts, radius, mat, sides=sides, radii=rr, caps=caps)


def cloth_drop(ob, frames=40, colliders=(), **kw):
    for c in colliders:
        make_collider(c)
    return cloth_sim(ob, frames=frames, **kw)


def ground_clamp(ob, z=0.0):
    for v in ob.data.vertices:
        if v.co.z < z:
            v.co.z = z
    ob.data.update()
    return ob


def lerp(a, b, t):
    return a + (b - a) * t

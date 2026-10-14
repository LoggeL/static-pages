"""Keep every lightmap chart sampleable while preserving the material UV layer.

Charts are connected only across actual mesh edges whose UV endpoints agree.
Collapsed UV triangles are projected from their unchanged 3D geometry. The true
minimum caliper width of each chart's convex hull, measured after packing, is
used instead of the axis-aligned bounding box or a PCA estimate.
"""
import sys
sys.dont_write_bytecode = True

import bpy
import bmesh
import numpy as np


def _uv_values(mesh):
    values = np.empty(len(mesh.loops) * 2, np.float32)
    mesh.uv_layers[1].data.foreach_get('uv', values)
    return values.reshape(-1, 2)


def _remove_zero_geometry(obj):
    """BMesh's float32 polygon-area sum can report nonzero collinear faces."""
    mesh = obj.data
    coordinates = np.empty(len(mesh.vertices) * 3, np.float64)
    mesh.vertices.foreach_get('co', coordinates)
    indices = np.empty(len(mesh.loops), np.int32)
    mesh.loops.foreach_get('vertex_index', indices)
    matrix = np.asarray(obj.matrix_world)
    coordinates = coordinates.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3]
    triangles = coordinates[indices].reshape(-1, 3, 3)
    areas = np.linalg.norm(np.cross(triangles[:, 1]-triangles[:, 0], triangles[:, 2]-triangles[:, 0]), axis=1) / 2
    bad = np.flatnonzero(areas < 1e-12)
    if len(bad):
        editable = bmesh.new()
        editable.from_mesh(mesh)
        editable.faces.ensure_lookup_table()
        bmesh.ops.delete(editable, geom=[editable.faces[int(i)] for i in bad], context='FACES_ONLY')
        editable.to_mesh(mesh)
        editable.free()
    return len(bad)


def island_labels(mesh, uv=None):
    """Return one chart label per loop, without joining unrelated equal UVs."""
    if any(face.loop_total != 3 for face in mesh.polygons):
        raise ValueError('Lightmap footprint repair requires triangulated geometry')
    uv = _uv_values(mesh) if uv is None else np.asarray(uv, np.float32)
    uv = np.ascontiguousarray(uv.copy())
    uv[uv == 0] = 0
    vertex_indices = np.empty(len(mesh.loops), np.int32)
    mesh.loops.foreach_get('vertex_index', vertex_indices)
    keys = np.column_stack((vertex_indices, uv.view(np.uint32))).astype(np.int64)
    _, vertices = np.unique(keys, axis=0, return_inverse=True)
    vertices = vertices.reshape(-1, 3)
    pairs = vertices[:, [[0, 1], [1, 2], [2, 0]]].reshape(-1, 2)
    pairs.sort(axis=1)
    edges = (pairs[:, 0].astype(np.uint64) << np.uint64(32)) | pairs[:, 1].astype(np.uint64)
    _, first, inverse = np.unique(edges, return_index=True, return_inverse=True)
    faces = np.repeat(np.arange(len(mesh.polygons)), 3)
    other = faces[first[inverse]]
    parent = np.arange(len(mesh.polygons))
    size = np.ones(len(parent), np.int32)

    def root(value):
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = parent[value]
        return value

    for left, right in zip(faces, other):
        if left != right:
            a, b = root(left), root(right)
            if a != b:
                if size[a] < size[b]:
                    a, b = b, a
                parent[b] = a
                size[a] += size[b]
    _, labels = np.unique([root(i) for i in range(len(parent))], return_inverse=True)
    return np.repeat(labels, 3)


def _hull(points):
    points = np.unique(points, axis=0)
    if len(points) <= 3:
        return points

    def cross(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])

    lower = []
    for point in points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper = []
    for point in points[::-1]:
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return np.array(lower[:-1] + upper[:-1])


def chart_frame(points):
    """Exact minimum convex-hull width and the corresponding orthogonal axes."""
    hull = _hull(np.asarray(points, np.float64))
    if len(hull) < 3:
        return 0.0, np.eye(2)
    edges = np.roll(hull, -1, axis=0) - hull
    lengths = np.linalg.norm(edges, axis=1)
    edges = edges[lengths > 1e-20] / lengths[lengths > 1e-20, None]
    if not len(edges):
        return 0.0, np.eye(2)
    normals = np.column_stack((-edges[:, 1], edges[:, 0]))
    # Translate first, avoiding cancellation when a repaired chart lies off-atlas.
    projections = (hull - hull[0]) @ normals.T
    widths = np.ptp(projections, axis=0)
    index = int(np.argmin(widths))
    return float(widths[index]), np.column_stack((edges[index], normals[index]))


def _expand(points, target):
    width, axes = chart_frame(points)
    if width <= 1e-16:
        raise ValueError('UV chart is still degenerate after geometric projection')
    if width >= target:
        return points
    center = points.mean(axis=0)
    projected = (points - center) @ axes
    extent = np.ptp(projected, axis=0)
    # Widen the short dimension; preserve useful length on thin wall/slab sides.
    factors = np.maximum(1, np.array([2 * target, target]) / extent)
    widened = (projected * factors) @ axes.T
    # The caliper width of a triangle is smaller than its bounding-box height.
    # Correct that remaining difference, rather than assuming box dimensions.
    actual, _ = chart_frame(widened)
    if actual <= 1e-16:
        raise ValueError('Unable to expand a degenerate UV chart')
    widened *= max(1.0, target / actual)
    return widened + center


def _project_triangles(obj, uv, faces, target):
    triangles = uv.reshape(-1, 3, 2).astype(np.float64)
    positions = np.empty(len(obj.data.vertices) * 3, np.float64)
    obj.data.vertices.foreach_get('co', positions)
    matrix = np.asarray(obj.matrix_world)
    positions = positions.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3]
    for repair_index, face_index in enumerate(faces):
        face = obj.data.polygons[int(face_index)]
        points = positions[list(face.vertices)]
        edges = np.roll(points, -1, axis=0) - points
        lengths = np.linalg.norm(edges, axis=1)
        longest = int(np.argmax(lengths))
        normal = np.cross(points[1]-points[0], points[2]-points[0])
        normal_length = np.linalg.norm(normal)
        if lengths[longest] <= 0 or normal_length <= 1e-20:
            raise ValueError(f'{obj.name}: geometric zero-area face {face_index}; remove before packing')
        x_axis = edges[longest] / lengths[longest]
        y_axis = np.cross(normal / normal_length, x_axis)
        projected = (points - points[0]) @ np.column_stack((x_axis, y_axis))
        projected *= 0.01 / np.ptp(projected, axis=0).max()
        projected = _expand(projected, target)
        # This breaks UV adjacency only on the repaired triangle, including the
        # case of multiple collapsed charts sharing the same original UV value.
        projected += [2 + (repair_index % 200) * 0.05, 2 + (repair_index // 200) * 0.05]
        triangles[face_index] = projected
    return triangles.reshape(-1, 2).astype(np.float32)


def _repair_zero_triangles(obj, uv, target):
    triangles = uv.reshape(-1, 3, 2).astype(np.float64)
    a, b = triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]
    bad = np.flatnonzero(np.abs(a[:, 0]*b[:, 1] - a[:, 1]*b[:, 0]) <= 1e-16)
    return (_project_triangles(obj, uv, bad, target), len(bad)) if len(bad) else (uv, 0)


def _split_convex(mesh, uv, faces, labels, target):
    """Partition a fragile chart into convex patches, retaining valid shared quads.

    This avoids spending a complete padding border on each tessellation triangle.
    A merge needs an actual shared mesh edge and a convex, nonoverlapping UV union.
    """
    triangles = uv.reshape(-1, 3, 2).astype(np.float64)
    indices = np.empty(len(mesh.loops), np.int32)
    mesh.loops.foreach_get('vertex_index', indices)
    indices = indices.reshape(-1, 3)
    parent = {int(face): int(face) for face in faces}
    polygons = {int(face): triangles[face].copy() for face in faces}
    members = {int(face): [int(face)] for face in faces}
    areas = {}
    for face in faces:
        a, b = triangles[face, 1]-triangles[face, 0], triangles[face, 2]-triangles[face, 0]
        areas[int(face)] = abs(a[0]*b[1]-a[1]*b[0]) / 2

    def root(face):
        while parent[face] != face:
            parent[face] = parent[parent[face]]
            face = parent[face]
        return face

    owners, edges = {}, []
    for face in faces:
        for a, b in ((0, 1), (1, 2), (2, 0)):
            va, vb = int(indices[face, a]), int(indices[face, b])
            key = (int(labels[face * 3]), min(va, vb), max(va, vb))
            if key in owners:
                other = owners[key]
                edge = triangles[face, b] - triangles[face, a]
                edges.append((float(edge @ edge), int(face), other, triangles[face, a], edge))
            else:
                owners[key] = int(face)
    edges.sort(key=lambda item: -item[0])
    for _, left, right, point, edge in edges:
        a, b = root(left), root(right)
        if a == b:
            continue
        pa, pb = polygons[a] - point, polygons[b] - point
        sa, sb = pa[:, 0]*edge[1]-pa[:, 1]*edge[0], pb[:, 0]*edge[1]-pb[:, 1]*edge[0]
        tolerance = max(1e-18, np.linalg.norm(edge) * 1e-10)
        # Convex patches must lie on opposite sides of their common edge.
        separated = ((sa.min() >= -tolerance and sb.max() <= tolerance) or
                     (sb.min() >= -tolerance and sa.max() <= tolerance))
        if not separated:
            continue
        hull = _hull(np.concatenate((polygons[a], polygons[b])))
        shifted = hull - hull[0]
        area = abs(np.sum(shifted[:, 0]*np.roll(shifted[:, 1], -1)-shifted[:, 1]*np.roll(shifted[:, 0], -1))) / 2
        total = areas[a] + areas[b]
        if abs(area-total) > max(1e-16, total * 1e-6):
            continue
        parent[b] = a
        polygons[a] = hull
        areas[a] = total
        members[a].extend(members.pop(b))
        polygons.pop(b)
        areas.pop(b)
    for patch, group in enumerate(members.values()):
        values = triangles[group].reshape(-1, 2)
        values -= values.mean(axis=0)
        values *= 0.01 / np.ptp(values, axis=0).max()
        values = _expand(values, target)
        values += [2 + (patch % 200) * 0.05, 2 + (patch // 200) * 0.05]
        triangles[group] = values.reshape(-1, 3, 2)
    return triangles.reshape(-1, 2).astype(np.float32), len(members)


def _coverage(uv, labels, size, border_scale):
    """Read back the final texel grid; detect concave slivers and folded charts."""
    final_uv = uv.astype(np.float32)
    final_uv[:] = final_uv * border_scale + (1 - border_scale) / 2
    blender_triangles = final_uv.astype(np.float64).reshape(-1, 3, 2)
    ba, bb = blender_triangles[:, 1]-blender_triangles[:, 0], blender_triangles[:, 2]-blender_triangles[:, 0]
    blender_area = np.abs(ba[:, 0]*bb[:, 1]-ba[:, 1]*bb[:, 0]) / 2
    # Match the exported glTF V coordinate's float32 rounding too.
    final_uv[:, 1] = 1 - final_uv[:, 1]
    triangles = final_uv.astype(np.float64).reshape(-1, 3, 2) * size
    face_labels = labels.reshape(-1, 3)[:, 0]
    samples = np.zeros(int(labels.max()) + 1, np.int64)
    owner = np.full((size, size), -1, np.int32)
    bad = set()
    overlap_pixels = 0
    edge1, edge2 = triangles[:, 1]-triangles[:, 0], triangles[:, 2]-triangles[:, 0]
    signed_area = (edge1[:, 0]*edge2[:, 1]-edge1[:, 1]*edge2[:, 0]) / 2
    areas = np.abs(signed_area)
    for face, triangle in enumerate(triangles):
        low = np.maximum(np.ceil(triangle.min(axis=0) - 0.5).astype(int), 0)
        high = np.minimum(np.floor(triangle.max(axis=0) - 0.5).astype(int), size - 1)
        if np.any(high < low):
            continue
        e1, e2 = triangle[1] - triangle[0], triangle[2] - triangle[0]
        determinant = e1[0]*e2[1] - e1[1]*e2[0]
        if abs(determinant) < 1e-10:
            continue
        yy, xx = np.mgrid[low[1]:high[1]+1, low[0]:high[0]+1]
        dx, dy = xx + 0.5 - triangle[0, 0], yy + 0.5 - triangle[0, 1]
        u, v = (dx*e2[1]-dy*e2[0])/determinant, (e1[0]*dy-e1[1]*dx)/determinant
        inside = (u > 1e-6) & (v > 1e-6) & (u + v < 1 - 1e-6)
        xx, yy = xx[inside], yy[inside]
        if not len(xx):
            continue
        label = int(face_labels[face])
        samples[label] += len(xx)
        previous = owner[yy, xx]
        hits = previous >= 0
        if np.any(hits):
            bad.add(label)
            bad.update(int(i) for i in np.unique(face_labels[previous[hits]]))
            overlap_pixels += int(hits.sum())
        owner[yy, xx] = face
    collapsed = np.flatnonzero((areas / (size * size) < 5e-17) | (blender_area < 5e-17))
    return bad, set(np.flatnonzero(samples == 0).tolist()), overlap_pixels, collapsed


def _snap_charts(uv, groups, missing, size, border_scale):
    """Put a chart's safest interior point on the nearest texel centre.

    Each axis moves at most half a texel. With 18 px packed separation this
    leaves at least 17 px between charts, enough for two 8 px bake margins.
    """
    maximum = 0.0
    for index in sorted(missing):
        loops = groups[index]
        final = uv[loops].astype(np.float32)
        final[:] = final * border_scale + (1 - border_scale) / 2
        final[:, 1] = 1 - final[:, 1]
        triangles = final.astype(np.float64).reshape(-1, 3, 2) * size
        lengths = np.linalg.norm(np.roll(triangles, -1, axis=1)-triangles, axis=2)
        a, b = triangles[:, 1]-triangles[:, 0], triangles[:, 2]-triangles[:, 0]
        area2 = np.abs(a[:, 0]*b[:, 1]-a[:, 1]*b[:, 0])
        perimeter = lengths.sum(axis=1)
        best = int(np.argmax(area2 / np.maximum(perimeter, 1e-30)))
        weights = lengths[best, [1, 2, 0]]
        center = (triangles[best] * weights[:, None]).sum(axis=0) / weights.sum()
        offset = np.floor(center) + 0.5 - center
        maximum = max(maximum, float(np.max(np.abs(offset))))
        offset[1] *= -1
        uv[loops] += offset / (size * border_scale)
    return maximum


def ensure_chart_footprint(obj, settings):
    mesh = obj.data
    removed = _remove_zero_geometry(obj)
    size = settings['atlasSize']
    required = float(settings.get('minimumChartPixels', 2))
    # pack_atlas reserves this outer border after this function returns.
    border_scale = 1 - 2 * settings.get('paddingPixels', 0) / size
    target = max(required, 2.25) / (size * border_scale)
    uv, repaired = _repair_zero_triangles(obj, _uv_values(mesh), target * 1.6)
    mesh.uv_layers[1].data.foreach_set('uv', uv.ravel())
    adjusted, pack_count, split_triangles = 0, 0, 0
    overlap_charts, snapped_charts, maximum_shift = 0, 0, 0.0
    for coverage_pass in range(12):
        labels = island_labels(mesh)
        count = int(labels.max()) + 1
        order = np.argsort(labels, kind='stable')
        groups = np.split(order, np.flatnonzero(np.diff(labels[order])) + 1)
        resized = set()
        for attempt in range(8):
            uv = _uv_values(mesh).astype(np.float64)
            needs_pack = attempt == 0 and (repaired or coverage_pass or uv.min() < 0 or uv.max() > 1)
            minimum = np.inf
            changed = False
            for index, group in enumerate(groups):
                # A triangle with minimum altitude >= 2.25 px has an incircle
                # radius >= .75 px, exceeding the square grid's covering radius.
                group_target = max(target, 2.25 / (size * border_scale)) if len(group) == 3 else target
                width, _ = chart_frame(uv[group])
                minimum = min(minimum, width)
                if width < group_target * (1 - 1e-5):
                    uv[group] = _expand(uv[group], group_target * 1.6)
                    resized.add(index)
                    changed = True
            if not changed and not needs_pack:
                break
            mesh.uv_layers[1].data.foreach_set('uv', uv.astype(np.float32).ravel())
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.select_all(action='SELECT')
            bpy.ops.uv.pack_islands(rotate=True, rotate_method='CARDINAL', scale=True,
                margin_method='FRACTION', margin=settings['islandGapPixels'] / (2 * size),
                shape_method='AABB', merge_overlap=False)
            bpy.ops.object.mode_set(mode='OBJECT')
            pack_count += 1
        else:
            raise ValueError(f'{obj.name}: UV charts cannot fit minimum {required}px after 8 packing iterations')
        adjusted += len(resized)
        overlap, missing, overlap_pixels, collapsed = _coverage(uv, labels, size, border_scale)
        if missing:
            snapped_charts += len(missing)
            maximum_shift = max(maximum_shift, _snap_charts(uv, groups, missing, size, border_scale))
            mesh.uv_layers[1].data.foreach_set('uv', uv.astype(np.float32).ravel())
            uv = _uv_values(mesh).astype(np.float64)
            overlap, missing, overlap_pixels, collapsed = _coverage(uv, labels, size, border_scale)
        if not overlap and not missing:
            return {'charts': count, 'chartResizeOperations': adjusted,
                    'repairedZeroUVTriangles': repaired, 'removedDegenerateGeometryFaces': removed,
                    'sampledChartUVZeroTriangles': len(collapsed),
                    'uvZeroPolicy': 'Retain geometrically valid micro triangles in sampled charts; no destructive cleanup.',
                    'splitOverlapCharts': overlap_charts, 'snappedCharts': snapped_charts,
                    'maximumChartShiftPixelsPerAxis': maximum_shift,
                    'splitTriangles': split_triangles, 'coveragePasses': coverage_pass + 1,
                    'overlapTexels': 0, 'samplelessCharts': 0,
                    'minimumChartPixels': float(minimum * size * border_scale),
                    'minimumChartMetric': 'minimum convex-hull caliper width after outer border',
                    'packIterations': pack_count}
        overlap_charts += len(overlap)
        faces = np.flatnonzero(np.isin(labels.reshape(-1, 3)[:, 0], list(overlap | missing)))
        split_triangles += len(faces)
        if len(faces):
            uv, patches = _split_convex(mesh, uv, faces, labels, target * 1.6)
        else:
            patches = 0
        mesh.uv_layers[1].data.foreach_set('uv', uv.astype(np.float32).ravel())
        print(f'C6_UV_REPAIR {obj.name}: {len(overlap)} folded charts ({overlap_pixels} overlapping samples), '
              f'{len(missing)} sampleless charts after snapping; '
              f'partition {len(faces)} triangles into {patches} convex patches', flush=True)
    raise ValueError(f'{obj.name}: unresolved UV overlap/coverage after 12 repairs')

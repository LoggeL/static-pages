"""Fill uncovered bilinear lightmap support from the same original UV chart.

The function operates on Blender's bottom-up, linear float RGBA bake array.
Existing positive-alpha samples, including genuinely black lighting, are never
changed. Transparent decals and emission-only materials have no diffuse-bake
coverage requirement. A chart without an original interior sample is an error.
"""

import math
import sys
import time

sys.dont_write_bytecode = True

import numpy as np
from mathutils.kdtree import KDTree

from bake_uv import island_labels


def _material_name(material):
    name = material.name if material else ''
    for prefix in ('__BAKE_', 'C6_BAKE_'):
        while name.startswith(prefix):
            name = name[len(prefix):]
    return name


def _interior_pixels(triangle, width, height):
    low = np.maximum(np.ceil(triangle.min(axis=0) - .5).astype(int), 0)
    high = np.minimum(np.floor(triangle.max(axis=0) - .5).astype(int), [width - 1, height - 1])
    e1, e2 = triangle[1] - triangle[0], triangle[2] - triangle[0]
    determinant = e1[0] * e2[1] - e1[1] * e2[0]
    if abs(determinant) < 1e-10 or np.any(high < low):
        return np.empty(0, np.int64), np.empty(0, np.int64)
    yy, xx = np.mgrid[low[1]:high[1] + 1, low[0]:high[0] + 1]
    dx, dy = xx + .5 - triangle[0, 0], yy + .5 - triangle[0, 1]
    u = (dx * e2[1] - dy * e2[0]) / determinant
    v = (e1[0] * dy - e1[1] * dx) / determinant
    inside = (u > 1e-6) & (v > 1e-6) & (u + v < 1 - 1e-6)
    return xx[inside], yy[inside]


def _uncovered_support(triangle, uncovered, radius):
    """Find alpha-zero pixel centres within a square-radius of the triangle.

    The separating-axis test is exact for a convex triangle and an axis-aligned
    square. A radius of one includes all four bilinear taps for every point in
    the triangle. The caller may reserve extra space for delivery UV rounding.
    Collinear micro triangles retain their line/point support as well.
    """
    height, width = uncovered.shape
    low = np.maximum(np.ceil(triangle.min(axis=0) - .5 - radius).astype(int), 0)
    high = np.minimum(np.floor(triangle.max(axis=0) - .5 + radius).astype(int), [width - 1, height - 1])
    if np.any(high < low):
        return np.empty(0, np.int64), np.empty(0, np.int64)
    yy, xx = np.nonzero(uncovered[low[1]:high[1] + 1, low[0]:high[0] + 1])
    xx, yy = xx + low[0], yy + low[1]
    if not len(xx):
        return xx, yy
    centres = np.column_stack((xx + .5, yy + .5)) - triangle[0]
    points = triangle - triangle[0]
    inside = np.ones(len(xx), np.bool_)
    for edge in np.roll(triangle, -1, axis=0) - triangle:
        normal = np.array([-edge[1], edge[0]])
        length = np.linalg.norm(normal)
        if length <= 1e-20:
            continue
        normal /= length
        projected = points @ normal
        centre_projection = centres @ normal
        reach = radius * np.abs(normal).sum()
        inside &= ((centre_projection + reach >= projected.min() - 1e-10) &
                   (centre_projection - reach <= projected.max() + 1e-10))
    return xx[inside], yy[inside]


def fill_chart_coverage(obj, pixels, settings):
    """Fill required alpha-zero texels in-place and return JSON-ready evidence.

    Args:
        obj: Original triangulated Blender atlas object with lightmap UV layer 1.
        pixels: Writable H x W x 4 floating RGBA array, bottom-up and linear.
        settings: {enabled: True, bilinearRadiusPixels: 1.02}. Optional
            maxDistancePixels rejects excessive extension rather than truncating
            it. The default has no distance cap; measured distances are reported.

    Seeds are original alpha-positive pixels strictly inside the same UV chart.
    Filling is planned fully before writing, so a missing seed, ambiguous chart,
    or configured distance failure cannot partially mutate the caller's array.
    Neither the Blender object nor its materials or UVs are changed.
    """
    started = time.monotonic()
    if not settings.get('enabled', True):
        return {'enabled': False, 'filledTexels': 0, 'seconds': 0.0}
    if not isinstance(pixels, np.ndarray) or pixels.ndim != 3 or pixels.shape[2] != 4:
        raise ValueError('Chart padding requires an H x W x 4 numpy RGBA array')
    if pixels.dtype.kind != 'f' or not pixels.flags.writeable or not np.isfinite(pixels).all():
        raise ValueError('Chart padding requires writable finite floating-point RGBA')
    if np.any(pixels[:, :, 3] < 0):
        raise ValueError('Chart padding cannot interpret negative alpha coverage')
    radius = float(settings.get('bilinearRadiusPixels', 1.02))
    max_distance = float(settings.get('maxDistancePixels', math.inf))
    if not math.isfinite(radius) or radius < 1:
        raise ValueError('bilinearRadiusPixels must be finite and at least 1')
    if max_distance <= 0 or math.isnan(max_distance):
        raise ValueError('maxDistancePixels must be positive')
    mesh = obj.data
    if len(mesh.uv_layers) < 2 or any(face.loop_total != 3 for face in mesh.polygons):
        raise ValueError('Chart padding requires triangulated geometry with UV layer 1')
    values = np.empty(len(mesh.loops) * 2, np.float32)
    mesh.uv_layers[1].data.foreach_get('uv', values)
    uv = values.reshape(-1, 3, 2).astype(np.float64)
    if not np.isfinite(uv).all() or uv.min(initial=0) < 0 or uv.max(initial=0) > 1:
        raise ValueError('Chart padding requires finite UVs within the atlas')
    labels = island_labels(mesh, values.reshape(-1, 2)).reshape(-1, 3)[:, 0]
    chart_count = int(labels.max(initial=-1)) + 1
    material_names = [_material_name(material) for material in mesh.materials]
    excluded_materials = {i for i, name in enumerate(material_names)
                          if name.startswith('ME_') or name.startswith('MU_decal_')}
    material_ids = np.empty(len(mesh.polygons), np.int32)
    mesh.polygons.foreach_get('material_index', material_ids)
    eligible = ~np.isin(material_ids, list(excluded_materials))
    active_charts = np.unique(labels[eligible])
    height, width = pixels.shape[:2]
    triangles = uv * [width, height]
    original_covered = pixels[:, :, 3] > 0
    uncovered = ~original_covered
    seed_owner = np.full((height, width), -1, np.int32)
    required_owner = np.full((height, width), -1, np.int32)
    for face in np.flatnonzero(eligible):
        triangle, chart = triangles[face], int(labels[face])
        xx, yy = _interior_pixels(triangle, width, height)
        valid = original_covered[yy, xx]
        xx, yy = xx[valid], yy[valid]
        previous = seed_owner[yy, xx]
        if np.any((previous >= 0) & (previous != chart)):
            raise ValueError(f'{obj.name}: different charts have overlapping interior bake samples')
        seed_owner[yy, xx] = chart
        xx, yy = _uncovered_support(triangle, uncovered, radius)
        previous = required_owner[yy, xx]
        if np.any((previous >= 0) & (previous != chart)):
            conflicts = np.unique(previous[(previous >= 0) & (previous != chart)]).tolist()
            raise ValueError(f'{obj.name}: required uncovered support of chart {chart} overlaps charts {conflicts}')
        required_owner[yy, xx] = chart
    seed_counts = np.bincount(seed_owner[seed_owner >= 0], minlength=chart_count)
    missing = active_charts[seed_counts[active_charts] == 0]
    if len(missing):
        raise ValueError(f'{obj.name}: UV charts have no original interior bake seed: {missing.tolist()}')
    fill_flat = np.flatnonzero(required_owner.ravel() >= 0)
    fill_labels = required_owner.ravel()[fill_flat]
    source_flat = np.empty(len(fill_flat), np.int64)
    details = []
    largest_distance = 0.0
    for chart in np.unique(fill_labels):
        seeds = np.flatnonzero(seed_owner.ravel() == chart)
        target_indices = np.flatnonzero(fill_labels == chart)
        tree = KDTree(len(seeds))
        for index, flat in enumerate(seeds):
            tree.insert((int(flat % width) + .5, int(flat // width) + .5, 0), index)
        tree.balance()
        chart_max = 0.0
        for target in target_indices:
            flat = int(fill_flat[target])
            _, nearest, distance = tree.find((flat % width + .5, flat // width + .5, 0))
            if distance > max_distance:
                raise ValueError(f'{obj.name}: chart {int(chart)} needs {distance:.3f}px extension, above configured limit')
            source_flat[target] = seeds[nearest]
            chart_max = max(chart_max, float(distance))
        largest_distance = max(largest_distance, chart_max)
        details.append({'chart': int(chart), 'seedTexels': len(seeds),
                        'filledTexels': len(target_indices), 'maxDistancePixels': chart_max})
    # Only original alpha-zero pixels are assigned. Sources always refer to the
    # immutable original interior samples, never to pixels filled in this pass.
    target_y, target_x = np.divmod(fill_flat, width)
    source_y, source_x = np.divmod(source_flat, width)
    if not np.all(uncovered[target_y, target_x]) or not np.all(original_covered[source_y, source_x]):
        raise AssertionError('Chart padding attempted to overwrite a bake sample or propagate a filled pixel')
    pixels[target_y, target_x] = pixels[source_y, source_x]
    if np.any(pixels[target_y, target_x, 3] <= 0):
        raise AssertionError('Chart padding left required bilinear support uncovered')
    return {'enabled': True, 'method': 'same-chart nearest original interior sample; conservative triangle-square support',
            'orientation': 'bottom-up', 'bilinearRadiusPixels': radius,
            'maxDistanceLimitPixels': max_distance if math.isfinite(max_distance) else None,
            'chartCount': chart_count, 'eligibleChartCount': len(active_charts), 'filledChartCount': len(details),
            'filledTexels': len(fill_flat), 'originalBakedTexels': int(original_covered.sum()),
            'preservedBakedTexels': int(original_covered.sum()), 'interiorSeedTexels': int(seed_counts.sum()),
            'minimumChartSeedTexels': int(seed_counts[active_charts].min()) if len(active_charts) else 0,
            'maxDistancePixels': largest_distance, 'zeroSeedCharts': 0, 'remainingRequiredAlphaZeroTexels': 0,
            'excludedTriangles': int(np.count_nonzero(~eligible)),
            'excludedMaterials': sorted(material_names[i] for i in excluded_materials),
            'charts': details, 'seconds': time.monotonic() - started}

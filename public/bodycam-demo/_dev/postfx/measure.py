#!/usr/bin/env python3
"""Pixelpruefung der C5-Diagnosebilder, ohne Anpassung des Looks.

python3 public/bodycam-demo/_dev/postfx/measure.py --strict
Eingaben: <work>/qa/{mask,lens,osd,overlay,still,spin,dark,muzzle}.png,
optional params.json und overlay.json. Alle Ausgaben bleiben in <work>/qa.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


DEFAULT_WORK = Path('/Users/logge/Documents/Projects/bodycam-work/codex/C5')
DEFAULT_REFERENCES = Path('/Users/logge/Documents/Projects/bodycam-work/ref/frames')
DEFAULTS = {
    'lens': {
        'enabled': True, 'k1': 0.06, 'k2': 0.01, 'overscan': 1.06,
        'caR': 0.0012, 'caB': -0.0015,
        'mask': {
            'enabled': True, 'a': 0.5375, 'b': 0.7335,
            'rimInner': 0.94, 'rimOuter': 1.05, 'innerVignette': 0.08,
            'outside': [0.17, 0.19, 0.20],
            'radii': [0.90, 0.94, 0.97, 0.99, 1.01, 1.03, 1.05, 1.08],
            'profile': [[1, 1, 1], [0.99, 0.98, 0.97], [0.95, 0.90, 0.81],
                        [0.83, 0.69, 0.53], [0.55, 0.41, 0.32],
                        [0.32, 0.26, 0.26], [0.22, 0.22, 0.23]],
        },
    },
}
SAMPLE_RADII = [0.0, 0.90, 0.94, 0.97, 0.99, 1.01, 1.03, 1.05, 1.08]
REQUIRED_IMAGES = ['mask', 'lens', 'osd', 'still', 'spin', 'dark', 'muzzle']


def merge(target, update):
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            merge(target[key], value)
        else:
            target[key] = value
    return target


def load_json(path):
    return json.loads(path.read_text()) if path.exists() else None


def read_rgb(path):
    with Image.open(path) as image:
        return np.asarray(image.convert('RGB'), dtype=np.float32)


def uv_grid(width, height):
    # PNG rows are top-down; vUv in the GLSL fullscreen triangle is bottom-up.
    u = (np.arange(width, dtype=np.float64)[None, :] + 0.5) / width
    v = 1.0 - (np.arange(height, dtype=np.float64)[:, None] + 0.5) / height
    return u, v


def source_uv(width, height, lens):
    u, v = uv_grid(width, height)
    dx, dy = u - 0.5, v - 0.5
    r2 = (dx * 2.0) ** 2 + (dy * 2.0 * height / width) ** 2
    enabled = lens.get('enabled', True)
    k1, k2 = (lens['k1'], lens['k2']) if enabled else (0.0, 0.0)
    overscan = lens['overscan'] if enabled else 1.0
    gain = (1.0 + k1 * r2 + k2 * r2 * r2) / max(overscan, 0.0001)
    return 0.5 + dx * gain, 0.5 + dy * gain, r2


def mask_profile(rho, mask):
    if not mask.get('enabled', True):
        return np.ones(rho.shape + (3,), dtype=np.float32)
    radii = np.asarray(mask['radii'], dtype=np.float64)
    profile = np.asarray(mask['profile'], dtype=np.float64)
    outside = np.asarray(mask['outside'], dtype=np.float64)
    if radii.shape != (8,) or profile.shape != (7, 3) or np.any(np.diff(radii) <= 0):
        raise ValueError('Die Maske erwartet acht aufsteigende Radien und sieben RGB-Stuetzstellen.')
    r = np.where(rho > 0.90, 0.94 + 0.11 * (rho - mask['rimInner']) /
                 max(mask['rimOuter'] - mask['rimInner'], 0.0001), rho)
    t = np.clip(r / max(radii[0], 0.0001), 0, 1)
    smooth = t * t * (3 - 2 * t)
    center = 1 + np.asarray([1, 0.75, 1]) * mask['innerVignette']
    output = np.empty(rho.shape + (3,), dtype=np.float32)
    for channel in range(3):
        samples = np.append(profile[:, channel], outside[channel])
        values = np.interp(r, radii, samples)
        output[..., channel] = np.where(r <= radii[0],
            center[channel] * (1 - smooth) + profile[0, channel] * smooth, values)
    return output


def measure_mask(path, params):
    rgb = read_rgb(path)
    height, width = rgb.shape[:2]
    u, v = uv_grid(width, height)
    mask = params['lens']['mask']
    rho = np.sqrt(((u - 0.5) / mask['a']) ** 2 + ((v - 0.5) / mask['b']) ** 2)
    expected = mask_profile(rho, mask)
    measured = rgb / 127.5
    difference = np.abs(measured - expected)
    tolerance = 0.012
    rows = []
    for radius in SAMPLE_RADII:
        selected = np.abs(rho - radius) <= 0.001
        count = int(np.count_nonzero(selected))
        if not count:
            rows.append({'rho': radius, 'samples': 0, 'status': 'unavailable'})
            continue
        actual = measured[selected].mean(axis=0, dtype=np.float64)
        target = expected[selected].mean(axis=0, dtype=np.float64)
        error = float(difference[selected].max())
        rows.append({'rho': radius, 'samples': count,
                     'mean_sample_rho': float(rho[selected].mean()),
                     'measured_rgb': actual.tolist(), 'expected_rgb': target.tolist(),
                     'max_error': error, 'status': 'pass' if error <= tolerance else 'fail'})
    max_error = float(difference.max())
    return {
        'status': 'pass' if max_error <= tolerance and all(row['samples'] for row in rows) else 'fail',
        'width': width, 'height': height, 'ratio_denominator': 127.5,
        'tolerance': tolerance, 'max_error': max_error,
        'mean_error': float(difference.mean(dtype=np.float64)),
        'p99_error': float(np.quantile(difference, 0.99)), 'samples': rows,
    }


def measure_lens(path, params):
    rgb = read_rgb(path)
    height, width = rgb.shape[:2]
    expected_x, expected_y, _ = source_uv(width, height, params['lens'])
    actual_x = (rgb[..., 0] * 256.0 + rgb[..., 1]) / 65535.0
    actual_y = rgb[..., 2] / 255.0
    valid_x = (expected_x >= 0) & (expected_x <= 1)
    valid_y = (expected_y >= 0) & (expected_y <= 1)
    error_x = np.abs(actual_x - expected_x) * width
    error_y = np.abs(actual_y - expected_y) * height
    x_tolerance = 0.08
    y_tolerance = height / (2 * 255) + 0.08
    max_x = float(error_x[valid_x].max())
    max_y = float(error_y[valid_y].max())
    samples = []
    for nx, ny in [(0.5, 0.5), (0.1, 0.5), (0.9, 0.5), (0.1, 0.1), (0.9, 0.1), (0.5, 0.9)]:
        x, y = min(width - 1, int(nx * width)), min(height - 1, int(ny * height))
        samples.append({'pixel': [x, y], 'source_uv': [float(expected_x[y, x]), float(expected_y[y, x])],
                        'decoded_uv': [float(actual_x[y, x]), float(actual_y[y, x])],
                        'x_error_px': float(error_x[y, x]), 'y_error_px': float(error_y[y, x])})
    return {
        'status': 'pass' if max_x <= x_tolerance and max_y <= y_tolerance else 'fail',
        'encoding': 'R/G = source-u high/low byte, B = source-v unsigned 8 bit',
        'width': width, 'height': height,
        'x_quantization_half_step_px': width / (2 * 65535),
        'y_quantization_half_step_px': height / (2 * 255),
        'x_tolerance_px': x_tolerance, 'y_tolerance_px': y_tolerance,
        'max_x_error_px': max_x, 'p99_x_error_px': float(np.quantile(error_x[valid_x], 0.99)),
        'mean_x_error_px': float(error_x[valid_x].mean()), 'max_y_error_px': max_y,
        'clipped_x_pixels': int(np.count_nonzero(~valid_x)),
        'clipped_y_pixels': int(np.count_nonzero(~valid_y)), 'samples': samples,
    }


def linear(rgb):
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)


def srgb(rgb):
    rgb = np.maximum(rgb, 0)
    return np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - 0.055)


def bilinear(plane, u, v):
    height, width = plane.shape
    x = np.clip(u * width - 0.5, 0, width - 1)
    y = np.clip((1 - v) * height - 0.5, 0, height - 1)
    x0, y0 = np.floor(x).astype(np.intp), np.floor(y).astype(np.intp)
    x1, y1 = np.minimum(x0 + 1, width - 1), np.minimum(y0 + 1, height - 1)
    tx, ty = x - x0, y - y0
    return ((plane[y0, x0] * (1 - tx) + plane[y0, x1] * tx) * (1 - ty) +
            (plane[y1, x0] * (1 - tx) + plane[y1, x1] * tx) * ty)


def bbox(mask):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    x, y, right, bottom = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    return {'x': x, 'y': y, 'width': right - x, 'height': bottom - y, 'right': right, 'bottom': bottom}


def read_overlay_metrics(path):
    value = load_json(path) or {}
    for key in ['overlay', 'metrics']:
        if isinstance(value.get(key), dict):
            value = value[key]
    return value


def measure_osd(path, source_path, params, metrics_path, qa):
    rgb = read_rgb(path)
    height, width = rgb.shape[:2]
    metrics = read_overlay_metrics(metrics_path)
    threshold = 8.0
    support = rgb.max(axis=2) >= threshold
    top = np.arange(height)[:, None] < height * 0.35
    left = np.arange(width)[None, :] < width * 0.5
    regions = {'left': top & left, 'right': top & ~left}
    result = {'status': 'partial', 'width': width, 'height': height,
              'support_threshold_8bit': threshold, 'source_metrics': metrics,
              'note': 'Glyphen vor schwarzem Hintergrund, Schaerfung 0; Debug3 umgeht Maske/Rauschen.',
              'blocks': {name: {'measured_bounds': bbox(support & region)} for name, region in regions.items()}}
    if not source_path.exists():
        result['note'] += ' overlay.png fehlt; keine Konturvorhersage und keine bestandene OSD-Abnahme.'
        return result
    with Image.open(source_path) as image:
        source = np.asarray(image.convert('RGBA'), dtype=np.float32) / 255.0
    source_height, source_width = source.shape[:2]
    source_support = (source[..., :3].max(axis=2) > 0) & (source[..., 3] > 0)
    source_top = np.arange(source_height)[:, None] < source_height * 0.35
    source_left = np.arange(source_width)[None, :] < source_width * 0.5
    source_bounds = {'left': bbox(source_support & source_top & source_left),
                     'right': bbox(source_support & source_top & ~source_left)}
    osd_params = params.get('osd', {})
    scale = source_height / 1080
    anchor_left = osd_params.get('left', [100, 95])
    target_left_x = round(anchor_left[0] * scale)
    target_top = round(anchor_left[1] * scale)
    target_right_x = round(source_width - (1920 - osd_params.get('rightEdge', 1790)) * scale)
    anchor_error = None
    if source_bounds['left'] and source_bounds['right']:
        anchor_error = max(abs(source_bounds['left']['x'] - target_left_x),
                           abs(source_bounds['left']['y'] - target_top),
                           abs(source_bounds['right']['right'] - target_right_x),
                           abs(source_bounds['right']['y'] - target_top))
    result['source_blocks'] = source_bounds
    result['source_target_anchors'] = {'left_x': target_left_x, 'top': target_top, 'right_edge': target_right_x}
    result['source_anchor_max_error_px'] = anchor_error
    # CanvasTexture is sRGB, blended over black in linear space before lens/CA.
    premultiplied = linear(source[..., :3]) * source[..., 3:4]
    u, v, r2 = source_uv(width, height, params['lens'])
    predicted = np.empty_like(rgb)
    enabled = params['lens'].get('enabled', True)
    ca = [params['lens']['caR'], 0.0, params['lens']['caB']] if enabled else [0, 0, 0]
    for channel in range(3):
        shifted_u = u + (u - 0.5) * ca[channel] * r2
        shifted_v = v + (v - 0.5) * ca[channel] * r2
        predicted[..., channel] = srgb(bilinear(premultiplied[..., channel], shifted_u, shifted_v)) * 255
    predicted_support = predicted.max(axis=2) >= threshold
    errors = np.abs(predicted - rgb)
    active = support | predicted_support
    contour_union = int(np.count_nonzero(active))
    contour_intersection = int(np.count_nonzero(support & predicted_support))
    iou = contour_intersection / max(contour_union, 1)
    mean_error = float(errors[active].mean()) if contour_union else None
    bounds_ok = True
    for name, region in regions.items():
        block = result['blocks'][name]
        expected = bbox(predicted_support & region)
        block['expected_bounds'] = expected
        observed = block['measured_bounds']
        if expected is None or observed is None:
            block['max_edge_error_px'] = None
            bounds_ok = False
        else:
            edge_error = max(abs(observed[key] - expected[key]) for key in ['x', 'y', 'right', 'bottom'])
            block['max_edge_error_px'] = edge_error
            bounds_ok &= edge_error <= 2
    result.update({
        'status': 'pass' if bounds_ok and anchor_error is not None and anchor_error <= 1 and
                           iou >= 0.97 and mean_error is not None and mean_error <= 3 else 'fail',
        'source_image_size': [int(source.shape[1]), int(source.shape[0])],
        'contour_iou': iou, 'contour_iou_minimum': 0.97,
        'active_pixels': contour_union, 'active_mean_error_8bit': mean_error,
        'active_p99_error_8bit': float(np.quantile(errors[active], 0.99)) if contour_union else None,
        'max_error_8bit': float(errors.max()), 'edge_tolerance_px': 2,
    })
    Image.fromarray(np.clip(np.rint(predicted), 0, 255).astype(np.uint8)).save(qa / 'osd-predicted.png')
    Image.fromarray(np.clip(errors * 8, 0, 255).astype(np.uint8)).save(qa / 'osd-difference-x8.png')
    return result


def contact_sheet(qa, references):
    pairs = [('still', 'Ruhe / OSD', 1), ('spin', 'Drehung', 45),
             ('dark', 'Dunkelheit / Bloecke', 37), ('muzzle', 'Muendungsfeuer', 28)]
    tile_width, tile_height, label_height, margin = 640, 360, 30, 12
    sheet = Image.new('RGB', (2 * tile_width + 3 * margin,
                             len(pairs) * (tile_height + label_height + margin) + margin), '#17191c')
    drawing = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for font_path in ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']:
        if Path(font_path).exists():
            font = ImageFont.truetype(font_path, 17)
            break
    rows = []
    for row, (name, label, reference_id) in enumerate(pairs):
        matches = sorted(references.glob(f'ref_{reference_id:02d}_*'))
        reference = matches[0] if matches else None
        demo = qa / f'{name}.png'
        y = margin + row * (tile_height + label_height + margin)
        for column, image_path in enumerate([demo, reference]):
            x = margin + column * (tile_width + margin)
            prefix = 'Demo' if column == 0 else f'Referenz {reference_id:02d}'
            caption = f'{prefix}: {label}'
            drawing.text((x, y + 5), caption, fill='#e8ecef', font=font)
            if image_path and image_path.exists():
                with Image.open(image_path) as image:
                    tile = ImageOps.pad(image.convert('RGB'), (tile_width, tile_height), color='#0b0d0f')
                sheet.paste(tile, (x, y + label_height))
            else:
                drawing.rectangle((x, y + label_height, x + tile_width - 1,
                                   y + label_height + tile_height - 1), fill='#292c30')
                drawing.text((x + 16, y + label_height + 16), 'Bild fehlt', fill='#e8ecef', font=font)
        rows.append({'demo': str(demo), 'reference': str(reference) if reference else None,
                     'complete': demo.exists() and reference is not None})
    output = qa / 'reference-contact.jpg'
    sheet.save(output, quality=91, subsampling=0)
    return {'status': 'pass' if all(row['complete'] for row in rows) else 'partial',
            'path': str(output), 'pairs': rows,
            'note': 'Unterschiedliche Szenen; Kontaktbogen nur als visuelle Kontrolle, kein Bildaehnlichkeitswert.'}


def triplet(values):
    return '/'.join(f'{value:.4f}' for value in values)


def bounds_label(value):
    return f"x={value['x']}, y={value['y']}, {value['width']}x{value['height']}, rechts={value['right']}" if value else 'fehlt'


def write_markdown(report, path):
    lines = ['# C5 Pixelmessung', '', f"Zeitpunkt: {report['created_at']}", '',
             f"Ergebnis: **{report['status']}**. Pixelzentren und GL-Y-Inversion sind beruecksichtigt.", '',
             f"Eingabe: `{report['qa_directory']}`.", '',
             '## Maskenprofil', '']
    mask = report['mask']
    if mask['status'] == 'missing':
        lines.append('mask.png fehlt.')
    else:
        lines.extend([f"Maximaler RGB-Faktorfehler: {mask['max_error']:.6f}, Toleranz {mask['tolerance']:.3f}.", '',
                      '| rho | Pixel in +/-0.001 | Ist R/G/B | Soll R/G/B im selben Bin | Max. Fehler | Status |',
                      '|---:|---:|---|---|---:|---|'])
        for row in mask['samples']:
            if not row['samples']:
                lines.append(f"| {row['rho']:.2f} | 0 | fehlt | | | unavailable |")
            else:
                lines.append(f"| {row['rho']:.2f} | {row['samples']} | {triplet(row['measured_rgb'])} | "
                             f"{triplet(row['expected_rgb'])} | {row['max_error']:.6f} | {row['status']} |")
    lines.extend(['', '## Linsenverzerrung', ''])
    lens = report['lens']
    if lens['status'] == 'missing':
        lines.append('lens.png fehlt.')
    else:
        lines.extend([f"RG16-X: maximal {lens['max_x_error_px']:.5f}px, p99 {lens['p99_x_error_px']:.5f}px "
                      f"(Toleranz {lens['x_tolerance_px']:.3f}px). B8-Y: maximal {lens['max_y_error_px']:.4f}px "
                      f"(Quantisierung +/-{lens['y_quantization_half_step_px']:.4f}px).", '',
                      f"Ausserhalb [0,1] und aus der Fehlerstatistik ausgeschlossen: X {lens['clipped_x_pixels']} Pixel, "
                      f"Y {lens['clipped_y_pixels']} Pixel.", '',
                      '| PNG-Pixel x/y | Soll source-u/v | Dekodiert u/v | X-Fehler px | Y-Fehler px |',
                      '|---|---|---|---:|---:|'])
        for row in lens['samples']:
            lines.append(f"| {row['pixel'][0]}/{row['pixel'][1]} | {row['source_uv'][0]:.7f}/{row['source_uv'][1]:.7f} | "
                         f"{row['decoded_uv'][0]:.7f}/{row['decoded_uv'][1]:.7f} | {row['x_error_px']:.5f} | {row['y_error_px']:.5f} |")
    lines.extend(['', '## OSD', ''])
    osd = report['osd']
    if osd['status'] == 'missing':
        lines.append('osd.png fehlt.')
    else:
        lines.extend([osd['note'], '', '| Block | Gerenderte AABB | Erwartete AABB nach Linse/CA | Max. Kantenfehler |',
                      '|---|---|---|---:|'])
        for name, block in osd['blocks'].items():
            lines.append(f"| {name} | {bounds_label(block['measured_bounds'])} | {bounds_label(block.get('expected_bounds'))} | "
                         f"{block.get('max_edge_error_px', 'nicht gemessen')} |")
        if 'contour_iou' in osd:
            mean_error = f"{osd['active_mean_error_8bit']:.4f}" if osd['active_mean_error_8bit'] is not None else 'nicht messbar'
            lines.extend(['', f"Kontur-IoU: {osd['contour_iou']:.5f} (Minimum 0.97). Mittlerer RGB-Fehler auf aktiven "
                          f"Pixeln: {mean_error}/255 (Maximum 3/255).",
                          'Vorhersage: `osd-predicted.png`; achtfach verstaerkte Differenz: `osd-difference-x8.png`.'])
        metrics = osd.get('source_metrics', {})
        if 'source_blocks' in osd:
            anchors = osd['source_target_anchors']
            lines.extend(['', '| Canvas vor Linse, direkt aus overlay.png | Gemessene Glyphen-AABB ohne schwarzen Schatten | Sollanker |',
                          '|---|---|---|',
                          f"| left | {bounds_label(osd['source_blocks']['left'])} | x={anchors['left_x']}, y={anchors['top']} |",
                          f"| right | {bounds_label(osd['source_blocks']['right'])} | rechts={anchors['right_edge']}, y={anchors['top']} |", '',
                          f"Maximaler Ankerfehler vor Linse: {osd['source_anchor_max_error_px']}px (Toleranz 1px)."])
        if metrics:
            lines.extend(['', f"Versalhoehe aus Canvas-Schriftmetriken: {metrics.get('capPx', 'nicht vorhanden')}px; Schriftstatus: "
                          f"{metrics.get('fontStatus', 'nicht vorhanden')}."])
    lines.extend(['', '## Referenzkontaktbogen', '', '`reference-contact.jpg`: Demo und die Referenzen 01/45/37/28.',
                  report['contact']['note'], '', '## Reproduktion', '', '```sh', report['command'], '```', '',
                  'Die JSON-Datei enthaelt Eingabe-Hashes, Parameter, Messwerte und Grenzwerte. '
                  'Ohne overlay.png bleibt die OSD-Abnahme partial; fehlende Bilder werden nie als bestanden gewertet.', ''])
    if report['missing_images']:
        lines.extend(['Fehlende Pflichtbilder: ' + ', '.join(report['missing_images']) + '.', ''])
    path.write_text('\n'.join(lines))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, default=DEFAULT_WORK)
    parser.add_argument('--references', type=Path, default=DEFAULT_REFERENCES)
    parser.add_argument('--strict', action='store_true', help='Exitcode 1, sobald eine Pflichtpruefung nicht pass ist.')
    args = parser.parse_args()
    qa = args.work / 'qa'
    qa.mkdir(parents=True, exist_ok=True)
    params_file = load_json(qa / 'params.json') or {}
    params = merge(copy.deepcopy(DEFAULTS), params_file.get('params', params_file))
    missing = [f'{name}.png' for name in REQUIRED_IMAGES if not (qa / f'{name}.png').exists()]
    report = {'created_at': datetime.now(timezone.utc).isoformat(), 'qa_directory': str(qa),
              'parameters': params, 'parameter_source': 'params.json' if params_file else 'STYLE defaults',
              'missing_images': missing, 'inputs': {}}
    for name in REQUIRED_IMAGES + ['overlay']:
        path = qa / f'{name}.png'
        if path.exists():
            with Image.open(path) as image:
                size = list(image.size)
            report['inputs'][path.name] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'size': size}
    report['mask'] = measure_mask(qa / 'mask.png', params) if (qa / 'mask.png').exists() else {'status': 'missing'}
    report['lens'] = measure_lens(qa / 'lens.png', params) if (qa / 'lens.png').exists() else {'status': 'missing'}
    report['osd'] = measure_osd(qa / 'osd.png', qa / 'overlay.png', params, qa / 'overlay.json', qa) \
        if (qa / 'osd.png').exists() else {'status': 'missing'}
    report['contact'] = contact_sheet(qa, args.references)
    statuses = [report[name]['status'] for name in ['mask', 'lens', 'osd', 'contact']]
    report['status'] = 'fail' if 'fail' in statuses else ('partial' if missing or any(value != 'pass' for value in statuses) else 'pass')
    report['command'] = f'python3 public/bodycam-demo/_dev/postfx/measure.py --work "{args.work}" --references "{args.references}" --strict'
    (qa / 'measurements.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    write_markdown(report, qa / 'measurements.md')
    print(json.dumps({'status': report['status'], **{name: report[name]['status'] for name in ['mask', 'lens', 'osd', 'contact']},
                      'report': str(qa / 'measurements.md')}, ensure_ascii=False))
    return 1 if args.strict and report['status'] != 'pass' else 0


if __name__ == '__main__':
    raise SystemExit(main())

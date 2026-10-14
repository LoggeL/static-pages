#!/usr/bin/env python3
"""Unabhaengige Pixelpruefung des realen GPU-Fixtures aus behavior.mjs.

python3 public/bodycam-demo/_dev/postfx/measure_behavior.py --strict
Alle Eingaben und Ausgaben liegen unter <work>/qa. Kein Browser ist erforderlich.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image


DEFAULT_WORK = Path('/Users/logge/Documents/Projects/bodycam-work/codex/C5')
MOTION_NAMES = ['motion-before', 'motion-after', 'motion-reset', 'viewmodel-wall']
NOISE_NAMES = ['noise-a', 'noise-b', 'noise-c']
FIXTURE = {'vertical_fov_deg': 82, 'yaw_step_rad': 0.025, 'dt_sec': 1 / 60,
           'exposure_sec': 0.025, 'world_plane_m': 12, 'world_distance_m': 4,
           'stripe_texture_width': 1024, 'stripe_width_texels': 4,
           'viewmodel_layer': 1, 'wall_z_m': -0.1,
           'noise_times_sec': [40, 40.016, 40.034], 'noise_rate_hz': 30}


def bounds(mask):
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    x, y, right, bottom = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    return {'x': x, 'y': y, 'width': right - x, 'height': bottom - y, 'right': right, 'bottom': bottom}


def intervals(mask):
    edges = np.diff(np.r_[False, mask, False].astype(np.int8))
    return list(zip(np.flatnonzero(edges == 1).tolist(), np.flatnonzero(edges == -1).tolist()))


def world_profile(rgb):
    height, width = rgb.shape[:2]
    half_band = max(2, round(height * 0.006))
    y0, y1 = height // 2 - half_band, height // 2 + half_band
    # White contributes in all channels; the magenta layer-1 marker has no green.
    profile = rgb[y0:y1].min(axis=2).mean(axis=0, dtype=np.float64)
    peak = float(profile.max())
    result = {'band_y': [y0, y1], 'peak_8bit': peak, 'component_count': 0,
              'support_width_px': 0, 'fwhm_px': 0, 'centroid_x': None}
    if peak <= 4:
        return result
    threshold = max(4.0, peak * 0.02)
    segments = intervals(profile >= threshold)
    result['component_count'] = len(segments)
    if not segments:
        return result
    x0, x1 = max(segments, key=lambda pair: float(profile[pair[0]:pair[1]].sum()))
    weights = profile[x0:x1]
    xs = np.arange(x0, x1) + 0.5
    centroid = float(np.dot(xs, weights) / weights.sum())
    fwhm = int(np.count_nonzero(weights >= peak * 0.5))
    lo, hi = max(0, x0 - 2), min(width, x1 + 2)
    result.update({'support_threshold_8bit': threshold, 'support_x': [x0, x1],
                   'support_width_px': x1 - x0, 'fwhm_px': fwhm, 'centroid_x': centroid,
                   'sigma_px': float(np.sqrt(np.dot((xs - centroid) ** 2, weights) / weights.sum())),
                   'profile_samples': [[index, float(profile[index])] for index in range(lo, hi)]})
    return result


def measure_motion(images):
    measured = {name: world_profile(images[name]) for name in MOTION_NAMES}
    height, width = images['motion-before'].shape[:2]
    focal = height / (2 * math.tan(math.radians(FIXTURE['vertical_fov_deg']) / 2))
    displacement = focal * math.tan(FIXTURE['yaw_step_rad'])
    shutter_span = displacement * FIXTURE['exposure_sec'] / FIXTURE['dt_sec']
    stripe_world_width = FIXTURE['world_plane_m'] * FIXTURE['stripe_width_texels'] / FIXTURE['stripe_texture_width']
    geometric_width = focal * stripe_world_width / FIXTURE['world_distance_m']
    before, after, reset = [measured[name] for name in MOTION_NAMES[:3]]
    support_growth = after['support_width_px'] - reset['support_width_px']
    expected_reset_center = width * 0.5 + displacement
    centers_present = before['centroid_x'] is not None and reset['centroid_x'] is not None
    checks = {
        'single_white_bar': all(measured[name]['component_count'] == 1 for name in MOTION_NAMES[:3]),
        'before_center_matches_projection': centers_present and abs(before['centroid_x'] - width * 0.5) <= 1,
        'reset_center_matches_positive_threejs_yaw': centers_present and abs(reset['centroid_x'] - expected_reset_center) <= 1,
        'motion_fwhm_at_least_double_static': after['fwhm_px'] >= 2 * max(before['fwhm_px'], reset['fwhm_px'], 1),
        # Sampling and the nonlinear grade make the width approximate; this still requires a large, physically sized blur.
        'support_growth_matches_shutter': 0.75 * shutter_span <= support_growth <= 1.25 * shutter_span,
        'history_reset_restores_static_width': abs(reset['fwhm_px'] - before['fwhm_px']) <= 2,
        'near_wall_removes_world_bar': measured['viewmodel-wall']['peak_8bit'] <= 1,
    }
    return {'status': 'pass' if all(checks.values()) else 'fail', 'checks': checks,
            'focal_px': focal, 'expected_yaw_displacement_px': displacement,
            'expected_static_centers_x': [width * 0.5, expected_reset_center],
            'expected_full_shutter_span_px': shutter_span, 'measured_support_growth_px': support_growth,
            'projected_geometric_stripe_width_px': geometric_width, 'profiles': measured,
            'limits': {'centroid_error_px': 1, 'reset_fwhm_difference_px': 2,
                       'minimum_fwhm_broadening_factor': 2, 'support_growth_to_shutter_range': [0.75, 1.25]},
            'note': 'Positive rotation.y dreht die Kamera nach links; die Weltlinie wandert im Bild nach rechts. '
                    'Die statische Pixelbreite variiert durch Subpixelphase und Filterung. '
                    'Die 25-ms-Belichtung wird aus dt=1/60 s und der gemessenen Geometrie geprueft.'}


def marker_mask(rgb):
    red, green, blue = (rgb[..., channel].astype(np.int16) for channel in range(3))
    return (red > 32) & (blue > 32) & (green < np.minimum(red, blue) * 0.25)


def measure_viewmodel(images):
    masks = {name: marker_mask(images[name]) for name in MOTION_NAMES}
    measured = {name: {'bounds': bounds(mask), 'pixels': int(mask.sum())} for name, mask in masks.items()}
    reference = masks['motion-before']
    reference_bounds = measured['motion-before']['bounds']
    height, width = reference.shape
    checks = {'magenta_marker_detected': reference_bounds is not None and int(reference.sum()) >= 100}
    differences = {}
    if reference_bounds:
        checks['marker_in_lower_right_quadrant'] = reference_bounds['x'] > width / 2 and reference_bounds['y'] > height / 2
        union = np.logical_or.reduce(list(masks.values()))
        roi = bounds(union)
        # Include the antialiased fringe and surrounding black pixels, not just solid magenta.
        x0, y0 = max(0, roi['x'] - 2), max(0, roi['y'] - 2)
        x1, y1 = min(width, roi['right'] + 2), min(height, roi['bottom'] + 2)
        base = images['motion-before'][y0:y1, x0:x1].astype(np.int16)
        for name in MOTION_NAMES[1:]:
            current = masks[name]
            delta = np.abs(images[name][y0:y1, x0:x1].astype(np.int16) - base)
            changed_contour_pixels = int(np.count_nonzero(reference ^ current))
            changed_color_pixels = int(np.count_nonzero(np.any(delta != 0, axis=2)))
            differences[name] = {'changed_contour_pixels': changed_contour_pixels,
                                 'changed_color_pixels_in_padded_roi': changed_color_pixels,
                                 'max_rgb_error_8bit': int(delta.max()), 'roi': [x0, y0, x1, y1]}
            checks[f'{name}_contour_identical'] = changed_contour_pixels == 0
            checks[f'{name}_rgb_appearance_identical'] = changed_color_pixels == 0
    # A black world plane in front of the camera leaves no white/green world contribution.
    checks['wall_frame_has_no_world_green'] = int(images['viewmodel-wall'][..., 1].max()) == 0
    return {'status': 'pass' if all(checks.values()) else 'fail', 'checks': checks,
            'markers': measured, 'comparisons_to_before': differences,
            'note': 'Magenta wird ohne feste Koordinaten im gesamten Bild erkannt. Kontur und RGB-Pixel '
                    'im um 2px erweiterten Markerbereich muessen exakt gleich bleiben, auch vor der schwarzen Wand.'}


def measure_noise(images):
    a, b, c = (images[name] for name in NOISE_NAMES)
    ab = np.abs(a.astype(np.int16) - b.astype(np.int16))
    ac = c.astype(np.int16) - a.astype(np.int16)
    changed_ab = int(np.count_nonzero(np.any(ab != 0, axis=2)))
    changed_ac = int(np.count_nonzero(np.any(ac != 0, axis=2)))
    count = a.shape[0] * a.shape[1]
    ratio = changed_ac / count
    mean_shift = ac.mean(axis=(0, 1), dtype=np.float64)
    rmse = float(np.sqrt(np.mean(ac.astype(np.float64) ** 2)))
    ticks = [math.floor(time * FIXTURE['noise_rate_hz']) for time in FIXTURE['noise_times_sec']]
    checks = {
        'first_two_times_have_same_30hz_tick': ticks[0] == ticks[1] and ticks[2] == ticks[0] + 1,
        'same_tick_pixel_identical': changed_ab == 0,
        'next_tick_changes_at_least_80_percent_pixels': ratio >= 0.8,
        'next_tick_has_measurable_variance': rmse >= 0.5,
        'change_has_no_global_brightness_step': float(np.abs(mean_shift).max()) <= 0.05,
    }
    return {'status': 'pass' if all(checks.values()) else 'fail', 'checks': checks,
            'times_sec': FIXTURE['noise_times_sec'], 'ticks': ticks, 'pixel_count': count,
            'a_b_changed_pixels': changed_ab, 'a_b_max_error_8bit': int(ab.max()),
            'a_b_rmse_8bit': float(np.sqrt(np.mean(ab.astype(np.float64) ** 2))),
            'a_c_changed_pixels': changed_ac, 'a_c_changed_fraction': ratio,
            'a_c_mean_absolute_error_8bit': float(np.abs(ac).mean(dtype=np.float64)),
            'a_c_rmse_8bit': rmse, 'a_c_mean_rgb_shift_8bit': mean_shift.tolist(),
            'limits': {'held_frame_pixel_error': 0, 'next_tick_min_changed_fraction': 0.8,
                       'next_tick_min_rmse_8bit': 0.5, 'max_abs_mean_rgb_shift_8bit': 0.05},
            'note': 'Der gehaltene Frame wird bytegenau verglichen. Beim Tickwechsel muss ein grosser Teil '
                    'der Bildpixel wechseln, ohne messbaren globalen Helligkeitssprung.'}


def write_markdown(report, path):
    lines = ['# C5 Kontrollfixture: Pixelmessungen', '', f"Ergebnis: **{report['status']}**.", '',
             f"Zeitpunkt: {report['created_at']}. Capture vollstaendig: {'ja' if report['capture_complete'] else 'nein'}.", '']
    if report['missing_images']:
        lines.append('Fehlende Bilder: ' + ', '.join(report['missing_images']) + '.')
    if 'motion' in report:
        result = report['motion']
        lines.extend(['## Kamera-Bewegungsunschaerfe', '',
                      '| Bild | Supportbreite px | Halbwertsbreite px | Schwerpunkt x | Spitzenwert /255 |',
                      '|---|---:|---:|---:|---:|'])
        for name, row in result['profiles'].items():
            center = f"{row['centroid_x']:.4f}" if row['centroid_x'] is not None else 'keine Linie'
            lines.append(f"| {name} | {row['support_width_px']} | {row['fwhm_px']} | {center} | {row['peak_8bit']:.2f} |")
        lines.extend(['', f"Sollverschiebung bei +0.025rad Yaw: +{result['expected_yaw_displacement_px']:.4f}px. "
                      f"Soll-Schwerpunkte: {result['expected_static_centers_x'][0]:.4f} und {result['expected_static_centers_x'][1]:.4f}px.", '',
                      f"Belichtungsweg bei 25ms: {result['expected_full_shutter_span_px']:.4f}px; "
                      f"gemessene zusaetzliche Supportbreite: {result['measured_support_growth_px']}px.", '', result['note'], '',
                      'Grenzen: mindestens doppelte Halbwertsbreite, 75-125% des berechneten Belichtungswegs als Supportzuwachs, '
                      'maximal 2px Unterschied der statischen Halbwertsbreiten und 1px Schwerpunktfehler.', ''])
    if 'viewmodel' in report:
        result = report['viewmodel']
        lines.extend(['## Viewmodel und nahe Weltwand', '',
                      '| Bild | Magenta-Pixel | AABB x/y/breite/hoehe | Geaenderte Konturpixel | Geaenderte RGB-Pixel im ROI |',
                      '|---|---:|---|---:|---:|'])
        for name, row in result['markers'].items():
            b = row['bounds']
            label = f"{b['x']}/{b['y']}/{b['width']}/{b['height']}" if b else 'fehlt'
            diff = result['comparisons_to_before'].get(name, {})
            lines.append(f"| {name} | {row['pixels']} | {label} | {diff.get('changed_contour_pixels', 0)} | "
                         f"{diff.get('changed_color_pixels_in_padded_roi', 0)} |")
        lines.extend(['', result['note'], ''])
    if 'noise' in report:
        result = report['noise']
        lines.extend(['## Rauschen mit 30Hz', '', '| Vergleich | Geaenderte Pixel | Anteil | RMS-Differenz /255 |',
                      '|---|---:|---:|---:|',
                      f"| 40.000s / 40.016s, Tick 1200 | {result['a_b_changed_pixels']} | "
                      f"{result['a_b_changed_pixels'] / result['pixel_count']:.6%} | {result['a_b_rmse_8bit']:.5f} |",
                      f"| 40.000s / 40.034s, Tick 1200/1201 | {result['a_c_changed_pixels']} | "
                      f"{result['a_c_changed_fraction']:.6%} | {result['a_c_rmse_8bit']:.5f} |", '',
                      'Mittlerer RGB-Versatz /255: ' + '/'.join(f'{value:.6f}' for value in result['a_c_mean_rgb_shift_8bit']) + '.', '',
                      result['note'], ''])
    lines.extend(['## Einzelpruefungen', '', '| Pruefung | Ergebnis |', '|---|---|'])
    for section in ['motion', 'viewmodel', 'noise']:
        for name, passed in report.get(section, {}).get('checks', {}).items():
            lines.append(f"| {section}: {name} | {'pass' if passed else 'fail'} |")
    lines.extend(['', '## Reproduktion', '', '```sh', report['command'], '```', '',
                  'Die JSON-Datei enthaelt SHA-256 der Eingaben, Fixture-Parameter, Profilwerte und alle Grenzwerte. '
                  'Eine laufende Capture-Serie oder fehlende Dateien ergeben partial, keinen bestandenen Test.', ''])
    path.write_text('\n'.join(lines))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, default=DEFAULT_WORK)
    parser.add_argument('--strict', action='store_true')
    args = parser.parse_args()
    qa = args.work / 'qa'
    qa.mkdir(parents=True, exist_ok=True)
    names = MOTION_NAMES + NOISE_NAMES
    missing = [name + '.png' for name in names if not (qa / (name + '.png')).exists()]
    images, inputs, mtimes = {}, {}, []
    for name in names:
        path = qa / (name + '.png')
        if not path.exists():
            continue
        with Image.open(path) as image:
            images[name] = np.asarray(image.convert('RGB'))
        inputs[path.name] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                             'size': list(images[name].shape[1::-1])}
        mtimes.append(path.stat().st_mtime)
    if len({image.shape for image in images.values()}) > 1:
        raise ValueError('Die Kontrollbilder muessen dieselbe Pixelgroesse haben.')
    capture_report = qa / 'behavior.json'
    capture_complete = capture_report.exists() and bool(mtimes) and capture_report.stat().st_mtime >= max(mtimes)
    fixture_source = Path(__file__).with_name('behavior.mjs')
    report = {'created_at': datetime.now(timezone.utc).isoformat(), 'qa_directory': str(qa),
              'fixture': FIXTURE, 'inputs': inputs, 'missing_images': missing,
              'capture_complete': capture_complete,
              'capture_report_mtime': datetime.fromtimestamp(capture_report.stat().st_mtime, timezone.utc).isoformat() if capture_report.exists() else None,
              'fixture_source_sha256': hashlib.sha256(fixture_source.read_bytes()).hexdigest() if fixture_source.exists() else None}
    if all(name in images for name in MOTION_NAMES):
        report['motion'] = measure_motion(images)
        report['viewmodel'] = measure_viewmodel(images)
    if all(name in images for name in NOISE_NAMES):
        report['noise'] = measure_noise(images)
    statuses = [report[section]['status'] for section in ['motion', 'viewmodel', 'noise'] if section in report]
    report['status'] = 'fail' if 'fail' in statuses else ('partial' if missing or not capture_complete or len(statuses) != 3 else 'pass')
    report['command'] = f'python3 public/bodycam-demo/_dev/postfx/measure_behavior.py --work "{args.work}" --strict'
    (qa / 'behavior-pixels.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    write_markdown(report, qa / 'behavior-pixels.md')
    print(json.dumps({'status': report['status'], 'capture_complete': capture_complete,
                      **{section: report[section]['status'] for section in ['motion', 'viewmodel', 'noise'] if section in report},
                      'report': str(qa / 'behavior-pixels.md')}, ensure_ascii=False))
    return 1 if args.strict and report['status'] != 'pass' else 0


if __name__ == '__main__':
    raise SystemExit(main())

#!/usr/bin/env python3
"""
Quantitative 15-Shot Visual Diff Benchmark for Kindenheim 3D.
Compares real Google Street View / Satellite captures (data/references/brave/*.png)
against 1440x900 Three.js renders (data/benchmark/<run>/renders/*.png).

Computes UI-masked SSIM, MAE_RGB, CIE76 Lab DeltaE, Sobel Edge Correlation,
optimal Sobel Edge shift (camera alignment error dx/dy px & degrees),
regional DeltaE (Sky / Mid / Ground), and RGB/Lab bias.

Generates 3-panel visual diff strips, amplified error heatmaps,
15-shot contact sheet, metrics.json, and data/benchmark/latest_summary.json.
"""

import argparse
import datetime
import json
import math
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

PROJECT_ROOT = "/Users/logge/Documents/Projects/kindenheim-3d"
REF_DIR = os.path.join(PROJECT_ROOT, "data", "references", "brave")
BENCH_ROOT = os.path.join(PROJECT_ROOT, "data", "benchmark")


def load_font(size: int):
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNS.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def build_ui_mask(w: int, h: int, is_aerial: bool) -> np.ndarray:
    """Boolean mask of PURE scene pixels (True = keep, False = Google Maps chrome)."""
    mask = np.ones((h, w), dtype=bool)
    if is_aerial:
        # Google Maps Satellite chrome (exact 1440x900 layout):
        # Left navigation sidebar
        mask[0:h, 0:76] = False
        # Top search + category pills + Sign-in bar
        mask[0:76, 0:w] = False
        # Top-left "Kindenheim / Light traffic" card
        mask[0:190, 0:495] = False
        # Bottom-left Layers button
        mask[h - 118 : h, 0:182] = False
        # Bottom-right zoom/compass/pegman controls
        mask[h - 160 : h, w - 175 : w] = False
        # Bottom copyright & scale bar
        mask[h - 36 : h, 0:w] = False
    else:
        # Google Street View chrome:
        # Top-left search pill + black address card
        mask[0:232, 0:395] = False
        # Top-right Share + Close buttons
        mask[0:82, w - 190 : w] = False
        # Bottom-left mini-map widget
        mask[h - 148 : h, 0:260] = False
        # Bottom-right compass + zoom + layers
        mask[h - 175 : h, w - 165 : w] = False
        # Bottom watermark & legal bar
        mask[h - 48 : h, 0:w] = False
    return mask


def srgb_to_lab(rgb_u8: np.ndarray) -> np.ndarray:
    """Vectorized exact sRGB [0..255] -> CIE L*a*b* (D65)."""
    rgb = rgb_u8.astype(np.float32) / 255.0
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)

    # sRGB to XYZ (D65)
    x = lin[..., 0] * 0.4124564 + lin[..., 1] * 0.3575761 + lin[..., 2] * 0.1804375
    y = lin[..., 0] * 0.2126729 + lin[..., 1] * 0.7151522 + lin[..., 2] * 0.0721750
    z = lin[..., 0] * 0.0193339 + lin[..., 1] * 0.1191920 + lin[..., 2] * 0.9503041

    # Normalize by D65 white point
    x /= 0.95047
    z /= 1.08883

    eps = 0.008856
    kappa = 903.3
    fx = np.where(x > eps, np.cbrt(x), (kappa * x + 16.0) / 116.0)
    fy = np.where(y > eps, np.cbrt(y), (kappa * y + 16.0) / 116.0)
    fz = np.where(z > eps, np.cbrt(z), (kappa * z + 16.0) / 116.0)

    L = 116.0 * fy - 16.0
    a = 500.0 * (fx - fy)
    b = 200.0 * (fy - fz)
    return np.stack([L, a, b], axis=-1)


def box_blur_2d(arr: np.ndarray, r: int) -> np.ndarray:
    """Fast O(HW) separable box blur with edge padding."""
    k = 2 * r + 1
    # Horizontal
    p = np.pad(arr, ((0, 0), (r, r)), mode="edge")
    cs = np.cumsum(p, axis=1, dtype=np.float64)
    cs = np.pad(cs, ((0, 0), (1, 0)), mode="constant")
    h_blur = (cs[:, k:] - cs[:, :-k]) / k
    # Vertical
    p2 = np.pad(h_blur, ((r, r), (0, 0)), mode="edge")
    cs2 = np.cumsum(p2, axis=0, dtype=np.float64)
    cs2 = np.pad(cs2, ((1, 0), (0, 0)), mode="constant")
    v_blur = (cs2[k:, :] - cs2[:-k, :]) / k
    return v_blur.astype(np.float32)


def compute_ssim(real_rgb: np.ndarray, rend_rgb: np.ndarray, mask: np.ndarray) -> float:
    """Windowed luminance SSIM (11x11 window, radius=5) over unmasked pixels."""
    y1 = 0.299 * real_rgb[..., 0] + 0.587 * real_rgb[..., 1] + 0.114 * real_rgb[..., 2]
    y2 = 0.299 * rend_rgb[..., 0] + 0.587 * rend_rgb[..., 1] + 0.114 * rend_rgb[..., 2]
    y1 = y1.astype(np.float32)
    y2 = y2.astype(np.float32)

    r = 5
    mu1 = box_blur_2d(y1, r)
    mu2 = box_blur_2d(y2, r)
    mu1_sq = mu1 * mu1
    mu2_sq = mu2 * mu2
    mu12 = mu1 * mu2

    sig1_sq = np.maximum(0.0, box_blur_2d(y1 * y1, r) - mu1_sq)
    sig2_sq = np.maximum(0.0, box_blur_2d(y2 * y2, r) - mu2_sq)
    sig12 = box_blur_2d(y1 * y2, r) - mu12

    C1 = (0.01 * 255.0) ** 2
    C2 = (0.03 * 255.0) ** 2
    ssim_map = ((2.0 * mu12 + C1) * (2.0 * sig12 + C2)) / (
        (mu1_sq + mu2_sq + C1) * (sig1_sq + sig2_sq + C2) + 1e-8
    )
    return float(ssim_map[mask].mean())


def sobel_mag(gray: np.ndarray) -> np.ndarray:
    """Sobel gradient magnitude after light smoothing to focus on structural edges."""
    sm = box_blur_2d(gray.astype(np.float32), 2)
    p = np.pad(sm, 1, mode="edge")
    gx = (
        -p[:-2, :-2]
        + p[:-2, 2:]
        - 2.0 * p[1:-1, :-2]
        + 2.0 * p[1:-1, 2:]
        - p[2:, :-2]
        + p[2:, 2:]
    )
    gy = (
        -p[:-2, :-2]
        - 2.0 * p[:-2, 1:-1]
        - p[:-2, 2:]
        + p[2:, :-2]
        + 2.0 * p[2:, 1:-1]
        + p[2:, 2:]
    )
    return np.hypot(gx, gy)


def compute_edge_corr_and_shift(
    real_rgb: np.ndarray, rend_rgb: np.ndarray, mask: np.ndarray
) -> tuple[float, int, int, float]:
    """
    Computes Sobel gradient correlation on unmasked pixels AND estimates
    optimal (dx_px, dy_px) shift of render relative to real via FFT/spatial search
    at 1/4 resolution (360x225) to diagnose camera heading/pitch misalignment!
    """
    g1 = 0.299 * real_rgb[..., 0] + 0.587 * real_rgb[..., 1] + 0.114 * real_rgb[..., 2]
    g2 = 0.299 * rend_rgb[..., 0] + 0.587 * rend_rgb[..., 1] + 0.114 * rend_rgb[..., 2]

    e1 = sobel_mag(g1)
    e2 = sobel_mag(g2)

    v1 = e1[mask]
    v2 = e2[mask]
    v1c = v1 - v1.mean()
    v2c = v2 - v2.mean()
    denom = math.sqrt(float((v1c * v1c).sum()) * float((v2c * v2c).sum())) + 1e-8
    edge_corr = float((v1c * v2c).sum() / denom)

    # Downsample 4x for fast ±45px (=±180px full-res) shift search
    ds = 4
    e1s = e1[::ds, ::ds] * mask[::ds, ::ds]
    e2s = e2[::ds, ::ds] * mask[::ds, ::ds]
    ms = mask[::ds, ::ds]

    # Zero-mean normalized
    e1s = box_blur_2d(e1s, 2)
    e2s = box_blur_2d(e2s, 2)
    h, w = e1s.shape
    max_dx = 40  # ±160px full res
    max_dy = 18  # ±72px full res
    best_corr = -2.0
    best_dx = 0
    best_dy = 0

    for dy in range(-max_dy, max_dy + 1, 2):
        y1_0 = max(0, dy)
        y1_1 = min(h, h + dy)
        y2_0 = max(0, -dy)
        y2_1 = min(h, h - dy)
        for dx in range(-max_dx, max_dx + 1, 2):
            x1_0 = max(0, dx)
            x1_1 = min(w, w + dx)
            x2_0 = max(0, -dx)
            x2_1 = min(w, w - dx)

            m_ov = ms[y1_0:y1_1, x1_0:x1_1] & ms[y2_0:y2_1, x2_0:x2_1]
            if m_ov.sum() < 500:
                continue
            a = e1s[y1_0:y1_1, x1_0:x1_1][m_ov]
            b = e2s[y2_0:y2_1, x2_0:x2_1][m_ov]
            ac = a - a.mean()
            bc = b - b.mean()
            den = math.sqrt(float((ac * ac).sum()) * float((bc * bc).sum())) + 1e-8
            c = float((ac * bc).sum() / den)
            if c > best_corr:
                best_corr = c
                best_dx = dx * ds
                best_dy = dy * ds

    return edge_corr, best_dx, best_dy, best_corr


def delta_e_to_heatmap(de: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Map CIE76 DeltaE (0..75+) to vivid Inferno-like heatmap RGB uint8."""
    t = np.clip(de / 65.0, 0.0, 1.0)
    # 5-stop colormap: deep navy -> magenta -> crimson -> orange -> bright yellow
    stops = np.array([0.0, 0.25, 0.50, 0.75, 1.0], dtype=np.float32)
    colors = np.array(
        [
            [12, 16, 40],
            [110, 24, 130],
            [215, 52, 55],
            [250, 155, 25],
            [255, 252, 185],
        ],
        dtype=np.float32,
    )
    out = np.zeros((*de.shape, 3), dtype=np.float32)
    for c in range(3):
        out[..., c] = np.interp(t, stops, colors[:, c])

    # Dim UI-masked regions with subtle diagonal hatch so it's visually clear what's excluded
    if not mask.all():
        yy, xx = np.indices(de.shape)
        hatch = ((xx + yy) // 6) % 2 == 0
        dim_bg = np.where(hatch[..., None], 36.0, 22.0)
        out = np.where(mask[..., None], out, dim_bg)

    return np.clip(out, 0, 255).astype(np.uint8)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run", help="Run name (e.g. baseline, iter1, iter2)")
    parser.add_argument("--compare", help="Previous run name for Before -> After deltas", default=None)
    args = parser.parse_args()

    run_dir = os.path.join(BENCH_ROOT, args.run)
    renders_dir = os.path.join(run_dir, "renders")
    diffs_dir = os.path.join(run_dir, "diffs")
    os.makedirs(diffs_dir, exist_ok=True)

    with open(os.path.join(REF_DIR, "manifest.json")) as f:
        manifest = json.load(f)
    refs = manifest["references"]

    prev_by_id = {}
    prev_overall = None
    if args.compare:
        prev_path = os.path.join(BENCH_ROOT, args.compare, "metrics.json")
        if os.path.exists(prev_path):
            with open(prev_path) as f:
                prev_data = json.load(f)
            prev_overall = prev_data.get("overall")
            for item in prev_data.get("shots", []):
                prev_by_id[item["id"]] = item

    # Also check if baseline exists for latest_summary.json
    baseline_data = None
    baseline_path = os.path.join(BENCH_ROOT, "baseline", "metrics.json")
    if args.run != "baseline" and os.path.exists(baseline_path):
        with open(baseline_path) as f:
            baseline_data = json.load(f)

    font_hdr = load_font(16)
    font_sub = load_font(13)
    font_sheet = load_font(14)

    shot_results = []
    strip_thumbs = []

    for ref in refs:
        rid = ref["id"]
        real_path = os.path.join(REF_DIR, f"{rid}.png")
        rend_path = os.path.join(renders_dir, f"{rid}.png")
        if not os.path.exists(real_path) or not os.path.exists(rend_path):
            print(f"SKIP {rid}: missing real or render", file=sys.stderr)
            continue

        real_img = Image.open(real_path).convert("RGB")
        rend_img = Image.open(rend_path).convert("RGB")
        if rend_img.size != real_img.size:
            rend_img = rend_img.resize(real_img.size, Image.Resampling.BILINEAR)

        w, h = real_img.size
        is_aerial = (ref.get("cameraHeightM", 2.5) > 22) or ("satellite" in ref.get("source", "").lower())
        mask = build_ui_mask(w, h, is_aerial)

        real_np = np.asarray(real_img)
        rend_np = np.asarray(rend_img)

        # RGB MAE
        abs_diff = np.abs(rend_np.astype(np.float32) - real_np.astype(np.float32))
        mae_rgb = float(abs_diff[mask].mean())

        # Lab DeltaE
        real_lab = srgb_to_lab(real_np)
        rend_lab = srgb_to_lab(rend_np)
        dlab = rend_lab - real_lab
        de_map = np.sqrt(np.sum(dlab * dlab, axis=-1))
        lab_de = float(de_map[mask].mean())

        # Regional DeltaE: top 25% (sky), mid 50% (buildings), bottom 25% (ground)
        y_sky = int(h * 0.25)
        y_mid = int(h * 0.75)
        m_sky = mask.copy(); m_sky[y_sky:, :] = False
        m_mid = mask.copy(); m_mid[:y_sky, :] = False; m_mid[y_mid:, :] = False
        m_gnd = mask.copy(); m_gnd[:y_mid, :] = False

        sky_de = float(de_map[m_sky].mean()) if m_sky.any() else lab_de
        mid_de = float(de_map[m_mid].mean()) if m_mid.any() else lab_de
        gnd_de = float(de_map[m_gnd].mean()) if m_gnd.any() else lab_de

        # Color/Lightness biases (render - real)
        bias_dL = float(dlab[..., 0][mask].mean())
        bias_da = float(dlab[..., 1][mask].mean())
        bias_db = float(dlab[..., 2][mask].mean())
        drgb = rend_np.astype(np.float32) - real_np.astype(np.float32)
        bias_rgb = [round(float(drgb[..., c][mask].mean()), 1) for c in range(3)]
        sky_bias_rgb = [round(float(drgb[..., c][m_sky].mean()), 1) for c in range(3)] if m_sky.any() else [0, 0, 0]
        gnd_bias_rgb = [round(float(drgb[..., c][m_gnd].mean()), 1) for c in range(3)] if m_gnd.any() else [0, 0, 0]

        # SSIM & Edge Correlation + Shift
        ssim_val = compute_ssim(real_np, rend_np, mask)
        edge_corr, shift_dx, shift_dy, best_edge_corr = compute_edge_corr_and_shift(real_np, rend_np, mask)

        # Estimate heading/pitch error in degrees from pixel shift
        fov_h = ref.get("fovDeg", 85) if not is_aerial else 55
        est_d_heading = round(shift_dx / w * fov_h, 1)
        est_d_pitch = round(-shift_dy / h * (fov_h * 0.65), 1)

        # Save standalone heatmap (720x450) for UI live-diff overlay if desired
        hm_rgb = delta_e_to_heatmap(de_map, mask)
        hm_img = Image.fromarray(hm_rgb)
        hm_small = hm_img.resize((720, 450), Image.Resampling.BILINEAR)
        hm_small.save(os.path.join(diffs_dir, f"{rid}_heatmap.png"))

        # Build crisp 3-panel strip: [Real | 3D Render | Amplified Error Heatmap]
        pw, ph = 480, 300
        hdr_h = 46
        strip = Image.new("RGB", (pw * 3, ph + hdr_h), (16, 20, 22))
        strip.paste(real_img.resize((pw, ph), Image.Resampling.BILINEAR), (0, hdr_h))
        strip.paste(rend_img.resize((pw, ph), Image.Resampling.BILINEAR), (pw, hdr_h))
        strip.paste(hm_img.resize((pw, ph), Image.Resampling.BILINEAR), (pw * 2, hdr_h))

        draw = ImageDraw.Draw(strip)
        draw.line([(pw, hdr_h), (pw, ph + hdr_h)], fill=(70, 80, 85), width=2)
        draw.line([(pw * 2, hdr_h), (pw * 2, ph + hdr_h)], fill=(70, 80, 85), width=2)

        delta_str = ""
        if rid in prev_by_id:
            p = prev_by_id[rid]
            d_ssim = ssim_val - p["ssim"]
            d_de = lab_de - p["labDeltaE"]
            delta_str = f"  |  ΔSSIM {d_ssim:+.3f}, Δ(ΔE) {d_de:+.1f}"

        draw.text(
            (12, 6),
            f"[{args.run.upper()}] {rid}  |  SSIM={ssim_val:.3f}  Lab_ΔE={lab_de:.1f}  MAE={mae_rgb:.1f}  EdgeCorr={edge_corr:.3f}{delta_str}",
            fill=(242, 238, 222),
            font=font_hdr,
        )
        draw.text(
            (12, 26),
            f"Sky_ΔE={sky_de:.1f}  Mid_ΔE={mid_de:.1f}  Gnd_ΔE={gnd_de:.1f}  |  Bias(dL={bias_dL:+.1f}, da={bias_da:+.1f}, db={bias_db:+.1f})  |  EstShift=({shift_dx:+d}px, {shift_dy:+d}px ~ {est_d_heading:+.1f}°h, {est_d_pitch:+.1f}°p, peakCorr={best_edge_corr:.3f})",
            fill=(170, 195, 210),
            font=font_sub,
        )
        # Panel labels
        for idx_p, lbl in enumerate(["REAL (Google)", "KINDENHEIM 3D", "ΔE ERROR HEATMAP (0–65)"]):
            bx = idx_p * pw + 8
            by = hdr_h + 8
            draw.rectangle([bx, by, bx + 185, by + 22], fill=(12, 16, 18))
            draw.text((bx + 6, by + 4), lbl, fill=(235, 210, 125), font=font_sub)

        strip_path = os.path.join(diffs_dir, f"{rid}_diff.png")
        strip.save(strip_path)
        strip_thumbs.append((rid, lab_de, strip))

        rec = {
            "id": rid,
            "title": ref.get("title", rid),
            "isAerial": is_aerial,
            "ssim": round(ssim_val, 4),
            "maeRgb": round(mae_rgb, 2),
            "labDeltaE": round(lab_de, 2),
            "edgeCorr": round(edge_corr, 4),
            "skyDeltaE": round(sky_de, 2),
            "midDeltaE": round(mid_de, 2),
            "groundDeltaE": round(gnd_de, 2),
            "biasLab": [round(bias_dL, 2), round(bias_da, 2), round(bias_db, 2)],
            "biasRgb": bias_rgb,
            "skyBiasRgb": sky_bias_rgb,
            "groundBiasRgb": gnd_bias_rgb,
            "estShiftPx": [int(shift_dx), int(shift_dy)],
            "estShiftDeg": [est_d_heading, est_d_pitch],
            "peakShiftEdgeCorr": round(best_edge_corr, 4),
            "diffStripPath": f"/data/benchmark/{args.run}/diffs/{rid}_diff.png",
            "heatmapPath": f"/data/benchmark/{args.run}/diffs/{rid}_heatmap.png",
            "renderPath": f"/data/benchmark/{args.run}/renders/{rid}.png",
        }
        shot_results.append(rec)

    # Sort worst-to-best by Lab DeltaE for reporting
    ranked = sorted(shot_results, key=lambda x: x["labDeltaE"], reverse=True)

    # Overall aggregates
    def avg(key, subset=shot_results):
        return round(float(np.mean([s[key] for s in subset])), 4) if subset else 0.0

    sv_shots = [s for s in shot_results if not s["isAerial"]]
    ae_shots = [s for s in shot_results if s["isAerial"]]

    overall = {
        "shotCount": len(shot_results),
        "meanSsim": avg("ssim"),
        "meanMaeRgb": round(avg("maeRgb"), 2),
        "meanLabDeltaE": round(avg("labDeltaE"), 2),
        "meanEdgeCorr": avg("edgeCorr"),
        "meanSkyDeltaE": round(avg("skyDeltaE"), 2),
        "meanMidDeltaE": round(avg("midDeltaE"), 2),
        "meanGroundDeltaE": round(avg("groundDeltaE"), 2),
        "streetViewMeanSsim": avg("ssim", sv_shots),
        "streetViewMeanLabDeltaE": round(avg("labDeltaE", sv_shots), 2),
        "streetViewMeanEdgeCorr": avg("edgeCorr", sv_shots),
        "aerialMeanSsim": avg("ssim", ae_shots),
        "aerialMeanLabDeltaE": round(avg("labDeltaE", ae_shots), 2),
        "aerialMeanEdgeCorr": avg("edgeCorr", ae_shots),
    }

    # Build 15-shot contact sheet (3 columns x 5 rows of compact 3-panel strips = 2160x1150 -> crisp 1800x1120)
    # Sort contact sheet worst-to-best so highest-error shots are top-left!
    strip_thumbs.sort(key=lambda x: x[1], reverse=True)
    cols = 3
    rows = math.ceil(len(strip_thumbs) / cols)
    tw, th = 600, 144
    sheet_hdr = 64
    sheet = Image.new("RGB", (cols * tw, sheet_hdr + rows * th), (14, 18, 20))
    sdraw = ImageDraw.Draw(sheet)
    cmp_txt = ""
    if prev_overall:
        cmp_txt = (
            f"  |  vs {args.compare}: SSIM {overall['meanSsim']-prev_overall['meanSsim']:+.4f}, "
            f"ΔE {overall['meanLabDeltaE']-prev_overall['meanLabDeltaE']:+.2f}, "
            f"EdgeCorr {overall['meanEdgeCorr']-prev_overall['meanEdgeCorr']:+.4f}"
        )
    sdraw.text(
        (16, 10),
        f"KINDENHEIM 3D — 15-SHOT VISUAL DIFF BENCHMARK ({args.run.upper()})  |  Ranked Worst -> Best by Lab ΔE",
        fill=(245, 220, 140),
        font=font_hdr,
    )
    sdraw.text(
        (16, 36),
        f"Overall (n={overall['shotCount']}): SSIM={overall['meanSsim']:.4f}  Lab_ΔE={overall['meanLabDeltaE']:.2f}  MAE={overall['meanMaeRgb']:.2f}  EdgeCorr={overall['meanEdgeCorr']:.4f}  |  Sky_ΔE={overall['meanSkyDeltaE']:.1f}  Mid_ΔE={overall['meanMidDeltaE']:.1f}  Gnd_ΔE={overall['meanGroundDeltaE']:.1f}{cmp_txt}",
        fill=(205, 222, 232),
        font=font_sheet,
    )
    for idx, (_rid, _de, st_img) in enumerate(strip_thumbs):
        r = idx // cols
        c = idx % cols
        resized = st_img.resize((tw - 6, th - 6), Image.Resampling.BILINEAR)
        sheet.paste(resized, (c * tw + 3, sheet_hdr + r * th + 3))

    sheet_path = os.path.join(run_dir, "summary_sheet.png")
    sheet.save(sheet_path)

    metrics_out = {
        "run": args.run,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "comparedTo": args.compare,
        "overall": overall,
        "shots": shot_results,
        "rankedWorstFirst": [s["id"] for s in ranked],
    }
    with open(os.path.join(run_dir, "metrics.json"), "w") as f:
        json.dump(metrics_out, f, indent=2)

    # Write data/benchmark/latest_summary.json for @threejs UI panel!
    base_ov = baseline_data["overall"] if baseline_data else overall
    base_by_id = {s["id"]: s for s in baseline_data["shots"]} if baseline_data else {s["id"]: s for s in shot_results}

    per_shot_summary = {}
    for s in shot_results:
        b = base_by_id.get(s["id"], s)
        per_shot_summary[s["id"]] = {
            "ssim": s["ssim"],
            "labDeltaE": s["labDeltaE"],
            "maeRgb": s["maeRgb"],
            "edgeCorr": s["edgeCorr"],
            "skyDeltaE": s["skyDeltaE"],
            "midDeltaE": s["midDeltaE"],
            "groundDeltaE": s["groundDeltaE"],
            "baselineSsim": b["ssim"],
            "baselineLabDeltaE": b["labDeltaE"],
            "deltaSsim": round(s["ssim"] - b["ssim"], 4),
            "deltaLabDeltaE": round(s["labDeltaE"] - b["labDeltaE"], 2),
            "heatmapPath": s["heatmapPath"],
            "diffStripPath": s["diffStripPath"],
        }

    latest_summary = {
        "latestRun": args.run,
        "timestamp": metrics_out["timestamp"],
        "baseline": base_ov,
        "latest": overall,
        "improvement": {
            "deltaSsim": round(overall["meanSsim"] - base_ov["meanSsim"], 4),
            "deltaLabDeltaE": round(overall["meanLabDeltaE"] - base_ov["meanLabDeltaE"], 2),
            "deltaMaeRgb": round(overall["meanMaeRgb"] - base_ov["meanMaeRgb"], 2),
            "deltaEdgeCorr": round(overall["meanEdgeCorr"] - base_ov["meanEdgeCorr"], 4),
        },
        "perShot": per_shot_summary,
    }
    with open(os.path.join(BENCH_ROOT, "latest_summary.json"), "w") as f:
        json.dump(latest_summary, f, indent=2)

    # Print crisp console table
    print(f"\n=== KINDENHEIM 3D VISUAL DIFF REPORT: {args.run.upper()} ===")
    print(
        f"OVERALL (15 shots): SSIM={overall['meanSsim']:.4f} | Lab_ΔE={overall['meanLabDeltaE']:.2f} | "
        f"MAE={overall['meanMaeRgb']:.2f} | EdgeCorr={overall['meanEdgeCorr']:.4f} | "
        f"Sky_ΔE={overall['meanSkyDeltaE']:.1f} Mid_ΔE={overall['meanMidDeltaE']:.1f} Gnd_ΔE={overall['meanGroundDeltaE']:.1f}"
    )
    print(
        f"  StreetView (12): SSIM={overall['streetViewMeanSsim']:.4f} Lab_ΔE={overall['streetViewMeanLabDeltaE']:.2f} EdgeCorr={overall['streetViewMeanEdgeCorr']:.4f}"
    )
    print(
        f"  Aerial      (3): SSIM={overall['aerialMeanSsim']:.4f} Lab_ΔE={overall['aerialMeanLabDeltaE']:.2f} EdgeCorr={overall['aerialMeanEdgeCorr']:.4f}"
    )
    if prev_overall:
        print(
            f"  DELTA vs {args.compare}: SSIM={overall['meanSsim']-prev_overall['meanSsim']:+.4f} | "
            f"Lab_ΔE={overall['meanLabDeltaE']-prev_overall['meanLabDeltaE']:+.2f} | "
            f"MAE={overall['meanMaeRgb']-prev_overall['meanMaeRgb']:+.2f} | "
            f"EdgeCorr={overall['meanEdgeCorr']-prev_overall['meanEdgeCorr']:+.4f}"
        )

    print(
        f"\n{'Shot ID':32s} {'SSIM':>6s} {'ΔE':>6s} {'MAE':>6s} {'Edge':>6s} {'SkyΔE':>6s} {'MidΔE':>6s} {'GndΔE':>6s} {'dL':>6s} {'SkyRGB(r-R)':>15s} {'EstShift(h°,p°)':>16s}"
    )
    print("-" * 126)
    for s in ranked:
        srgb_s = f"{s['skyBiasRgb'][0]:+.0f},{s['skyBiasRgb'][1]:+.0f},{s['skyBiasRgb'][2]:+.0f}"
        sh_s = f"{s['estShiftDeg'][0]:+.1f}°,{s['estShiftDeg'][1]:+.1f}°"
        print(
            f"{s['id']:32s} {s['ssim']:6.3f} {s['labDeltaE']:6.1f} {s['maeRgb']:6.1f} {s['edgeCorr']:6.3f} "
            f"{s['skyDeltaE']:6.1f} {s['midDeltaE']:6.1f} {s['groundDeltaE']:6.1f} {s['biasLab'][0]:+6.1f} "
            f"{srgb_s:>15s} {sh_s:>16s}"
        )
    print(f"\nSaved: {sheet_path} and {os.path.join(BENCH_ROOT, 'latest_summary.json')}")


if __name__ == "__main__":
    main()

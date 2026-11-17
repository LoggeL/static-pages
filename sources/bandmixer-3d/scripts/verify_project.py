#!/usr/bin/env python3
"""End-to-end verification suite for stem-stage catalog, manifests, audio stems, and static assets."""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import Any
from urllib.parse import unquote, urlsplit

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SITE_DIR = PROJECT_ROOT / "site"
DEFAULT_RAW_DIR = PROJECT_ROOT / "work" / "raw"

EXEMPLAR_SONGS = [
    "american-idiot",
    "i-was-made-for-lovin-you",
    "hammer-to-fall",
    "enter-sandman",
]
CANONICAL_STEM_ORDER = ["vocals", "guitar", "bass", "drums", "keys"]
PEAK_BUCKET_COUNT = 240
EXPECTED_SAMPLE_RATE = 44100
EXPECTED_CHANNELS = 2
MAX_STEM_DURATION_SPREAD_S = 0.05
MAX_DURATION_DELTA_S = 0.50
MAX_PAIRWISE_CORR = 0.70
MIN_RECON_CORR = 0.50
MIN_RECON_SNR_DB = 0.0
MIN_ENERGY_RATIO = 0.25
MAX_ENERGY_RATIO = 2.50
LAG_SEARCH_SAMPLES = 2500

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")

# Fast linear-time JS tokenizer/import patterns (avoid nested quantifiers on minified bundles).
JS_TOKEN_RE = re.compile(r"//|/\*|[\"'`]")
JS_STMT_HEAD_RE = re.compile(r"(?m)^[ \t]*(import|export)\b")
JS_SIDE_IMPORT_RE = re.compile(r"^\s*import\s+([\"'])([^\"'\n]+)\1")
JS_FROM_CLAUSE_RE = re.compile(r"\bfrom\s+([\"'])([^\"'\n]+)\1\s*(?:;|$)", re.MULTILINE)
JS_DYN_IMPORT_RE = re.compile(r"(?<![.\w$])import\s*\(\s*([\"'])([^\"'\n]+)\1\s*\)")

EXTERNAL_URI_PREFIXES = ("http://", "https://", "//", "data:", "blob:", "mailto:", "tel:", "javascript:")


@dataclass
class VerificationReport:
    """Collects verification errors, warnings, and human-readable summary lines."""

    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    song_summaries: list[str] = field(default_factory=list)
    static_summary: str = ""

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    @property
    def ok(self) -> bool:
        return not self.errors


class HtmlAssetParser(HTMLParser):
    """Extract local asset references and inline module scripts from HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.refs: list[tuple[str, str]] = []
        self.inline_module_scripts: list[str] = []
        self._in_module_script = False
        self._script_buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {k.lower(): v for k, v in attrs if v is not None}
        for attr in ("src", "href"):
            if attr in attr_map:
                self.refs.append((f"<{tag} {attr}>", attr_map[attr]))

        if tag.lower() == "script":
            script_type = (attr_map.get("type") or "").strip().lower()
            if script_type == "module" and "src" not in attr_map:
                self._in_module_script = True
                self._script_buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._in_module_script:
            self.inline_module_scripts.append("".join(self._script_buf))
            self._in_module_script = False
            self._script_buf = []

    def handle_data(self, data: str) -> None:
        if self._in_module_script:
            self._script_buf.append(data)


def find_binary(name: str) -> str:
    """Locate ffmpeg or ffprobe across PATH and standard installation locations."""
    found = shutil.which(name)
    if found:
        return found

    candidates: list[Path] = []
    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            candidates.append(Path(local_app_data) / "Microsoft" / "WinGet" / "Links" / f"{name}.exe")
        candidates.extend(
            [
                Path.home() / "AppData" / "Local" / "Microsoft" / "WinGet" / "Links" / f"{name}.exe",
                Path.home() / "scoop" / "shims" / f"{name}.exe",
            ]
        )
    else:
        candidates.extend(
            [
                Path(f"/opt/homebrew/bin/{name}"),
                Path(f"/usr/local/bin/{name}"),
                Path(f"/usr/bin/{name}"),
            ]
        )

    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)

    raise FileNotFoundError(f"{name} executable not found in PATH or standard directories.")


def is_finite_number(value: Any) -> bool:
    """Return True if value is a finite int or float (excluding bool)."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def is_nonempty_str(value: Any) -> bool:
    """Return True if value is a non-empty string after stripping whitespace."""
    return isinstance(value, str) and bool(value.strip())


def resolve_under_site(site_dir: Path, raw_ref: str, base_dir: Path) -> Path:
    """Resolve a URL path relative to base_dir (or site_dir for leading '/') safely within site_dir."""
    parsed = urlsplit(raw_ref.strip())
    clean_path = unquote(parsed.path)
    if not clean_path:
        raise ValueError(f"Empty path in reference: {raw_ref!r}")

    site_root = site_dir.resolve()
    if clean_path.startswith("/"):
        candidate = (site_root / clean_path.lstrip("/")).resolve()
    else:
        candidate = (base_dir.resolve() / clean_path).resolve()

    if not candidate.is_relative_to(site_root):
        raise ValueError(f"Reference escapes site directory: {raw_ref!r}")

    return candidate


def catalog_sort_key(song_id: str) -> tuple[int, int, str, str]:
    """Match build_catalog.py canonical sort ordering."""
    if song_id in EXEMPLAR_SONGS:
        return (0, EXEMPLAR_SONGS.index(song_id), song_id.lower(), song_id)
    return (1, 0, song_id.lower(), song_id)


def load_json_object(path: Path) -> dict[str, Any]:
    """Read and parse a JSON file, requiring a top-level JSON object."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object in {path}, got {type(data).__name__}")
    return data


def ffprobe_audio(mp3_path: Path, ffprobe_bin: str) -> dict[str, Any]:
    """Run ffprobe on an audio file and return parsed stream/format metadata."""
    cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,sample_rate,channels,bit_rate,duration",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(mp3_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed on {mp3_path}: {proc.stderr.strip()}")

    payload = json.loads(proc.stdout)
    streams = payload.get("streams") or []
    if not streams:
        raise RuntimeError(f"ffprobe found no streams in {mp3_path}")

    stream = streams[0]
    fmt = payload.get("format") or {}
    duration_raw = fmt.get("duration") if fmt.get("duration") is not None else stream.get("duration")
    if duration_raw is None:
        raise RuntimeError(f"ffprobe reported no duration for {mp3_path}")

    return {
        "codec_name": str(stream.get("codec_name") or ""),
        "sample_rate": int(stream["sample_rate"]),
        "channels": int(stream["channels"]),
        "bit_rate": int(stream["bit_rate"]) if stream.get("bit_rate") else None,
        "duration": float(duration_raw),
    }


def decode_pcm_f32_stereo(audio_path: Path, ffmpeg_bin: str) -> Any:
    """Decode audio_path via ffmpeg into a (N, 2) float32 numpy ndarray at 44100 Hz."""
    import numpy as np

    cmd = [
        ffmpeg_bin,
        "-nostdin",
        "-v",
        "error",
        "-i",
        str(audio_path),
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        "-ar",
        str(EXPECTED_SAMPLE_RATE),
        "-ac",
        str(EXPECTED_CHANNELS),
        "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True, check=False)
    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg failed decoding {audio_path}: {stderr}")

    samples = np.frombuffer(proc.stdout, dtype="<f4")
    if samples.size == 0 or samples.size % EXPECTED_CHANNELS != 0:
        raise RuntimeError(f"Decoded PCM from {audio_path} is empty or misaligned.")

    return samples.reshape(-1, EXPECTED_CHANNELS).copy()


def pearson_corr_1d(a: Any, b: Any) -> float:
    """Compute exact float64 Pearson correlation between two equal-length 1D arrays in bounded RAM."""
    import numpy as np

    n = int(a.size)
    if n == 0:
        return 0.0

    mean_a = float(a.mean(dtype=np.float64))
    mean_b = float(b.mean(dtype=np.float64))
    dot = 0.0
    na = 0.0
    nb = 0.0
    chunk = 2_000_000
    for start in range(0, n, chunk):
        da = a[start : start + chunk].astype(np.float64) - mean_a
        db = b[start : start + chunk].astype(np.float64) - mean_b
        dot += float(np.dot(da, db))
        na += float(np.dot(da, da))
        nb += float(np.dot(db, db))

    denom = math.sqrt(na * nb)
    if denom <= 1e-12:
        return 0.0
    return dot / denom


def find_candidate_lags(mix_sum: Any, raw: Any, max_lag: int) -> list[int]:
    """Use FFT cross-correlation on the highest-energy 30s window to find best lag offsets."""
    import numpy as np

    n = int(min(len(mix_sum), len(raw)))
    if n <= 2 * max_lag + 16:
        return [0]

    seg_len = min(n, 30 * EXPECTED_SAMPLE_RATE)
    # Pick highest-energy raw window (in 5s steps) so silent intros cannot skew lag estimation.
    best_start = 0
    if n > seg_len:
        step = 5 * EXPECTED_SAMPLE_RATE
        best_energy = -1.0
        for s0 in range(0, n - seg_len + 1, step):
            block = raw[s0 : s0 + seg_len : 16]
            energy = float(np.mean(np.square(block, dtype=np.float64)))
            if energy > best_energy:
                best_energy = energy
                best_start = s0

    m_seg = mix_sum[best_start : best_start + seg_len].mean(axis=1).astype(np.float64)
    r_seg = raw[best_start : best_start + seg_len].mean(axis=1).astype(np.float64)
    m_seg -= float(m_seg.mean())
    r_seg -= float(r_seg.mean())

    n_fft = 1 << int(math.ceil(math.log2(seg_len + 2 * max_lag + 1)))
    spec_m = np.fft.rfft(m_seg, n=n_fft)
    spec_r = np.fft.rfft(r_seg, n=n_fft)
    xc = np.fft.irfft(spec_m * np.conj(spec_r), n=n_fft)

    # Positive lag k >= 0 at xc[k]; negative lag k < 0 at xc[n_fft + k].
    pos = xc[0 : max_lag + 1]
    neg = xc[n_fft - max_lag : n_fft]
    combined = np.concatenate([neg, pos])
    lags = np.arange(-max_lag, max_lag + 1)

    top_indices = np.argsort(combined)[-3:][::-1]
    candidates: list[int] = [0]
    for idx in top_indices:
        lag = int(lags[idx])
        for delta in (-1, 0, 1):
            clamped = max(-max_lag, min(max_lag, lag + delta))
            if clamped not in candidates:
                candidates.append(clamped)
    return candidates


def compute_aligned_reconstruction_metrics(
    mix_sum: Any, raw: Any, lag: int
) -> tuple[float, float, float]:
    """Compute (pearson_corr, energy_ratio, snr_db) for mix_sum shifted by lag against raw."""
    import numpy as np

    n = int(min(len(mix_sum), len(raw)))
    if lag >= 0:
        m_al = mix_sum[lag:n]
        r_al = raw[0 : n - lag]
    else:
        m_al = mix_sum[0 : n + lag]
        r_al = raw[-lag:n]

    corr = pearson_corr_1d(m_al.reshape(-1), r_al.reshape(-1))

    raw_sum_sq = 0.0
    mix_sum_sq = 0.0
    res_sum_sq = 0.0
    total_samples = 0
    chunk = 1_000_000
    for start in range(0, len(r_al), chunk):
        rb = r_al[start : start + chunk].astype(np.float64)
        mb = m_al[start : start + chunk].astype(np.float64)
        diff = rb - mb
        raw_sum_sq += float(np.sum(rb * rb))
        mix_sum_sq += float(np.sum(mb * mb))
        res_sum_sq += float(np.sum(diff * diff))
        total_samples += rb.size

    if total_samples == 0 or raw_sum_sq <= 1e-12:
        return corr, 0.0, -120.0

    energy_ratio = mix_sum_sq / raw_sum_sq
    snr_db = 10.0 * math.log10(raw_sum_sq / max(res_sum_sq, 1e-12))
    return corr, energy_ratio, snr_db


def verify_audio_reconstruction(
    song_id: str,
    stem_paths: dict[str, Path],
    raw_wav_path: Path,
    ffmpeg_bin: str,
    report: VerificationReport,
) -> dict[str, Any]:
    """Decode stems and raw WAV to PCM, checking pairwise distinction and mix reconstruction."""
    try:
        import numpy as np
    except ImportError as exc:
        report.error(f"[{song_id}] numpy is required for PCM audio verification: {exc}")
        return {}

    stem_arrays: dict[str, Any] = {}
    for stem_id, path in stem_paths.items():
        stem_arrays[stem_id] = decode_pcm_f32_stereo(path, ffmpeg_bin)
    raw = decode_pcm_f32_stereo(raw_wav_path, ffmpeg_bin)

    min_len = min([len(raw)] + [len(arr) for arr in stem_arrays.values()])
    if min_len < EXPECTED_SAMPLE_RATE // 4:
        report.error(f"[{song_id}] Decoded audio too short ({min_len} samples).")
        return {}

    raw_aligned = raw[:min_len]
    aligned_stems = {sid: arr[:min_len] for sid, arr in stem_arrays.items()}

    # Verify each stem contains non-trivial energy and compute pairwise Pearson correlations.
    stem_ids = list(aligned_stems.keys())
    for sid in stem_ids:
        rms = float(np.sqrt(np.mean(np.square(aligned_stems[sid], dtype=np.float64))))
        if rms <= 1e-6:
            report.error(f"[{song_id}] Stem '{sid}' decoded to near-zero silence (rms={rms:.2e}).")

    max_abs_corr = 0.0
    max_pair = ""
    for i in range(len(stem_ids)):
        for j in range(i + 1, len(stem_ids)):
            sid_a, sid_b = stem_ids[i], stem_ids[j]
            corr = pearson_corr_1d(aligned_stems[sid_a].reshape(-1), aligned_stems[sid_b].reshape(-1))
            if abs(corr) > max_abs_corr:
                max_abs_corr = abs(corr)
                max_pair = f"{sid_a}/{sid_b}"
            if abs(corr) >= MAX_PAIRWISE_CORR:
                report.error(
                    f"[{song_id}] Stems '{sid_a}' and '{sid_b}' have suspiciously high correlation "
                    f"(|corr|={abs(corr):.3f} >= {MAX_PAIRWISE_CORR})."
                )

    mix_sum = np.zeros((min_len, EXPECTED_CHANNELS), dtype=np.float32)
    for arr in aligned_stems.values():
        mix_sum += arr

    best_lag = 0
    best_corr = -2.0
    best_ratio = 0.0
    best_snr = -120.0
    for lag in find_candidate_lags(mix_sum, raw_aligned, LAG_SEARCH_SAMPLES):
        corr, ratio, snr = compute_aligned_reconstruction_metrics(mix_sum, raw_aligned, lag)
        if corr > best_corr:
            best_corr = corr
            best_lag = lag
            best_ratio = ratio
            best_snr = snr

    if best_corr <= MIN_RECON_CORR:
        report.error(
            f"[{song_id}] Stem sum vs raw WAV correlation too low: "
            f"corr={best_corr:.3f} <= {MIN_RECON_CORR} (best lag={best_lag} samples)."
        )
    if best_snr <= MIN_RECON_SNR_DB:
        report.error(
            f"[{song_id}] Stem sum residual SNR too low: "
            f"snr={best_snr:.2f} dB <= {MIN_RECON_SNR_DB} dB (best lag={best_lag})."
        )
    if not (MIN_ENERGY_RATIO <= best_ratio <= MAX_ENERGY_RATIO):
        report.error(
            f"[{song_id}] Stem sum energy ratio out of range: "
            f"ratio={best_ratio:.3f} not in [{MIN_ENERGY_RATIO}, {MAX_ENERGY_RATIO}]."
        )

    return {
        "max_pair_corr": max_abs_corr,
        "max_pair": max_pair,
        "recon_corr": best_corr,
        "best_lag": best_lag,
        "energy_ratio": best_ratio,
        "snr_db": best_snr,
    }


def validate_stem_entry(
    song_id: str,
    stem: Any,
    song_duration: float,
    site_dir: Path,
    ffprobe_bin: str,
    report: VerificationReport,
) -> tuple[str | None, Path | None, float | None, float | None]:
    """Validate a single stem object from song.json and ffprobe its MP3 asset."""
    if not isinstance(stem, dict):
        report.error(f"[{song_id}] Stem entry must be an object, got {type(stem).__name__}.")
        return None, None, None, None

    stem_id = stem.get("id")
    if not is_nonempty_str(stem_id) or stem_id not in CANONICAL_STEM_ORDER:
        report.error(f"[{song_id}] Invalid stem id {stem_id!r}; expected one of {CANONICAL_STEM_ORDER}.")
        return None, None, None, None

    for key in ("label", "shortLabel"):
        if not is_nonempty_str(stem.get(key)):
            report.error(f"[{song_id}/{stem_id}] Stem field '{key}' must be a non-empty string.")

    color = stem.get("color")
    if not isinstance(color, str) or not HEX_COLOR_RE.match(color):
        report.error(f"[{song_id}/{stem_id}] Stem color must be #RRGGBB hex, got {color!r}.")

    rms_db = stem.get("rmsDb")
    if not is_finite_number(rms_db) or not (-120.0 <= float(rms_db) <= 6.0):
        report.error(f"[{song_id}/{stem_id}] Invalid rmsDb {rms_db!r}; expected finite number in [-120, 6].")
        rms_val: float | None = None
    else:
        rms_val = float(rms_db)

    peaks = stem.get("peaks")
    if not isinstance(peaks, list) or len(peaks) != PEAK_BUCKET_COUNT:
        actual_len = len(peaks) if isinstance(peaks, list) else type(peaks).__name__
        report.error(
            f"[{song_id}/{stem_id}] 'peaks' must be an array of exact length {PEAK_BUCKET_COUNT}, got {actual_len}."
        )
    else:
        bad_peaks = [
            (idx, val)
            for idx, val in enumerate(peaks)
            if not is_finite_number(val) or not (0.0 <= float(val) <= 1.0)
        ]
        if bad_peaks:
            idx0, val0 = bad_peaks[0]
            report.error(
                f"[{song_id}/{stem_id}] 'peaks[{idx0}]' out of [0.0, 1.0] or non-numeric: {val0!r}."
            )

    stem_url = stem.get("url")
    if not is_nonempty_str(stem_url):
        report.error(f"[{song_id}/{stem_id}] Missing or empty stem 'url'.")
        return stem_id, None, None, rms_val

    try:
        mp3_path = resolve_under_site(site_dir, stem_url, site_dir)
    except ValueError as exc:
        report.error(f"[{song_id}/{stem_id}] Invalid stem url: {exc}")
        return stem_id, None, None, rms_val

    if not mp3_path.is_file() or mp3_path.stat().st_size == 0:
        report.error(f"[{song_id}/{stem_id}] Stem audio file missing or empty: {mp3_path}")
        return stem_id, None, None, rms_val

    try:
        probe = ffprobe_audio(mp3_path, ffprobe_bin)
    except Exception as exc:
        report.error(f"[{song_id}/{stem_id}] {exc}")
        return stem_id, mp3_path, None, rms_val

    if probe["codec_name"] != "mp3":
        report.error(f"[{song_id}/{stem_id}] Expected codec 'mp3', got {probe['codec_name']!r}.")
    if probe["sample_rate"] != EXPECTED_SAMPLE_RATE:
        report.error(
            f"[{song_id}/{stem_id}] Expected sample_rate {EXPECTED_SAMPLE_RATE}, got {probe['sample_rate']}."
        )
    if probe["channels"] != EXPECTED_CHANNELS:
        report.error(f"[{song_id}/{stem_id}] Expected {EXPECTED_CHANNELS} channels, got {probe['channels']}.")

    stem_dur = probe["duration"]
    if not math.isfinite(stem_dur) or stem_dur <= 0:
        report.error(f"[{song_id}/{stem_id}] Invalid probed duration: {stem_dur}.")
    elif abs(stem_dur - song_duration) > MAX_DURATION_DELTA_S:
        report.error(
            f"[{song_id}/{stem_id}] Probed duration {stem_dur:.3f}s differs from song duration "
            f"{song_duration:.3f}s by more than {MAX_DURATION_DELTA_S:.2f}s."
        )

    return stem_id, mp3_path, stem_dur, rms_val


def verify_catalog_and_songs(
    site_dir: Path,
    raw_dir: Path,
    allow_empty: bool,
    skip_audio_check: bool,
    report: VerificationReport,
) -> None:
    """Validate site/songs/index.json, every song.json manifest, stem MP3s, and optional raw reconstruction."""
    index_path = site_dir / "songs" / "index.json"
    if not index_path.is_file():
        report.error(f"Catalog file missing: {index_path}")
        return

    try:
        catalog = load_json_object(index_path)
    except Exception as exc:
        report.error(f"Failed parsing {index_path}: {exc}")
        return

    songs = catalog.get("songs")
    if not isinstance(songs, list):
        report.error(f"{index_path} must contain a 'songs' list.")
        return

    if not songs:
        if allow_empty:
            report.warn(f"Catalog {index_path} has 0 songs (allowed via --allow-empty).")
            return
        report.error(f"Catalog {index_path} has 0 songs (expected at least {EXEMPLAR_SONGS}).")
        return

    try:
        ffprobe_bin = find_binary("ffprobe")
        ffmpeg_bin = find_binary("ffmpeg")
    except FileNotFoundError as exc:
        report.error(str(exc))
        return

    seen_ids: set[str] = set()
    catalog_ids: list[str] = []
    required_index_keys = ("id", "title", "artist", "duration", "bpm", "accent", "manifestUrl", "stemIds")

    for idx, entry in enumerate(songs):
        if not isinstance(entry, dict):
            report.error(f"Catalog entry #{idx} is not a JSON object.")
            continue

        missing = [k for k in required_index_keys if k not in entry]
        if missing:
            report.error(f"Catalog entry #{idx} ({entry.get('id', '?')}) missing keys: {missing}")
            continue

        song_id = entry["id"]
        if not is_nonempty_str(song_id) or not SLUG_RE.match(song_id):
            report.error(f"Catalog entry #{idx} has invalid song id {song_id!r}.")
            continue
        if song_id in seen_ids:
            report.error(f"Duplicate song id in catalog: {song_id!r}")
            continue
        seen_ids.add(song_id)
        catalog_ids.append(song_id)

        for key in ("title", "artist", "manifestUrl"):
            if not is_nonempty_str(entry[key]):
                report.error(f"[{song_id}] Catalog field '{key}' must be a non-empty string.")

        cat_dur = entry["duration"]
        if not is_finite_number(cat_dur) or float(cat_dur) <= 0:
            report.error(f"[{song_id}] Catalog 'duration' must be > 0, got {cat_dur!r}.")

        cat_bpm = entry["bpm"]
        if not is_finite_number(cat_bpm) or float(cat_bpm) <= 0:
            report.error(f"[{song_id}] Catalog 'bpm' must be > 0, got {cat_bpm!r}.")

        accent = entry["accent"]
        if not isinstance(accent, str) or not HEX_COLOR_RE.match(accent):
            report.error(f"[{song_id}] Catalog 'accent' must be #RRGGBB hex, got {accent!r}.")

        cat_stem_ids = entry["stemIds"]
        if not isinstance(cat_stem_ids, list) or not cat_stem_ids:
            report.error(f"[{song_id}] Catalog 'stemIds' must be a non-empty list.")
        else:
            invalid_stems = [s for s in cat_stem_ids if s not in CANONICAL_STEM_ORDER]
            if invalid_stems:
                report.error(f"[{song_id}] Catalog 'stemIds' contains unknown ids: {invalid_stems}")
            elif len(set(cat_stem_ids)) != len(cat_stem_ids):
                report.error(f"[{song_id}] Catalog 'stemIds' contains duplicates: {cat_stem_ids}")
            elif [CANONICAL_STEM_ORDER.index(s) for s in cat_stem_ids] != sorted(
                CANONICAL_STEM_ORDER.index(s) for s in cat_stem_ids
            ):
                report.error(f"[{song_id}] Catalog 'stemIds' is not in canonical order: {cat_stem_ids}")

        # Resolve and validate song.json manifest
        try:
            manifest_path = resolve_under_site(site_dir, str(entry["manifestUrl"]), site_dir)
        except ValueError as exc:
            report.error(f"[{song_id}] Invalid manifestUrl: {exc}")
            continue

        if not manifest_path.is_file():
            report.error(f"[{song_id}] Manifest file does not exist: {manifest_path}")
            continue

        try:
            manifest = load_json_object(manifest_path)
        except Exception as exc:
            report.error(f"[{song_id}] Failed parsing manifest {manifest_path}: {exc}")
            continue

        required_manifest_keys = ("id", "title", "artist", "duration", "bpm", "source", "stems")
        missing_m = [k for k in required_manifest_keys if k not in manifest]
        if missing_m:
            report.error(f"[{song_id}] Manifest missing required keys: {missing_m}")
            continue

        if manifest["id"] != song_id:
            report.error(f"[{song_id}] Manifest id {manifest['id']!r} != catalog id {song_id!r}.")
        if manifest["title"] != entry["title"]:
            report.error(f"[{song_id}] Manifest title {manifest['title']!r} != catalog title {entry['title']!r}.")
        if manifest["artist"] != entry["artist"]:
            report.error(f"[{song_id}] Manifest artist {manifest['artist']!r} != catalog artist {entry['artist']!r}.")

        man_dur = manifest["duration"]
        if not is_finite_number(man_dur) or float(man_dur) <= 0:
            report.error(f"[{song_id}] Manifest 'duration' must be > 0, got {man_dur!r}.")
            continue
        song_duration = float(man_dur)
        if is_finite_number(cat_dur) and abs(song_duration - float(cat_dur)) > 0.05:
            report.error(f"[{song_id}] Manifest duration {song_duration} != catalog duration {cat_dur}.")

        man_bpm = manifest["bpm"]
        if not is_finite_number(man_bpm) or float(man_bpm) <= 0:
            report.error(f"[{song_id}] Manifest 'bpm' must be > 0, got {man_bpm!r}.")
        elif is_finite_number(cat_bpm) and abs(float(man_bpm) - float(cat_bpm)) > 0.5:
            report.error(f"[{song_id}] Manifest bpm {man_bpm} != catalog bpm {cat_bpm}.")

        source = manifest["source"]
        if not isinstance(source, dict):
            report.error(f"[{song_id}] Manifest 'source' must be an object.")
        else:
            yt_id = source.get("youtubeId")
            if not isinstance(yt_id, str):
                report.error(f"[{song_id}] Manifest 'source.youtubeId' must be a string.")
            elif song_id in EXEMPLAR_SONGS and not yt_id.strip():
                report.error(f"[{song_id}] Exemplar song must have non-empty 'source.youtubeId'.")

            if not is_nonempty_str(source.get("model")):
                report.error(f"[{song_id}] Manifest 'source.model' must be a non-empty string.")

        stems = manifest["stems"]
        if not isinstance(stems, list) or not stems:
            report.error(f"[{song_id}] Manifest 'stems' must be a non-empty list.")
            continue

        stem_paths: dict[str, Path] = {}
        stem_durations: dict[str, float] = {}
        stem_rms: dict[str, float] = {}
        manifest_stem_ids: list[str] = []

        for stem in stems:
            sid, mp3_path, stem_dur, rms_val = validate_stem_entry(
                song_id, stem, song_duration, site_dir, ffprobe_bin, report
            )
            if sid is not None:
                manifest_stem_ids.append(sid)
            if sid is not None and mp3_path is not None:
                stem_paths[sid] = mp3_path
            if sid is not None and stem_dur is not None:
                stem_durations[sid] = stem_dur
            if sid is not None and rms_val is not None:
                stem_rms[sid] = rms_val

        if len(set(manifest_stem_ids)) != len(manifest_stem_ids):
            report.error(f"[{song_id}] Duplicate stem ids in manifest: {manifest_stem_ids}")
        elif isinstance(cat_stem_ids, list) and manifest_stem_ids != cat_stem_ids:
            report.error(
                f"[{song_id}] Manifest stem order {manifest_stem_ids} != catalog stemIds {cat_stem_ids}."
            )

        spread = 0.0
        if len(stem_durations) >= 2:
            spread = max(stem_durations.values()) - min(stem_durations.values())
            if spread > MAX_STEM_DURATION_SPREAD_S:
                detail = ", ".join(f"{k}={v:.3f}s" for k, v in stem_durations.items())
                report.error(
                    f"[{song_id}] Stem duration spread {spread:.4f}s > {MAX_STEM_DURATION_SPREAD_S:.2f}s ({detail})."
                )

        # Audio separation & mix reconstruction check if raw WAV is available
        recon_info: dict[str, Any] = {}
        raw_wav_path = raw_dir / f"{song_id}.wav"
        if not skip_audio_check and raw_wav_path.is_file() and len(stem_paths) == len(stems):
            recon_info = verify_audio_reconstruction(song_id, stem_paths, raw_wav_path, ffmpeg_bin, report)
        elif not skip_audio_check and song_id in EXEMPLAR_SONGS and not raw_wav_path.is_file():
            report.warn(f"[{song_id}] Raw WAV not found at {raw_wav_path}; skipped PCM reconstruction check.")

        dur_str = ", ".join(f"{k}:{stem_durations.get(k, 0.0):.2f}s" for k in manifest_stem_ids)
        rms_str = ", ".join(f"{k}:{stem_rms.get(k, float('nan')):.1f}dB" for k in manifest_stem_ids)
        recon_str = ""
        if recon_info:
            recon_str = (
                f" | max|pairCorr|={recon_info['max_pair_corr']:.3f} ({recon_info['max_pair']})"
                f" | reconCorr={recon_info['recon_corr']:.3f} lag={recon_info['best_lag']}smp"
                f" ratio={recon_info['energy_ratio']:.2f} SNR={recon_info['snr_db']:.1f}dB"
            )
        report.song_summaries.append(
            f"  - {song_id} ({manifest['artist']} — {manifest['title']}, {song_duration:.2f}s, "
            f"{man_bpm} BPM, {len(stems)} stems, spread={spread:.3f}s){recon_str}\n"
            f"      durations: [{dur_str}]\n"
            f"      rms:       [{rms_str}]"
        )

    if catalog_ids:
        expected_ids = sorted(catalog_ids, key=catalog_sort_key)
        if catalog_ids != expected_ids:
            report.error(
                f"Catalog songs are not in canonical order: got {catalog_ids}, expected {expected_ids}."
            )

    if not allow_empty:
        missing_exemplars = [sid for sid in EXEMPLAR_SONGS if sid not in seen_ids]
        if missing_exemplars:
            report.error(f"Missing required exemplar song(s) in catalog: {missing_exemplars}")


def strip_js_comments_fast(src: str) -> str:
    """Strip JS // and /* */ comments in O(N) time while preserving string/template literals."""
    out: list[str] = []
    pos = 0
    n = len(src)
    while pos < n:
        match = JS_TOKEN_RE.search(src, pos)
        if not match:
            out.append(src[pos:])
            break
        start = match.start()
        tok = match.group(0)
        out.append(src[pos:start])
        if tok == "//":
            nl = src.find("\n", start + 2)
            if nl == -1:
                break
            pos = nl
        elif tok == "/*":
            end = src.find("*/", start + 2)
            if end == -1:
                break
            out.append(" ")
            pos = end + 2
        else:
            quote = tok
            i = start + 1
            while i < n:
                ch = src[i]
                if ch == "\\":
                    i += 2
                    continue
                if ch == quote:
                    i += 1
                    break
                if ch == "\n" and quote != "`":
                    break
                i += 1
            out.append(src[start:i])
            pos = i
    return "".join(out)


def extract_js_module_specifiers(src: str) -> list[str]:
    """Extract static import/re-export and dynamic import() module specifiers from JS source."""
    clean = strip_js_comments_fast(src)
    specs: list[str] = []
    n = len(clean)

    for match in JS_STMT_HEAD_RE.finditer(clean):
        kw = match.group(1)
        pos = match.end()
        peek = clean[pos : pos + 32].lstrip()
        if kw == "export" and re.match(r"(?:function|async\s+function|class|const|let|var|default)\b", peek):
            continue
        if kw == "import":
            side_match = JS_SIDE_IMPORT_RE.match(clean[match.start() : match.start() + 300])
            if side_match:
                specs.append(side_match.group(2))
                continue

        depth = 0
        i = pos
        limit = min(n, pos + 25000)
        while i < limit:
            ch = clean[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                if depth > 0:
                    depth -= 1
            elif ch == ";" and depth == 0:
                i += 1
                break
            elif ch == "\n" and depth == 0 and "from" in clean[pos:i]:
                if JS_FROM_CLAUSE_RE.search(clean[pos:i]):
                    break
            i += 1

        stmt = clean[match.start() : i]
        from_match = JS_FROM_CLAUSE_RE.search(stmt)
        if from_match:
            specs.append(from_match.group(2))

    for dyn_match in JS_DYN_IMPORT_RE.finditer(clean):
        specs.append(dyn_match.group(2))

    return specs


def is_external_or_ignored_ref(ref: str) -> bool:
    """Return True if ref is empty, an in-page fragment, or a non-local URI scheme."""
    stripped = ref.strip()
    if not stripped or stripped.startswith("#"):
        return True
    lower = stripped.lower()
    return any(lower.startswith(prefix) for prefix in EXTERNAL_URI_PREFIXES)


def verify_local_ref(
    owner_file: Path,
    site_dir: Path,
    context_label: str,
    ref: str,
    report: VerificationReport,
) -> bool:
    """Resolve and verify a single local file reference under site_dir."""
    try:
        target = resolve_under_site(site_dir, ref, owner_file.parent)
    except ValueError as exc:
        report.error(f"[{owner_file.relative_to(site_dir)}] {context_label}: {exc}")
        return False

    if target.is_file():
        return True
    if target.is_dir() and (target / "index.html").is_file():
        return True

    report.error(
        f"[{owner_file.relative_to(site_dir)}] {context_label} points to missing local file: {ref!r} -> {target}"
    )
    return False


def verify_static_assets_and_imports(
    site_dir: Path, allow_empty: bool, report: VerificationReport
) -> None:
    """Verify HTML src/href references and ES module imports across site/index.html, site/js/, and site/vendor/."""
    checked_links = 0
    scanned_files = 0

    index_html = site_dir / "index.html"
    if not index_html.is_file():
        if allow_empty:
            report.warn(f"{index_html} does not exist yet (skipped under --allow-empty).")
        else:
            report.error(f"Missing required entry page: {index_html}")
    else:
        scanned_files += 1
        parser = HtmlAssetParser()
        parser.feed(index_html.read_text(encoding="utf-8"))
        parser.close()

        for ctx, ref in parser.refs:
            if is_external_or_ignored_ref(ref):
                continue
            if verify_local_ref(index_html, site_dir, ctx, ref, report):
                checked_links += 1

        for inline_js in parser.inline_module_scripts:
            for spec in extract_js_module_specifiers(inline_js):
                if is_external_or_ignored_ref(spec):
                    continue
                if spec.startswith(("./", "../", "/")):
                    if verify_local_ref(index_html, site_dir, "inline <script type=module> import", spec, report):
                        checked_links += 1
                else:
                    report.error(f"[index.html] Bare module specifier {spec!r} in inline module script.")

    for subdir_name in ("js", "vendor"):
        subdir = site_dir / subdir_name
        if not subdir.is_dir():
            if allow_empty:
                report.warn(f"Directory {subdir} missing (skipped under --allow-empty).")
            else:
                report.error(f"Missing required asset directory: {subdir}")
            continue

        js_files = sorted(list(subdir.rglob("*.js")) + list(subdir.rglob("*.mjs")))
        if not js_files and not allow_empty:
            report.error(f"No .js/.mjs files found under {subdir}")
            continue

        for js_path in js_files:
            scanned_files += 1
            specs = extract_js_module_specifiers(js_path.read_text(encoding="utf-8"))
            for spec in specs:
                if is_external_or_ignored_ref(spec):
                    continue
                if spec.startswith(("./", "../", "/")):
                    if verify_local_ref(js_path, site_dir, "ES module import", spec, report):
                        checked_links += 1
                else:
                    report.error(
                        f"[{js_path.relative_to(site_dir)}] Unsupported bare module specifier {spec!r} "
                        "(must use relative local path)."
                    )

    report.static_summary = (
        f"Static asset & ES module check: scanned {scanned_files} HTML/JS/MJS file(s), "
        f"verified {checked_links} local reference(s)."
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate stem-stage catalog, song manifests, stem audio alignment/reconstruction, and static imports."
    )
    parser.add_argument(
        "--allow-empty",
        action="store_true",
        help=f"Allow an empty catalog (pre-separation dry run) and skip requiring the {len(EXEMPLAR_SONGS)} exemplar songs.",
    )
    parser.add_argument(
        "--skip-audio-check",
        action="store_true",
        help="Skip ffmpeg PCM decode and pairwise/mix-reconstruction correlation checks.",
    )
    parser.add_argument(
        "--site-dir",
        type=Path,
        default=DEFAULT_SITE_DIR,
        help=f"Site root directory (default: {DEFAULT_SITE_DIR})",
    )
    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=DEFAULT_RAW_DIR,
        help=f"Directory containing raw WAV mixes for reconstruction checks (default: {DEFAULT_RAW_DIR})",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    site_dir = args.site_dir.resolve()
    raw_dir = args.raw_dir.resolve()

    report = VerificationReport()

    if not site_dir.is_dir():
        report.error(f"Site directory does not exist: {site_dir}")
    else:
        verify_catalog_and_songs(
            site_dir=site_dir,
            raw_dir=raw_dir,
            allow_empty=args.allow_empty,
            skip_audio_check=args.skip_audio_check,
            report=report,
        )
        verify_static_assets_and_imports(site_dir=site_dir, allow_empty=args.allow_empty, report=report)

    if report.song_summaries:
        print(f"Verified {len(report.song_summaries)} song(s):")
        for line in report.song_summaries:
            print(line)
    else:
        print("Songs verified: 0")

    if report.static_summary:
        print(report.static_summary)

    for warning in report.warnings:
        print(f"[WARN] {warning}")

    if not report.ok:
        for err in report.errors:
            print(f"[ERROR] {err}", file=sys.stderr)
        print(f"VERIFY FAILED ({len(report.errors)} error(s))", file=sys.stderr)
        return 1

    print("VERIFY OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""End-to-end song ingestion pipeline: yt-dlp -> remote CUDA (WoL) or local separation -> build_catalog.py."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent
RAW_DIR = PROJECT_ROOT / "work" / "raw"
SONGS_DIR = PROJECT_ROOT / "site" / "songs"

_YT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def slugify(text: str) -> str:
    """Convert arbitrary title text into a safe URL/directory slug."""
    normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return slug or "song"


def extract_youtube_id(url_or_id: str) -> str:
    """Extract an 11-character YouTube video ID from a URL or bare ID."""
    candidate = url_or_id.strip()
    if _YT_ID_RE.match(candidate):
        return candidate

    parsed = urlparse(candidate)
    host = parsed.netloc.lower()
    if host.endswith("youtu.be"):
        seg = parsed.path.strip("/").split("/")[0]
        if _YT_ID_RE.match(seg):
            return seg
    if "youtube.com" in host or "youtube-nocookie.com" in host:
        qs = parse_qs(parsed.query)
        if "v" in qs and qs["v"] and _YT_ID_RE.match(qs["v"][0]):
            return qs["v"][0]
        parts = [p for p in parsed.path.split("/") if p]
        for idx, part in enumerate(parts):
            if part in {"shorts", "embed", "live", "v"} and idx + 1 < len(parts):
                if _YT_ID_RE.match(parts[idx + 1]):
                    return parts[idx + 1]
    return ""


def find_yt_dlp() -> list[str]:
    """Return command prefix to invoke yt-dlp cleanly."""
    exe = shutil.which("yt-dlp")
    if exe:
        return [exe]
    return [sys.executable, "-m", "yt_dlp"]


def find_ffmpeg_dir() -> str | None:
    """Locate ffmpeg parent directory for yt-dlp --ffmpeg-location."""
    for candidate in [
        shutil.which("ffmpeg"),
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ]:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate).parent)
    return None


def fetch_youtube_metadata(yt_dlp_cmd: list[str], source_url: str) -> dict[str, str]:
    """Query video id, title, and artist/uploader metadata without downloading audio."""
    cmd = [*yt_dlp_cmd, "--dump-single-json", "--no-playlist", "--no-warnings", source_url]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp metadata lookup failed: {proc.stderr.strip()}")
    data = json.loads(proc.stdout)
    artist = (
        data.get("artist")
        or data.get("creator")
        or data.get("uploader")
        or data.get("channel")
        or "Unknown Artist"
    )
    return {
        "id": str(data.get("id") or ""),
        "title": str(data.get("track") or data.get("title") or ""),
        "artist": str(artist),
    }


def download_youtube_wav(
    yt_dlp_cmd: list[str],
    source_url: str,
    raw_wav_path: Path,
    ffmpeg_dir: str | None,
    overwrite: bool,
) -> Path:
    """Download YouTube audio and extract a 44.1 kHz WAV into work/raw/<slug>.wav."""
    if raw_wav_path.is_file() and not overwrite:
        print(f"[download] Reusing existing raw audio: {raw_wav_path}")
        return raw_wav_path

    raw_wav_path.parent.mkdir(parents=True, exist_ok=True)
    if overwrite and raw_wav_path.exists():
        raw_wav_path.unlink()

    out_template = str(raw_wav_path.with_suffix(".%(ext)s"))
    cmd = [
        *yt_dlp_cmd,
        "--no-playlist",
        "-x",
        "--audio-format",
        "wav",
        "--audio-quality",
        "0",
        "--postprocessor-args",
        "ExtractAudio:-ar 44100 -ac 2",
        "-o",
        out_template,
    ]
    if ffmpeg_dir:
        cmd.extend(["--ffmpeg-location", ffmpeg_dir])
    cmd.append(source_url)

    print(f"[download] Fetching audio from YouTube -> {raw_wav_path}...")
    proc = subprocess.run(cmd, check=False)
    if proc.returncode != 0 or not raw_wav_path.is_file():
        raise RuntimeError(f"yt-dlp download failed with exit code {proc.returncode}")
    return raw_wav_path


def run_remote_separation(
    host: str,
    timeout: int,
    input_path: Path,
    slug: str,
    title: str,
    artist: str,
    youtube_id: str,
    out_dir: Path,
    shifts: int,
    overlap: float,
    segment: float | None,
    force_5_stems: bool,
) -> None:
    """Run separation remotely on logge-pc via wake_and_separate_remote.sh."""
    script = SCRIPTS_DIR / "wake_and_separate_remote.sh"
    cmd = [
        "bash",
        str(script),
        "--host",
        host,
        "--timeout",
        str(timeout),
        "--input",
        str(input_path),
        "--slug",
        slug,
        "--title",
        title,
        "--artist",
        artist,
        "--youtube-id",
        youtube_id,
        "--out-dir",
        str(out_dir),
        "--shifts",
        str(shifts),
        "--overlap",
        str(overlap),
    ]
    if segment is not None:
        cmd.extend(["--segment", str(segment)])
    cmd.append("--force-5-stems" if force_5_stems else "--auto-stems")

    proc = subprocess.run(cmd, check=False)
    if proc.returncode != 0:
        raise RuntimeError(
            f"Remote separation on {host} failed with exit code {proc.returncode}"
        )


def run_local_separation(
    input_path: Path,
    slug: str,
    title: str,
    artist: str,
    youtube_id: str,
    out_dir: Path,
    device: str,
    shifts: int,
    overlap: float,
    segment: float | None,
    force_5_stems: bool,
) -> None:
    """Run separation locally via scripts/separate_song.py."""
    script = SCRIPTS_DIR / "separate_song.py"
    cmd = [
        sys.executable,
        str(script),
        "--input",
        str(input_path),
        "--slug",
        slug,
        "--title",
        title,
        "--artist",
        artist,
        "--youtube-id",
        youtube_id,
        "--out-dir",
        str(out_dir),
        "--device",
        device,
        "--shifts",
        str(shifts),
        "--overlap",
        str(overlap),
    ]
    if segment is not None:
        cmd.extend(["--segment", str(segment)])
    cmd.append("--force-5-stems" if force_5_stems else "--auto-stems")

    proc = subprocess.run(cmd, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"Local separation failed with exit code {proc.returncode}")


def rebuild_catalog() -> None:
    """Rebuild site/songs/index.json using scripts/build_catalog.py."""
    catalog_script = SCRIPTS_DIR / "build_catalog.py"
    if not catalog_script.is_file():
        raise FileNotFoundError(f"Missing catalog builder script: {catalog_script}")
    proc = subprocess.run([sys.executable, str(catalog_script)], check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"build_catalog.py failed with exit code {proc.returncode}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Add a song to stem-stage: yt-dlp download -> remote CUDA (WoL) or local separation -> build_catalog.py."
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--youtube", "-y", help="YouTube URL or 11-char video ID")
    src.add_argument("--input", "-i", type=Path, help="Existing local audio file")

    parser.add_argument("--slug", default=None, help="Song slug/id (auto-derived from title if omitted)")
    parser.add_argument("--title", default=None, help="Song display title")
    parser.add_argument("--artist", default=None, help="Song artist")
    parser.add_argument("--youtube-id", default=None, help="Explicit YouTube video ID for song.json")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="Output directory (default: site/songs/<slug>)",
    )

    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--remote",
        nargs="?",
        const="logge-pc",
        default=None,
        metavar="HOST",
        help="Separate on remote CUDA host via Wake-on-LAN + SSH (default host: logge-pc)",
    )
    mode.add_argument(
        "--local",
        action="store_true",
        help="Separate locally on this machine",
    )

    parser.add_argument(
        "--fallback-local",
        action="store_true",
        default=False,
        help="Fall back to local separation if --remote host fails/is unreachable (enabled automatically when neither --remote nor --local is passed)",
    )
    parser.add_argument(
        "--device",
        choices=["auto", "cuda", "mps", "cpu"],
        default="auto",
        help="Compute device when running locally (default: auto)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=45,
        help="Wake-on-LAN SSH timeout in seconds for remote mode (default: 45)",
    )
    parser.add_argument("--shifts", type=int, default=4, help="Demucs random shifts (default: 4)")
    parser.add_argument("--overlap", type=float, default=0.25, help="Demucs chunk overlap (default: 0.25)")
    parser.add_argument("--segment", type=float, default=None, help="Optional Demucs segment length in seconds")

    stem_mode = parser.add_mutually_exclusive_group()
    stem_mode.add_argument("--auto-stems", action="store_true", default=True, help="Enable bleed gate (default)")
    stem_mode.add_argument("--force-5-stems", action="store_true", default=False, help="Force all 5 stems")

    parser.add_argument("--overwrite", action="store_true", help="Re-download raw WAV even if cached in work/raw/")
    parser.add_argument("--skip-catalog", action="store_true", help="Skip running build_catalog.py after separation")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    title = args.title
    artist = args.artist
    youtube_id = args.youtube_id or ""

    if args.youtube:
        yt_dlp_cmd = find_yt_dlp()
        ffmpeg_dir = find_ffmpeg_dir()
        yt_source = args.youtube.strip()
        if not youtube_id:
            youtube_id = extract_youtube_id(yt_source)
        if _YT_ID_RE.match(yt_source):
            yt_source = f"https://www.youtube.com/watch?v={yt_source}"

        if not title or not artist:
            meta = fetch_youtube_metadata(yt_dlp_cmd, yt_source)
            youtube_id = youtube_id or meta["id"]
            title = title or meta["title"]
            artist = artist or meta["artist"]

        if not title:
            raise ValueError("Could not determine song --title from YouTube metadata; pass --title explicitly.")
        artist = artist or "Unknown Artist"
        slug = args.slug or slugify(title)
        raw_wav = RAW_DIR / f"{slug}.wav"
        input_path = download_youtube_wav(yt_dlp_cmd, yt_source, raw_wav, ffmpeg_dir, args.overwrite)
    else:
        assert args.input is not None
        input_path = args.input.resolve()
        if not input_path.is_file():
            raise FileNotFoundError(f"Input audio file not found: {input_path}")
        if not title:
            title = input_path.stem.replace("-", " ").replace("_", " ").strip().title()
        artist = artist or "Unknown Artist"
        slug = args.slug or slugify(title)

    if not re.match(r"^[a-zA-Z0-9._-]+$", slug):
        raise ValueError(f"Invalid slug '{slug}'; only [a-zA-Z0-9._-] are permitted.")

    out_dir = (args.out_dir or (SONGS_DIR / slug)).resolve()

    auto_mode = (args.remote is None) and (not args.local)
    remote_host = args.remote or "logge-pc"
    allow_fallback = args.fallback_local or auto_mode

    if args.local:
        print(f"[pipeline] Separating '{title}' locally (device={args.device})...")
        run_local_separation(
            input_path=input_path,
            slug=slug,
            title=title,
            artist=artist,
            youtube_id=youtube_id,
            out_dir=out_dir,
            device=args.device,
            shifts=args.shifts,
            overlap=args.overlap,
            segment=args.segment,
            force_5_stems=args.force_5_stems,
        )
    else:
        try:
            print(f"[pipeline] Separating '{title}' remotely on {remote_host} (CUDA)...")
            run_remote_separation(
                host=remote_host,
                timeout=args.timeout,
                input_path=input_path,
                slug=slug,
                title=title,
                artist=artist,
                youtube_id=youtube_id,
                out_dir=out_dir,
                shifts=args.shifts,
                overlap=args.overlap,
                segment=args.segment,
                force_5_stems=args.force_5_stems,
            )
        except Exception as exc:
            if not allow_fallback:
                raise
            print(f"[pipeline] Remote separation unavailable ({exc}); falling back to --local...", file=sys.stderr)
            run_local_separation(
                input_path=input_path,
                slug=slug,
                title=title,
                artist=artist,
                youtube_id=youtube_id,
                out_dir=out_dir,
                device=args.device,
                shifts=args.shifts,
                overlap=args.overlap,
                segment=args.segment,
                force_5_stems=args.force_5_stems,
            )

    if not args.skip_catalog:
        print("[catalog] Rebuilding site/songs/index.json...")
        rebuild_catalog()

    print(f"[pipeline] Complete! Song '{slug}' ready in {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

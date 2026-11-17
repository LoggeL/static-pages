#!/usr/bin/env python3
"""Build site/songs/index.json from site/songs/*/song.json manifests."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SONGS_DIR = PROJECT_ROOT / "site" / "songs"

CANONICAL_ORDER = ["american-idiot", "in-the-end", "get-lucky"]
CANONICAL_ACCENTS = {
    "american-idiot": "#f43f5e",
    "in-the-end": "#38bdf8",
    "get-lucky": "#a855f7",
}
DEFAULT_ACCENT = "#f43f5e"


def resolve_accent(song_id: str, manifest: dict[str, Any], stems: list[dict[str, Any]]) -> str:
    """Resolve a song's accent color from manifest, canonical table, or stems."""
    explicit = manifest.get("accent")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()

    if song_id in CANONICAL_ACCENTS:
        return CANONICAL_ACCENTS[song_id]

    if len(stems) >= 2 and isinstance(stems[1].get("color"), str) and stems[1]["color"].strip():
        return stems[1]["color"].strip()

    if stems and isinstance(stems[0].get("color"), str) and stems[0]["color"].strip():
        return stems[0]["color"].strip()

    return DEFAULT_ACCENT


def sort_key(entry: dict[str, Any]) -> tuple[int, int, str, str]:
    """Order canonical songs first, then remaining songs alphabetically by id."""
    song_id = str(entry["id"])
    if song_id in CANONICAL_ORDER:
        return (0, CANONICAL_ORDER.index(song_id), song_id, song_id)
    return (1, 0, song_id.lower(), song_id)


def build_catalog(songs_dir: Path, output_path: Path) -> dict[str, list[dict[str, Any]]]:
    """Scan song manifests under songs_dir and write catalog JSON to output_path."""
    entries: list[dict[str, Any]] = []

    if songs_dir.is_dir():
        for candidate in sorted(songs_dir.iterdir(), key=lambda p: p.name):
            if not candidate.is_dir():
                continue
            manifest_path = candidate / "song.json"
            if not manifest_path.is_file():
                continue

            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not isinstance(manifest, dict):
                raise ValueError(f"Manifest must be a JSON object: {manifest_path}")

            song_id = str(manifest.get("id") or candidate.name)
            raw_stems = manifest.get("stems") or []
            stems = [stem for stem in raw_stems if isinstance(stem, dict)]
            stem_ids = [str(stem["id"]) for stem in stems if "id" in stem]

            entry: dict[str, Any] = {
                "id": song_id,
                "title": manifest.get("title", song_id),
                "artist": manifest.get("artist", "Unknown Artist"),
                "duration": manifest.get("duration", 0.0),
                "bpm": manifest.get("bpm"),
                "accent": resolve_accent(song_id, manifest, stems),
                "manifestUrl": f"./songs/{candidate.name}/song.json",
                "stemIds": stem_ids,
            }
            entries.append(entry)

    entries.sort(key=sort_key)
    catalog = {"songs": entries}

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return catalog


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build site/songs/index.json from site/songs/*/song.json."
    )
    parser.add_argument(
        "--songs-dir",
        type=Path,
        default=DEFAULT_SONGS_DIR,
        help=f"Songs directory to scan (default: {DEFAULT_SONGS_DIR})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output catalog JSON path (default: <songs-dir>/index.json)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    songs_dir = args.songs_dir.resolve()
    output_path = args.output.resolve() if args.output else songs_dir / "index.json"
    try:
        catalog = build_catalog(songs_dir, output_path)
    except Exception as exc:
        print(f"Error building catalog: {exc}", file=sys.stderr)
        return 1

    print(f"Wrote {len(catalog['songs'])} song(s) to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

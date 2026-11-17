#!/usr/bin/env python3
"""
Importiert fertig getrennte WAV-Stems (z. B. aus separate_hq.py auf dem GPU-Rechner) in die App.

  python3 tools/import_stems.py --dir <ordner mit vocals.wav, drums.wav, …> --id enter-sandman \
      --title "Enter Sandman" --artist "Metallica" [--bpm 123] [--bitrate 160k] [--silence-db 30]

- verwirft (fast) stille Stems (Pegel > --silence-db unter dem lautesten Stem)
- kodiert MP3 (Stereo, 44.1 kHz, identische Sample-Anzahl) nach app/songs/<id>/
- schätzt BPM (falls nicht angegeben) und trägt den Song in app/songs/songs.json ein
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prepare_song as ps  # noqa: E402  (Helfer & Vertragskonstanten wiederverwenden)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", required=True, type=Path)
    ap.add_argument("--id", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--artist", required=True)
    ap.add_argument("--bpm", type=float)
    ap.add_argument("--bitrate", default="160k")
    ap.add_argument("--silence-db", type=float, default=30.0)
    ap.add_argument("--source", default="file")
    args = ap.parse_args()

    stems = {n: args.dir / f"{n}.wav" for n in ps.STEM_ORDER if (args.dir / f"{n}.wav").exists()}
    if not stems:
        sys.exit(f"Keine Stems in {args.dir}")

    stats = {n: ps.analyze_stem(p) for n, p in stems.items()}
    loudest = max(ps.db(s["rms"]) for s in stats.values())
    keep = [n for n in ps.STEM_ORDER if n in stats and ps.db(stats[n]["rms"]) >= loudest - args.silence_db]
    for n in stats:
        mark = "✓" if n in keep else "✗ (zu leise)"
        print(f"  {n:7s} {ps.db(stats[n]['rms']):6.1f} dB  peak {stats[n]['peak']:.2f}  {mark}")
    if len(keep) < ps.MIN_STEMS:
        sys.exit("Zu wenige hörbare Stems.")

    frames = min(stats[n]["frames"] for n in keep)
    bpm = args.bpm
    if bpm is None and "drums" in stems:
        bpm = ps.estimate_bpm(stems["drums"], 80.0, 200.0)
    bpm = round(bpm or 120)

    out = ps.song_dir(args.id)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for n in keep:
        ps.encode_mp3(stems[n], out / f"{n}.mp3", 1.0, frames, args.bitrate)

    entry = {
        "id": args.id,
        "title": args.title,
        "artist": args.artist,
        "bpm": bpm,
        "duration": round(frames / ps.SAMPLE_RATE, 2),
        "source": args.source,
        "stems": [
            {"id": n, "label": ps.STEM_LABELS[n], "instrument": n,
             "file": f"songs/{args.id}/{n}.mp3", "color": ps.STEM_COLORS[n]}
            for n in keep
        ],
    }
    action = ps.upsert_song(entry)
    size = sum(f.stat().st_size for f in out.iterdir()) / 1e6
    print(f"{args.id}: {len(keep)} Stems, {entry['duration']}s, {bpm} BPM, {size:.1f} MB – {action}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

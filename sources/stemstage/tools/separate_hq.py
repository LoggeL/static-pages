#!/usr/bin/env python3
"""
StemStage – Hochqualitäts-Stem-Trennung (läuft auf dem GPU-Rechner, braucht audio-separator + CUDA-Torch).

Kaskade (Standard, "roformer"):
  1. Gesang : Mel-Band-RoFormer (vocals_mel_band_roformer)  -> vocals + Instrumental
  2. Band   : BS-Roformer-SW (6 Stems) auf dem Instrumental   -> drums, bass, guitar, piano, other
              (Vocal-Rest aus Schritt 2 wird verworfen – der Gesang kommt sauber aus Schritt 1)

Ausweichkaskade ("demucs"): RoFormer-Gesang -> htdemucs_ft (drums/bass/other) -> htdemucs_6s auf other.

Ausgabe: <out>/<id>/{vocals,guitar,bass,drums,piano,other}.wav (float32, 44.1 kHz, Stereo, gleiche Länge) + info.json

  python separate_hq.py --in song.wav --id my-song --out D:\\AI\\stemstage\\out
"""
from __future__ import annotations

import argparse
import gc
import json
import re
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

HERE = Path(__file__).resolve().parent
MODEL_DIR = HERE / "models"

VOCAL_MODEL = "vocals_mel_band_roformer.ckpt"
BAND_MODEL = "BS-Roformer-SW.ckpt"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def ensure_ffmpeg() -> None:
    if shutil.which("ffmpeg"):
        return
    try:
        import static_ffmpeg  # pip install static-ffmpeg

        static_ffmpeg.add_paths()
    except ImportError:
        pass
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg nicht gefunden – bitte installieren oder `pip install static-ffmpeg`.")


def make_separator(out_dir: Path, overlap: int, shifts: int):
    ensure_ffmpeg()
    from audio_separator.separator import Separator

    return Separator(
        output_dir=str(out_dir),
        model_file_dir=str(MODEL_DIR),
        output_format="WAV",
        normalization_threshold=1.0,   # keine Normalisierung -> Stems bleiben pegelkonsistent
        amplification_threshold=0.0,
        sample_rate=44100,
        use_autocast=False,            # volle fp32-Präzision
        mdxc_params={"segment_size": 256, "override_model_segment_size": False,
                     "batch_size": 1, "overlap": overlap, "pitch_shift": 0},
        demucs_params={"segment_size": "Default", "shifts": shifts, "overlap": 0.5, "segments_enabled": True},
    )


def run(sep, model: str, src: Path, tag: str) -> dict[str, Path]:
    """Trennt src mit model und gibt {stemname_lower: pfad} zurück (aus '(Stem)' im Dateinamen)."""
    log(f"  {model} auf {src.name} …")
    t = time.time()
    sep.load_model(model_filename=model)
    files = sep.separate(str(src))
    out: dict[str, Path] = {}
    for f in files:
        p = Path(f)
        if not p.is_absolute():
            p = Path(sep.output_dir) / p
        m = re.findall(r"\(([^)]+)\)", p.name)
        stem = (m[-1] if m else p.stem).lower()
        dst = p.with_name(f"{tag}_{stem}.wav")
        p.replace(dst)
        out[stem] = dst
    log(f"  fertig in {time.time() - t:.0f}s -> {sorted(out)}")
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return out


def pick(d: dict[str, Path], *names: str) -> Path:
    for n in names:
        if n in d:
            return d[n]
    raise KeyError(f"keiner von {names} in {sorted(d)}")


def read(p: Path) -> np.ndarray:
    a, sr = sf.read(str(p), dtype="float32", always_2d=True)
    if sr != 44100:
        raise ValueError(f"{p}: {sr} Hz")
    if a.shape[1] == 1:
        a = np.repeat(a, 2, axis=1)
    return a[:, :2]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="inp", required=True, type=Path)
    ap.add_argument("--id", required=True)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--mode", choices=["roformer", "demucs"], default="roformer")
    ap.add_argument("--vocal-model", default=VOCAL_MODEL)
    ap.add_argument("--band-model", default=BAND_MODEL)
    ap.add_argument("--overlap", type=int, default=8, help="RoFormer-Overlap (höher = besser, langsamer)")
    ap.add_argument("--shifts", type=int, default=4, help="Demucs-Shifts (nur --mode demucs)")
    args = ap.parse_args()

    cuda = torch.cuda.is_available()
    log(f"torch {torch.__version__}, CUDA={cuda}"
        + (f", {torch.cuda.get_device_name(0)}, frei {torch.cuda.mem_get_info()[0] / 1e9:.1f} GB" if cuda else ""))

    final = args.out / args.id
    work = args.out / f"_work_{args.id}"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    final.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    sep = make_separator(work, args.overlap, args.shifts)

    log("Schritt 1: Gesang")
    s1 = run(sep, args.vocal_model, args.inp, "s1")
    vocals = pick(s1, "vocals")
    inst = pick(s1, "instrumental", "other", "no vocals")

    stems: dict[str, np.ndarray] = {"vocals": read(vocals)}
    if args.mode == "roformer":
        log("Schritt 2: Band (BS-Roformer-SW)")
        s2 = run(sep, args.band_model, inst, "s2")
        for name in ("drums", "bass", "guitar", "piano", "other"):
            stems[name] = read(pick(s2, name))
    else:
        log("Schritt 2: Drums & Bass (htdemucs_ft)")
        s2 = run(sep, "htdemucs_ft.yaml", inst, "s2")
        stems["drums"] = read(pick(s2, "drums"))
        stems["bass"] = read(pick(s2, "bass"))
        log("Schritt 3: Gitarre & Keys (htdemucs_6s)")
        s3 = run(sep, "htdemucs_6s.yaml", pick(s2, "other"), "s3")
        stems["guitar"] = read(pick(s3, "guitar"))
        stems["piano"] = read(pick(s3, "piano"))
        other = read(pick(s3, "other"))
        for k in ("drums", "bass", "vocals"):
            if k in s3:
                r = read(s3[k]); n = min(len(other), len(r)); other = other[:n] + r[:n]
        stems["other"] = other

    n = min(len(a) for a in stems.values())
    info: dict = {}
    for name, a in stems.items():
        a = a[:n]
        sf.write(str(final / f"{name}.wav"), a, 44100, subtype="FLOAT")
        rms = float(np.sqrt(np.mean(a.astype(np.float64) ** 2)) + 1e-12)
        info[name] = {"rms_db": round(20 * np.log10(rms), 1), "peak": round(float(np.abs(a).max()), 3)}
    info["_seconds"] = round(n / 44100, 2)
    info["_elapsed"] = round(time.time() - t0)
    info["_mode"] = args.mode
    (final / "info.json").write_text(json.dumps(info, indent=2))
    shutil.rmtree(work, ignore_errors=True)
    log(f"FERTIG {args.id}: {json.dumps(info)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

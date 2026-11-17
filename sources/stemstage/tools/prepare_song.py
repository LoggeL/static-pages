#!/usr/bin/env python3
"""StemStage – echte Songs für die App vorbereiten.

Holt Audio (YouTube via yt-dlp oder lokale Datei), trennt es mit Demucs
(Meta, Hybrid Transformer Demucs) in Instrument-Spuren ("Stems"), kodiert
sie als MP3 für das Web und trägt den Song in app/songs/songs.json ein.

Beispiele:
  python tools/prepare_song.py --url "https://www.youtube.com/watch?v=..." --id mein-song
  python tools/prepare_song.py --file ~/Musik/song.flac --title "Mein Song" --artist "Band"
  python tools/prepare_song.py --list
  python tools/prepare_song.py --remove mein-song

Nur für den Unterricht / die eigene Nutzung – siehe tools/README.md (Urheberrecht).
"""

from __future__ import annotations

import argparse
import contextlib
import importlib.util
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
from pathlib import Path

# --------------------------------------------------------------------------
# Pfade (relativ zur Skriptposition, damit das Skript von überall läuft)
# --------------------------------------------------------------------------
TOOLS_DIR = Path(__file__).resolve().parent
ROOT_DIR = TOOLS_DIR.parent
APP_DIR = ROOT_DIR / "app"
SONGS_DIR = APP_DIR / "songs"
SONGS_JSON = SONGS_DIR / "songs.json"
WORK_ROOT = TOOLS_DIR / ".work"
VENV_DIR = TOOLS_DIR / ".venv"
VENV_PY = VENV_DIR / "bin" / "python"

SAMPLE_RATE = 44100

# --------------------------------------------------------------------------
# Vertrag (CONTRACT.md): Reihenfolge, Labels, Farben
# --------------------------------------------------------------------------
STEM_ORDER = ["vocals", "guitar", "bass", "drums", "piano", "other"]
STEM_LABELS = {
    "vocals": "Gesang",
    "guitar": "Gitarre",
    "bass": "E-Bass",
    "drums": "Schlagzeug",
    "piano": "Keyboard",
    "other": "Sonstiges",
}
STEM_COLORS = {
    "vocals": "#ff3d8b",
    "guitar": "#ffb020",
    "bass": "#3dd6ff",
    "drums": "#7cff4d",
    "piano": "#b26bff",
    "other": "#ff7a45",
}
MODEL_STEMS = {
    "htdemucs_6s": ["vocals", "drums", "bass", "guitar", "piano", "other"],
    "htdemucs_ft": ["vocals", "drums", "bass", "other"],
    "htdemucs": ["vocals", "drums", "bass", "other"],
}
MIN_STEMS = 3  # Vertrag: ein Song hat 3–6 Stems

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


# --------------------------------------------------------------------------
# Ausgabe-Helfer
# --------------------------------------------------------------------------
def info(msg: str) -> None:
    print(f"  {msg}", flush=True)


def step(msg: str) -> None:
    print(f"\n▶ {msg}", flush=True)


def warn(msg: str) -> None:
    print(f"  ⚠ {msg}", flush=True)


class Abbruch(Exception):
    """Fehler mit verständlicher deutscher Meldung."""


def fmt_time(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    m, s = divmod(int(round(seconds)), 60)
    return f"{m}:{s:02d}"


def run(cmd: list[str], *, quiet: bool = False, env: dict | None = None) -> None:
    """Startet einen Prozess; bei Fehler Abbruch mit Hinweis."""
    try:
        subprocess.run(
            cmd,
            check=True,
            env=env,
            stdout=subprocess.DEVNULL if quiet else None,
            stderr=subprocess.PIPE if quiet else None,
            text=True,
        )
    except FileNotFoundError as exc:
        raise Abbruch(f"Programm nicht gefunden: {cmd[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip()
        tail = "\n".join(detail.splitlines()[-8:]) if detail else ""
        raise Abbruch(
            f"Befehl fehlgeschlagen (Exit-Code {exc.returncode}):\n    {' '.join(cmd[:6])} …"
            + (f"\n{tail}" if tail else "")
        ) from exc


# --------------------------------------------------------------------------
# Abhängigkeiten
# --------------------------------------------------------------------------
INSTALL_HINT = f"""\
  So richtest du die Umgebung ein (einmalig, macOS):

    brew install ffmpeg python@3.12          # falls noch nicht vorhanden
    python3.12 -m venv "{VENV_DIR}"
    "{VENV_PY}" -m pip install -U pip
    "{VENV_PY}" -m pip install -r "{TOOLS_DIR / 'requirements.txt'}"

  Danach das Skript mit dem venv-Python starten:
    "{VENV_PY}" "{TOOLS_DIR / 'prepare_song.py'}" --help
  (Liegt ein venv unter tools/.venv, wechselt das Skript automatisch dorthin.)"""


def maybe_reexec_in_venv(need_modules: list[str]) -> None:
    """Wenn Module fehlen, aber tools/.venv existiert: Skript dort neu starten."""
    missing = [m for m in need_modules if importlib.util.find_spec(m) is None]
    if not missing:
        return
    if not VENV_PY.exists() or os.environ.get("STEMSTAGE_REEXEC") == "1":
        return
    try:
        if Path(sys.prefix).resolve() == VENV_DIR.resolve():
            return
    except OSError:
        pass
    print(f"ℹ Starte im venv neu ({VENV_PY}) …", flush=True)
    env = dict(os.environ, STEMSTAGE_REEXEC="1")
    os.execve(str(VENV_PY), [str(VENV_PY), str(Path(__file__).resolve()), *sys.argv[1:]], env)


def ytdlp_cmd() -> list[str] | None:
    if importlib.util.find_spec("yt_dlp") is not None:
        return [sys.executable, "-m", "yt_dlp"]
    exe = shutil.which("yt-dlp")
    return [exe] if exe else None


def check_dependencies(*, need_ytdlp: bool, need_demucs: bool) -> None:
    step("Prüfe Abhängigkeiten")
    problems: list[str] = []

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        problems.append("ffmpeg fehlt → brew install ffmpeg")
    else:
        try:
            enc = subprocess.run(
                [ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True, check=True
            ).stdout
            if "libmp3lame" not in enc:
                problems.append("ffmpeg kann kein MP3 (libmp3lame fehlt) → brew reinstall ffmpeg")
            else:
                info(f"ffmpeg: {ffmpeg}")
        except (OSError, subprocess.CalledProcessError):
            problems.append("ffmpeg lässt sich nicht starten → brew reinstall ffmpeg")

    if importlib.util.find_spec("numpy") is None:
        problems.append("Python-Modul numpy fehlt → pip install -r tools/requirements.txt")
    else:
        info("numpy: ok")

    if need_ytdlp:
        cmd = ytdlp_cmd()
        if cmd is None:
            problems.append('yt-dlp fehlt → pip install -r tools/requirements.txt (oder "brew install yt-dlp")')
        else:
            info(f"yt-dlp: {' '.join(cmd[-2:]) if len(cmd) > 1 else cmd[0]}")

    if need_demucs:
        if importlib.util.find_spec("demucs") is None:
            problems.append("Python-Modul demucs fehlt → pip install -r tools/requirements.txt")
        elif importlib.util.find_spec("torch") is None:
            problems.append("PyTorch (torch) fehlt → pip install -r tools/requirements.txt")
        else:
            try:
                from importlib.metadata import version

                info(f"demucs: {version('demucs')}, torch: {version('torch')}")
            except Exception:  # noqa: BLE001
                info("demucs: ok")

    if problems:
        msg = "Es fehlen Werkzeuge:\n" + "\n".join(f"    • {p}" for p in problems)
        raise Abbruch(msg + "\n\n" + INSTALL_HINT)


def pick_device(requested: str) -> str:
    if requested != "auto":
        return requested
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        try:
            out = subprocess.run(
                [sys.executable, "-c", "import torch;print(torch.backends.mps.is_available())"],
                capture_output=True, text=True, timeout=120,
            ).stdout.strip()
            if out == "True":
                return "mps"
        except (OSError, subprocess.TimeoutExpired):
            pass
    try:
        out = subprocess.run(
            [sys.executable, "-c", "import torch;print(torch.cuda.is_available())"],
            capture_output=True, text=True, timeout=120,
        ).stdout.strip()
        if out == "True":
            return "cuda"
    except (OSError, subprocess.TimeoutExpired):
        pass
    return "cpu"


# --------------------------------------------------------------------------
# songs.json (frisch lesen, mit Lock, atomar schreiben)
# --------------------------------------------------------------------------
@contextlib.contextmanager
def songs_lock():
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    lock_path = WORK_ROOT / "songs.json.lock"
    with open(lock_path, "w") as fh:
        try:
            import fcntl

            fcntl.flock(fh, fcntl.LOCK_EX)
        except ImportError:  # Windows: ohne Lock weiter
            pass
        yield


def read_songs() -> dict:
    if not SONGS_JSON.exists():
        return {"songs": []}
    try:
        data = json.loads(SONGS_JSON.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise Abbruch(
            f"{SONGS_JSON} ist kein gültiges JSON ({exc}). Bitte zuerst reparieren – "
            "die Datei wird nicht überschrieben."
        ) from exc
    if not isinstance(data, dict) or not isinstance(data.get("songs", []), list):
        raise Abbruch(f'{SONGS_JSON} hat nicht das erwartete Format {{"songs": [...]}}.')
    data.setdefault("songs", [])
    return data


def write_songs_atomic(data: dict) -> None:
    SONGS_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".songs.", suffix=".json.tmp", dir=SONGS_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, SONGS_JSON)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def upsert_song(entry: dict) -> str:
    with songs_lock():
        data = read_songs()  # unmittelbar vor dem Schreiben frisch lesen
        songs = data["songs"]
        for i, s in enumerate(songs):
            if isinstance(s, dict) and s.get("id") == entry["id"]:
                songs[i] = entry
                action = "ersetzt"
                break
        else:
            songs.append(entry)
            action = "hinzugefügt"
        write_songs_atomic(data)
    return action


def remove_song_entry(song_id: str) -> bool:
    with songs_lock():
        data = read_songs()
        before = len(data["songs"])
        data["songs"] = [s for s in data["songs"] if not (isinstance(s, dict) and s.get("id") == song_id)]
        if len(data["songs"]) == before:
            return False
        write_songs_atomic(data)
    return True


def song_dir(song_id: str) -> Path:
    d = (SONGS_DIR / song_id).resolve()
    if d.parent != SONGS_DIR.resolve():
        raise Abbruch(f"Ungültige Song-ID: {song_id!r}")
    return d


# --------------------------------------------------------------------------
# Hilfsfunktionen: Slug, Metadaten
# --------------------------------------------------------------------------
def slugify(text: str, max_len: int = 48) -> str:
    repl = {"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss", "&": " und "}
    for k, v in repl.items():
        text = text.replace(k, v)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    text = text[:max_len].rstrip("-")
    return text or f"song-{int(time.time())}"


_TITLE_JUNK = re.compile(
    r"\s*[\(\[][^\)\]]*(official|video|audio|lyrics?|lyric video|hd|hq|4k|remaster(ed)?|"
    r"visuali[sz]er|clip|musikvideo)[^\)\]]*[\)\]]",
    re.IGNORECASE,
)


def clean_title(title: str) -> str:
    title = _TITLE_JUNK.sub("", title)
    return re.sub(r"\s{2,}", " ", title).strip(" -–|")


def meta_from_ytdlp(meta: dict) -> tuple[str, str]:
    """(Titel, Künstler) aus den yt-dlp-Metadaten ableiten."""
    raw_title = (meta.get("track") or meta.get("title") or "").strip()
    artist = (meta.get("artist") or meta.get("creator") or "").strip()
    if artist and "," in artist and meta.get("artists"):
        artist = ", ".join(meta["artists"][:2])
    title = raw_title
    if not meta.get("track") and " - " in raw_title:
        left, right = raw_title.split(" - ", 1)
        if not artist:
            artist = left.strip()
        title = right
    if not artist:
        artist = (meta.get("uploader") or meta.get("channel") or "").strip()
        artist = re.sub(r"\s*-\s*Topic$", "", artist)
        artist = re.sub(r"(VEVO|Official)$", "", artist).strip()
    return clean_title(title) or "Unbenannter Song", artist or "Unbekannt"


# --------------------------------------------------------------------------
# Audio holen und vorbereiten
# --------------------------------------------------------------------------
def download_youtube(url: str, work: Path) -> tuple[Path, dict]:
    step("Lade Audio mit yt-dlp")
    cmd = ytdlp_cmd()
    assert cmd is not None
    for old in work.glob("download.*"):
        old.unlink()
    run(
        cmd
        + [
            "--no-playlist",
            "-f", "bestaudio/best",
            "-x", "--audio-format", "wav",
            "--write-info-json",
            "-o", str(work / "download.%(ext)s"),
            url,
        ]
    )
    wav = work / "download.wav"
    if not wav.exists():
        cands = [p for p in work.glob("download.*") if p.suffix not in (".json", ".part")]
        if not cands:
            raise Abbruch("yt-dlp hat keine Audiodatei erzeugt.")
        wav = cands[0]
    meta: dict = {}
    meta_file = work / "download.info.json"
    if meta_file.exists():
        with contextlib.suppress(json.JSONDecodeError):
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
    return wav, meta


def prepare_input(src: Path, dst: Path, start: float | None, end: float | None) -> None:
    """Nach 44,1 kHz Stereo-WAV wandeln, optional Ausschnitt."""
    step("Bereite Eingabe vor" + (" (Ausschnitt)" if start is not None or end is not None else ""))
    cmd = ["ffmpeg", "-y", "-v", "error", "-nostdin"]
    if start:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(src)]
    if end is not None:
        cmd += ["-t", f"{end - (start or 0.0):.3f}"]
    cmd += ["-vn", "-ac", "2", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", str(dst)]
    run(cmd, quiet=True)
    if not dst.exists() or dst.stat().st_size < 1000:
        raise Abbruch("Die Eingabe enthält kein (ausreichend langes) Audio – stimmen --start/--end?")


# --------------------------------------------------------------------------
# Trennung
# --------------------------------------------------------------------------
def separate_demucs(wav: Path, work: Path, model: str, shifts: int, device: str) -> dict[str, Path]:
    out = work / "separated"
    if out.exists():
        shutil.rmtree(out)

    def attempt(dev: str) -> None:
        step(f"Trenne Stems mit Demucs ({model}, shifts={shifts}, Gerät={dev})")
        info("Das dauert – beim ersten Lauf wird außerdem das Modell heruntergeladen.")
        env = dict(os.environ)
        if dev == "mps":
            env.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
        run(
            [
                sys.executable, "-m", "demucs",
                "-n", model,
                "--shifts", str(shifts),
                "-d", dev,
                "--float32",
                "-o", str(out),
                str(wav),
            ],
            env=env,
        )

    t0 = time.time()
    try:
        attempt(device)
    except Abbruch as exc:
        if device == "cpu":
            raise
        warn(f"Demucs auf '{device}' fehlgeschlagen – versuche es auf der CPU.\n{exc}")
        if out.exists():
            shutil.rmtree(out)
        attempt("cpu")
    info(f"Trennung fertig nach {fmt_time(time.time() - t0)} (min:s)")

    found: dict[str, Path] = {}
    for p in out.rglob("*.wav"):
        found[p.stem] = p
    if not found:
        raise Abbruch(f"Demucs hat keine Stems erzeugt (erwartet unter {out}).")
    return found


def separate_fake(wav: Path, work: Path, model: str) -> dict[str, Path]:
    """Nur zum Testen der Pipeline: erzeugt 'Stems' per Filter statt Demucs."""
    step(f"FAKE-Trennung (Test, kein Demucs) für Modell {model}")
    out = work / "separated" / "fake"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    filters = {
        "bass": "lowpass=f=250,lowpass=f=250",
        "drums": "highpass=f=4000,highpass=f=4000",
        "vocals": "bandpass=f=900:width_type=o:w=2",
        "guitar": "bandpass=f=1600:width_type=o:w=1,volume=0.7",
        "piano": "volume=0.0005",  # nahezu still → muss verworfen werden
        "other": "highpass=f=2500,lowpass=f=6000,volume=0.5",
    }
    found: dict[str, Path] = {}
    for stem in MODEL_STEMS.get(model, MODEL_STEMS["htdemucs"]):
        dst = out / f"{stem}.wav"
        run(
            ["ffmpeg", "-y", "-v", "error", "-nostdin", "-i", str(wav), "-af", filters[stem],
             "-c:a", "pcm_f32le", str(dst)],
            quiet=True,
        )
        found[stem] = dst
        info(f"{stem}: {filters[stem]}")
    return found


# --------------------------------------------------------------------------
# Analyse: Pegel, Länge, BPM
# --------------------------------------------------------------------------
def decode_stream(path: Path, channels: int, rate: int):
    """Liefert float32-Blöcke (frames × channels) über eine ffmpeg-Pipe."""
    import numpy as np

    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-f", "f32le",
         "-ac", str(channels), "-ar", str(rate), "-"],
        stdout=subprocess.PIPE,
    )
    assert proc.stdout is not None
    block = rate * channels * 4 * 5  # ~5 s pro Block
    rest = b""
    try:
        while True:
            chunk = proc.stdout.read(block)
            if not chunk:
                break
            chunk = rest + chunk
            usable = len(chunk) - (len(chunk) % (4 * channels))
            rest = chunk[usable:]
            if usable:
                yield np.frombuffer(chunk[:usable], dtype=np.float32).reshape(-1, channels)
    finally:
        proc.stdout.close()
        if proc.wait() != 0:
            raise Abbruch(f"ffmpeg konnte {path.name} nicht lesen.")


def analyze_stem(path: Path) -> dict:
    import numpy as np

    frames = 0
    sumsq = 0.0
    peak = 0.0
    for blk in decode_stream(path, 2, SAMPLE_RATE):
        frames += blk.shape[0]
        b64 = blk.astype(np.float64)
        sumsq += float(np.sum(b64 * b64))
        peak = max(peak, float(np.max(np.abs(blk))) if blk.size else 0.0)
    rms = math.sqrt(sumsq / max(1, frames * 2))
    return {"frames": frames, "rms": rms, "peak": peak}


def db(x: float) -> float:
    return 20 * math.log10(max(x, 1e-12))


def estimate_bpm(path: Path, lo: float = 70.0, hi: float = 180.0) -> float | None:
    """Grobe Tempo-Schätzung: Autokorrelation der Onset-Hüllkurve (Spectral Flux)."""
    import numpy as np

    sr = 22050
    x = np.concatenate([b[:, 0] for b in decode_stream(path, 1, sr)] or [np.zeros(0, np.float32)])
    if x.size < sr * 4:
        return None
    n_fft, hop = 1024, 256
    fps = sr / hop
    window = np.hanning(n_fft).astype(np.float32)
    n_frames = 1 + (x.size - n_fft) // hop
    flux = np.zeros(n_frames, dtype=np.float64)
    prev = None
    chunk = 2048
    for s in range(0, n_frames, chunk):
        idx = np.arange(s, min(n_frames, s + chunk))[:, None] * hop + np.arange(n_fft)[None, :]
        mag = np.log1p(100.0 * np.abs(np.fft.rfft(x[idx] * window, axis=1)))
        if prev is None:
            d = np.diff(mag, axis=0, prepend=mag[:1])
        else:
            d = np.diff(np.vstack([prev, mag]), axis=0)
        flux[s : s + mag.shape[0]] = np.maximum(d, 0.0).sum(axis=1)
        prev = mag[-1:]
    # Glätten + lokalen Mittelwert abziehen (Onset-Hüllkurve)
    k = np.hanning(5)
    env = np.convolve(flux, k / k.sum(), mode="same")
    w = int(fps)  # ~1 s gleitender Mittelwert
    env = env - np.convolve(env, np.ones(w) / w, mode="same")
    env = np.maximum(env, 0.0)
    if not np.any(env):
        return None
    env = env - env.mean()
    # Autokorrelation per FFT
    n = 1 << int(math.ceil(math.log2(2 * env.size)))
    spec = np.fft.rfft(env, n)
    ac = np.fft.irfft(spec * np.conj(spec), n)[: env.size]
    ac /= ac[0] if ac[0] > 0 else 1.0

    min_lag = int(math.floor(60.0 * fps / hi))
    max_lag = int(math.ceil(60.0 * fps / lo))
    lags = np.arange(min_lag, max_lag + 1)
    bpms = 60.0 * fps / lags
    # Gewichtung: Grundschlag + halbe/doppelte Periode, leichter Prior um 120 BPM
    def acv(l):
        l = np.clip(np.round(l).astype(int), 0, ac.size - 1)
        return ac[l]

    score = acv(lags) + 0.5 * acv(2 * lags) + 0.25 * acv(lags / 2)
    prior = np.exp(-0.5 * (np.log2(bpms / 120.0) / 0.9) ** 2)
    score = score * (0.6 + 0.4 * prior)
    i = int(np.argmax(score))
    # parabolische Verfeinerung
    lag = float(lags[i])
    if 0 < i < len(score) - 1:
        a, b, c = score[i - 1], score[i], score[i + 1]
        den = a - 2 * b + c
        if den != 0:
            lag += 0.5 * (a - c) / den
    bpm = 60.0 * fps / lag
    return float(min(hi, max(lo, bpm)))


# --------------------------------------------------------------------------
# Kodierung
# --------------------------------------------------------------------------
def encode_mp3(src: Path, dst: Path, gain: float, frames: int, bitrate: str) -> None:
    af = f"volume={gain:.6f},apad=whole_len={frames},atrim=end_sample={frames}"
    run(
        ["ffmpeg", "-y", "-v", "error", "-nostdin", "-i", str(src), "-af", af,
         "-ac", "2", "-ar", str(SAMPLE_RATE), "-map_metadata", "-1",
         "-c:a", "libmp3lame", "-b:a", bitrate, str(dst)],
        quiet=True,
    )


# --------------------------------------------------------------------------
# Hauptaktionen
# --------------------------------------------------------------------------
def cmd_list() -> int:
    data = read_songs()
    songs = data["songs"]
    print(f"Songs in {SONGS_JSON} ({len(songs)}):\n")
    if not songs:
        print("  (noch keine Songs)")
        return 0
    print(f"  {'ID':<24} {'Titel':<26} {'Künstler':<22} {'BPM':>4} {'Dauer':>6}  {'Quelle':<8} Stems")
    print("  " + "-" * 110)
    for s in songs:
        stems = ", ".join(st.get("id", "?") for st in s.get("stems", []))
        exists = "" if song_dir(str(s.get("id", "x"))).exists() else "  (Ordner fehlt!)"
        print(
            f"  {str(s.get('id', '?'))[:24]:<24} {str(s.get('title', ''))[:26]:<26} "
            f"{str(s.get('artist', ''))[:22]:<22} {str(s.get('bpm', '')):>4} "
            f"{fmt_time(s.get('duration', 0) or 0):>6}  {str(s.get('source', '')):<8} {stems}{exists}"
        )
    return 0


def confirm(question: str, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        print(f"{question} – keine interaktive Eingabe möglich; mit --yes bestätigen.")
        return False
    ans = input(f"{question} [j/N] ").strip().lower()
    return ans in ("j", "ja", "y", "yes")


def cmd_remove(song_id: str, assume_yes: bool) -> int:
    if not ID_RE.match(song_id):
        raise Abbruch(f"Ungültige Song-ID: {song_id!r}")
    data = read_songs()
    entry = next((s for s in data["songs"] if isinstance(s, dict) and s.get("id") == song_id), None)
    d = song_dir(song_id)
    if entry is None and not d.exists():
        raise Abbruch(f"Kein Song mit der ID '{song_id}' gefunden (siehe --list).")
    desc = f"'{entry.get('title', song_id)}' ({song_id})" if entry else f"'{song_id}'"
    if not confirm(f"Song {desc} inkl. Ordner {d} wirklich entfernen?", assume_yes):
        print("Abgebrochen – nichts geändert.")
        return 1
    removed = remove_song_entry(song_id)
    if d.exists():
        shutil.rmtree(d)
    print(f"✔ Entfernt: {desc}" + ("" if removed else " (war nicht in songs.json eingetragen)"))
    return 0


def cmd_prepare(args: argparse.Namespace) -> int:
    t_start = time.time()
    if args.start is not None and args.start < 0:
        raise Abbruch("--start muss ≥ 0 sein.")
    if args.end is not None and args.end <= (args.start or 0):
        raise Abbruch("--end muss größer als --start sein.")
    if args.shifts < 1:
        raise Abbruch("--shifts muss ≥ 1 sein.")
    if not re.fullmatch(r"\d{2,3}k", args.bitrate):
        raise Abbruch("--bitrate bitte z.B. als 128k, 160k oder 192k angeben.")
    if args.bpm is not None and not (30 <= args.bpm <= 300):
        raise Abbruch("--bpm sollte zwischen 30 und 300 liegen.")

    src_file: Path | None = None
    if args.file:
        src_file = Path(args.file).expanduser().resolve()
        if not src_file.is_file():
            raise Abbruch(f"Datei nicht gefunden: {src_file}")

    check_dependencies(need_ytdlp=bool(args.url), need_demucs=not args.fake_separation)

    # ID früh festlegen (für Arbeitsordner); bei URL ggf. nach dem Download
    song_id = args.id
    if song_id and not ID_RE.match(song_id):
        raise Abbruch("--id darf nur Kleinbuchstaben, Ziffern und '-' enthalten (z.B. 'smoke-on-the-water').")

    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    work = WORK_ROOT / (song_id or f"_tmp-{os.getpid()}")
    work.mkdir(parents=True, exist_ok=True)

    title, artist = args.title, args.artist
    source = "youtube" if args.url else "file"
    if args.url:
        dl, meta = download_youtube(args.url, work)
        yt_title, yt_artist = meta_from_ytdlp(meta)
        title = title or yt_title
        artist = artist or yt_artist
        raw = dl
    else:
        assert src_file is not None
        title = title or clean_title(src_file.stem.replace("_", " "))
        artist = artist or "Unbekannt"
        raw = src_file

    if not song_id:
        song_id = slugify(title)
        new_work = WORK_ROOT / song_id
        if new_work != work:
            if new_work.exists():
                shutil.rmtree(new_work)
            work.rename(new_work)
            work = new_work
            if args.url:
                raw = work / Path(raw).name
    info(f"Song: „{title}“ – {artist}  (id: {song_id})")

    # Vorhandenen Eintrag nicht ungefragt überschreiben
    existing = next((s for s in read_songs()["songs"] if isinstance(s, dict) and s.get("id") == song_id), None)
    if existing is not None or song_dir(song_id).exists():
        what = f"„{existing.get('title')}“ (Quelle: {existing.get('source')})" if existing else "ein Ordner"
        if not confirm(f"Unter der ID '{song_id}' gibt es schon {what}. Ersetzen?", args.yes):
            raise Abbruch("Abgebrochen – bitte eine andere --id wählen.")

    input_wav = work / "input.wav"
    prepare_input(Path(raw), input_wav, args.start, args.end)

    # Trennen
    if args.fake_separation:
        stems = separate_fake(input_wav, work, args.model)
    else:
        device = pick_device(args.device)
        stems = separate_demucs(input_wav, work, args.model, args.shifts, device)
    unknown = sorted(set(stems) - set(STEM_ORDER))
    if unknown:
        warn(f"Unbekannte Stems werden ignoriert: {', '.join(unknown)}")
    stems = {k: v for k, v in stems.items() if k in STEM_ORDER}

    # Analyse
    step("Analysiere Stems (Pegel, Länge)")
    stats = {name: analyze_stem(p) for name, p in stems.items()}
    loudest = max(s["rms"] for s in stats.values())
    frames = max(s["frames"] for s in stats.values())
    if loudest <= 1e-6 or frames == 0:
        raise Abbruch("Alle Stems sind still – ist die Eingabe leer?")
    keep: list[str] = []
    dropped: list[tuple[float, str]] = []
    for name in STEM_ORDER:
        if name not in stats:
            continue
        rel = db(stats[name]["rms"]) - db(loudest)
        silent = rel < args.silence_db
        mark = "verworfen (nahezu still)" if silent and not args.keep_silent else "ok"
        info(f"{name:<7} {rel:6.1f} dB relativ zum lautesten Stem → {mark}")
        if silent and not args.keep_silent:
            dropped.append((rel, name))
        else:
            keep.append(name)
    if len(keep) < MIN_STEMS:
        dropped.sort(reverse=True)
        while len(keep) < MIN_STEMS and dropped:
            _, name = dropped.pop(0)
            warn(f"Behalte {name} trotzdem (mindestens {MIN_STEMS} Stems nötig).")
            keep.append(name)
        keep = [n for n in STEM_ORDER if n in keep]

    # Gemeinsame Verstärkung: nichts übersteuern, Balance zwischen Stems bleibt erhalten
    peak = max(stats[n]["peak"] for n in keep)
    gain = min(1.0, 0.98 / peak) if peak > 0 else 1.0
    if gain < 1.0:
        info(f"Gemeinsame Absenkung um {db(gain):.1f} dB gegen Übersteuerung.")
    duration = frames / SAMPLE_RATE

    # BPM
    if args.bpm is not None:
        bpm = int(round(args.bpm))
    else:
        step("Schätze Tempo (BPM)")
        bpm_src = stems["drums"] if "drums" in keep else input_wav
        est = estimate_bpm(bpm_src)
        if est is None:
            bpm = 120
            warn("Tempo nicht erkennbar – nehme 120 BPM (mit --bpm korrigieren).")
        else:
            bpm = int(round(est))
            info(f"≈ {bpm} BPM (Schätzung aus {'Drums-Stem' if bpm_src != input_wav else 'Mix'}; "
                 "bei Bedarf mit --bpm korrigieren)")

    # Kodieren in Staging-Ordner, dann austauschen
    step(f"Kodiere {len(keep)} Stems als MP3 ({args.bitrate}, Stereo, {fmt_time(duration)} min)")
    staging = work / "out"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    for name in keep:
        dst = staging / f"{name}.mp3"
        encode_mp3(stems[name], dst, gain, frames, args.bitrate)
        info(f"{name}.mp3  {dst.stat().st_size / 1e6:5.2f} MB")

    final = song_dir(song_id)
    SONGS_DIR.mkdir(parents=True, exist_ok=True)
    if final.exists():
        shutil.rmtree(final)
    shutil.move(str(staging), str(final))

    entry = {
        "id": song_id,
        "title": title,
        "artist": artist,
        "bpm": bpm,
        "duration": round(duration, 2),
        "source": source,
        "stems": [
            {
                "id": name,
                "label": STEM_LABELS[name],
                "instrument": name,
                "file": f"songs/{song_id}/{name}.mp3",
                "color": STEM_COLORS[name],
            }
            for name in keep
        ],
    }
    action = upsert_song(entry)

    if not args.keep_work:
        shutil.rmtree(work, ignore_errors=True)
    else:
        info(f"Arbeitsordner behalten: {work}")

    print(
        f"\n✔ Fertig in {fmt_time(time.time() - t_start)} min: „{title}“ in songs.json {action} "
        f"({len(keep)} Stems: {', '.join(keep)})."
    )
    print(f"  Dateien: {final}")
    print(f"  In der App: http://localhost:8080/?song={song_id}  (cd app && python3 -m http.server 8080)")
    return 0


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
class DeutscherHelpFormatter(argparse.RawDescriptionHelpFormatter):
    def add_usage(self, usage, actions, groups, prefix=None):
        return super().add_usage(usage, actions, groups, prefix or "Aufruf: ")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="prepare_song.py",
        formatter_class=DeutscherHelpFormatter,
        add_help=False,
        description=(
            "StemStage: Song holen (YouTube oder Datei), mit Demucs in Instrument-Spuren trennen,\n"
            "als MP3 nach app/songs/<id>/ schreiben und in app/songs/songs.json eintragen.\n"
            "Nur für Unterricht und eigene Nutzung – Urheberrecht beachten (siehe tools/README.md)."
        ),
        epilog=(
            "Beispiele:\n"
            '  %(prog)s --url "https://www.youtube.com/watch?v=XXXX" --id mein-song\n'
            '  %(prog)s --file ~/Musik/song.flac --title "Mein Song" --artist "Die Band" --bpm 96\n'
            '  %(prog)s --url "…" --start 30 --end 75 --id refrain-beispiel\n'
            "  %(prog)s --file song.wav --model htdemucs_ft      (4 Stems, bessere Qualität)\n"
            "  %(prog)s --list\n"
            "  %(prog)s --remove mein-song --yes\n"
        ),
    )
    p._optionals.title = "Optionen"
    p.add_argument("-h", "--help", action="help", help="Diese Hilfe anzeigen und beenden.")

    act = p.add_argument_group("Aktion (genau eine)")
    g = act.add_mutually_exclusive_group(required=True)
    g.add_argument("--url", metavar="URL", help="YouTube-URL (Audio wird mit yt-dlp geladen).")
    g.add_argument("--file", metavar="DATEI", help="Lokale Audiodatei (mp3, wav, flac, m4a, …).")
    g.add_argument("--list", action="store_true", help="Songs aus songs.json anzeigen.")
    g.add_argument("--remove", metavar="ID", help="Song inkl. Ordner entfernen (mit Rückfrage).")

    meta = p.add_argument_group("Song-Angaben")
    meta.add_argument("--id", metavar="SLUG", help="Song-ID, z.B. 'smoke-on-the-water' (Standard: aus Titel).")
    meta.add_argument("--title", metavar="TITEL", help="Titel (Standard: aus YouTube-Metadaten bzw. Dateiname).")
    meta.add_argument("--artist", metavar="NAME", help="Künstler (Standard: aus YouTube-Metadaten, sonst 'Unbekannt').")
    meta.add_argument("--bpm", type=float, help="Tempo; ohne Angabe grob geschätzt (70–180) aus dem Drums-Stem.")
    meta.add_argument("--start", type=float, metavar="SEK", help="Ausschnitt ab Sekunde (z.B. 30).")
    meta.add_argument("--end", type=float, metavar="SEK", help="Ausschnitt bis Sekunde (z.B. 75).")

    sep = p.add_argument_group("Trennung & Kodierung")
    sep.add_argument(
        "--model", default="htdemucs_6s", choices=["htdemucs_6s", "htdemucs_ft", "htdemucs"],
        help="Demucs-Modell: htdemucs_6s = 6 Stems (Gesang, Gitarre, Bass, Drums, Keyboard, Sonstiges; "
             "Standard), htdemucs_ft = 4 Stems in besserer Qualität (langsamer), htdemucs = 4 Stems schnell.",
    )
    sep.add_argument("--shifts", type=int, default=2, metavar="N",
                     help="Demucs-Durchläufe mit Versatz – mehr = etwas besser, aber N-mal langsamer (Standard 2).")
    sep.add_argument("--device", default="auto", choices=["auto", "mps", "cpu", "cuda"],
                     help="Rechengerät (Standard auto: mps auf Apple Silicon, sonst cpu).")
    sep.add_argument("--keep-silent", action="store_true",
                     help="Auch nahezu stille Stems behalten (z.B. leeres Keyboard).")
    sep.add_argument("--silence-db", type=float, default=-35.0, metavar="DB",
                     help="Stille-Schwelle relativ zum lautesten Stem (Standard -35).")
    sep.add_argument("--bitrate", default="160k", metavar="RATE", help="MP3-Bitrate (Standard 160k).")

    misc = p.add_argument_group("Sonstiges")
    misc.add_argument("-y", "--yes", action="store_true", help="Rückfragen automatisch mit Ja beantworten.")
    misc.add_argument("--keep-work", action="store_true",
                      help="Arbeitsordner tools/.work/<id>/ nach Erfolg nicht löschen.")
    # Versteckt: Demucs durch Filter ersetzen (zum Testen der Pipeline ohne torch)
    misc.add_argument("--fake-separation", action="store_true", help=argparse.SUPPRESS)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.list:
            return cmd_list()
        if args.remove:
            return cmd_remove(args.remove, args.yes)
        need = ["numpy"] + ([] if args.fake_separation else ["demucs"])
        maybe_reexec_in_venv(need)
        return cmd_prepare(args)
    except Abbruch as exc:
        print(f"\n✖ {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n✖ Abgebrochen (Strg+C). Zwischenstand liegt in tools/.work/.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())

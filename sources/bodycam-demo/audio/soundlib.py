# Verarbeitungs-Kern für fetch_sounds.py (Download, Schnitt, Normalisierung, Opus-Export).
# Nur numpy + ffmpeg + yt-dlp. Läuft mit `python3 -I`.
import json, os, re, subprocess, sys, time, glob
import numpy as np

SR = 48000


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- Download
def find_raw(raw_dir, ytid):
    for p in sorted(glob.glob(os.path.join(raw_dir, glob.escape(ytid) + ".*"))):
        if p.endswith((".webm", ".m4a", ".opus", ".mp3", ".ogg", ".wav")):
            return p, 0.0
    return None, 0.0


def find_section(raw_dir, ytid, s, e):
    # Abschnitts-Downloads heißen <id>__<a>_<b>.<ext>, a/b in ms Originalzeit
    for p in glob.glob(os.path.join(raw_dir, glob.escape(ytid) + "__*")):
        m = re.search(r"__(\d+)_(\d+)\.", p)
        if m and int(m.group(1)) <= s * 1000 and int(m.group(2)) >= e * 1000:
            return p, int(m.group(1)) / 1000.0
    return None, 0.0


def ensure_source(raw_dir, ytid, s, e, full, cookies=None):
    """Liefert (pfad, offset). full=True lädt das ganze (kurze) Video, sonst nur den Abschnitt."""
    p, off = find_raw(raw_dir, ytid)
    if p:
        return p, off
    p, off = find_section(raw_dir, ytid, s, e)
    if p:
        return p, off
    os.makedirs(raw_dir, exist_ok=True)
    url = "https://www.youtube.com/watch?v=" + ytid
    base = ["yt-dlp", "-q", "--no-warnings", "--no-playlist", "-f", "bestaudio", "--sleep-requests", "2"]
    if cookies:
        base += ["--cookies-from-browser", cookies]
    if full:
        cmd = base + ["-o", os.path.join(raw_dir, "%(id)s.%(ext)s"), url]
    else:
        a = max(0.0, s - 3.0); b = e + 3.0
        tag = f"{ytid}__{int(a*1000)}_{int(b*1000)}"
        cmd = base + ["--download-sections", f"*{a:.2f}-{b:.2f}", "-o", os.path.join(raw_dir, tag + ".%(ext)s"), url]
    for attempt in range(4):
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            break
        msg = (r.stderr or "")[-300:]
        log(f"  yt-dlp Fehler ({ytid}, Versuch {attempt+1}): {msg.strip()}")
        if "429" in msg or "bot" in msg.lower():
            time.sleep(120 + 60 * attempt)
        else:
            time.sleep(5)
    time.sleep(3)  # sanft drosseln
    p, off = find_raw(raw_dir, ytid) if full else find_section(raw_dir, ytid, s, e)
    if not p:
        raise RuntimeError(f"Download fehlgeschlagen: {ytid}")
    return p, off


# ---------------------------------------------------------------- Audio I/O
def decode(path, t0, t1, ch, af=None):
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{max(0,t0):.4f}", "-to", f"{t1:.4f}", "-i", path]
    if af:
        cmd += ["-af", af]
    cmd += ["-ac", str(ch), "-ar", str(SR), "-f", "f32le", "-"]
    x = np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32).copy()
    return x.reshape(-1, ch)


def encode(x, out, bitrate):
    ch = x.shape[1]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(ch), "-i", "-",
           "-c:a", "libopus", "-b:a", bitrate, "-vbr", "on", "-application", "audio",
           "-frame_duration", "10", "-map_metadata", "-1", out]
    subprocess.run(cmd, input=np.ascontiguousarray(x, dtype=np.float32).tobytes(), check=True)


def measure(path):
    """True-Peak (dBTP) und integrierte Lautheit (LUFS) per ffmpeg ebur128."""
    r = subprocess.run(["ffmpeg", "-v", "info", "-nostats", "-i", path, "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"],
                       capture_output=True, text=True)
    t = r.stderr
    tp = re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", t)
    it = re.findall(r"I:\s+(-?[\d.]+) LUFS", t)
    dur = re.findall(r"Duration: (\d+):(\d+):([\d.]+)", t)
    d = None
    if dur:
        h, m, s = dur[0]; d = int(h) * 3600 + int(m) * 60 + float(s)
    return (float(tp[-1]) if tp and tp[-1] != "-inf" else -99.0), (float(it[-1]) if it else -99.0), d


def lufs_of(x):
    tmp = os.path.join(os.environ.get("TMPDIR", "/tmp"), f"_lufs_{os.getpid()}.wav")
    ch = x.shape[1]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(ch), "-i", "-", tmp],
                   input=np.ascontiguousarray(x, dtype=np.float32).tobytes(), check=True)
    tp, i, _ = measure(tmp)
    os.remove(tmp)
    return i, tp


# ---------------------------------------------------------------- Bearbeitung
def env_db(m, h):
    n = len(m) // h
    if n == 0:
        return np.array([-120.0])
    e = np.sqrt(np.mean(m[: n * h].reshape(n, h) ** 2, axis=1) + 1e-14)
    return 20 * np.log10(e)


def find_onset(m, search=None, rel=0.12, back_ms=4.0, back_rel=0.03):
    """Erster Einsatz: erstes Sample über rel*Maximum (im Suchfenster), dann höchstens back_ms zurück,
    solange 0,5-ms-Fenster deutlich über dem Rauschboden liegen (kein langer Vorlauf)."""
    a = np.abs(m)
    lim = len(a) if search is None else min(len(a), int(search * SR))
    mx = a[:lim].max() + 1e-12
    k = int(np.argmax(a[:lim] > rel * mx))
    h = max(1, int(0.0005 * SR))
    floor = np.percentile(a[:k], 50) if k > h * 8 else 0.0
    thr = max(floor * 4, back_rel * mx)
    j, stop = k, max(0, k - int(back_ms * SR / 1000))
    while j - h > stop and a[j - h:j].max() > thr:
        j -= h
    return max(0, j)


def fade(x, fi, fo):
    n = len(x)
    if fi > 0:
        k = min(n, int(fi * SR)); x[:k] *= (np.sin(np.linspace(0, np.pi / 2, k)) ** 2)[:, None]
    if fo > 0:
        k = min(n, int(fo * SR)); x[n - k:] *= (np.cos(np.linspace(0, np.pi / 2, k)) ** 2)[:, None]
    return x


def auto_tail(x, floor_db=-60.0, min_len=0.05):
    """Kürzt den Schwanz dort, wo die Hüllkurve dauerhaft unter (Spitze+floor_db) bzw. Rauschboden+4 dB fällt."""
    m = x.mean(axis=1)
    h = int(0.01 * SR)
    d = env_db(m, h)
    top = d.max()
    noise = np.percentile(d[-max(3, len(d) // 8):], 50)
    thr = max(top + floor_db, noise + 4)
    above = np.where(d > thr)[0]
    if len(above) == 0:
        return x
    end = min(len(x), (above[-1] + 2) * h)
    return x[: max(end, int(min_len * SR))]


def loop_xfade(x, xf):
    """Nahtlose Schleife: das Ende wird in den Anfang überblendet (Equal-Power)."""
    k = int(xf * SR)
    body = x[:-k].copy()
    t = np.linspace(0, np.pi / 2, k)[:, None]
    body[:k] = body[:k] * np.sin(t) + x[-k:] * np.cos(t)
    return body


def process(clip, raw_dir, out_dir, cookies=None):
    c = dict(clip)
    ch = 2 if c.get("stereo") else 1
    s, e = c["start"], c["end"]
    path, off = ensure_source(raw_dir, c["id"], s, e, c.get("full", True), cookies)
    pre = c.get("pre", 0.15)                      # Suchvorlauf für den Onset
    t0 = max(0.0, s - off - (pre if c.get("snap", True) else 0))
    t1 = e - off
    filt = []
    if c.get("hp"): filt.append(f"highpass=f={c['hp']}:poles=2")
    if c.get("hp2"): filt.append(f"highpass=f={c['hp2']}:poles=2")
    if c.get("lp"): filt.append(f"lowpass=f={c['lp']}:poles=2")
    for f, w, g in c.get("eq", []):
        filt.append(f"equalizer=f={f}:t=q:w={w}:g={g}")
    if c.get("nr"): filt.append(f"afftdn=nr={c['nr']}:nf={c.get('nf', -50)}:tn=1")
    if c.get("af"): filt.append(c["af"])
    # Filter mit Vorlauf rechnen (Einschwingen), danach wegschneiden
    lead = min(t0, 0.5)
    x = decode(path, t0 - lead, t1, ch, ",".join(filt) if filt else None)[int(lead * SR):]
    if len(x) < int(0.02 * SR):
        raise RuntimeError(f"leerer Ausschnitt {c['id']} {s}-{e}")
    if c.get("snap", True):
        m = x.mean(axis=1)
        k = find_onset(m, search=pre + c.get("search", 0.25), rel=c.get("rel", 0.12), back_ms=c.get("back_ms", 4.0))
        k = max(0, k - int(c.get("lead_ms", 1.0) * SR / 1000))
        x = x[k:]
    if c.get("len"):                              # feste Länge ab Onset
        x = x[: int(c["len"] * SR)]
    ref_peak = None
    if c.get("gate_head"):                        # Transiente ausblenden (Schwanz-Layer, zeitgleich mit Schuss)
        ref_peak = float(np.abs(x).max())         # Pegel relativ zum vollen Schuss behalten
        mute, ramp = c["gate_head"]
        a, b = int(mute * SR), int((mute + ramp) * SR)
        x[:a] = 0
        x[a:b] *= (np.sin(np.linspace(0, np.pi / 2, b - a)) ** 2)[:, None]
    if c.get("loop"):
        x = loop_xfade(x, c["loop"])
    elif c.get("tail", True):
        x = auto_tail(x, c.get("floor", -60.0))
    x = fade(x, 0 if c.get("gate_head") else c.get("fi", 0.0015 if c.get("snap", True) else 0.05),
             c.get("fo", min(0.25, max(0.015, 0.25 * len(x) / SR))) if not c.get("loop") else 0)
    # Normalisieren
    if c.get("lufs") is not None:
        i, tp = lufs_of(x)
        g = 10 ** ((c["lufs"] - i) / 20)
        if tp + 20 * np.log10(g) > c.get("peak", -1.0):
            g = 10 ** ((c.get("peak", -1.0) - tp) / 20)
    else:
        g = c.get("peak_lin", None) or 10 ** (c.get("peak", -1.0) / 20) / ((ref_peak or np.abs(x).max()) + 1e-9)
    x = (x * g).astype(np.float32)
    out = os.path.join(out_dir, c["file"])
    target_tp = c.get("peak", -1.0)
    for _ in range(4):
        encode(x, out, c.get("br", "128k" if ch == 2 else "96k"))
        tp, lu, dur = measure(out)
        if tp <= target_tp + 0.05:
            break
        x = (x * 10 ** ((target_tp - 0.1 - tp) / 20)).astype(np.float32)
    return {"file": c["file"], "dur": round(len(x) / SR, 3), "truePeak": round(tp, 2), "lufs": round(lu, 1),
            "bytes": os.path.getsize(out)}

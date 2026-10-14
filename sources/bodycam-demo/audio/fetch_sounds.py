#!/usr/bin/env python3
"""UNIT 27 · Bodycam-Tech-Demo – Sounds reproduzierbar von YouTube holen und schneiden.

Privatkopie für ein privates Projekt: `public/bodycam-demo/audio/` ist gitignored und wird NICHT veröffentlicht.
Committet werden nur dieses Skript, `clips.py` (Schnittliste) und das Manifest `public/bodycam-demo/data/sounds.json`.

Aufruf (aus dem Repo-Root):
    python3 -I sources/bodycam-demo/audio/fetch_sounds.py [--only name1,name2] [--raw DIR] [--cookies chrome] [--keep-raw]

- Lädt pro Quelle `-f bestaudio` (kurze Videos ganz, lange nur den benötigten Abschnitt) nach --raw
  (Standard: $TMPDIR/bodycam-sound-raw), höchstens ein Download gleichzeitig, mit --sleep-requests 2.
  Bei "429"/"confirm you're not a bot": wartet 2-4 min und versucht es erneut; notfalls --cookies chrome.
- Schneidet laut clips.py (Onset ohne Vorlauf, Fades, Schwanz behalten), filtert (Hochpass, EQ, Entrauschen),
  normalisiert (Punktquellen: Peak -1 dBTP; Ambiences/Loops: LUFS-Ziel) und kodiert Opus/OGG 48 kHz.
- Schreibt/aktualisiert das Manifest (Dateien, gain-Empfehlung, Beschreibung, Quelle mit Zeitstempel).
"""
import argparse, json, os, sys, shutil, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import soundlib  # noqa: E402
from clips import CLIPS, META  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "public", "bodycam-demo", "audio")
MANIFEST = os.path.join(REPO, "public", "bodycam-demo", "data", "sounds.json")


def fmt_t(t):
    m, s = divmod(t, 60)
    return f"{int(m)}:{s:06.3f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="kommagetrennte Namen (Präfix mit * erlaubt, z. B. step_*)")
    ap.add_argument("--raw", default=os.path.join(tempfile.gettempdir(), "bodycam-sound-raw"))
    ap.add_argument("--cookies", default=None, help="z. B. chrome (yt-dlp --cookies-from-browser)")
    ap.add_argument("--keep-raw", action="store_true")
    ap.add_argument("--report", default=None, help="JSON-Bericht (Dauer, Peak, LUFS je Clip)")
    a = ap.parse_args()

    sel = [s.strip() for s in a.only.split(",") if s.strip()]

    def wanted(n):
        return not sel or any(n == s or (s.endswith("*") and n.startswith(s[:-1])) for s in sel)

    os.makedirs(OUT, exist_ok=True)
    man = {}
    if os.path.exists(MANIFEST):
        man = json.load(open(MANIFEST))
    # Clips je Name durchnummerieren
    counter, jobs = {}, []
    for c in CLIPS:
        n = c["name"]
        counter[n] = counter.get(n, 0) + 1
        c = dict(c)
        c.setdefault("file", f"{n}_{counter[n]}.ogg")
        if wanted(n):
            jobs.append(c)
    report, files, srcs = [], {}, {}
    for c in jobs:
        soundlib.log(f"[{c['name']}] {c['id']} {c['start']}-{c['end']} -> {c['file']}")
        try:
            r = soundlib.process(c, a.raw, OUT, a.cookies)
        except Exception as e:  # einzelne Fehler nicht den ganzen Lauf abbrechen lassen
            soundlib.log(f"  FEHLER: {e}")
            continue
        r["name"] = c["name"]
        report.append(r)
        soundlib.log(f"  dur={r['dur']}s tp={r['truePeak']}dBTP lufs={r['lufs']} {r['bytes'] // 1024}kB")
        files.setdefault(c["name"], []).append("audio/" + c["file"])
        srcs.setdefault(c["name"], []).append(
            f"https://www.youtube.com/watch?v={c['id']}&t={int(c['start'])} [{fmt_t(c['start'])}-{fmt_t(c['end'])}]")
    for n, fl in files.items():
        m = META.get(n, {})
        man[n] = {"files": fl, "gain": m.get("gain", 1.0), "desc": m.get("desc", ""), "source": " | ".join(srcs[n])}
        for k in ("loop", "refDistance", "rolloff", "pitchVar", "volVar", "stereo"):
            if k in m:
                man[n][k] = m[k]
    # entfernte Dateien eines neu gebauten Namens aufräumen
    for n in files:
        for f in os.listdir(OUT):
            if f.startswith(n + "_") and f[len(n) + 1:-4].isdigit() and "audio/" + f not in files[n]:
                os.remove(os.path.join(OUT, f))
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    order = {c["name"]: i for i, c in enumerate(CLIPS)}
    man = dict(sorted(man.items(), key=lambda kv: order.get(kv[0], 9999)))
    with open(MANIFEST, "w") as fh:
        json.dump(man, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    if a.report:
        old = []
        if os.path.exists(a.report):
            old = [r for r in json.load(open(a.report)) if r["name"] not in files]
        json.dump(old + report, open(a.report, "w"), indent=1)
    if not a.keep_raw and not sel:
        shutil.rmtree(a.raw, ignore_errors=True)
    soundlib.log(f"fertig: {len(report)}/{len(jobs)} Clips")


if __name__ == "__main__":
    main()

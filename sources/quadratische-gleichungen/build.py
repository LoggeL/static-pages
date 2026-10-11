#!/usr/bin/env python3
"""Baut die Lernseite „Quadratische Gleichungen ohne Formel“.

Aufruf (von überall):  python3 -I build.py
Demo-Dateien (parts/, css/, js/ mit führendem „_“) nur mit:  QG_DEMO=1 python3 -I build.py

Ergebnis in ../../public/quadratische-gleichungen/:
  index.html  = shell.html, <!--PARTS--> ersetzt durch parts/*.html (alphabetisch)
  style.css   = css/base.css + übrige css/*.css (alphabetisch)
  app.js      = js/core.js  + übrige js/*.js  (alphabetisch, jede Datei in try/catch gekapselt)
"""
import os
import pathlib
import shutil
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT.parent.parent / "public" / "quadratische-gleichungen"
DEMO = os.environ.get("QG_DEMO") == "1"


def ordered(files, first):
    names = sorted(f.name for f in files if DEMO or not f.name.startswith("_"))
    head = [n for n in first if n in names]
    return head + [n for n in names if n not in head]


def main():
    shell = (ROOT / "shell.html").read_text(encoding="utf-8")
    if "<!--PARTS-->" not in shell:
        sys.exit("Fehler: shell.html enthält kein <!--PARTS-->")

    # ---- Parts -------------------------------------------------------------
    parts = []
    skipped = []
    for p in sorted((ROOT / "parts").glob("*.html")) if (ROOT / "parts").is_dir() else []:
        if p.name.startswith("_") and not DEMO:
            skipped.append(p.name)
            continue
        parts.append(p)
    html_parts = "\n".join(
        f"<!-- ===== parts/{p.name} ===== -->\n" + p.read_text(encoding="utf-8").strip() + "\n"
        for p in parts
    )

    # ---- CSS ---------------------------------------------------------------
    css_dir = ROOT / "css"
    css_names = ordered(css_dir.glob("*.css"), ["base.css"]) if css_dir.is_dir() else []
    css_chunks = []
    for n in css_names:
        css_chunks.append(f"/* {'=' * 66}\n   css/{n}\n   {'=' * 66} */\n" + (css_dir / n).read_text(encoding="utf-8").strip() + "\n")
    css = "\n".join(css_chunks)

    # ---- JS ----------------------------------------------------------------
    js_dir = ROOT / "js"
    js_names = ordered(js_dir.glob("*.js"), ["core.js"]) if js_dir.is_dir() else []
    js_chunks = []
    warnings = []
    node = shutil.which("node")
    for n in js_names:
        src = (js_dir / n).read_text(encoding="utf-8").strip()
        if node:
            r = subprocess.run([node, "--check", str(js_dir / n)], capture_output=True, text=True)
            if r.returncode != 0:
                warnings.append(f"Syntaxfehler in js/{n}:\n{r.stderr.strip()}")
        head = f"/* {'=' * 66}\n   js/{n}\n   {'=' * 66} */\n"
        if n == "core.js":
            js_chunks.append(head + src + "\n")
        else:
            # Laufzeitfehler eines Kapitels sollen die anderen nicht mitreißen.
            js_chunks.append(
                head + ";try {\n" + src + "\n} catch (e) { console.error('[QG] Fehler in js/" + n + "', e); }\n"
            )
    js = "\n".join(js_chunks)

    # ---- Schreiben ---------------------------------------------------------
    v = str(int(time.time()))
    index = shell.replace("<!--PARTS-->", html_parts).replace("{{V}}", v)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(index, encoding="utf-8")
    (OUT / "style.css").write_text(css, encoding="utf-8")
    (OUT / "app.js").write_text(js, encoding="utf-8")

    sections = index.count('class="chapter"')
    tasks = index.count('class="task"') + index.count('class="task ')
    print(f"Gebaut → {OUT}")
    print(f"  parts: {len(parts)} ({', '.join(p.name for p in parts) or '–'})" + (f"  übersprungen: {', '.join(skipped)}" if skipped else ""))
    print(f"  css:   {len(css_names)} Datei(en), {len(css) // 1024} KB")
    print(f"  js:    {len(js_names)} Datei(en), {len(js) // 1024} KB")
    print(f"  index: {len(index) // 1024} KB, {sections} Kapitel, ~{tasks} Aufgaben, v={v}" + ("  [DEMO]" if DEMO else ""))
    for w in warnings:
        print("WARNUNG: " + w)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Baut index.html aus shell.html + parts/*.html und verlinkt css/*.css + js/*.js.
Aufruf: python3 -I build.py   (aus beliebigem Verzeichnis)
Reihenfolge: alphabetisch nach Dateiname. base.css und core.js immer zuerst, fx.js direkt nach core.js."""
import pathlib, re, time

ROOT = pathlib.Path(__file__).resolve().parent
shell = (ROOT / "shell.html").read_text(encoding="utf-8")

parts = sorted((ROOT / "parts").glob("*.html"))
html_parts = "\n".join(f"<!-- ===== {p.name} ===== -->\n" + p.read_text(encoding="utf-8").strip() + "\n" for p in parts)

def order(files, first):
    names = sorted(f.name for f in files)
    head = [n for n in first if n in names]
    return head + [n for n in names if n not in head]

v = int(time.time())
css = order((ROOT / "css").glob("*.css"), ["base.css"])
js = order((ROOT / "js").glob("*.js"), ["core.js", "fx.js"])
css_tags = "\n".join(f'<link rel="stylesheet" href="css/{n}?v={v}">' for n in css)
js_tags = "\n".join(f'<script src="js/{n}?v={v}"></script>' for n in js)

out = shell.replace("<!--CSS-->", css_tags).replace("<!--PARTS-->", html_parts).replace("<!--JS-->", js_tags)
(ROOT / "index.html").write_text(out, encoding="utf-8")
print(f"index.html gebaut: {len(parts)} parts, {len(css)} css, {len(js)} js")

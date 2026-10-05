#!/usr/bin/env python3
"""Setzt die fertigen HTML-Seiten aus den Inhaltsteilen in _quellen/ zusammen.

Jede Seite = gemeinsamer Kopf (Navigation) + ein oder mehrere Inhaltsteile + Fuß.
Aufruf:  python3 werkzeug/build.py
"""
import os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "_quellen")

# (Datei, Navigationstitel, Seitentitel, [Inhaltsteile in Reihenfolge])
PAGES = [
    ("index.html", "Start", "Übersicht", ["index.html"]),
    ("lehrplan.html", "Lehrplan", "Lehrplan der Unterrichtsreihe", ["lehrplan.html"]),
    ("stunden.html", "Stundenverläufe", "Stundenverläufe", ["stunden-0.html", "stunden-1.html", "stunden-2.html"]),
    ("arbeitsblaetter.html", "Arbeitsblätter", "Arbeitsblätter", ["ab-0.html", "ab-1.html", "ab-2.html"]),
    ("loesungen.html", "Lösungen", "Lösungen zu den Arbeitsblättern", ["loesungen-0.html", "loesungen-1.html", "loesungen-2.html"]),
    ("hausaufgaben.html", "Hausaufgaben", "Hausaufgaben & Überprüfung", ["hausaufgaben.html"]),
    ("methoden.html", "Methoden", "Methodenkoffer", ["methoden.html"]),
    ("uebungen.html", "Lernspiele", "Interaktive Lernspiele", ["uebungen.html"]),
    ("beamer.html", "Beamer-Bilder", "Bilder für den Beamer", ["beamer.html"]),
    ("klassenarbeit.html", "Klassenarbeit", "Klassenarbeit", ["klassenarbeit.html"]),
]

HEAD = """<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · Bildbeschreibung Klasse 5</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Andika:ital,wght@0,400;0,700;1,400&family=Nunito:wght@600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/style.css">
<link rel="icon" href="bilder/lupo.png">
</head>
<body class="seite-{slug}">
<header class="site-header no-print">
  <div class="inner">
    <a class="brand" href="index.html"><img src="bilder/lupo.png" alt=""><span>Bildbeschreibung<small>Deutsch · Klasse 5</small></span></a>
    <nav class="nav" aria-label="Hauptnavigation">
{nav}
    </nav>
  </div>
</header>
<main class="wrap">
"""

FOOT = """
</main>
<footer class="site-footer no-print">
  Unterrichtsreihe „Bildbeschreibung“ · Klasse 5 · Alle Illustrationen wurden für diese Reihe mit KI-Bildgenerierung erstellt.
</footer>
<script src="assets/app.js"></script>
</body>
</html>
"""


def main():
    missing = []
    for fname, navtitle, title, parts in PAGES:
        nav = "\n".join(
            f'      <a href="{f}"{" class=\"active\" aria-current=\"page\"" if f == fname else ""}>{n}</a>'
            for f, n, _, _ in PAGES)
        body = []
        for p in parts:
            path = os.path.join(SRC, p)
            if os.path.exists(path):
                with open(path, encoding="utf-8") as fh:
                    body.append(fh.read())
            else:
                missing.append(p)
                body.append(f'<div class="achtung no-print">Teil <code>{p}</code> fehlt noch.</div>')
        html = HEAD.format(title=title, slug=fname[:-5], nav=nav) + "\n".join(body) + FOOT
        with open(os.path.join(ROOT, fname), "w", encoding="utf-8") as fh:
            fh.write(html)
    print("gebaut:", ", ".join(p[0] for p in PAGES))
    if missing:
        print("fehlt:", ", ".join(missing), file=sys.stderr)


if __name__ == "__main__":
    main()

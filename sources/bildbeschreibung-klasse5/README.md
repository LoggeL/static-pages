# Bildbeschreibung · Klasse 5 – Quellen

- `_quellen/` – Inhaltsteile jeder Seite (nur der `<main>`-Inhalt)
- `werkzeug/build.py` – setzt Kopf/Navigation + Inhaltsteile zu den fertigen Seiten zusammen
- `werkzeug/gen_svg.py` – erzeugt die eigenen Übungsbilder (SVG) nach `bilder/`
- `werkzeug/VORGABE.md` – inhaltliche Vorgabe der Reihe (Stundenplan, Bildinhalte, Nummern)
- `assets/` – gemeinsames Stylesheet und JS

Neu bauen: Ordner neben `bilder/` legen (wie in `public/bildbeschreibung-klasse5/`), dann `python3 werkzeug/build.py`.

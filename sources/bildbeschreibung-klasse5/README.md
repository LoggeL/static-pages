# Bildbeschreibung · Klasse 5 – Quellen

- `_quellen/` – Inhaltsteile jeder Seite (nur der `<main>`-Inhalt)
- `werkzeug/build.py` – setzt Kopf/Navigation + Inhaltsteile zu den fertigen Seiten zusammen
- `werkzeug/prompts/` – Bild-Prompts; `werkzeug/codex_image.sh` / `gen_all.sh` erzeugen die Illustrationen über die Codex-CLI
- `werkzeug/lupo_freistellen.py` – stellt das Maskottchen vom Magenta-Hintergrund frei
- `werkzeug/VORGABE.md` – inhaltliche Vorgabe der Reihe (Stundenplan, verbindliche Bildinhalte, Nummern)
- `assets/` – gemeinsames Stylesheet und JS

Neu bauen: Ordner neben `bilder/` legen (wie in `public/bildbeschreibung-klasse5/`), dann `python3 werkzeug/build.py`.

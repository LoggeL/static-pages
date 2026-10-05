# Was der Berg behält – Roman vom Donnersberg

Historischer Low-Fantasy-Roman (ca. 113.000 Wörter) über das keltische Oppidum auf dem Donnersberg, 54–51 v. Chr., und die Frage, warum es aufgegeben wurde.

- `kapitel/` – Romantext als Markdown (Prolog, 23 Kapitel, Epilog, Anhang mit Personen, Glossar, Kalender und Nachwort)
- `konzept/` – Story-Bible und Kapitelplan
- `recherche/` – Recherche-Dossiers (Archäologie, Geschichte, Mythologie, Alltag)
- `werkzeug/build.py` – erzeugt `book.json` für die Lese-Seite aus `kapitel/*.md`
- `site/` – Lese-Seite (HTML/CSS/JS); Bilder und `book.json` liegen in `public/was-der-berg-behaelt/`

Neu bauen: `kapitel/` und `werkzeug/` nebeneinander legen, `python3 werkzeug/build.py` ausführen (schreibt nach `site/book.json`) und das Ergebnis nach `public/was-der-berg-behaelt/` kopieren.

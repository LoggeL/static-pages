# Quadratische Gleichungen ohne Formel

Handyoptimierte Lernseite für Klasse 9 (HÜ-Vorbereitung): quadratische Gleichungen auf drei Wegen lösen – **grafisch**, durch **Faktorisieren** (inkl. Wurzel ziehen) und mit der **quadratischen Ergänzung** – ganz ohne p-q- oder abc-Formel. Dazu Grundlagen, Methodenwahl, ein Trainingsraum mit Zufallsaufgaben, zwei Probe-HÜs mit Timer, ein druckbarer Spickzettel und ein Leitfaden für die Nachhilfe.

Statische Seite ohne Build-Abhängigkeiten (nur Google Fonts „Nunito“). Fortschritt wird nur lokal im Browser gespeichert (`localStorage`, Präfix `qg:`).

## Struktur

| Pfad | Inhalt |
|---|---|
| `shell.html` | Seitengerüst (Top-Bar, Menü, Toasts); `<!--PARTS-->` wird durch die Kapitel ersetzt |
| `parts/NN-name.html` | ein Kapitel pro Datei (`<section class="chapter" id="…">`), Hash-Routing `#start`, `#grafisch` … |
| `css/base.css` | Design-System (Tokens, Hell/Dunkel, Boxen, Aufgaben, Rechnungen, Druck) |
| `css/NN-name.css` | Kapitel-Styles, immer unter `#kapitel-id` gescoped |
| `js/core.js` | Core (`window.QG`): Router, Antwort-Parser, Aufgaben-Check, Stepper, `QG.plot`, Store, Widgets |
| `js/NN-name.js` | Kapitel-Widgets (`QG.widget(name, fn)`) |
| `tests/` | Node-Tests für Parser/Core und den Aufgaben-Generator des Trainingsraums |
| `CONTRACT.md` | Vertrag für Inhalte, Markup und Core-API |

Kapitel: 00 Start · 10 Grundlagen · 20 Grafisch · 30 Faktorisieren · 40 Ergänzung · 50 Welcher Weg? · 60 Training · 70 Probe-HÜ · 80 Spickzettel · 90 Nachhilfe (143 gezählte Aufgaben + unbegrenzte Trainingsaufgaben).

## Build

```sh
python3 -I build.py
```

Erzeugt `../../public/quadratische-gleichungen/` mit `index.html`, `style.css` (base.css + Kapitel-CSS alphabetisch) und `app.js` (core.js + Kapitel-JS, jede Datei in `try/catch`). Nie direkt in `public/` editieren. Lokal ansehen:

```sh
python3 -m http.server 8765 -d ../../public/quadratische-gleichungen
```

## Tests

```sh
node tests/parse.test.mjs      # Antwort-Parser, Formatierung, Mathe-Typografie
node tests/training.test.mjs   # ~2 Mio. Prüfungen der Zufallsaufgaben (jede Rechenzeile)
```

Im Browser listet `QG.selfcheck()` in der Konsole Markup-Probleme (doppelte IDs, unlesbare Antworten, fehlende Widgets).

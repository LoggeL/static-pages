# Bodycam-Tech-Demo

[Demo öffnen](https://loggel.github.io/static-pages/bodycam-demo/)

Spielbare Technikdemo mit Three.js 0.170.0 und WebGL2. Maus und Tastatur
sind erforderlich. Der Startbildschirm zeigt die Steuerung sowie Grafik-
und Lautstärkeeinstellungen.

`public/bodycam-demo/` enthält die Laufzeitdateien. Die Veröffentlichung
auf GitHub Pages erfolgt aus `docs/bodycam-demo/` auf `main`.
Die Quellen, Blender-Generatoren und Prüfwerkzeuge liegen in diesem Ordner.
[CONTRACT.md](CONTRACT.md) beschreibt die Schnittstellen,
die [Statusberichte](status/) dokumentieren den jeweiligen Prüfstand.

Die öffentlichen Dateien enthalten keine lokal geschnittenen Audioaufnahmen.
Die Laufzeit wählt beim ersten fehlenden Audio-Sample die vorhandene Synthese
und zeigt dies an. Das verursacht eine erwartete HTTP-404-Probe; weitere
Aufnahmen werden danach nicht angefragt. Die Audioengine unter `js/audio/`
gehört zur Veröffentlichung.

## Veröffentlichten Stand prüfen

Am 14.10.2026 bestand der vollständige C20-Lauf alle 21 Gruppen mit
104 Bildern und 435 funktionalen Prüfungen. Die 348 geprüften Dateien
wurden vor der Veröffentlichung per SHA-256 mit dem Arbeitsstand verglichen.
Die Prüfung der veröffentlichten Zusammenstellung ohne Aufnahmen bestand
16 Checks: Start, echte Mausbindung, Bewegung, Waffenlicht, Schuss,
Nachladen, Pause, alle Laufzeitmodule und Browserdiagnostik. Screenshots
von Start und Spiel wurden angesehen. Die MIME- und Referenzprüfung
bestand für 309 Dateien und 1.256 lokale Verweise.

Die Technikdemo enthält die in C18/C19 dokumentierten Modell- und
Animationsgrenzen. Die Kamera der NPC-Prüfseite hat im engen CLO1 einen
in C20 dokumentierten offenen Befund. Diese Veröffentlichung ändert
keine Spielmechanik oder Modelle.

```sh
npm ci --prefix sources/bodycam-demo/tools/harness --ignore-scripts --no-audit --no-fund
npm test --prefix sources/bodycam-demo/tools/harness
python3 sources/bodycam-demo/tools/check_mime.py --root docs/bodycam-demo
```

Ausführliche Testanleitung: [tools/harness/README.md](tools/harness/README.md).
Audioaufnahmen, Python-Caches und Ausführungsprotokolle bleiben lokal.

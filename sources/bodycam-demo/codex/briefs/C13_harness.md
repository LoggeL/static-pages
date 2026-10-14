# Auftrag C13: Test-Harness (Port 8954)

**Deine Dateien:** `sources/bodycam-demo/tools/harness/**` (eigene `package.json`; `node_modules` ist im Repo ignoriert), `sources/bodycam-demo/status/C13.md`.

- Ein Befehl `node sources/bodycam-demo/tools/harness/run.mjs --page <pfad unter public/> --shots shots.json --out <ordner>`:
  startet einen eigenen statischen Server, öffnet die Seite in Headless-Chromium mit echter GPU (siehe gemeinsame Regeln), wartet auf
  `window.__bodycam?.ready`, fährt benannte Kamerapunkte/Aktionen aus einer JSON-Datei an (`teleport`, `look`, Tasten, `eval`), macht Screenshots,
  sammelt Konsole/Fehler/fehlgeschlagene Requests, misst FPS (rAF über n Sekunden), Frame-Zeit-Perzentile, `renderer.info` (falls über `__bodycam.stats()` verfügbar).
- Ausgabe: PNGs, `report.json`, `report.html` mit Kontaktbogen und Kennzahlen; Exit-Code ≠ 0 bei Konsolenfehlern.
- Vorbereitete Shot-Listen für die bekannten Seiten (`_dev/world`, `_dev/weapon`, `_dev/postfx`, `_dev/lightmaps`, App `index.html`) mit
  sinnvollen Kamerapunkten aus `blender/layout.json` (Spawn, Veranda, Flur, jeder Raum).
- Vergleichsmodus: zwei Läufe nebeneinander (vorher/nachher) als Bildpaar-Bogen; optional ein Referenzframe aus `$WORK/ref/frames/` daneben.
- Selbsttest mit einer Mini-Seite. Kurze Anleitung in der Statusdatei.

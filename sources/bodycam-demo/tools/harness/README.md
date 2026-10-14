# Bodycam-Test-Harness (C13/C16/C20)

Lokales Node-Werkzeug, kein Build-Schritt für die Demo. Benötigt Node >= 22 und den in `_common.md` angegebenen Chromium. Installation ab Repo-Root:

```sh
npm ci --prefix sources/bodycam-demo/tools/harness --ignore-scripts --no-audit --no-fund
```

## Ein Lauf

```sh
node sources/bodycam-demo/tools/harness/run.mjs \
  --page 'bodycam-demo/_dev/world/index.html?debug=1' \
  --shots sources/bodycam-demo/tools/harness/shots/world.json \
  --out /Users/logge/Documents/Projects/bodycam-work/codex/C20/world-run
```

`--page` ist relativ zu `public/`; führendes `/` oder `public/` ist ebenfalls erlaubt. Externe URLs und Pfade mit `..` werden abgewiesen. Ohne `--page` gilt `page` aus der Shot-Datei. Ein Shot kann über sein eigenes `page` eine weitere Seite desselben Servers laden. Deren vollständiger Pfad, Query und Fragment werden übernommen; `--page` überschreibt nur die Einstiegsseite.

Der Runner startet selbst einen Server auf `127.0.0.1:8969` und beendet Server und eigenen Chromium nach Erfolg, Fehler und SIGINT/SIGTERM. Ein belegter Port ist ein Fehler. Er verwendet ein neues Browserprofil und ANGLE/Metal; ein Software-Renderer wird nicht akzeptiert. Der Ausgabeordner muss neu oder leer sein und außerhalb des Repos liegen. Vorhandene Ergebnisse werden nicht überschrieben.

Erzeugt werden benannte PNGs, eine Kopie der Shot-Datei, `report.json` und ein lokal öffnbarer `report.html` mit Kontaktbogen, Kennzahlen, GPU-Nachweis und vollständiger Diagnostik. `report.json` speichert Eingabedatei samt SHA-256, Aktionsresultate, Browser-/Viewport-Einstellungen und rohe Frame-Abstände. Es ist kein Snapshot aller gleichzeitig veränderten Demo-Quellen.

Exit-Codes: `0` bestanden, `1` Lauf fehlgeschlagen, `2` ungültige Eingabe oder Ausgabe nicht möglich. Konsolenmeldungen vom Typ `error`, JavaScript-Ausnahmen, fehlgeschlagene Requests, HTTP >= 400, Aktions-/Statistikfehler und Laufzeitfehler führen zu Exit 1. Warnungen allein tun das nicht. Auch bei einem Fehler werden Berichte geschrieben, sofern der Ausgabeordner verfügbar ist. Nach einem Timeout wird der Lauf beendet: laufendes JavaScript lässt sich nicht durch ein Promise-Zeitlimit abbrechen und könnte sonst Folgeaufnahmen verändern.

## Shot-Datei

```json
{
  "version": 1,
  "page": "bodycam-demo/_dev/world/index.html?debug=1",
  "defaults": { "settleMs": 500, "measureSeconds": 3 },
  "shots": [
    {
      "name": "flur",
      "teleport": [-0.28, 0.6, -1.6, 0, -4],
      "look": [0, -4],
      "actions": [
        { "type": "keys", "keys": ["ShiftLeft", "KeyW"], "durationMs": 300 },
        { "type": "look", "yawDeg": 30, "pitchDeg": -4 },
        { "type": "eval", "code": "window.__bodycam.stats()" },
        { "type": "wait", "ms": 200 }
      ]
    }
  ]
}
```

Alle Shot-Namen müssen eindeutig sein. Metadaten wie `description`, `source` und `integration` bleiben erhalten. Alternativ ist eine einfache Shot-Liste erlaubt; dann ist CLI `--page` erforderlich.

Ablauf: Seite laden, `beforeReady`-Aktionen ausführen, auf `window.__bodycam.ready` warten, den nativen Audioausgang auswählen, `setup` ausführen. `ready` muss `true` oder ein erfülltes Promise sein; ein Promise mit Ergebnis `false` scheitert. Ohne echtes Ready-Signal wird kein Screenshot als Erfolg ausgegeben. `beforeReady` und `setup` gelten nach jeder Navigation. Sie erlauben explizite Adapter vorhandener Debug-APIs und echte Startdialog-Aktionen.

Je Shot: optional navigieren, `teleport`, `look`, `actions` der Reihe nach, `settleMs` warten, Screenshot, Statistik-Snapshot, rAF-Messung, zweiter Statistik-Snapshot. Der Zustand bleibt zwischen Shots erhalten. `teleport`/`look` werden nicht über direkten Zugriff auf eine vermutete Kamera nachgebaut, sondern rufen die vorhandenen Methoden auf.

| Aktion | Daten | Verhalten |
| --- | --- | --- |
| `teleport` | `position: [x,y,z]`, optional `yawDeg`, `pitchDeg` | `__bodycam.teleport(x,y,z,yaw,pitch)`, Standardwinkel 0/-4 Grad |
| `look` | `yawDeg`, `pitchDeg` | `__bodycam.look(yaw,pitch)` |
| `keys` | `keys: ["KeyW","ShiftLeft"]`, optional `durationMs` | Native Playwright-Keydowns gleichzeitig halten, danach alle loslassen, Standard 80 ms |
| `mouse` | optional `button`, `position: [x,y]`, `durationMs` | Native Maustaste halten/loslassen, Standard links/80 ms |
| `click` | `selector` | Sichtbares Element mit Playwright anklicken |
| `eval` | `code` | JavaScript im Seitenkontext ausführen, Promise abwarten und Ergebnis protokollieren |
| `wait` | `ms` | Bewusste Pause |

Shot-Kurzformen: `teleport: [x,y,z]` oder `[x,y,z,yawDeg,pitchDeg]` und `look: [yawDeg,pitchDeg]`. Koordinaten sind Three.js-Weltkoordinaten in Metern; Spielerseiten verwenden die Fußposition, Lightmaps die absolute Kamera über setCamera. Die Herkunft der vorbereiteten Punkte steht in [shots/README.md](shots/README.md).

`eval` ist absichtlich frei ausführbarer Code. Shot-Dateien müssen aus einer vertrauenswürdigen Quelle stammen. Der Shot-Runner bewertet den Look nicht automatisch. Die funktionalen Regressionen verwenden gesonderte numerische und bildbasierte Prüfungen.

## Parameter und Messgrenzen

Standard: 1920 × 1080, DPR 1, 500 ms Einschwingzeit, drei Sekunden Messung, 60 Sekunden Ready-/Navigationsfrist, 15 Sekunden Aktionsfrist. Optionen:

```text
--width 1920 --height 1080 --device-scale-factor 1
--measure-seconds 3 --settle-ms 500
--ready-timeout-ms 60000 --action-timeout-ms 15000
--port 8969 --browser /absolute/path/to/chromium
--root /absolute/static/root
--audio-sink none|default
```

Priorität für Mess-/Einschwingzeit: CLI vor Shot vor Datei-Defaults vor Werkzeugstandard. `measureSeconds: 0` deaktiviert die Messung für kurze Ereignisse. Screenshots kommen immer vor der Messung. Kurze Mündungsblitze sind ohne gezielte Pause/Render-Schritt der Zielseite nicht framegenau garantiert.

FPS = Anzahl rAF-Intervalle × 1000 / Summe ihrer Millisekunden. p50/p90/p95/p99 sind linear interpolierte Perzentile der sortierten Intervalle. Rohe Samples stehen im Bericht. Das misst die Browser-Taktung einschließlich VSync und Systemlast, keine isolierte Render-, GPU- oder Post-FX-Zeit. `__bodycam.stats()` ist optional; fehlende Daten bleiben `null`. Vorhandene Daten werden zum Aufnahmezeitpunkt und nach der Messung gespeichert.

Konsole und Requests werden ab Navigation bis 200 ms nach dem letzten Shot beobachtet; dies ist kein unbegrenzter Netzwerk-Idle-Nachweis. Beim gezielten Schließen abgebrochene Requests werden nicht als Anwendungsfehler gezählt. Die tatsächliche GPU-Kennung wird mit WebGL2 und zusätzlich Chromium-CDP erfasst.

## Vergleich und Referenz

```sh
node sources/bodycam-demo/tools/harness/compare.mjs \
  --before /Users/logge/Documents/Projects/bodycam-work/codex/C20/world-before \
  --after /Users/logge/Documents/Projects/bodycam-work/codex/C20/world-after \
  --out /Users/logge/Documents/Projects/bodycam-work/codex/C20/world-comparison \
  --reference /Users/logge/Documents/Projects/bodycam-work/ref/frames/ref_01_osd_spiel_tag_innen.jpg
```

Vorher/Nachher dürfen Laufordner oder `report.json` sein. Der Vergleich benötigt einen neuen Ausgabeordner außerhalb Repo und Quellläufen. Er kopiert Bilder und optionale PNG/JPEG/WebP-Referenz und erzeugt einen portablen `compare.html` samt `compare.json`. Zuordnung über Shot-Namen, zusätzliche/fehlende Shots bleiben sichtbar. Er zeigt FPS-/p95-Differenzen ohne automatische Qualitätsbewertung. Exit 0 bedeutet vollständige vorhandene Bilddaten, nicht dass beide Ausgangsläufe bestanden haben; Exit 1 ist ein Eingabe-/Dateifehler, Exit 2 bedeutet fehlende Bilder in vorhandenen Shots.

## Gesamtsuite und Selbsttest

```sh
npm test --prefix sources/bodycam-demo/tools/harness
npm run test:self --prefix sources/bodycam-demo/tools/harness
node sources/bodycam-demo/tools/harness/generate-shots.mjs --check
```

Die lokale Miniseite zeichnet echtes WebGL2, ohne CDN oder Demo-Assets. Der Test startet CLI-Läufe und prüft Aktionen, Readiness, PNGs, Frame-Messung, Statistik, Fehler-Exitcodes, Zeitlimits, Portkonflikte, SIGTERM und Server-Cleanup. Die HTML-Berichte werden im Browser bei Desktop- und Mobilbreite geprüft und als Screenshots abgelegt. Alle Ergebnisse liegen in einem neuen `bodycam-work/codex/C20/selftest-*`-Ordner. Ein Test mit absichtlichen Fehlern gilt als bestanden, wenn der Harness korrekt scheitert und die Diagnose enthält.

Gezielter manueller Minilauf:

```sh
node sources/bodycam-demo/tools/harness/run.mjs \
  --root sources/bodycam-demo/tools/harness/fixtures \
  --page index.html \
  --shots sources/bodycam-demo/tools/harness/fixtures/shots.json \
  --out /Users/logge/Documents/Projects/bodycam-work/codex/C20/mini-manual
```

API-Nachschlagequellen: [Playwright Page](https://playwright.dev/docs/api/class-page), [Browser/CDP](https://playwright.dev/docs/api/class-browser). Projektspezifische Abnahme und Integrationsbefunde: [C16.md](../../status/C16.md).

## C20-Regressionssuite

`npm test` startet `suite.mjs`: Preset-Konsistenz, den Werkzeug-Selbsttest,
elf Shot-Listen, Türphysik, Waffenträgheit, Post-FX, Arme, NPCs,
Netzwerk-A/B-Test, Audiozeit und Quellstabilität. Fehler einer Gruppe verhindern
folgende Gruppen nicht. Echte Fehler führen zu Exit 1.

```sh
npm test --prefix sources/bodycam-demo/tools/harness
npm test --prefix sources/bodycam-demo/tools/harness -- --out /Users/logge/Documents/Projects/bodycam-work/codex/C20/new-full-run
node sources/bodycam-demo/tools/harness/suite.mjs --only arms,npc
node sources/bodycam-demo/tools/harness/suite.mjs --only audio-default
```

Ohne `--out` entsteht ein neuer `suite-*`-Ordner unter C20. `--only` markiert
den Lauf als unvollständig. `suite.json` enthält Gruppenergebnisse und SHA-256
aller Harnessdateien und ausgelieferten Demo-Dateien einschließlich der
Prüfseiten, ohne `audio/`, `node_modules/` und Python-Caches. Die Gruppe
`source-integrity` vergleicht die Quellen vor/nach dem gesamten Lauf.
`index.html` verlinkt Berichte. Alle GPU-Läufe erfolgen nacheinander auf Port 8969.

- `door-regression.mjs`: echte Tür-, Input-, Spieler- und Kollisionsmodule,
  30/60/144-Hz-Verläufe, beide Schubrichtungen, gespiegeltes Scharnier,
  Kapsel/Box-Abstand, Projektilimpulse und echte App-Schüsse.
- `weapon-regression.mjs`: echte Waffenassets, Drehimpuls, Abklingen, tatsächliche
  ADS-Auslenkung, Modul-/App-Teleport und endliche Zustandswerte.
- `postfx-regression.mjs`: Produktionsshader, 300/600 Grad/s bei allen Qualitäten,
  Kompressionsvergleich desselben Sensorframes, negative Kachelkontrolle und
  messbarer Welt-Blur. Die isolierte Silhouette prüft die Shader; echte Arme
  und Waffe haben eigene funktionale Tests und Bilder.
- `arms-regression.mjs`: echte FP-/Waffenmodelle, Handknochen-/Zielabstände und
  Rotationen, Zustände, freie Ziele, Finger, schnelle Drehungen, Dispose,
  Neuaufbau, mobile Größe sowie App mit/ohne Arme.
- `npc-regression.mjs`: echte Welt-/Türnavigation, Sicht, Hören, Trefferzonen,
  Schüsse, Zustände, Cleanup, Neuaufbau und drei abwechselnde FPS-Paare.

Der Standard `none` verwendet `AudioContext.setSinkId({type:'none'})` nach
Bereitschaft und vor App-Start. Der native Audiograph und die Samples bleiben
aktiv. Jede Navigation wird erneut konfiguriert und protokolliert.
`--audio-sink default` oder `BODYCAM_AUDIO_SINK=default` wählt das echte
Standardgerät. `audio` prüft die gewählte Ausgabe und fortschreitende Audiozeit
über sechs Sekunden (mindestens 50 % Fortschritt; `AUDIO_CLOCK_CONFIG` in `suite.mjs`).
`audio-default` ist eine gesondert aufrufbare Diagnose und gehört nicht zum
Standardlauf. Der bekannte Headless-Gerätefehler bleibt in dessen Bericht
sichtbar; hörbare Ausgabe wird nicht abgenommen. Die NPC-Prüfseite wählt beim
internen Aufbau bereits `none`; der Harness setzt die angeforderte Auswahl
nach Bereitschaft und nach Neuaufbau erneut.

Statische Antworten verwenden `Cache-Control: no-cache`. Requestfehler bleiben
streng; Responses und Requestabschlüsse werden protokolliert. Bei frühem
Seitenfehler entsteht `failure.png`, keine erfolgreiche Modellaufnahme.
`network-regression.mjs` prüft alle 18 historischen GLB-Pfade unter `no-store`
und `no-cache` mit Bytezahl, EOF und SHA-256 gegen aktuelle Dateien. Nur die
nachgewiesene `no-store`-Kontrollvariante darf vollständig gelesene Bytes trotz
`ERR_ABORTED` melden; der korrigierte Header muss sauber abschließen.

Abnahme und offene App-Befunde: [C20.md](../../status/C20.md).

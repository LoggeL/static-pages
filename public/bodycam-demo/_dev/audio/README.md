# Audioprüfung C4

Diese Testseite lädt dieselbe Engine und Mischung wie die Demo. Alle 11 Ereignisse aus dem C4-Vertrag haben einen eigenen Knopf. Der Regler startet bei 35 % Wiedergabepegel. Offline-Messungen verwenden den vollen Masterpegel und geben keinen Ton über Lautsprecher aus.

Vom Repository-Verzeichnis aus:

```sh
python3 -m http.server 8952 --bind 127.0.0.1 -d public
```

Seite: `http://127.0.0.1:8952/bodycam-demo/_dev/audio/`

Automatische Prüfung im echten Chromium mit AudioContext und OfflineAudioContext:

```sh
node public/bodycam-demo/_dev/audio/run.mjs
node public/bodycam-demo/_dev/audio/verify.mjs
```

Die vorhandene Werkzeuginstallation unter `/Users/logge/Documents/Projects/bodycam-work/tools/node_modules/playwright` wird verwendet. `PLAYWRIGHT_MODULE` und `CHROMIUM_PATH` können die Werkzeugpfade ersetzen. Artefakte liegen standardmäßig unter `/Users/logge/Documents/Projects/bodycam-work/codex/C4/`; `C4_OUTPUT` kann einen anderen Ordner außerhalb des Repositorys festlegen.

Der Dateilauf erwartet erfolgreiche Audioantworten. Im zweiten Lauf beantwortet Playwright alle OGG-Anfragen mit echten HTTP-404-Antworten. Manifest und Engine bleiben verfügbar. Die Seite selbst kann denselben Ausfall über einen injizierten Fetch-Aufruf simulieren. Beide Fälle rendern dieselbe 36-Sekunden-Sequenz mit einem festen Zufalls-Seed. Ergebnisse: WAV (PCM16, 48 kHz, Stereo), Messwerte pro Abschnitt, vollständige Ereignisfolge, Engine-Diagnose, Browserfehler und Screenshots. Der Runner beendet sich bei ungültigem Audio, Clipping über Vollaussteuerung, Überschreitung des konfigurierten -0,3-dB-Ceilings, unvollständiger Ereignisfolge oder unerwarteten Browserfehlern mit Fehlerstatus.

Spektrogramme aus den WAVs erstellen:

```sh
ffmpeg -y -i /Users/logge/Documents/Projects/bodycam-work/codex/C4/bodycam-c4-files.wav -lavfi 'showspectrumpic=s=1600x800:legend=1:scale=log:fscale=log' /Users/logge/Documents/Projects/bodycam-work/codex/C4/bodycam-c4-files-spectrum.png
ffmpeg -y -i /Users/logge/Documents/Projects/bodycam-work/codex/C4/bodycam-c4-fallback-404.wav -lavfi 'showspectrumpic=s=1600x800:legend=1:scale=log:fscale=log' /Users/logge/Documents/Projects/bodycam-work/codex/C4/bodycam-c4-fallback-404-spectrum.png
```

`window.audioTest.runOffline({ fallback, simulate404, includeWav, seed })` liefert die Messwerte und optional Base64-WAV-Daten. `simulate404: false` ermöglicht die echte Netzwerkinterzeption des Runners. `window.audioTest.validateAdapter()` prüft alle Ereignisse und das Entfernen der Listener für einen `on/off`-Bus sowie für `EventTarget`.

`clippingRatio` zählt Samples mit Betrag mindestens 1. `ceilingRatio` zählt Samples am -0,3-dB-Ceiling (Toleranz 0,00001). `above097Ratio` verwendet zusätzlich die Schwelle 0,97 aus den Referenzmessungen. Das absichtliche Softclipping unterhalb des Ceilings ist getrennt vom digitalen Übersteuern ausgewiesen. Peak/RMS werden aus dem Float-Render gemessen, vor der PCM16-Quantisierung.

Die Sequenz enthält Außen- und Innenschüsse, einen entfernten verdeckten Pistolenschuss, zwei Nachladefolgen mit STYLE-Zeitstempeln, drei Türaktionen, Schritte auf allen 13 Contract-Oberflächen, Schalter, Hülsen und alle sechs Einschlagsmaterialien. Raumnamen und Hallwerte im Harness sind neutrale Testprofile; die Anwendung kann die Profile aus `layout.json` übergeben.

`verify.mjs` ergänzt acht gezielte Prüfgruppen mit echten Web-Audio-Nodes: Layer-Timing, Mechanikpegel, Varianten, Raumprofile, fehlendes Manifest, 404-Cache, frühe Stops, Loop-Limit, Distanz/Laufzeit/Verdeckung, bewegter Lichtbalken, Rauschpegel/Mute, Ducking und Scheduler. Ergebnis: `verification.json` im selben Artefaktordner. Nur die Scheduler-Intervalle sind in dieser Prüfung verkürzt; im Produktionsmix bleiben es 40 bis 90 Sekunden für Funk.

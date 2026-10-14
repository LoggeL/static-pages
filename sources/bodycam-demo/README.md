# Bodycam-Tech-Demo

[Demo öffnen](https://loggel.github.io/static-pages/bodycam-demo/)

Spielbare Technikdemo mit Three.js 0.170.0 und WebGL2. Unterstützt Maus,
Tastatur und Touch. Der Startbildschirm zeigt die Steuerung sowie Grafik-,
Eingabe- und Lautstärkeeinstellungen.

`public/bodycam-demo/` enthält die Laufzeitdateien. Die Veröffentlichung
auf GitHub Pages erfolgt aus `docs/bodycam-demo/` auf `main`.
Die Quellen, Blender-Generatoren und Prüfwerkzeuge liegen in diesem Ordner.
[CONTRACT.md](CONTRACT.md) beschreibt die Schnittstellen,
die [Statusberichte](status/) dokumentieren den jeweiligen Prüfstand.

Die Veröffentlichung enthält 198 Opus-Soundclips für 50 Klangereignisse
(8.153.247 Bytes). Die Laufzeit lädt und dekodiert die Aufnahmen im Hintergrund.
Das Laden der Karte wartet weder auf die Sounds noch auf einen Audio-Kontext.
Auf Handys werden zuerst 16 häufige Sounds geladen, weitere Varianten bei Bedarf.
Der dekodierte Cache ist dort auf 24 MiB begrenzt. Bei fehlenden oder nicht lesbaren Dateien stehen synthetische
Ersatzklänge bereit. Manifest: `data/sounds.json`, Dateien: `audio/`.

## Veröffentlichten Stand prüfen

Der C20-Lauf vor der Handy-Korrektur vom 14.10.2026 bestand alle 21 Gruppen mit
104 Bildern und 435 funktionalen Prüfungen. Die 348 geprüften Dateien
wurden vor der Veröffentlichung per SHA-256 mit dem Arbeitsstand verglichen.
Der lokale Veröffentlichungscheck mit Aufnahmen bestand alle 21 Prüfungen:
Start, echte Mausbindung, Bewegung,
Waffenlicht, Schuss, Nachladen, Pause, alle Laufzeitmodule und
Browserdiagnostik. Für die Aufnahmen werden zusätzlich die erfolgreiche
Dekodierung aller 198 Dateien, die Audiozeit und die Wiedergabe der
Dateiquellen ohne Synthese geprüft.

Die Technikdemo enthält die in C18/C19 dokumentierten Modell- und
Animationsgrenzen. Die Kamera der NPC-Prüfseite hat im engen CLO1 einen
in C20 dokumentierten offenen Befund. Die Handyfassung erhält die Geometrie und Spielmechanik dieses Stands.

```sh
npm ci --prefix sources/bodycam-demo/tools/harness --ignore-scripts --no-audit --no-fund
npm test --prefix sources/bodycam-demo/tools/harness
python3 sources/bodycam-demo/tools/check_mime.py --root docs/bodycam-demo
```

Ausführliche Testanleitung: [tools/harness/README.md](tools/harness/README.md).
Python-Caches und Ausführungsprotokolle bleiben lokal.

## Handy, Grafik und Ausfälle

Auf Touchgeräten erscheint automatisch der Bewegungsstick links. Rechts
ziehen dreht die Kamera. Bewegung, Umsehen und Feuer halten funktionieren
gleichzeitig. Zielen, Ducken und Sprint lassen sich umschalten; weitere
Aktionen liegen unter "Mehr". Pause, Fokusverlust, abgebrochene Kontakte
und Bildschirmdrehung geben die Eingaben frei. Im Start-/Pausenmenü lässt
sich die Eingabe auch ausdrücklich auf Touch oder Maus stellen. Wenn die
Mausbindung gesperrt ist, startet die Bildschirmsteuerung als Ersatz.

"Automatisch" verwendet auf Touchgeräten eine niedrige Grafikstufe.
Anhaltend langsame Frames reduzieren Effekte und Auflösung, bei genügend
Reserve steigt die Auflösung wieder. Tabwechsel und Pausen zählen nicht
als langsame Frames. Software-Renderer erhalten eine eigene sparsame
Voreinstellung. Eine manuell gewählte Stufe bleibt bestehen. Bei fehlendem
HDR/Post-FX bleibt die Welt ohne Nachbearbeitung spielbar. Nach Verlust
des Grafikkontexts bietet die Fehleranzeige einen Neustart mit einfacher
Grafik an. Ohne WebGL2 kann die 3D-Demo nicht laufen.

Handys und Geräte mit wenig gemeldetem RAM wählen vor dem Dekodieren das
Profil `mobile/`. Es enthält dasselbe gebackene Haus, dieselbe Kollision,
Türen, Spawnpunkte und Navigation. Haus-, Tile- und Decal-Texturen sind
maximal 256 Pixel groß, Akteure/Waffen maximal 512 Pixel, RGBM-Lightmaps
512 Pixel. Der reproduzierbare Builder mittelt RGBM in linearem Licht.
Das vollständige mobile Profil umfasst 166 Dateien mit 29.040.890 Bytes.
Die konservative Texturspeicherschätzung für alle Assets sinkt um 92,7 %.
Dynamische Schatten entfallen im mobilen Profil.

Eine fehlende Textur oder Lightmap verwirft das Gebäude nicht. Die betroffenen
Materialien erhalten einfache Farben bzw. Beleuchtung. Fehlt `DecompressionStream`,
dekodiert ein lokaler Deflate-Fallback die PNG-Daten. Der sparsame Neustart
(`?assets=safe&quality=low&postfx=0`) verwendet die mobile Karte ohne Lightmaps
und Kameraeffekte. Schlägt der eigentliche Haus-/Kollisionsdownload fehl,
folgt ein automatischer Versuch mit diesem Profil. Scheitert auch der,
erscheint ein Fehler statt einer startbereiten leeren Bodenplatte.
Netz-/Dekodierphasen haben Zeitlimits; der sparsame Neustart und kopierbare
Ladedetails sind bereits während des Ladens zugänglich.

Bei fehlenden oder beschädigten Einzelaufnahmen bleiben die anderen
Dateiquellen verfügbar. Drei getrennte Proben prüfen die Erreichbarkeit;
komplett fehlende Aufnahmen führen direkt zur Synthese. Ein fehlendes oder
ungültiges Manifest verwendet ebenfalls die Ersatzklänge. Abruf und Dekodierung einzelner Clips haben Zeitlimits; bereits
dekodierte Aufnahmen bleiben nutzbar. Später benötigte Sounds können
auch nach dem Start weitergeladen werden.

Die Handy-Korrektur besteht 42 Prüfungen in acht WebKit-Szenarien,
65 Chromium-Touch-/Ausfallprüfungen, 13 Desktop-/Karten-Retry-Prüfungen,
32 Audioprüfungen und 19 isolierte Weltprüfungen. WebKit-Fälle umfassen
fehlende Atlanten, fehlenden PNG-Entpacker, unterbrochenes Audio,
einen endlos wartenden Audiodecoder, verzögertes Manifest und hängenden
Hausdownload. Der Assetcheck prüft 2301 lokale Referenzen ohne Fehler.

Die Mechanismen für Geräteklassen, Auflösungsanpassung und sichere
Touchfreigabe orientieren sich an Bulli Drive. Die Browserprüfung verwendet
echte Chromium-Touchkontakte und Web Audio, einschließlich gleichzeitiger
Kontakte, analoger Geschwindigkeit, gedrehter Blickrichtung, verweigerter
Mausbindung im Sandbox-Iframe und echtem WebGL-Kontextverlust. Das ist
eine Browseremulation von Handy-/Tabletgrößen auf der Mac-GPU, keine
Abnahme auf einem physischen Android- oder iOS-Gerät.

```sh
node sources/bodycam-demo/tools/harness/mobile-check.mjs /absoluter/neuer/ergebnisordner
# WebKit mit iPhone-Profil und gezielt blockierten/defekten Downloads:
node sources/bodycam-demo/tools/harness/phone-check.mjs /absoluter/neuer/webkit-ergebnisordner
# Optional dieselben Prüfungen gegen eine veröffentlichte URL:
node sources/bodycam-demo/tools/harness/mobile-check.mjs /absoluter/neuer/ergebnisordner https://loggel.github.io/static-pages/bodycam-demo/
```

Vor jeder Veröffentlichung `node sources/bodycam-demo/tools/version-modules.mjs`
ausführen und `public/bodycam-demo/` nach `docs/bodycam-demo/` synchronisieren.
`npm run build` führt die Modulversionierung automatisch aus. Native
Import-Map-Einträge und das CSS erhalten Inhaltshashes gegen veraltete
Browserdateien; CDN-Versionen von Three.js und BVH bleiben fest gepinnt.

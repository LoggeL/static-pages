# Grundstück · 3D-Begehung

Quelltext des Viewers unter `public/grundstueck-3d/`. Die Seite ist bewusst nicht in der
Galerie und nicht im Haupt-README verlinkt und trägt `noindex`.

Die Seite startet als leichte 2D-Karte (Orthofoto-Kacheln aus der Rekonstruktion, Grenzen,
Gebäude, Kanal und alle Messwerkzeuge, rund 130 KB bis zum ersten Kartenbild). Die 3D-Ansicht
lädt erst auf Wunsch („3D laden“, Taste V): ein Gaussian Splat des Gartengrundstücks
(bis 2,6 Mio. Splats, SOG-komprimiert, je nach Qualitätsstufe 5,3 bis 40,1 MB), aus den
Begehungen vom 14. und 21.11.2026 rekonstruiert (siehe „Datengrundlage“). Messwerkzeuge in beiden Ansichten: Strecke,
Fläche, Höhe, Höhenprofil entlang einer Strecke und Nachkalibrierung des Maßstabs. Aus dem
Katasterplan (1:500) eingepasst und einblendbar: die Flurstücke 213, 214 und 215 mit Seitenlängen
und Fläche, die angrenzenden Flurstücke, die Gebäudeumrisse der Umgebung als Hilfswände sowie
der Kanal mit Schächten und einstellbarem Schutzstreifen. Bei Strecke und Fläche rasten
Messpunkte auf Gebäudeecken, Grenzpunkte und Schächte ein.

## Bauen

```bash
npm install
cp ../../public/grundstueck-3d/scene/garden.sog public/scene/   # der Splat liegt nur einmal im Repo (siehe unten)
python3 tools/build_splat_tiers.py --scene public/scene/scene.json --scene-dir public/scene \
  --work-dir /tmp/splat-tiers               # erzeugt garden-400k.sog, garden-1m.sog, garden-1600k.sog
npm run dev      # lokal ansehen
npm run build    # erzeugt dist/ und prüft den Start-Chunk (tools/check_bundle.mjs)
```

Die Quelle muss genau die in `scene.json` eingetragene sein (Stufe `max`: 40.108.918 B, Hash
`078567d79a66`, 2.599.763 Splats). `build_splat_tiers.py` prüft das vor dem Bauen und bricht bei
einer anderen Datei mit den abweichenden Werten ab; eine absichtlich neue Quelle (neue Begehung)
wird mit `--new-source` eingetragen. Achtung: Bis die zweite Begehung veröffentlicht ist, liegt
unter `public/grundstueck-3d/scene/garden.sog` noch der alte Splat der ersten Begehung
(28.173.255 B, 1.786.380 Splats) – das Skript lehnt ihn ab.

Den Inhalt von `dist/` nach `public/grundstueck-3d/` kopieren und im Repo-Wurzelverzeichnis
`npm run build` ausführen (kopiert `public/` nach `docs/`).

Alle `.sog`-Dateien liegen nur im veröffentlichten Ordner `public/grundstueck-3d/scene/`;
hier sind `public/scene/*.sog` per `.gitignore` ausgeschlossen. Die Karte
(`public/scene/map/`, rund 1,2 MB: 30 WebP-Kacheln mit 1,07 MB und das Bodenmodell mit 0,15 MB)
wird mit `tools/build_map.py` erzeugt.

## Datengrundlage

- Zwei Begehungen im selben Koordinatensystem: 14.11.2026 und 21.11.2026 (die zweite ergänzt die
  erste). Registriert sind 1.058 Bilder aus drei Videos, davon 600 neue aus der zweiten Begehung.
  Rund 630 weitere neue Bilder mit dichtem Bewuchs ließen sich nicht verorten; dort bleibt das
  Modell lückenhaft bzw. unscharf.
- Quelle `public/scene/garden.sog`: 2.599.763 Splats, SH 3, 40,1 MB (SOG v2).
- Qualitätsstufen (`tools/build_splat_tiers.py`, `--decimate-adaptive`):

  | Stufe | Datei | Splats | SH | Positionen | Größe |
  |---|---|---|---|---|---|
  | Niedrig | `garden-400k.sog` | 400.000 | 0 | 16 Bit (bis ±1,9 cm gerundet) | 5,3 MB |
  | Mittel | `garden-1m.sog` | 1.000.000 | 0 | 16 Bit (bis ±1,9 cm gerundet) | 13,0 MB |
  | Hoch | `garden-1600k.sog` | 1.600.000 | 1 | 32 Bit (ExtSplats) | 21,7 MB |
  | Maximal | `garden.sog` (Quelle) | 2.599.763 | 3 | 32 Bit (ExtSplats) | 40,1 MB |

  „Hoch“ ist eine eigene Datei mit nur dem ersten SH-Band, passend zu `render.maxSh` 1; ein Wechsel
  zwischen „Hoch“ und „Maximal“ lädt deshalb die andere Datei.
- Karte: Orthofoto und Bodenmodell aus der Rekonstruktion (`tools/build_map.py`), Kartenbild über
  x −16 … 16 m und z −40 … 16 m, Karte insgesamt x −54 … 51 m und z −48,5 … 38,5 m.

## Aufbau

Ladeablauf: `index.html` lädt nur `src/app.js` (rund 32 KB gzip, ohne three.js und Spark).
`scene.json`, das Bodenmodell `map/ground.json` und die gröbste Kartenkachel ergeben das erste
Kartenbild; feinere Kacheln folgen danach. Erst „3D laden“ holt per dynamischem `import()` den
3D-Chunk (`view3d.js` mit three.js und Spark, rund 1,1 MB gzip) und danach die Splat-Datei der
gewählten Stufe; bis dahin bleibt die 2D-Karte sichtbar und bedienbar. „2D-Karte“ gibt Canvas,
WebGL-Kontext, Splat-Daten und den Mess-Worker wieder frei. Spark hält seinen eigenen Worker-Pool
(ein Worker mit WASM-Speicher) bis zum Neuladen der Seite am Leben. Das kostet im Leerlauf keine
Rechenzeit, aber Speicher: Nach der Rückkehr in 2D belegt der Renderer-Prozess gemessen rund
590 MB (nach Niedrig) bzw. 1.390 MB (nach Maximal) gegenüber etwa 500 MB vor dem ersten 3D, also
rund 100 bis 900 MB mehr (Handy-Emulation auf dem Mac, Metal, Stand 21.11.2026). Auf
Touch-Geräten bietet die App deshalb nach dem Schließen von 3D und nach dem Herunterschalten
„Seite neu laden“ an.

- `src/app.js` – Einstieg: Szene laden und prüfen, Werkzeuge, Liste, Hinweise, Tasten,
  Qualitätsmenü, Wechsel 2D ↔ 3D, Lade- und Fehlerkarten
- `src/scene.js` – `scene.json` laden und streng prüfen (Fehler nennen den Feldpfad)
- `src/map2d.js` – 2D-Karte: Kacheln als `<img>` in einem per CSS-Matrix skalierten Container,
  Gesten (Ziehen, Pinch, Mausrad, Trägheit), Rendern nur bei Bedarf. Während einer Geste,
  Trägheit oder Animation sind Kacheln, SVG-Overlay und Labels eigene Compositor-Ebenen
  (`will-change: transform`) und werden nur verschoben/skaliert; neu aufgebaut wird das Overlay
  nach der Geste, bei ruhendem Finger und – höchstens alle 400 ms – wenn der Ausschnitt die
  vorgezeichnete Fläche verlässt. Linien und Schrift sind dabei kurz mitskaliert (Faktor 0,5–2)
  und werden beim Neuaufbau korrigiert. Beide Wartezeiten wachsen mit der gemessenen Dauer der
  drei Bilder nach einem Aufbau (4× bzw. 2×): Bei Software-Rendering kostet das Rastern des
  Overlays 0,3–1 s, dann wird seltener neu aufgebaut und dazwischen auch über Faktor 2 hinaus
  mitskaliert (SwiftShader, Pinch 1→8→1: 5–6 statt 13 Aufbauten; auf Metal unverändert 5). Größe 0 (Tab oder Fenster beim Laden ausgeblendet,
  `display:none`) ist ein normaler Zustand: Startausschnitt und erstes Kartenbild folgen beim
  ersten echten Layout (ResizeObserver); dasselbe gilt für die 3D-Ansicht
- `src/ground.js` – Bodenmodell (0,5-m-Raster, Herkunft je Zelle: gemessen / geschätzt / keine)
- `src/view3d.js` – 3D-Ansicht (dynamisch geladen): three.js, Spark, Kamera, Rendern nur bei
  Bedarf, geringere Auflösung während Bewegung, Kontextverlust, `dispose()`. Ein Kontextverlust
  während des Ladens bricht das Laden ab (`ContextLostError`, Fehlerkarte mit „Erneut versuchen“,
  „Mit Stufe „Niedrig“ laden“, „In 2D bleiben“); in der aktiven Ansicht bietet die Karte
  „Zur 2D-Karte“ und „Mit Stufe „Niedrig“ neu laden“. `dispose()` gibt Renderer, Canvas und Kontext
  vollständig frei, auch die `dispose`-Listener, die three an Sparks modulweite Texturen und
  Geometrien hängt (sonst blieb je 3D-Sitzung ein alter Kontext erreichbar)
- `src/quality.js` – Geräteprobe (nach dem ersten Kartenbild in einem Worker mit OffscreenCanvas,
  sonst erst beim Öffnen des Qualitätsmenüs bzw. bei „3D laden“), Geräteklasse, Auto-Stufe, gemerkte Wahl
- `src/overlay.js`, `src/clip.js` – Linien, Flächen und Maßzahlen als SVG über Karte bzw.
  3D-Bild, im Clip-Raum zugeschnitten (gleich für 2D und 3D)
- `src/snap.js` – Einrasten auf Gebäudeecken, Grenzpunkte und Schächte; vereinheitlicht beim Laden
  die Höhe mehrfach eingetragener Planpunkte (siehe „Maßstab, Grenzen und Kanal“)
- `src/picker.js`, `src/pick-worker.js` – Punktbestimmung in 3D: Ein Web Worker summiert die
  Gaußglocken entlang des Klickstrahls von vorn nach hinten auf und nimmt die Tiefe, bei der
  die Deckkraft 35 % erreicht; beschleunigt über mehrstufige Gitter (identisch zur linearen Suche)
- `src/measure.js` – Messdaten mit Punktherkunft, Flächenformel, CSV-Export, Speicherung im
  Browser (Schlüssel `grundstueck-viewer:v2:<Pfad>|<frame>`, einmalige Übernahme aus v1)
- `src/profile.js` – Höhenprofil: in 2D aus dem Bodenmodell (geschätzte Abschnitte gestrichelt),
  in 3D über lotrechte Strahlen auf die Oberfläche (ein Batch)
- `public/scene/scene.json` – Titel, Transformation, Startansicht, Grenzen, Kanal, Gebäude,
  Qualitätsstufen (`splats`) und Karte (`map`)

three.js 0.180.0 und Spark 2.4.0 sind exakt gepinnt. Spark 2.4.0 liest nur SOG Version 2.

## Werkzeuge (`tools/`)

```bash
# Splat-Stufen bauen und splats.tiers in scene.json füllen (count, bytes, hash, sh, pos_round_mm)
python3 tools/build_splat_tiers.py --scene public/scene/scene.json --scene-dir public/scene \
  --work-dir <tmp> [--only niedrig,mittel] [--gpu cpu] [--skip-build] [--new-source]
  # --skip-build: nur prüfen und eintragen; --new-source: abweichende Quelle absichtlich neu eintragen
# Karte: Orthofoto-Kacheln (WebP, 4 Stufen) und Bodenmodell, füllt den Block map
python3 tools/build_map.py --ortho <work/ortho/ortho_top_plain.png> --npz <work/ortho/ortho.npz> \
  --scene public/scene/scene.json --out-dir public/scene
# nach vite build (läuft in npm run build): Start-Chunk ≤ 45 KB gzip, ohne three/Spark
node tools/check_bundle.mjs
# Messharness (headless Chromium, stumm); Szenarien 2d, 3d, orbit, switch, tiers, check-tiers
# (orbit: echte Maus-Ziehgeste ab der Startansicht mit GPU-Zeit je Render und Long Tasks)
node tools/perf.mjs --url http://127.0.0.1:<port>/ --playwright <pfad>/node_modules/playwright \
  --profile desktop|mobile|mobile-cpu4|mobile-cpu6 --gpu metal|swiftshader --scenario 3d --tier max --out <json>
```

`build_splat_tiers.py` nutzt `@playcanvas/splat-transform@3.12.0` (`--decimate-adaptive`; die
Alternative `importance` über `tools/prune_importance.py` war im Bildvergleich deutlich
schlechter). Die Orthofoto-Eingaben stammen aus der Rekonstruktion und liegen nicht im Repo.

## scene.json – Kurzreferenz `map` und `splats`

`map` (von `build_map.py` geschrieben):

- `extent` [x0, x1, z0, z1] – Grenzen der Karte in Weltmetern; `start` – Startausschnitt;
  `grid_m` – Rasterweite; `min_mpp` – stärkster Zoom (Meter je Bildschirmpixel)
- `image`: `dir`, `format`, `version` (Hash, Cache-Schlüssel), `bounds`, `res` (m/px der Stufe 1),
  `size`, `tile`, `overlap`, `levels` [{`f`, `size`, `tiles` [[tx, ty] …]}] – nicht gelistete
  Kacheln sind absichtlich leer; `bytes`
- `ground`: `file`, `version`, `bounds`, `cell`, `cols`, `rows`, `bytes`,
  `accuracy_m` {`measured`, `estimated`} (p90 der Gegenprobe)

`splats`:

- `source` – Quelldatei; `auto` – Geräteklasse → Stufen-id (`software`, `phone_weak`, `phone`,
  `laptop_weak`, `laptop`, `desktop_strong`)
- `tiers` [{`id`, `label`, `hint`, `file`, `count`, `bytes`, `hash`, `sh`, `ext`, `build`
  ({`method`, `target`, `sh`} oder `null` = Quelldatei), `render` {`pixelRatio`,
  `motionPixelRatio`, `maxStdDev`, `minAlpha`, `minPixelRadius`, `maxPixelRadius`, `clipXY`,
  `minSortIntervalMs`, `maxSh`}}]. `count`, `bytes`, `hash` und `sh` schreibt
  `build_splat_tiers.py`; der Client prüft die heruntergeladene Datei gegen `bytes` und `count`.
- Stufen mit `ext: false` speichern Positionen mit 16 Bit. `pos_round_mm` (Pflicht bei diesen
  Stufen, von `build_splat_tiers.py` aus `meta.json` berechnet) ist die größte Rundung in mm
  Weltmaß; das Qualitätsmenü zeigt sie an (heute ±19 mm am Rand der Aufnahme).
- `auto`: Laptops und starke Rechner bekommen „hoch“. „max“ ist nur von Hand wählbar: Bei einer echten
  Drehgeste ab der Startansicht stockt es auch auf einem M5 Pro (Sparks synchrones Zurücklesen
  der Tiefen, `getBufferSubData`), siehe `perf.mjs --scenario orbit`. In Bewegung rendert „max“
  mit `motionPixelRatio` 1,0 (Ruhebild 2,0): Bei 2,6 Mio. Splats halbiert das die GPU-Zeit je Bild.
  Die Speicherziele der Spezifikation (6.2 Nr. 11, gesetzt für 1,79 Mio. Splats) verfehlt „max“
  mit der neuen Szene: JS-Heap 283 MB, weil Spark die Splat-Daten auch im Hauptthread hält
  (≈ 96 B je Splat); siehe Hinweis unter SPEC 6.2.

Die Qualitätswahl wird je Gerät unter `grundstueck-viewer:quality:v1:<Pfad>` gemerkt; `?tier=<id>`
erzwingt eine Stufe für einen Aufruf.

## Maßstab, Grenzen und Kanal

Maßstab und Lage stammen aus der Einpassung des Katasterplans: Bruchsteinmauer, Mauer und
Hauswand zu 213 und das Tor liegen auf den Grenzen von Flurstück 214 (Tor auf 5 cm, Mauern
mit etwa 20 cm Streuung). Der Maßstab (2,434 m pro Modelleinheit) ist auf etwa ±4 % sicher:
Je nachdem, ob auch der Lattenzaun als Grenze gilt, ergibt die Einpassung 2,43 bis 2,52;
Wegbreite und andere Gegenproben sprechen eher für etwas weniger. Eine nachgemessene Strecke
entscheidet das und lässt sich über „Maßstab“ eintragen.

Die Grenzlinien sind auf etwa ±0,5 m eingepasst und kein amtlicher Grenznachweis; geprüft ist
die Lage nur an Flurstück 214. Die Höhen sind an den Schachtdeckelhöhen des Kanalplans
ausgerichtet (längs des Wegs etwa ±1°). Die Breite des Schutzstreifens am Kanal ist eine
Annahme – verbindlich ist die Vorgabe des Kanalbetreibers.

Planpunkthöhen beim Einrasten (eine Quelle der Wahrheit für 2D und 3D): In `scene.json` steht
dieselbe Ecke teils mehrfach (je Flurstück bzw. Gebäude) mit unterschiedlich geschätzter Höhe
(heute bis 0,35 m Unterschied). `unifyPlanHeights()` in `src/snap.js` fasst beim Laden alle
Einrastpunkte (Flurstücksecken, Gebäudeecken, Schächte) zusammen, deren Lage auf unter 1 cm
übereinstimmt: Alle bekommen die Lage des ersten Vorkommens und eine gemeinsame Höhe – die
Deckelhöhe des Schachts, wenn einer dabei ist, sonst den Mittelwert. Die Stützpunkte der
Grenzlinien an diesen Ecken bekommen dieselbe Höhe. Eingerastete Messpunkte haben deshalb in 2D
und 3D dieselben Koordinaten, egal welches Duplikat die Ansicht trifft.

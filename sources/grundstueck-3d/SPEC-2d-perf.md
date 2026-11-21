# SPEC: 2D-Einstieg, Qualitätsstufen, harte 3D-Optimierung

Arbeitsdokument für **einen** Implementierer. Es wird nach der Umsetzung gelöscht.
Stand 2026-11-21, geschrieben gegen den Code-Stand von `sources/grundstueck-3d` mit sauberem `git status`.

Ziel des Nutzers: „Harte Performance-Optimierungen und Qualitätsregler. Außerdem erst 2D, damit das Ding nicht abkackt. Alle Geräte laggen höllisch.“

Daraus folgt:

1. Die Seite startet in einer leichten 2D-Karte ohne three/Spark/WebGL. Die Karte besteht aus Orthofoto, Grenzen, Gebäuden, Kanal und allen Messwerkzeugen.
2. 3D gibt es nur auf Wunsch. Dann werden der Chunk mit three und Spark per dynamic import geladen und der Splat erst danach heruntergeladen.
3. In 3D gibt es einen Qualitätsregler mit Stufen. Die passende Stufe wird automatisch nach Gerät vorgewählt. Die 3D-Ansicht ist hart optimiert.

## 0. Rahmen, Regeln, Reihenfolge

### Rahmen

- **Arbeitsordner:** nur `/Users/logge/Documents/Projects/static-pages/sources/grundstueck-3d`. Temporäre Dateien liegen in `/private/tmp/claude-501/…` oder in einem eigenen Scratch-Ordner.
- **Nicht anfassen:**
  - `/Users/logge/Documents/Projects/static-pages/public/grundstueck-3d` (veröffentlichte Fassung)
  - `docs/`
  - alle anderen Ordner des Repos (dort liegen fremde, unfertige Änderungen)
- **Nichts committen.**
- **Vorbereitung:** Im Quellordner gibt es kein `node_modules`, deshalb zuerst `npm ci` (Lockfile vorhanden). Für lokale Tests den Splat kopieren:
  `cp /Users/logge/Documents/Projects/static-pages/public/grundstueck-3d/scene/garden.sog public/scene/`.
  Neu anlegen: `sources/grundstueck-3d/.gitignore` mit `public/scene/*.sog`. Die Splat-Dateien werden nie eingecheckt.
- **Keine stillen Fallbacks** (CLAUDE.md):
  - Jeder Fehler erscheint sichtbar in der UI, mit konkreter Ursache auf Deutsch, und zusätzlich per `console.error(<Originalfehler>)`.
  - Kein `catch {}`, kein „mit Standardwerten weiter“, keine Platzhalterdaten.
  - Fehlende oder kaputte Pflichtfelder in `scene.json` erzeugen einen Fehler mit Feldpfad.
- **Deutsche UI-Texte** mit korrekten Umlauten und typografischen Anführungszeichen („…“) sowie Zahlen im de-DE-Format.
- **Nichts darf verloren gehen:**
  - Werkzeuge: Strecke, Fläche, Höhe, Maßstab (Kalibrierung), Höhenprofil, Maßstabsleiste
  - Ebenen: Grenzen, Gebäude, Kanal mit Schutzstreifen-Stepper
  - Einrasten (Alt = ohne), CSV-Export, Speicherung, Hilfe, Tastenkürzel
  - Liste: Löschen, Alle löschen, Anwählen → `focusOn`
- **Tests:**
  - Nur headless Playwright 1.61.1 aus `/Users/logge/Documents/LoggeRythm/web/node_modules/playwright`, immer mit `--mute-audio`. Kein hörbarer Ton, nicht das In-App-Browserfenster benutzen.
  - WebGL-Messungen nur mit vollem Chromium-1248: `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`.
  - SwiftShader-Läufe sind als „nicht repräsentativ (Software)“ zu benennen.
  - Den Dev- oder Preview-Server selbst auf einem freien Port starten (`npx vite --port <frei> --strictPort` bzw. `npx vite preview --port <frei> --strictPort`) und danach beenden.

### Umsetzungsreihenfolge (Meilensteine)

Jeder Meilenstein endet lauffähig.

| M | Inhalt | Abschnitt |
|---|---|---|
| M1 | `src/scene.js` (Laden und strikte Prüfung), neues `scene.json`-Schema ohne `map`/`splats` erst einmal von Hand vorbereiten | 2 |
| M2 | `tools/build_map.py` → `public/scene/map/*` und `map`-Block | 5.1 |
| M3 | `src/clip.js` und `overlay.js` frei von three, Kappung am Bildausschnitt (größter Einzelgewinn, wirkt sofort auch in 3D) | 4 P1 |
| M4 | `src/app.js`, `map2d.js`, `ground.js`, `snap.js`, `profile.js`-Sampler, `measure.js`-Speicherschlüssel → 2D-Einstieg komplett | 1, 2 |
| M5 | `src/view3d.js` (aus `main.js`), Rendern nur bei Bedarf, Picker erst bei Bedarf, `dispose()`, Wechsel 2D↔3D | 1.5, 1.6, 4 |
| M6 | `tools/build_splat_tiers.py`, `src/quality.js`, Stufenwechsel zur Laufzeit | 3, 5.2 |
| M7 | Picker-Gitter und Batch, CSS-Entlastung, adaptive Auflösung | 4 P6–P11 |
| M8 | `tools/check_bundle.mjs`, `tools/perf.mjs`, Testplan abarbeiten, README aktualisieren | 5.3, 5.4, 6 |

`src/main.js` wird am Ende gelöscht. Sein Inhalt verteilt sich auf `app.js` (UI, ansichtsunabhängig) und `view3d.js` (three/Spark).

---

## 1. Architektur

### 1.1 Ladeablauf

```
index.html ── <script type="module" src="/src/app.js">          (Start-Chunk, ohne three/Spark)
  app.js
    1. loadScene()            scene.json (no-cache) → validateScene() → bei Fehler Vollbild-Fehler
    2. ground.load()          map/ground.json?v=<hash> → prüfen
    3. MapView2D.mount()      Kachel f_max sofort, dann Zielstufe; Overlay; Werkzeuge aktiv
    4. store.restore()        Messungen (Schlüssel aus scene.frame, Migration, siehe 2.4)
    5. quality.detect()       Geräteprobe (WebGL2-Kontext kurz anlegen, wieder freigeben) → Vorwahl, Knopftext „3D laden · 5,2 MB“
  Klick „3D laden“ (oder Taste V)
    6. const { View3D } = await import('./view3d.js')     → eigener Chunk (three, OrbitControls, Spark, picker.js)
    7. view3d.load(tier, signal) eigener fetch mit Fortschritt → SplatMesh({ fileBytes, fileType:'pcsogszip', … })
    8. Wechsel nach 3D, 2D-Kacheln bis auf die gröbste Stufe entladen
  Picker (pick-worker) erst beim ersten Bedarf in 3D (siehe 4 P5)
```

Vite legt den dynamischen Import automatisch als eigenen Chunk an. `index.html` darf kein `modulepreload` auf den 3D-Chunk enthalten; das prüft `tools/check_bundle.mjs`.

### 1.2 Module

| Datei | Inhalt | darf importieren |
|---|---|---|
| `src/app.js` (neu, Einstieg) | Zustand `state` (tool, draft, selected, Ebenen, corridor, marker, view), sämtliche UI-Verdrahtung aus `main.js` (Werkzeuge, Hinweis, Liste, Kalibrierdialog, Ebenen-Chips, Kanal-Stepper, CSV, Hilfe, Toast, Tasten, Klick-Warteschlange `queue`, `handleClick`, `finishArea`, `renderBounds`, `renderCalibration`, Maßstabsleiste), Umschalten 2D/3D, Ladekarte, Fehleranzeige | scene, map2d, ground, snap, overlay, measure, profile, quality, clip; **dynamisch** view3d |
| `src/scene.js` (neu) | `loadScene()`, `validateScene(cfg)`, `class SceneError extends Error { path }` | – |
| `src/clip.js` (neu) | Kappung im homogenen Clip-Raum: `clipSegment`, `clipPolygon`, `inside` (siehe 1.3) | – |
| `src/map2d.js` (neu) | `class MapView2D` (Kamera `{cx, cz, mpp}`, Kacheln, Gesten, rAF nur bei Bedarf, `TopDownProjection`) | clip |
| `src/ground.js` (neu) | `loadGround(cfg)`, `sample(x, z) → {y, q} \| {error}` | – |
| `src/snap.js` (neu) | `snapAt(proj, layers, sx, sy, touch)`, also das heutige `snapAt` aus `main.js:503-517` auf `proj` umgestellt | clip |
| `src/quality.js` (neu) | Geräteprobe, Auto-Vorwahl, Speichern der Wahl, Popover-UI-Daten | – |
| `src/format.js` (neu) | `COLORS`, `NF*`, `MB`-Formatierer (heute doppelt in `main.js:13,15,448` und `overlay.js:8-11`) | – |
| `src/overlay.js` (umgebaut) | arbeitet nur noch mit `proj` und `clip.js`; kein three | clip, measure, format |
| `src/profile.js` (umgebaut) | arbeitet mit einem `sampler` statt eines Pickers; kein three | measure |
| `src/measure.js` (umgebaut) | neuer Speicherschlüssel, Punktherkunft `src`, laute Fehler | – |
| `src/view3d.js` (neu, 3D-Chunk) | alles three/Spark-Spezifische aus `main.js`: Renderer, Controls, SplatMesh, Stufenwechsel, Picking (`raysAt`), Doppelklick-Drehpunkt, WASD, Draufsicht, Tween, `centerDepth`, Render-Schleife, `dispose()` | three, OrbitControls, Spark, picker, clip |
| `src/picker.js`, `src/pick-worker.js` | bleiben im 3D-Chunk; Umbau siehe 4 P5/P8 | three (nur picker.js) |

### 1.3 View-Schnittstelle und Projektion (gemeinsam für 2D und 3D)

Beide Ansichten implementieren dieselbe Schnittstelle; `app.js` kennt nur sie:

```js
view = {
  kind: '2d' | '3d',
  proj,                                   // siehe unten
  pickAt(clientX, clientY, { multi, touch }) → Promise<{ point:[x,y,z], src:'g'|'e'|'s', q?, opacity?, spread?, scatter? } | { error:string }>,
  pickReady() → Promise<void>,            // 2D sofort; 3D: Picker initialisiert (lazy)
  sampler,                                // für profile.js: { kind, title, sample(x,z) → Promise<{y,q}|null>, sampleMany(pts) }
  metersPerPixel() → number,              // für die Maßstabsleiste (2D exakt; 3D wie heute main.js:767-775)
  focusOn(points), home(), requestRender(),
  getViewState() → { cx, cz, mpp }, setViewState(s),
  setLayersChanged(), onFrame(cb),        // app.js zeichnet das Overlay im Frame-Callback der View
  dispose(),
}
```

`proj` ersetzt den direkten Kamerazugriff in `overlay.js` (`overlay.js:17,28-44,56,81,146,204,251,274`) und in `snapAt` (`main.js:508`):

```js
proj = {
  w, h,                 // CSS-Pixel des Overlays
  near,                 // 3D: camera.near*1.01; 2D: 0
  margin,               // Kappungsrand in CSS-Pixeln: 3D 48, 2D 0.5*max(w,h) (siehe 1.4 Overlay-Verschiebung)
  topDown,              // true in 2D (Gebäude als Grundriss, Höhe als Linie)
  toClip(p, out)        // Welt [x,y,z] → homogene Clip-Koordinaten out=[cx,cy,cz,cw] (Float64Array(4), keine Allokation)
  labelDist(p)          // 3D: Abstand Kamera–Punkt; 2D: mpp*h/(2*tan(30°)), konstant (alte Label-Schwellen 45–90 m bleiben sinnvoll)
}
// Bildschirm: sx = (cx/cw*0.5+0.5)*w, sy = (1-(cy/cw*0.5+0.5))*h
```

- **3D:** `toClip` ist `projectionMatrix · matrixWorldInverse · p` (aus `camera.matrixWorldInverse.elements` und `camera.projectionMatrix.elements` direkt multipliziert, ohne Vector3-Klone). Die Kombination wird einmal pro Frame als `Float64Array(16)` berechnet.
- **2D:** `cx = (x - camX)/(mpp*w/2)`, `cy = -(z - camZ)/(mpp*h/2)`, `cz = 0`, `cw = 1`. Daraus folgt `sx = w/2 + (x-camX)/mpp` und `sy = h/2 + (z-camZ)/mpp` (z nach unten, wie im Orthofoto).

`src/clip.js` kappt gegen fünf Ebenen im homogenen Raum (linear, deshalb auch für die Perspektive korrekt):

```
near:   cw - n ≥ 0                         (n = proj.near; 2D: immer erfüllt)
links:  cx + kx*cw ≥ 0     rechts: kx*cw - cx ≥ 0      kx = 1 + 2*margin/w
unten:  cy + ky*cw ≥ 0     oben:   ky*cw - cy ≥ 0      ky = 1 + 2*margin/h
```

- **`clipSegment(a4, b4)`:** Liang–Barsky über die 5 Abstände. Liefert `null` oder `[t0, t1]`; daraus entstehen die gekappten Endpunkte als homogene Interpolation.
- **`clipPolygon(V4[])`:** Sutherland–Hodgman über die 5 Ebenen. Liefert Bildschirmpunkte oder `null`, wenn weniger als 3 Ecken bleiben.
- **`inside(a4, marginPx)`:** Punkttest für Kreise und Labels. Labels benutzen 80 px Rand wie heute (`overlay.js:83`).
- **Hülltest:** Für jede statische Gruppe (Grenze, Haltung, Gebäude) wird beim Laden ein Welt-AABB berechnet. Liegen alle 8 Ecken außerhalb derselben Ebene, wird die Gruppe in diesem Frame übersprungen.
- **Garantie:** Keine SVG-Koordinate liegt außerhalb von `[-margin-1, w+margin+1] × [-margin-1, h+margin+1]`. Das wird im Test geprüft (6.2).

### 1.4 2D-Karte (`map2d.js`)

**DOM:**

```html
<div id="map">
  <div id="tiles"></div>
</div>
<svg id="overlay">…</svg>
<div id="labels">…</div>
```

- `#map`: `position:absolute; inset:0; overflow:hidden; touch-action:none; background:#141a20`.
- `#tiles`: `transform-origin:0 0`.
- `#overlay` und `#labels` bleiben wie heute über allem.

**Kacheln:**

- Einheit im `#tiles`-Container ist **ein Pixel der Stufe f=1** (`image.res` m). Kachel `t{f}_{tx}_{ty}` liegt bei `left = tx*tile*f`, `top = ty*tile*f`. Breite und Höhe sind `(Pixel der Kachel inklusive 1 px Überlappung, wenn nicht letzte Spalte bzw. Zeile) * f`.
- Container-Transform: `matrix(s,0,0,s, w/2 + (b.x0-cx)/mpp, h/2 + (b.z0-cz)/mpp)` mit `s = res/mpp` und `b = image.bounds`.
- `will-change: transform` nur während einer Geste setzen und bei Gestenende entfernen. Sonst rastert Chrome vergrößert gezeichnete Kacheln nicht neu, und sie bleiben unscharf.
- **Stufenwahl:** gröbste Stufe f mit `res*f ≤ 1.25*mpp/dprEff`, mindestens f=1. Dabei gilt `dprEff = min(devicePixelRatio, 2)` und bei `navigator.connection?.saveData` `dprEff = 1`.
- Die gröbste Stufe (eine Kachel) bleibt immer als Unterlage geladen. Darüber liegen die sichtbaren Kacheln der Zielstufe (sichtbarer Bereich plus eine Kachel Rand). Alte Kacheln werden erst nach `await img.decode()` der neuen entfernt.
- Höchstens 48 `<img>`, Verdrängung nach LRU. Attribute: `decoding="async"`, `draggable="false"`, `alt=""`. URL: `${BASE}scene/${image.dir}t${f}_${tx}_${ty}.webp?v=${image.version}`.
- Kacheln, die nicht in `levels[].tiles` stehen, sind absichtlich leer (ganz transparent) und werden nie angefragt.
- **Ladefehler einer gelisteten Kachel** (`onerror` bzw. `decode()`-Ablehnung):
  - Toast „Kartenkachel t2_1_0 konnte nicht geladen werden.“
  - `console.error` mit URL und Ursache
  - Die Kachelfläche wird rot schraffiert (`.tile-error`).
  - Kein Neuversuch und kein Ersatzbild.
- **Fläche ohne Orthofoto:** Hintergrund von `#map`. Ein 5-m-Raster (`map.grid_m`) wird als eigenes Overlay-Item `grid` gezeichnet (dünne gekappte Linien, nur in 2D). Kein CSS-Hintergrundmuster, weil es mitskaliert.

**Gesten (Pointer Events auf `#map`):**

- 1 Finger oder Maus ziehen = verschieben, in allen Werkzeugen.
- Kurzes Tippen = Punkt setzen im Messwerkzeug. Schwellen wie heute in `main.js:671`: 12 px / 1500 ms für Touch, 6 px / 700 ms für die Maus.
- Den zweiten Klick eines Doppelklicks ignorieren wie `main.js:673`.
- 2 Finger = Pinch-Zoom um den Mittelpunkt plus verschieben.
- Mausrad: Faktor `exp(-deltaY*k)` zum Cursor mit `k = 0.0015` (bei `deltaMode=1` ×16, bei `deltaMode=2` ×h). `ctrlKey` bedeutet Trackpad-Pinch, dabei `k = 0.01`.
- Doppelklick bzw. Doppeltipp: im Werkzeug „Bewegen“ ×2 zoomen zur Stelle; im Werkzeug „Fläche“ wird sie geschlossen (wie `main.js:682-684`).
- Tasten: Pfeile/WASD verschieben um 15 % der Bildbreite, `+`/`-` zoomen um ×1,5, `H` = Startausschnitt `map.start`.
- Zoomgrenzen: `mpp ∈ [map.min_mpp, max(extentB, extentH)*1.2/min(w,h)]`. Mittelpunkt auf `map.extent` begrenzen.
- Startausschnitt: `map.start` eingepasst. Die Polster sind oben 64 px + safe-area, unten 96 px + safe-area (Toolbar) und seitlich 12 px.

**Overlay in 2D:**

- Während einer aktiven Geste wird das Overlay nicht neu aufgebaut. `#overlay` und `#labels` bekommen per CSS-Transform nur die Differenzmatrix zum letzten Aufbau: `s = mpp_alt/mpp_neu` und Versatz `w/2·(1−s) + (cx_alt−cx)/mpp_neu`, analog für y.
- Voller Neuaufbau bei Gestenende, nach 150 ms Stillstand, bei Skalensprung außerhalb `[0.67, 1.5]` oder bei Verschiebung über 40 % der Bildgröße. Der Kappungsrand ist in 2D eine halbe Bildgröße (`proj.margin`), deshalb fehlen beim CSS-Verschieben keine Linien am Rand.
- Außerhalb von Gesten gibt es höchstens einen Neuaufbau je rAF und nur bei dirty.
- Die rAF-Schleife läuft nur, solange Geste, Trägheit oder dirty anstehen. Im Leerlauf läuft keine.

**Picking in 2D:** `pickAt` arbeitet synchron (als Promise).

1. Einrasten zuerst, sofern `SNAP_TOOLS` passt (`main.js:451`): `src:'p'`.
2. Sonst Bodenraster: `ground.sample(x,z)` mit `q=2` → `src:'g'`, `q=1` → `src:'e'`. Bei `q=0` oder außerhalb kommt `{error}`.
3. Die Meldungen stehen in 1.7.

Hover-Vorschau mit der Maus läuft wie in 3D, nur synchron und ohne Worker.

### 1.5 3D-Ansicht (`view3d.js`)

`export class View3D { static async create({ host, cfg, tier, onProgress, signal, onError }) … }`

- **Canvas:** dynamisch erzeugen (`<canvas id="view" tabindex="0" aria-label="3D-Ansicht des Grundstücks">`) und vor `#overlay` einfügen. Er ist nicht mehr in `index.html`.
- **Renderer:** `new THREE.WebGLRenderer({ canvas, antialias:false, powerPreference: tier.id==='max'||tier.id==='hoch' ? 'high-performance' : 'default' })`. Die Wahl gilt für die Lebensdauer des Kontexts und wird bei späterem Stufenwechsel nicht geändert.
- **SparkRenderer:** `new SparkRenderer({ renderer, onDirty: requestRender, enableLod:false, ...tier.render-Felder })`. Die Felder stehen in 3.3.
- **Laden des Splats:** eigener `fetch` mit Fortschritt und Abbruch.

```js
const r = await fetch(`${BASE}scene/${tier.file}?v=${tier.hash}`, { signal });
if (!r.ok) throw new Error(`${tier.file}: HTTP ${r.status}`);
// reader-Schleife → Uint8Array(tier.bytes); onProgress(gelesen, tier.bytes)
if (gelesen !== tier.bytes) throw new Error(`Datei ${tier.file} unvollständig oder abweichend: ${MB(gelesen)} statt ${MB(tier.bytes)} MB`);
const mesh = new SplatMesh({ fileBytes: bytes, fileType: 'pcsogszip', extSplats: tier.ext, editable:false, raycastable:false });
mesh.maxSh = tier.render.maxSh; // vor dem ersten Rendern
applyTransform(mesh, cfg.transform);       // Pflichtfelder, kein Default (heute main.js:145-149)
scene.add(mesh); await mesh.initialized;   // Ablehnung → Ladekarte rot, console.error
const n = (mesh.extSplats ?? mesh.packedSplats).numSplats;
if (n !== tier.count) throw new Error(`${tier.file}: ${n} Splats geladen, scene.json erwartet ${tier.count}`);
```

`fileType` ist der Spark-Wert `SplatFileType.PCSOGSZIP = "pcsogszip"` (`spark.module.js:574`, Erkennung über die Endung `.sog` in Zeile 11175). Nach `initialized` die Referenz auf `bytes` nullen.

- **Startansicht:** `cfg.view` (Pflicht) oder der übernommene Kartenausschnitt (1.6). Die Ersatzbox und die Picker-Grenzen (`main.js:166-187`) fallen weg.
  - `controls.maxDistance = max(60, 1.5*Diagonale(map.extent))`
  - `sceneRadius` für die Draufsicht ist `0.5*Diagonale(map.start)`.
- Die Controls bleiben wie `main.js:82-89`.
- **Statuszeile:** „3D · Mittel · 1.000.000 Splats“.
- **`dispose()`** in dieser Reihenfolge, jeder Schritt mit laut gemeldetem Fehler:
  1. rAF abbrechen
  2. `controls.dispose()`
  3. `scene.remove(mesh); mesh.dispose()`
  4. `spark.dispose()`
  5. `scene.clear()`
  6. `picker?.dispose()` (siehe P5: `worker.terminate()`, Arrays nullen)
  7. `renderer.dispose()`
  8. `renderer.forceContextLoss()`
  9. `canvas.remove()`
  10. alle Listener über den `AbortController` der View entfernen
  11. Referenzen nullen

  Danach erscheint der Toast „3D-Speicher freigegeben.“. Der globale Spark-Workerpool (bis zu 4 Worker) und sein WASM-Heap bleiben bis zum Neuladen der Seite bestehen. Das ist bekannt und wird in der README benannt.
- **`webglcontextlost`** (heute `main.js:104-107`): `e.preventDefault()`. Dann die Fehlerkarte „Die 3D-Ansicht wurde vom Gerät beendet (vermutlich zu wenig Grafikspeicher).“ mit den Knöpfen „Zur 2D-Karte“ (→ `dispose`, Wechsel) und „Mit Stufe ‚Niedrig‘ neu laden“. Es gibt kein automatisches Herunterschalten.

### 1.6 Wechsel 2D ↔ 3D

- **Bedienung:** Chip `#btn-view` in der Topbar und Taste `V`.
  - In 2D heißt der Chip „3D laden · 5,2 MB“ (Akzentfarbe). Ist der Chunk bereits geladen und der Splat im Speicher, heißt er nur „3D“.
  - In 3D heißt er „2D-Karte“.
  - Auf schmalen Bildschirmen (≤ 470 px) schwebt der 3D-Knopf als eigener Knopf über der Toolbar, weil die Chips dort nur Symbole zeigen (`style.css:258,278-282`).
- **Vorprüfung vor dem Download:**
  - Ohne WebGL 2 (`quality.probe().webgl2 === false`) wird der Knopf deaktiviert, mit dem Titel „3D ist auf diesem Gerät nicht verfügbar (kein WebGL 2)“. Ein Klick zeigt denselben Text als Toast. 2D bleibt.
  - Bei `navigator.connection?.saveData` oder `effectiveType` in `2g/3g` kommt zuerst die Rückfrage `confirm('3D lädt 12,6 MB herunter. Fortfahren?')`.
- **Ladekarte `#load3d`** (unten mittig über der Toolbar, blockiert nichts; 2D bleibt bedienbar):
  - Phase 1: „3D-Programm wird geladen …“ (dynamischer Import, ohne Prozentangabe), mit Knopf „Abbrechen“.
  - Phase 2: „Modell: 3,1 von 5,2 MB“ (Balken), mit Knopf „Abbrechen“ (`AbortController`).
  - Phase 3: „Modell wird entpackt …“
  - Danach Wechsel nach 3D.
  - Fehler: Die Karte wird rot und zeigt die Ursache wörtlich (z. B. „garden-400k.sog: HTTP 404“). Knöpfe „Erneut versuchen“ und „In 2D bleiben“, dazu `console.error(Originalfehler)`. Kein automatischer Neuversuch.
  - Abbrechen ist kein Fehler. Es bringt die stille Rückkehr zur Ausgangslage mit Toast „3D-Laden abgebrochen.“.
- **Kamera 2D → 3D:** Hat der Nutzer in 2D nichts bewegt, gilt `cfg.view`. Sonst:
  - Ziel = `(cx, yBoden, cz)` mit `yBoden` aus `ground.sample` bei q>0, sonst dem Median der Planhöhen in `map.start`. Das ist kein stiller Ersatz, sondern eine definierte Regel; sie steht als Kommentar im Code.
  - Blickrichtung = normierte Richtung `cfg.view.position − cfg.view.target`.
  - Abstand = `mpp*h/(2*tan(fov/2))`.
- **Kamera 3D → 2D:** `cx, cz = controls.target.x, .z` und `mpp = Abstand*2*tan(fov/2)/h`, auf die Zoomgrenzen begrenzt.
- **Was beim Wechsel erhalten bleibt:** Messungen, Auswahl, Ebenen, Schutzstreifen und Draft-Punkte. `hover` und `marker` werden zurückgesetzt. Das Höhenprofil wird mit dem Sampler der neuen Ansicht neu berechnet; der Profilschlüssel enthält `sampler.kind`.
- **In 3D** entlädt `map2d.suspend()` alle Kacheln außer der gröbsten und hängt die Listener ab. `resume()` beim Rückweg.
- **Weg zurück 3D → 2D:** Er ruft immer `view3d.dispose()` auf, die Freigabe ist der Zweck. Das nächste „3D“ lädt den Splat neu, in der Regel aus dem HTTP-Cache. Der Knopftext zeigt dann wieder die Größe, denn ob der Cache greift, ist nicht bekannt.

### 1.7 Fehlerbehandlung (verbindliche Liste)

| Situation | UI | Konsole |
|---|---|---|
| `scene.json` nicht ladbar oder kein JSON | Vollbild-Fehler `#fatal`: „Die Szenenbeschreibung konnte nicht geladen werden.“ plus HTTP-Status bzw. Parserfehler, Knopf „Neu laden“ | `console.error(err)` |
| Pflichtfeld fehlt oder ist falsch | Vollbild-Fehler: „Die Szenenbeschreibung ist fehlerhaft.“ plus z. B. „`splats.tiers[1].bytes` fehlt“ | `console.error(SceneError)` mit `path` |
| `ground.json` fehlt oder passt nicht zu `scene.json` | Vollbild-Fehler mit Datei und Feld | dto. |
| Kartenkachel fehlt | Toast plus rot schraffierte Kachel (1.4) | URL plus Ursache |
| 2D-Tippen auf Zelle ohne Höhe (q0) oder außerhalb | Warn-Toast „Hier gibt es keine Bodenhöhe – auf einen Planpunkt einrasten oder innerhalb der Karte messen.“; es wird kein Punkt gesetzt | – (Bedienhinweis, kein Fehler) |
| 2D-Punkt mit q1 | Toast „Höhe hier nur aus dem Plan geschätzt.“; Punkt mit `src:'e'` | – |
| 3D-Klick ohne Oberfläche | wie heute `main.js:340` | – |
| Picker-Init oder Worker-Fehler | Hinweisleiste rot: „Messen in 3D nicht möglich: <Ursache>. In der 2D-Karte messen.“; Messwerkzeuge in 3D deaktiviert (`aria-disabled`) | `console.error` |
| Splat-Laden (HTTP, unvollständig, Dekodierung, Splat-Zahl ≠ `count`) | Ladekarte rot (1.6) | `console.error` |
| `webglcontextlost` | Fehlerkarte (1.5) | `console.error('webglcontextlost', tier.id)` |
| localStorage nicht nutzbar (Lesen oder Schreiben wirft) | Dauerhinweis im Panel: „Messungen werden in diesem Browser nicht gespeichert: <err.name>.“ | `console.error` |
| Gespeicherte Messungen unlesbar oder einzelne Einträge ungültig | Toast „N gespeicherte Messungen waren unlesbar und wurden nicht geladen (Sicherung unter …).“; der Rohwert wird unter `<schlüssel>:defekt-<ISO-Datum>` gesichert, nichts wird gelöscht | `console.error` mit Index und Grund |
| Gespeicherte Qualitätsstufe gibt es nicht mehr | Toast „Gespeicherte Qualität „x“ gibt es nicht mehr – automatisch gewählt: Mittel.“ | `console.warn` |

Wegfallen müssen insbesondere:

- `main.js:123-128` (`catch {}`, `|| 'garden.sog'`, `?splat=` ohne Prüfung)
- `main.js:145-149` (Default-Quaternion)
- `main.js:157-164` (Picker-Fehler nur in der Konsole)
- `main.js:169-176` (Ersatzbox)
- `main.js:191-196` (stilles Filtern; wird zu einer Prüfung in `validateScene`)
- `main.js:209` (`catch { /* egal */ }`; für den Ersthinweis `sessionStorage` mit sichtbarem Fehlerpfad wie localStorage)
- `measure.js:126` und `141` (leere catch-Blöcke)
- `measure.js:135-138` (stilles Verwerfen)
- `main.js:437-438`: Der Ersatztext für `calibration.text` fällt weg, weil `calibration.text` Pflicht wird.

`?tier=<id>` als Testparameter ist erlaubt: Er erzwingt die Stufe, eine unbekannte id erzeugt einen sichtbaren Fehler.

### 1.8 HTML/CSS

**`index.html`:**

- `<canvas id="view">` entfernen.
- `#map` mit `#tiles` als erstes Kind von `#app` einfügen.
- `#loading` ersetzen durch `#fatal` (Vollbild-Fehler) und `#load3d` (Ladekarte mit `#load3d-title`, Balken, `#load3d-text`, Knöpfen `#load3d-cancel`, `#load3d-retry`, `#load3d-stay`).
- In der Topbar ergänzen: `#btn-view` (Akzent) und `#btn-quality` (Symbol plus Stufenname) mit dem Popover `#quality-menu`.
- `#btn-top` (Draufsicht) nur in 3D zeigen. `#btn-home` bedeutet in 2D „Startausschnitt“.
- Die Hilfe (`index.html:149-181`) bekommt getrennte Abschnitte „2D-Karte“ und „3D-Ansicht“.
- Den Hinweistext `#empty` neutral fassen: „… und tippe Punkte auf der Karte oder im Modell an.“
- `<title>`: „Grundstück – Karte und 3D-Begehung“; `document.title` aus `cfg.title`.

**`style.css`:** siehe P9. `#view`-Regeln (`style.css:28-30`) gelten jetzt für `#map` und den dynamischen Canvas: Cursor grab/crosshair und `touch-action:none`.

---

## 2. scene.json-Schema

Abwärtskompatibilität ist **nicht** nötig. `validateScene` prüft alles, was hier als Pflicht steht, auf Typ, Endlichkeit und Länge. Jede Abweichung erzeugt `SceneError(path, Meldung)`. Optionale Felder werden geprüft, wenn sie vorhanden sind.

### 2.1 Felder

```jsonc
{
 "title": "Grundstück",                       // Pflicht, String ≠ ""
 "subtitle": "3D-Begehung vom 14.11.2026",    // Pflicht, String
 "version": "2026-11-16a",                    // Pflicht, String (Veröffentlichungsstand; Teil der Migration 2.4)
 "frame": "grundstueck-welt-2026-11",         // NEU, Pflicht: Name des Meter-Weltsystems; Speicherschlüssel der Messungen.
                                              //   Nur ändern, wenn sich das Weltsystem ändert (nicht bei neuem Splat im selben System).
 "storage": { "legacy_ids": ["garden.sog|2026-11-16a|{\"quaternion\":[...],\"position\":[...],\"scale\":2.434042055771363}"] },
                                              // NEU, Pflicht (Array, darf leer sein): alte sceneIds ohne Pfad-Präfix, siehe 2.4
 "transform": { "quaternion":[4 Zahlen], "position":[3], "scale": >0 },   // Pflicht
 "view": { "position":[3], "target":[3] },    // Pflicht
 "background": ["#141c25","#0e1319","#0a0d11"], // optional (≥2 Farben oder ein String)
 "picking": { "tau": 0..1, "minOpacity": 0..1 }, // optional
 "calibration": { "text": "…", "reference":"…", "scale_m_per_unit": >0, "tilt_x_deg": Zahl }, // text Pflicht
 "plan": { "accuracy_m": >0, "area_total_m2": Zahl, "parcels":[…] },   // accuracy_m Pflicht
 "boundaries": [ { "name": Str, "style": "primary"|"secondary",
                   "points": [≥3 Punkte]  und/oder  "lines": [[≥2 Punkte],…],   // mind. eines davon
                   "corners"?, "sides"?: [{length, at}], "labels"?: [{text, at}], "center"?, "area_m2"? } ],  // Pflicht (Array, ≥0)
 "buildings": [ { "name": Str, "own": Bool, "points": [≥3], "center": [3], "kind"?, "area_m2"?, "base"?, "measured"? } ],
 "sewer": { "corridor_m": 0..6, "source": Str,
            "pipes": [ { "name","dn": Str, "length","slope_permille": Zahl, "points":[≥2], "depth_from"?, "depth_to"?, "own_m"? } ],
            "manholes": [ { "name": Str, "at":[3], "depth"?, "note"?: Str|null, … } ],
            "connections": [[≥2 Punkte], …] },     // sewer Pflicht (pipes ≥1)
 "map": { … },        // NEU, Pflicht – schreibt tools/build_map.py (2.2)
 "splats": { … }      // NEU, Pflicht – ersetzt "splat": "garden.sog"; tools/build_splat_tiers.py ergänzt count/bytes/hash (2.3)
}
```

„Punkt“ bedeutet überall `[x,y,z]`, 3 endliche Zahlen. Fehlermeldungen nennen den Index, z. B. `buildings[7].points[2]: kein Punkt [x,y,z]`.

### 2.2 `map`-Block (von `build_map.py` geschrieben, Prüfung im Client)

```jsonc
"map": {
 "extent": [-50, 46, -49, 39],   // Welt-x0,x1,z0,z1: Verschiebebereich = Vereinigung aus Orthofoto und allen Plandaten + Rand, auf Zellraster gerundet
 "start":  [-10, 21, -33, 13],   // Startausschnitt: eigene Flurstücke (style primary) + 3 m
 "grid_m": 5,
 "min_mpp": 0.004,
 "image": {
   "dir": "map/", "format": "webp", "version": "<12 hex sha256 über alle Kachelbytes>",
   "bounds": [-16, 16, -34, 16], // Welt-Bereich des Bilds f=1; Bild-x = Welt-x nach rechts, Bild-y = Welt-z nach unten
   "res": 0.02, "size": [1600, 2500], "tile": 512, "overlap": 1,
   "levels": [ {"f":1, "size":[1600,2500], "tiles":[[0,0],[1,0],…]}, {"f":2,…}, {"f":4,…}, {"f":8, "size":[200,313], "tiles":[[0,0]]} ],
   "bytes": 729088
 },
 "ground": {
   "file": "map/ground.json", "version": "<12 hex sha256>",
   "bounds": [-50, 46, -49, 39], "cell": 0.5, "cols": 192, "rows": 176, "bytes": 136508,
   "accuracy_m": { "measured": 0.25, "estimated": 0.45 }   // aus der Gegenprobe in build_map.py (p90, auf 0,05 aufgerundet), nicht erfunden
 }
}
```

Client-Prüfungen:

- `size == round((bounds.x1−x0)/res) × round((z1−z0)/res)`
- Die gröbste Stufe hat genau eine Kachel.
- Kachelindizes liegen im Bereich.
- `ground.bounds/cell/cols/rows` stimmen mit der Datei überein.

Die Texte zur Genauigkeit nennen `accuracy_m` („Boden gemessen ±0,25 m, geschätzt ±0,45 m“).

### 2.3 `splats`-Block (Stufenliste)

```jsonc
"splats": {
 "source": "garden.sog",                 // Ausgangsdatei für tools/build_splat_tiers.py (liegt neben scene.json)
 "auto": {                               // Geräteklasse → Stufen-id (siehe 3.2); alle 6 Schlüssel Pflicht, Werte müssen ids sein
   "software": "niedrig", "phone_weak": "niedrig", "phone": "mittel",
   "laptop_weak": "mittel", "laptop": "hoch", "desktop_strong": "max"
 },
 "tiers": [                              // aufsteigend nach Last; ids eindeutig; ≥1
  { "id": "niedrig", "label": "Niedrig", "hint": "für einfache Handys",
    "file": "garden-400k.sog", "count": 400000, "bytes": 0, "hash": "", "sh": 0, "ext": false,
    "build": { "method": "adaptive", "target": 400000, "sh": 0 },
    "render": { "pixelRatio": 1.0, "motionPixelRatio": 0.75, "maxStdDev": 2.236, "minAlpha": 0.0118,
                "minPixelRadius": 1.0, "maxPixelRadius": 128, "clipXY": 1.1, "minSortIntervalMs": 100, "maxSh": 0 } },
  { "id": "mittel", "label": "Mittel", "hint": "für aktuelle Handys und Tablets",
    "file": "garden-1m.sog", "count": 1000000, "bytes": 0, "hash": "", "sh": 0, "ext": false,
    "build": { "method": "adaptive", "target": 1000000, "sh": 0 },
    "render": { "pixelRatio": 1.25, "motionPixelRatio": 1.0, "maxStdDev": 2.449, "minAlpha": 0.0078,
                "minPixelRadius": 0.7, "maxPixelRadius": 256, "clipXY": 1.2, "minSortIntervalMs": 50, "maxSh": 0 } },
  { "id": "hoch", "label": "Hoch", "hint": "für Laptops",
    "file": "garden.sog", "count": 1786380, "bytes": 28173255, "hash": "", "sh": 3, "ext": true,
    "build": null,                                                        // = Quelldatei unverändert
    "render": { "pixelRatio": 1.5, "motionPixelRatio": 1.5, "maxStdDev": 2.646, "minAlpha": 0.0039,
                "minPixelRadius": 0.3, "maxPixelRadius": 384, "clipXY": 1.3, "minSortIntervalMs": 0, "maxSh": 1 } },
  { "id": "max", "label": "Maximal", "hint": "volle Qualität für starke Rechner",
    "file": "garden.sog", "count": 1786380, "bytes": 28173255, "hash": "", "sh": 3, "ext": true,
    "build": null,
    "render": { "pixelRatio": 2.0, "motionPixelRatio": 2.0, "maxStdDev": 2.828, "minAlpha": 0.002,
                "minPixelRadius": 0, "maxPixelRadius": 512, "clipXY": 1.4, "minSortIntervalMs": 0, "maxSh": 3 } }
 ]
}
```

Regeln:

- **Pflicht** sind alle gezeigten Felder. `count` und `bytes` müssen größer als 0 sein und `hash` 12 Hex-Zeichen haben. Bis `build_splat_tiers.py` gelaufen ist, scheitert die Validierung absichtlich laut, z. B. mit `splats.tiers[0].bytes: 0 – tools/build_splat_tiers.py ausführen`.
- Es gilt `render.maxSh ≤ sh`, `pixelRatio ≥ motionPixelRatio > 0` und `maxStdDev ∈ [1, √8]`. Die Werte liegen in `minAlpha` als 0–1-Wert vor; `0.0118 ≈ 3/255`.
- Teilen sich zwei Stufen `file` und `ext`, dann wechselt man zwischen ihnen ohne Neuladen (3.4).
- Die Splat-Zahlen sind absolute Budgets, keine Anteile. Für die künftige 2–3-Mio.-Szene bleiben niedrig und mittel bei 400k/1M. Für „hoch“ kann der Orchestrator ein `build` mit z. B. 1,6M eintragen.
- Die Render-Werte sind Startwerte aus der Spark-Analyse. Sie müssen auf echten Handys visuell geprüft werden; die Mac-Messung bildet Füllrate und Weichzeichnen nicht ab.

### 2.4 Speicherschlüssel der Messungen und Migration

- **Neu:** `grundstueck-viewer:v2:${pathname(BASE)}|${frame}`. Er hängt nicht an Datei, Stufe oder Ansicht.
- **Inhalt:** wie bisher `{ items, calibPairs, counter }`, plus je Item `src: ('g'|'e'|'s'|'p')[]` mit derselben Länge wie `points`.
- **Migration** einmalig und ausdrücklich, nur wenn der neue Schlüssel leer ist:
  1. Für jede `legacy_id` den alten Schlüssel `grundstueck-viewer:v1:${pathname}|${legacy_id}` lesen (heutiger Aufbau `main.js:201` und `measure.js:5,118`).
  2. Den ersten nicht leeren übernehmen. Fehlendes `src` wird zu `'s'` (alte Messungen konnten nur aus 3D kommen; dokumentierte Regel).
  3. Toast „Messungen aus der bisherigen Version übernommen.“. Der alte Schlüssel bleibt stehen.
- **Aktueller legacy_id-Wert:** exakt `garden.sog|2026-11-16a|` + `JSON.stringify(cfg.transform)` des heutigen `scene.json`. Geprüft: Python mit `separators=(',',':')` und Node liefern dieselbe Zeichenkette:
  `{"quaternion":[0.9011137111910978,-0.12488363146943864,0.3935331557618858,0.13240020170114453],"position":[0.06291064364021329,2.0172586314887826,-5.839269288210102],"scale":2.434042055771363}`
- **Fehlerfälle:** siehe 1.7.
- **CSV:** neue Spalte „Punktherkunft“ nach „Punkte (x y z in m)“. Je Punkt steht dort „Boden gemessen“, „Boden geschätzt“, „3D-Oberfläche“ oder „Planpunkt“, getrennt mit „ | “.
- **Kennzeichnung „(geschätzt)“:** Höhenwerte mit einem Punkt `e` oder `p` bekommen in Liste und Label den Zusatz. Für `p` gilt das schon heute laut Toast `main.js:349`.

---

## 3. Qualitätsregler

### 3.1 Stufen und was sie stellen

| Stufe | Datei | Splats | SH | Puffer | pixelRatio (Ruhe/Bewegung) | maxStdDev | minAlpha | min/maxPixelRadius | clipXY | minSortIntervalMs | maxSh | Download (heute) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| niedrig | garden-400k.sog | 400k | 0 | PackedSplats | 1,0 / 0,75 | √5 | 3/255 | 1,0 / 128 | 1,1 | 100 | 0 | ≈ 5 MB (geschätzt) |
| mittel | garden-1m.sog | 1,0M | 0 | PackedSplats | 1,25 / 1,0 | √6 | 2/255 | 0,7 / 256 | 1,2 | 50 | 0 | ≈ 12,6 MB (geschätzt) |
| hoch | garden.sog | 1,79M | 3 | ExtSplats | 1,5 / 1,5 | √7 | 1/255 | 0,3 / 384 | 1,3 | 0 | 1 | 28,2 MB |
| max | garden.sog | 1,79M | 3 | ExtSplats | min(dpr,2) / dto. | √8 | 0,5/255 | 0 / 512 | 1,4 | 0 | 3 | 28,2 MB |

> Stand 21.11.2026: Die Szene wurde ersetzt (zweite Begehung). Splat-Zahlen und Dateigrößen in dieser Spezifikation (1,79 Mio., 28,2 MB) sind historische Planungswerte; gültig sind `public/scene/scene.json` und README „Datengrundlage“ (Quelle 2,6 Mio. Splats/40,1 MB, „hoch“ eigene Datei `garden-1600k.sog` mit 1,6 Mio. Splats, SH 1, 21,7 MB).

Für alle Stufen gilt zusätzlich `enableLod:false`, SplatMesh `editable:false` und `raycastable:false`. Die tatsächliche Pixelratio ist `min(devicePixelRatio, render.pixelRatio)`.

Begründungen und aufgelöste Widersprüche:

- **Splat-Zahl ist der Hebel**, nicht die Pixelratio. Gemessen: 2880×1800 = 6,7 ms und 562×1218 = 7,3 ms GPU; pixelRatio 2→1 brachte nur 30→31,9 fps. Die Kosten pro Bewegung (Generate, Readback 4 B/Splat, Sortierung) skalieren mit der Splat-Zahl. Deshalb gibt es vorab erzeugte Dateien je Stufe.
- **Kein Laufzeit-LoD** (`lod:true`). Gemessen: GPU 16 ms statt 6,7 ms, Laden +3,2 s, Heap +100 MB, Splats +41 %. Ohne `nonLod` ist `numSplats=0`, und der Picker bekommt n=0. Es gibt auch kein `.rad`: `build-lod` liegt nicht im npm-Paket, und splat-transform schreibt kein `.rad`.
- **PackedSplats für niedrig/mittel.** Das halbiert den GPU-Speicher und senkt den Heap beim Laden (gemessen 127 statt 208 MB), bei gleicher GPU-Zeit (7,25 gegenüber 6,7 ms). Mittelpunkte liegen dann als float16 im lokalen System vor. Bei |Koordinate| ≤ 2,9 ist ein ulp ≈ 0,002 Einheiten, also höchstens ±2,4 mm Weltfehler. Das ist gegenüber der Splat-Oberflächenunschärfe vernachlässigbar.
  Bei der künftigen größeren Szene kann der Fehler auf etwa ±1 cm steigen. `build_splat_tiers.py` berechnet und druckt diesen Wert aus `meta.json` (`means.mins/maxs`). Liegt er über 5 mm, steht der Wert im Stufen-`hint`.
- **hoch und max teilen sich `garden.sog`.** Kein zusätzlicher Download, Wechsel ohne Neuladen. „hoch“ spart über `maxSh 1` und die Fragment-Parameter. Die PERF-Analyse hatte 3 Stufen vorgeschlagen, die Spark-Analyse 4; die 4 Stufen mit geteilter Datei erfüllen beides.
- **minSortIntervalMs:** PERF schlug 0/33/66–100 vor, Spark 120/60/0/0. Gewählt ist 100/50/0/0. Spark setzt bei Drosselung selbst einen Timer für die nachgeholte Sortierung und meldet danach `onDirty` (`spark.module.js:12574-12592, 12636-12644`). Mit „Rendern nur bei Bedarf“ geht deshalb keine Sortierung verloren.
- **motionPixelRatio:** Auf dem M5 wirkte die Auflösung kaum. Auf Handys ist die Füllrate vermutlich relevant, gemessen ist das nicht. Deshalb ist die Bewegungsauflösung nur in den Handy-Stufen niedriger (P7).

### 3.2 Auto-Vorwahl (`quality.js`, läuft im 2D-Start ohne three)

**Probe** (einmal, Ergebnis in `state.device`):

```js
const c = document.createElement('canvas');
const strict = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
const gl = strict ?? document.createElement('canvas').getContext('webgl2');
webgl2       = !!gl
software     = !!gl && !strict                      // Chrome liefert bei Software-Rendering nur ohne Caveat einen Kontext
dbg          = gl?.getExtension('WEBGL_debug_renderer_info')
renderer     = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null   // null = „Grafikchip unbekannt“ (Firefox/Safari maskieren)
maxTex       = gl?.getParameter(gl.MAX_TEXTURE_SIZE)
gl?.getExtension('WEBGL_lose_context')?.loseContext()          // Probe-Kontext sofort freigeben
coarse       = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches
ios          = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
mem          = navigator.deviceMemory            // undefined in Safari/Firefox → Kriterium entfällt, wird im Grundtext genannt
cores        = navigator.hardwareConcurrency
screenPx     = screen.width * screen.height * devicePixelRatio**2
```

Ohne WebGL 2 ist 3D nicht verfügbar (1.6). Spark braucht Texturbreite 2048 (`SPLAT_TEX_WIDTH`, `spark.module.js:562`); das garantiert WebGL 2 ohnehin.

**Grafikchip-Muster** (Groß-/Kleinschreibung egal):

- `SOFT = /SwiftShader|llvmpipe|softpipe|Software|Basic Render|Microsoft Basic/`
- `WEAK = /Mali-(4|T)|Adreno \(TM\) [3-5]\d\d|PowerVR|Intel.*(HD|UHD) Graphics|Intel\(R\) (HD|UHD)|GMA|Mesa Intel/`
- `STRONG = /Apple M\d|RTX|GeForce (GTX|RTX)|Radeon (RX|Pro)|Arc\b|Adreno \(TM\) [7-9]\d\d|Apple GPU/`

`Apple GPU` ist die Safari-Maskierung; auf dem Mac ist das stark. Auf iOS greift ohnehin die Handy-Regel.

**Klasse** (erste zutreffende Regel gewinnt):

```
software || SOFT                                                        → "software"
coarse || ios:
    mem ≤ 3 || cores ≤ 4 || WEAK || maxTex < 4096                       → "phone_weak"
    sonst                                                               → "phone"
sonst (Laptop/Desktop):
    WEAK || mem ≤ 4 || cores ≤ 4                                        → "laptop_weak"
    STRONG && (mem === undefined || mem ≥ 8) && cores ≥ 8               → "desktop_strong"
    sonst                                                               → "laptop"
tier = cfg.splats.auto[klasse]
```

Der Grundtext für die UI wird aus den zutreffenden Kriterien gebaut, z. B. „Automatisch: Mittel (Handy, 8 Kerne, Grafikchip unbekannt)“. Bei `software` kommt zusätzlich der Warn-Toast beim 3D-Laden: „Kein Grafikprozessor erkannt (Software-Rendering) – 3D wird sehr langsam sein.“.

**Kein automatisches Herunterschalten.** Optional als Hinweis: Liegt in den ersten 5 s einer 3D-Interaktion der Median der Bildabstände über 50 ms, zeigt ein Toast mit Knopf „Ruckelt es? Qualität „Niedrig“ wählen“. Es schaltet nichts von selbst.

### 3.3 Anwendung der Parameter (in `view3d.applyTier(tier)`)

```js
renderer.setPixelRatio(Math.min(devicePixelRatio, tier.render.pixelRatio)); renderer.setSize(w, h, false);
Object.assign(spark, { maxStdDev, minAlpha, minPixelRadius, maxPixelRadius, clipXY, minSortIntervalMs } = tier.render);
mesh.maxSh = tier.render.maxSh; mesh.updateGenerator();     // SplatMesh.d.ts:136,156 – „Call updateGenerator() after changing“
requestRender();
```

Alle Spark-Felder werden in jedem Bild in die Uniforms kopiert und sind zur Laufzeit änderbar (Spark-Analyse).

### 3.4 Umschalten zur Laufzeit inklusive Speicherfreigabe

- **Gleiche `file` und `ext`**: nur `applyTier`. Kein Neuladen, sofort sichtbar. (Geplant war das für hoch ↔ max; seit dem 21.11.2026 hat „hoch“ eine eigene Datei `garden-1600k.sog`, heute teilen sich keine zwei Stufen eine Datei. Ein Wechsel hoch ↔ max läuft deshalb über „Andere Datei“.)
- **Andere Datei** (Speicher zuerst freigeben, damit sich der Spitzenspeicher nicht verdoppelt; das ist auf Handys entscheidend):
  1. Die Ladekarte zeigt „Qualität wird gewechselt …“ und dann Phase 2/3 wie in 1.6, mit der Größe der neuen Datei.
  2. `scene.remove(mesh); mesh.dispose()`
  3. `picker?.dispose()`
  4. `spark.dispose()`, weil Accumulatoren, `orderingTexture` und Readback-Puffer nur wachsen und `mesh.dispose()` sie nicht freigibt (Spark-Analyse).
  5. `spark = new SparkRenderer({ renderer, onDirty: requestRender, enableLod:false, ...render })` und `scene.add(spark)`
  6. Neues Mesh laden (1.5), `applyTier`. Der Picker wird beim nächsten Bedarf neu initialisiert; die `count`-Prüfung gilt.
  7. Kamera, Messungen, Draft und Ebenen bleiben erhalten.
  8. Schlägt das Laden fehl, kommt die rote Ladekarte mit „Erneut versuchen“, „Vorherige Stufe laden“ und „Zur 2D-Karte“. Kein automatischer Rückfall.
- **Nach einem Herunterschalten auf Touch-Geräten:** Toast mit Knopf „Für vollständige Speicherfreigabe Seite neu laden“. Der Spark-Workerpool und sein WASM-Heap schrumpfen nicht.
- **In 2D** ändert die Wahl nur die Stufe für das nächste 3D-Laden und den Knopftext.

### 3.5 Merken pro Gerät

- **Schlüssel:** `grundstueck-viewer:quality:v1:${pathname}`, Wert `{"choice":"auto"}` oder `{"choice":"mittel"}`.
- Lesen und Schreiben stehen in try/catch. Ein Fehler wird sichtbar im selben Panel-Hinweis wie in 1.7 gemeldet, plus `console.error`. Die App läuft weiter mit „Automatisch“; das ist im Hinweis benannt.
- Eine unbekannte gespeicherte id behandelt 1.7.

### 3.6 UI

- `#btn-quality` zeigt das Symbol und den Stufennamen.
- Das Popover `#quality-menu` (`role="menu"`) listet:
  - „Automatisch – <Stufe> (<Grund>)“
  - je Stufe: Label, `hint`, „5,2 MB · 400.000 Splats“
  - die aktive Stufe mit Haken (`aria-checked`)
  - unten in kleiner Schrift: „Niedrig/Mittel: Positionen mit 16 Bit gespeichert (zusätzlich etwa ±3 mm).“
- Tastatur: Pfeile und Enter, Esc schließt.

---

## 4. Harte 3D-Optimierungen (Prioritätsreihenfolge)

Zeilennummern beziehen sich auf den heutigen Stand. `main.js`-Teile wandern nach `view3d.js` bzw. `app.js`.

**P1 – Overlay am Bildausschnitt kappen und Gruppen-Deckkraft ersetzen.** Hauptursache: 30 statt 60 fps auf dem Desktop, 39 statt 60 fps mobil, GPU-Prozess 400 statt 210 MB.

- **Ursache:**
  - `overlay.js:37-45` (`clip`) kappt nur an der Near-Plane, ebenso `55-65` (`clipPoly`), `68-77` (`polyPath`) und die Nutzung in `130` und `149`.
  - `overlay.js:251-254`: Flächen werden ganz weggelassen, sobald eine Ecke hinter der Kamera liegt.
  - Gemessen: Koordinaten bis ±849.412 px, gestrichelte Pfade mit Millionen px Länge (`style.css:43,46,59`).
- **Umsetzung:**
  - `clip.js` (1.3) für alle Linien, Polygone und Punkte, dazu der Hülltest je Gruppe.
  - Aufeinanderfolgende ungekappte Segmente eines Linienzugs zu einem `M…L…L` verbinden, damit die Strichelung durchläuft und weniger Befehle anfallen.
  - Statt `g.bwalls { opacity }` (`style.css:51`) und `g.corridor { opacity }` (`style.css:57`) **einen** `<path>` je Gruppe mit allen Polygonen als Teilpfaden, `fill-rule="nonzero"` und `fill-opacity` 0,13 bzw. 0,2. Jedes Polygon wird nach der Projektion auf gleiche Umlaufrichtung gebracht (Vorzeichen der Fläche prüfen, sonst umdrehen). So bleibt „Überlappungen werden nicht dunkler“ (`overlay.js:182`) erhalten, ohne eigene Offscreen-Ebene.
  - Der Ring am Rohrende (20-Eck, `overlay.js:167-174`) bleibt.
- **Erst messen, dann entscheiden:** Ist nach P1 die Variante ohne Strichelung auf dem Desktop (Metal) noch um mindestens 5 fps schneller, dann während Kamerabewegung `#app.moving #overlay path { stroke-dasharray: none }` setzen und im Stillstand stricheln. Sonst nicht.
- **Abnahme:** 6.2 Nr. 6–8.

**P2 – Nur bei Bedarf rendern** (`main.js:802-834`: `setAnimationLoop` rendert 60/s auch im Leerlauf; 16–36 % CPU des GPU-Prozesses, unter SwiftShader 975 %).

```js
let raf = 0, needs = false;
export function requestRender() { needs = true; if (!raf && !document.hidden) raf = requestAnimationFrame(frame); }
function frame(now) {
  raf = 0;
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  let active = moveByKeys(dt);                         // gibt true zurück, wenn bewegt (main.js:631-650)
  if (state.tween) { /* main.js:807-814 */ active = true; }
  if (controls.update()) active = true;                // OrbitControls: true solange sich etwas ändert (auch Dämpfung)
  if (needs || active) { needs = false; renderer.render(scene, camera); stats.renders++; onFrame(); }  // onFrame: Overlay, Maßstab
  if (active || state.keys.size || state.tween) raf = requestAnimationFrame(frame);
  else scheduleIdle();                                 // 200 ms später: motion-Ende (P7), centerDepth (P5)
}
```

- `requestRender()` auslösen bei:
  - `controls` `'change'` und `'start'`
  - `spark.onDirty` (Sortierung oder Upload fertig)
  - keydown einer Bewegungstaste
  - `animateTo`
  - Resize (`main.js:109-119`)
  - jedem bisherigen `state.dirty = true` (zentral über `markDirty()` in app.js, das `view.requestRender()` ruft)
  - Ende des Mesh-Ladens
- Ein Frame zeichnet das Overlay nur bei `cameraChanged()` oder dirty (`main.js:791-800` bleibt).
- **Abnahme:** 6.2 Nr. 4.

**P3 – Unsichtbare Seite rendert nichts.** `document.addEventListener('visibilitychange', …)` (heute nur `keys.clear()`, `main.js:751`):

- Bei `hidden`: rAF abbrechen und ein laufendes Tween beenden.
- Bei `visible`: `requestRender()`.
- Gleiches für `map2d`.
- `IntersectionObserver` ist nicht nötig (Vollbild).

**P4 – Splat-Zahl je Stufe, PackedSplats, SH je Stufe.** Betrifft `main.js:79, 111, 133-150`; umgesetzt durch Abschnitt 3 und 5.2. Das ist der eigentliche Hebel gegen Generate, Readback und Sortierung pro Bewegung (`spark.module.js:12573-12640`, Readback 7,2 MB bei 1,79M).

**P5 – Pick-Worker erst bei Messbedarf, Init ohne Long Task.** Heute:

- `picker.js:17` startet den Worker im Konstruktor.
- `main.js:157-164` initialisiert ihn beim Laden: `forEachSplat` über 1,79M im Hauptthread = Long Task 77 ms bzw. 308 ms bei 4-facher Drosselung.
- `main.js:776-787` pickt nach jedem Kamerastopp.

Neu:

- `new Picker()` erzeugt keinen Worker. `picker.ensure(mesh)` startet ihn und initialisiert beim **ersten** Bedarf:
  - Messwerkzeug ≠ nav in 3D gewählt
  - Doppelklick in nav
  - Höhenprofil in 3D angezeigt
  - Hover in einem Messwerkzeug

  Solange läuft, zeigt die Hinweisleiste „Messwerkzeug wird vorbereitet …“. Klicks warten in `queue` auf `view.pickReady()`.
- **Init in Scheiben:**
  - Quelle: `const src = mesh.extSplats ?? mesh.packedSplats`.
  - Je Scheibe 131.072 Splats per `src.getSplat(i)`. Es liefert ein geteiltes Objekt ohne Allokation (`spark.module.js:8150-8153, 11466-11469`).
  - Zwischen den Scheiben `await` über `MessageChannel` (Yield an den Hauptthread). Keine Scheibe dauert über 50 ms.
- **Arrays:** `C,S,Q,A` als Float32; `RMAX` entfällt und wird im Worker aus S berechnet (spart 4 B/Splat). Übergabe per Transfer wie heute (`picker.js:69-70`).
- **Prüfung:** `n === tier.count`, sonst Fehler (1.7).
- **`scheduleCenterDepth`** (`main.js:777-787`) nur, wenn der Picker bereit ist und keine Bewegung läuft. Bis dahin gilt der Abstand zum Drehpunkt (`main.js:768`). Das ist das bestehende, im Kommentar `main.js:764-765` dokumentierte Verhalten.
- **`picker.dispose()`:** `worker.terminate()`, offene Anfragen mit Fehler „Messen abgebrochen (3D geschlossen)“ ablehnen, Arrays nullen.
- Die `localBounds`-Berechnung (`picker.js:59-67`) entfällt, weil `cfg.view` Pflicht ist.

**P6 – Overlay-Aufbau ohne Allokationen und gedrosselt** (`main.js:819-831` baut `items` je Frame neu; `overlay.js:28-35,42-43` klont Vektoren; `overlay.js:47-52` `innerHTML`).

- Statische Geometrie (Grenzen, Gebäude-Grundrisse und -Oberkanten, Kanal mit Streifen für die aktuelle Breite) wird beim Laden bzw. bei Änderung von `corridor` einmal als `Float64Array` je Gruppe abgelegt. `toClip` schreibt in wiederverwendete `Float64Array(4)`-Puffer.
- `innerHTML` je Neuaufbau bleibt (nach P1 klein). Labels werden nur neu gesetzt, wenn sich ihr Text- und Sichtbarkeitssatz ändert; sonst nur `style.transform` je Label (`translate(x,y)`) statt `left/top`.
- Höchstens ein Neuaufbau je gerendertem Frame.
- In 3D wird **nicht** in jedem zweiten Frame ausgelassen, sonst schwimmt das Overlay sichtbar gegen den Splat.

**P7 – Adaptive Auflösung während Bewegung** (`main.js:111`).

- Bei `controls 'start'`, Tween-Start oder Bewegungstaste: Ist `motionPixelRatio < pixelRatio`, dann `renderer.setPixelRatio(min(dpr, motionPixelRatio))` und `setSize(w,h,false)`.
- 200 ms nach dem letzten aktiven Frame: Pixelratio zurücksetzen und `requestRender()`.
- Höchstens zwei Größenwechsel je Geste. Kein Flackern der CSS-Größe, weil das Canvas per CSS 100 % bleibt.

**P8 – Picking beschleunigen.**

- **Problem:** `pick-worker.js:38-47` prüft je Pick alle N Splats; `profile.js:55-62` schickt 121 Picks nacheinander (397–453 ms).
- **Batch:** Neue Nachricht `{type:'pick-batch', id, rays:[{o,dirs,…}]}` mit einer Antwort für das ganze Profil. `profile.js` ruft im 3D-Sampler `sampleMany`.
- **Gitter im Worker** (lokale Splat-Koordinaten):
  - Zellgröße `h = 0.1` lokale Einheiten (≈ 0,24 m), über die robusten Grenzen (0,5–99,5-Perzentil der Zentren je Achse).
  - Splats außerhalb oder mit `3·RMAX > h` kommen in eine Liste `big`, die jeder Pick linear prüft. Die Größe von `big` wird beim Init per `console.info` gemeldet.
  - Übrige Splats: Zellindex per Counting-Sort (`cellStart: Uint32Array(cells+1)`, `idx: Uint32Array(N)`).
  - Je Strahl 3D-DDA (Amanatides–Woo) von `near` bis zum Gitteraustritt; je besuchter Zelle die 27er-Nachbarschaft prüfen, doppelt besuchte Splats über `stamp: Uint32Array(N)` mit Generationszähler aussortieren.
  - Jeder der 5 Strahlen wird einzeln traversiert; der Kegel-Vorfilter `tanTheta` entfällt.
  - `composite()` bleibt unverändert (`pick-worker.js:51-109`).
- **Korrektheit:** Jeder beitragende Splat hat Abstand ≤ √8·σmax < 3·RMAX zum Strahl (`pick-worker.js:79-80`). Damit sind die Ergebnisse identisch zur linearen Suche. Die lineare Suche bleibt als Nachricht `pick-linear` für den Test (6.2 Nr. 15).

**P9 – CSS: kein Weichzeichnen über dem Canvas, Spinner stoppen.**

- `backdrop-filter` streichen in `style.css:86` (`.brand`), `94` (`.chip`), `112` (`.toolbar`) und `142` (`.panel`).
- Dafür `--glass: rgba(18,23,29,0.9)` (`style.css:3`). `dialog::backdrop` darf bleiben (statisch).
- Der Spinner der Ladekarte bekommt `animation` nur, solange die Karte sichtbar ist. Die Karte wird per `hidden` ausgeblendet, nicht per `opacity` (heute `style.css:215-216,222`).

**P10 – Renderer-Optionen.**

- `powerPreference` nach Stufe (1.5); heute fest `high-performance` in `main.js:74`.
- `antialias:false` bleibt.
- Kein `preserveDrawingBuffer`.
- `renderer.info.autoReset` bleibt.

**P11 – Speicher.**

- extSplats nur in hoch/max (heute immer, `main.js:135`).
- Stufenwechsel mit `spark.dispose()` (3.4).
- `dispose()` beim Weg nach 2D (1.5).
- Splat-Bytes nach `initialized` freigeben.
- Picker ohne RMAX (P5).

**P12 – Bundle.**

- `vite.config.js:7`: `chunkSizeWarningLimit` auf 3700 setzen, mit Kommentar: gilt nur für den 3D-Chunk (Spark mit eingebettetem WASM, ≈ 3,4 MB). Die harte Grenze für den Start-Chunk prüft `tools/check_bundle.mjs`.
- `package.json`: `"build": "vite build && node tools/check_bundle.mjs"`.

---

## 5. Werkzeuge unter `tools/`

Alle Skripte brechen bei jeder Unstimmigkeit mit Exit-Code ≠ 0 und einer konkreten Meldung ab (Datei, Feld, Wert). Sie geben am Ende eine Größenübersicht aus. Python 3 mit numpy 2.5 und Pillow 12.3 (WebP vorhanden) ist auf dem Mac installiert. Kein matplotlib (die Prototypen nutzten es). Die Prototyp-Logik liegt unter `/private/tmp/claude-501/-Users-logge--claude-spares-spare-rY8rnf/2cb988ca-d5aa-4b02-bd6f-f264a2ccd2f6/scratchpad/proto/` (`export_map.py`, `ground_proto.py`). Der Ordner kann gelöscht werden; diese Spezifikation ist maßgeblich.

### 5.1 `tools/build_map.py` – 2D-Assets

```
python3 tools/build_map.py \
  --ortho "/Users/logge/Library/Application Support/Claude/scratch-workspaces/e3689745-ec6a-4cdc-8352-2992fefa4962/269e685d-f271-412a-b545-eb874a78b9ca/scratch-2026-11-14-41dc50/work/ortho/ortho_top_plain.png" \
  --npz   "/Users/logge/Library/Application Support/Claude/scratch-workspaces/e3689745-ec6a-4cdc-8352-2992fefa4962/269e685d-f271-412a-b545-eb874a78b9ca/scratch-2026-11-14-41dc50/work/ortho/ortho.npz" \
  --scene public/scene/scene.json --out-dir public/scene \
  [--quality 75] [--tile 512] [--margin 4] [--start-margin 3] [--max-p90 0.5]
```

1. **npz laden:** Pflicht-Schlüssel `ground, valid, cell, x0, x1, z0, z1, res`. Fehlt einer, Abbruch mit Name. `ground.shape == (ceil((z1−z0)/cell), ceil((x1−x0)/cell))` prüfen.
2. **PNG laden** (heute RGB, 1600×2500). Größe prüfen: muss `round((x1−x0)/res) × round((z1−z0)/res)` sein. Alpha: Pixel mit Summe RGB > 0 sind gedeckt; reines Schwarz ist „keine Daten“, wie `ortho.py:78` es erzeugt. Liegt die Deckung unter 1 %, Abbruch.
3. **Pyramide:** f = 1, 2, 4, … bis beide Seiten ≤ `tile`.
   - Verkleinern vormultipliziert: `im.convert('RGBa').resize((ceil(W/f), ceil(H/f)), Image.LANCZOS).convert('RGBA')`. Sonst bluten schwarze transparente Pixel an Rändern ein.
   - Kacheln `t{f}_{tx}_{ty}.webp` nach `<out-dir>/map/`, Ausschnitt mit `overlap` = 1 px nach rechts und unten (sofern im Bild).
   - Speichern mit `quality=q, method=6`. Ganz transparente Kacheln auslassen und nicht listen.
   - Vorher alte `t*_*_*.webp` in `map/` löschen und die Anzahl ausgeben.
4. **Bodenraster `map/ground.json`:**
   - **Bereich:** `extent` = Vereinigung aus npz-Bereich und allen Planpunkten (boundaries.points/lines/corners, buildings.points, sewer.pipes.points, sewer.manholes.at, sewer.connections) ± `margin`, auf Vielfache von `cell` gerundet (floor/ceil). Heute ergibt das etwa x −54…51, z −49…39; die Plandaten reichen x −49,5…46,6 und z −44,1…34,0.
   - **Freie Zellen** = `valid` und nicht in einem Gebäudegrundriss. Den Grundriss mit `PIL.ImageDraw.polygon` auf das npz-Raster zeichnen.
   - **q2:** für Zellen, deren Mittelpunkt im npz-Raster liegt; 5×5-Fenster (±1 m) mit Anteil frei > 50 % → 15. Perzentil der freien Höhen (Regel aus `plan_overlay.py:58-66`).
   - **q1:** sonst inverse Distanz (Gewicht `1/max(d,0.5)²`) aller Planpunkte. Grenz-, Gebäude- und Rohrpunkte `y − 0.04`, Schächte `y − 0.06`; nur wenn der nächste Planpunkt näher als 15 m liegt. Vektorisiert mit numpy.
   - **q0:** sonst.
   - **Format** (Zeile = z aufsteigend, Spalte = x aufsteigend, Zellmitte `x0+(j+0.5)·cell`, `q` lauflängenkodiert mit Summe = rows·cols):
     `{"format":"grundstueck-ground-v1","x0","z0","cell","cols","rows","unit":0.01,"h":[cm|null…],"q":[[q,anzahl],…]}`
   - **Abbruch,** wenn q2 = 0 Zellen, wenn ein Planpunkt nicht endlich ist oder wenn ein `h` außerhalb von −50…+50 m liegt.
5. **Gegenprobe:** bilinear wie `ground.js` an allen Plan-Grenzpunkten, Gebäudepunkten und Schächten (nach Lift-Abzug). Ausgabe Median/p90 je Klasse und q. Bricht ab, wenn p90 der Grenzpunkte in q2 über `--max-p90` liegt. Daraus `accuracy_m.measured` = p90(q2), auf 0,05 aufgerundet, und `estimated` = max p90(q1) über die Klassen, auf 0,05 aufgerundet.
6. **`scene.json` aktualisieren:**
   - Nur den Block `map` ersetzen.
   - `start` = Bbox der `style:'primary'`-Grenzen ± `start-margin`; heute etwa x −9,9…20,4 und z −32,7…12,7.
   - `version` und `hash` = die ersten 12 Hex-Zeichen von sha256 über die Bytes.
   - Schreiben mit `json.dump(..., indent=1, ensure_ascii=False)` und abschließendem Zeilenumbruch, wie heute formatiert.
7. **Übersicht:** Kacheln je Stufe mit Anzahl und KiB, `ground.json` roh und gzip, Anteil q2/q1/q0, Gegenprobe.

Für spätere Daten (neues, größeres Orthofoto): dasselbe Kommando mit den neuen Pfaden. Bereich und Auflösung kommen aus dem npz.

### 5.2 `tools/build_splat_tiers.py` – Splat-Stufen

```
python3 tools/build_splat_tiers.py --scene public/scene/scene.json --scene-dir public/scene \
  --work-dir /private/tmp/claude-501/<eigener-ordner>/tiers [--only niedrig,mittel] [--gpu <n|cpu>]
```

- **Quelle:** `<scene-dir>/<splats.source>` (.sog oder .ply). Fehlt sie, Abbruch mit dem Hinweis auf den `cp`-Befehl aus der README.
- **Werkzeug:** splat-transform **exakt** `npx -y @playcanvas/splat-transform@3.12.0` (Node ≥ 22 nötig, vorhanden: v24.18.0). Jeder Aufruf wird ausgegeben. Exit-Code ≠ 0 bedeutet Abbruch mit stderr. `--gpu` wird nur weitergereicht, wenn angegeben; es gibt keine eigene Ersatzlogik.
- **Je Stufe mit `build`** (`method: "adaptive"`):
  ```
  npx -y @playcanvas/splat-transform@3.12.0 -w <quelle> -N -H <build.sh> --decimate-adaptive <build.target> <work>/<id>.ply
  npx -y @playcanvas/splat-transform@3.12.0 -w <work>/<id>.ply -m --sog-version 2 <scene-dir>/<file>
  ```
  - `--decimate-adaptive` muss die letzte Aktion sein, und die Ausgabe muss `.ply` sein (README 3.12.0).
  - Die Dezimierung verschmilzt Gaussians massenerhaltend. Das ist besser als reines Ausdünnen; Opazität über 1 kappt SOG v2 auf 1.
  - `-m` (Morton-Reihenfolge) verbessert die Kompression.
  - **`--sog-version 2` ist Pflicht.** Spark 2.4.0 erkennt nur v2 (`json.version === 2`) und das v1-Schema (`spark.module.js:11178-11208`, `tryPcSogs`). Die Standardausgabe v3 würde nicht geladen.
- **`method: "importance"`** (Alternative, für den Vergleich in 6.2 Nr. 17):
  ```
  npx … -w <quelle> -N -H <sh> <work>/<id>-full.ply
  python3 tools/prune_importance.py <work>/<id>-full.ply <target> <work>/<id>.ply
  npx … -w <work>/<id>.ply -m --sog-version 2 <scene-dir>/<file>
  ```
  `tools/prune_importance.py`:
  - PLY binary_little_endian per numpy lesen. Bei anderem Format, fehlendem `opacity` oder `scale_0..2` Abbruch.
  - Wichtigkeit = `sigmoid(opacity) · exp(scale_0+scale_1+scale_2)` (Deckkraft × Volumen).
  - Die `target` wichtigsten behalten (`argpartition`) und mit identischem Header (angepasste vertex-Anzahl) schreiben.
- **Prüfung je erzeugter oder referenzierter Datei:**
  - ZIP öffnen, `meta.json` lesen.
  - `version == 2`; `count` mit Abweichung höchstens 1 % zu `build.target` (die tatsächliche Zahl wird übernommen).
  - `shN` vorhanden genau dann, wenn `sh > 0`, und dann `shN.bands == sh`.
  - Für `build:null`-Stufen kommen `count` und `sh` aus der Datei.
  - Positionsquantisierung für PackedSplats ausgeben: `ulp(max|means.mins/maxs|)/2 · transform.scale` in mm; über 5 mm als deutliche Warnung (3.1).
- **`scene.json` schreiben:** je Stufe `count`, `bytes` (Dateigröße), `hash` (sha256, 12 Hex) und `sh`. Sonst nichts ändern; Format wie 5.1.6.
- **Abschlussprüfung im Browser** (im Skript nur als Hinweis ausgegeben, ausgeführt durch `tools/perf.mjs --check-tiers`): jede Stufe in Spark laden, `numSplats == count` prüfen, ohne Konsolenfehler.
- **Erwartung heute:** garden-400k.sog ≈ 5 MB, garden-1m.sog ≈ 12–13 MB (Hochrechnung 12,6 B/Splat ohne SH, nicht gemessen). Die echten Werte trägt das Skript ein.

Für spätere Daten (neuer Splat mit 2–3 Mio., gleiches Weltsystem):

1. Den neuen Splat neben `scene.json` legen.
2. `splats.source` und die `file`-Namen der Quell-Stufen anpassen, ebenso `transform`, falls es neu eingepasst wurde.
3. Das Skript ausführen.

### 5.3 `tools/check_bundle.mjs`

Läuft nach `vite build` und bricht ab, wenn:

- der Einstiegs-Chunk (aus `dist/index.html` `<script type="module" src>`) gzip über 45 KB liegt
- `dist/index.html` ein `modulepreload` auf einen Chunk enthält, der `SparkRenderer` oder `WebGLRenderer` enthält
- der Einstiegs-Chunk diese Bezeichner enthält
- das CSS gzip über 8 KB liegt

Ausgabe: Tabelle aller Chunks roh/gzip.

### 5.4 `tools/perf.mjs` – Messharness

Neu schreiben; Vorlage ist `/private/tmp/claude-501/-Users-logge--claude-spares-spare-rY8rnf/2cb988ca-d5aa-4b02-bd6f-f264a2ccd2f6/scratchpad/measure/run.mjs`, der Ordner kann gelöscht werden.

```
node tools/perf.mjs --url http://127.0.0.1:<port>/ --playwright /Users/logge/Documents/LoggeRythm/web/node_modules/playwright \
  --profile desktop|mobile|mobile-cpu4|mobile-cpu6 --gpu metal|swiftshader --scenario 2d|3d|switch|tiers|check-tiers [--tier id] [--legacy] --out <json>
```

- **Browser:**
  - metal = `~/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` mit `--mute-audio --use-angle=metal --enable-gpu --ignore-gpu-blocklist --enable-precise-memory-info --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`
  - swiftshader = `~/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell` mit `--use-angle=swiftshader --enable-unsafe-swiftshader`
- **Profile:**
  - desktop: 1440×900 bei DPR 2
  - mobile: 375×812 bei DPR 3 mit `isMobile` und `hasTouch`
  - CPU-Drosselung per CDP `Emulation.setCPUThrottlingRate`. Sie drosselt nur den Hauptthread; das wird so benannt.
- **Testschnittstelle der App:**
  - `window.__app = { state, view, store, stats:{renders, overlayBuilds, frames2d}, open3d(tierId) → Promise, close3d() → Promise, setTier(id) → Promise }`
  - `window.__viewer` in 3D wie heute (`main.js:837`) plus `requestRender`, `spark`, `mesh`.
- **Kamerafahrt 3D** (identisch zur Baseline, damit vergleichbar):
  - 10 s, je rAF `a = a0 + u·2π`, `R = R0·(1−0,55·sin(uπ))`, `y = y0·(1−0,45·sin(uπ))` um `controls.target`, mit Start aus `cfg.view`.
  - Nach jedem Setzen `__viewer.requestRender?.()`.
  - Gemessen: rAF-Intervalle (fps, p50/p95/p99), Renderaufrufe, GPU-Zeit per `EXT_disjoint_timer_query_webgl2`, CDP `Performance.getMetrics` (TaskDuration, Layout, RecalcStyle), CPU-Profil Top 18, Overlay-Neuaufbauten.
- **Leerlauf:** 8 s ohne Eingabe. `stats.renders`-Zuwachs, eigene rAF-Callbacks der App (`stats`), Prozess-CPU per `ps` je Chromium-Prozesstyp.
- **Weitere Messungen:**
  - Picks wie Baseline (10× 1 und 5 Strahlen, Median; Profil 121 Strahlen)
  - Renderer-RSS und GPU-Prozess-RSS per `ps`
  - `performance.memory.usedJSHeapSize` nach `HeapProfiler.collectGarbage`
  - Anzahl Worker per CDP `Target.getTargets` (type `worker`)
  - Long Tasks per PerformanceObserver (gepuffert)
  - Netzwerk: alle Anfragen mit Zeit und Größe
- **2D-Szenario:**
  - Zeit bis zum ersten Kartenbild: Marke `__app.stats.firstMap`, gesetzt nach Overlay-Aufbau und `decode()` der gröbsten Kachel.
  - Bytes bis dahin; JS-Bytes gzip.
  - 240 Frames Pan und Zoom über 4 Zoomstufen per Pointer-Events (CDP `Input.dispatchTouchEvent` bzw. Maus), Framezeiten.
  - Leerlauf.
- **`--legacy`:** misst den alten Stand (wartet auf `#loading.done`, kein 2D-Teil). Den alten Stand nicht im Repo erzeugen, sondern lesend exportieren:
  `git -C /Users/logge/Documents/Projects/static-pages archive HEAD sources/grundstueck-3d | tar -x -C /private/tmp/claude-501/<ordner>/`, dort `npm ci`, garden.sog kopieren und `npm run build`.

---

## 6. Testplan

### 6.1 Baseline (vorher)

Gemessen von der PERF-Analyse am 2026-11-21. Rohdaten: `/private/tmp/claude-501/-Users-logge--claude-spares-spare-rY8rnf/2cb988ca-d5aa-4b02-bd6f-f264a2ccd2f6/scratchpad/measure/result-*.json`. Wenn der Ordner noch existiert, mit `tools/perf.mjs --legacy` einmal nachmessen und beide Zahlen nennen.

| Größe | Desktop Metal | Mobil-Emulation Metal | Mobil ×4 CPU |
|---|---|---|---|
| JS vor erstem Bild | 3.452 KB (1.151 KB gzip) | dto. | dto. |
| erste Splats / erstes nutzbares Bild | 1.568 ms | 1.555 ms | ready 1.862 ms |
| Long Tasks | 77 ms (picker.init) | – | 308 ms + 143 ms |
| Leerlauf | 60 render/s, GPU-Prozess 16–36 % CPU | GPU-Prozess 32 % | – |
| Kamerafahrt | 30,1 fps, p95 50,1 ms | 39,4 fps | 38,2 fps |
| GPU-Zeit je Render | 12,0 ms | 5,5 ms | – |
| Hauptthread während Fahrt | 32 % (getBufferSubData 25 %) | – | 52 % |
| Renderer-RSS / GPU-Prozess | 1.432 MB / 420 MB | ≈ 1.415 MB | – |
| JS-Heap | 208→228 MB | – | – |
| Pick 1/5 Strahlen, Profil | 3 / 3 ms, 397–453 ms | – | – |
| SwiftShader mobil | erste Splats 15,4 s, Fahrt 0 Frames | | |

### 6.2 Messziele (nachher)

Alle Messziele mit `tools/perf.mjs`. Ergebnisse als JSON nach `/private/tmp/claude-501/<ordner>/perf/` und als Tabelle vorher/nachher im Abschlussbericht.

| Nr | Szenario | Ziel |
|---|---|---|
| 1 | 2D, mobile-cpu4, swiftshader (für 2D zulässig, kein WebGL) | erstes Kartenbild ≤ 600 ms nach Navigation (lokal); bis dahin ≤ 45 KB JS gzip und ≤ 250 KB gesamt übertragen; **keine** Anfrage auf den 3D-Chunk, `*.sog` oder `pick-worker` |
| 2 | 2D Pan/Zoom 240 Frames, mobile-cpu4 / mobile-cpu6 | Median ≤ 17,5 ms; p95 ≤ 25 ms (×4) bzw. ≤ 33 ms (×6), mit allen Ebenen und 3 gespeicherten Messungen |
| 3 | 2D Leerlauf 5 s | 0 App-rAF-Callbacks, 0 Overlay-Neuaufbauten; kein Long Task > 50 ms nach dem ersten Kartenbild (×1) bzw. > 100 ms (×4) |
| 4 | 3D Leerlauf 8 s nach Beruhigung, desktop metal, Stufe max | ≤ 2 Renderaufrufe; GPU-Prozess-CPU ≤ 3 % im Mittel (vorher 16–36 %) |
| 5 | 3D Kamerafahrt desktop metal, Stufe max, alle Ebenen an | ≥ 55 fps, p95 ≤ 20 ms (vorher 30,1 / 50,1) |
| 6 | dto. | max. Betrag aller SVG-Koordinaten ≤ Bildgröße + 2·48 px, geprüft an 11 Stellen der Fahrt (vorher 849.412 px) |
| 7 | dto. | GPU-Prozess-RSS nach der Fahrt ≤ 260 MB (vorher 420) |
| 8 | dto., A/B mit `nodash` nur zur Entscheidung P1 | Ergebnis dokumentieren, Entscheidung begründen |
| 9 | 3D Fahrt mobile metal, Auto-Stufe (erwartet „mittel“) und Stufe niedrig | ≥ 58 fps, p95 ≤ 20 ms |
| 10 | 3D öffnen mobile-cpu4 metal, Stufe niedrig | Long Tasks beim Öffnen ≤ 150 ms (Auswertung des 3D-Chunks); während Picker-Init keine Scheibe > 50 ms (×1) |
| 11 | Speicher nach 3D-Laden, desktop metal | Renderer-RSS: niedrig ≤ 650 MB, mittel ≤ 850 MB, max ≤ 1.450 MB; JS-Heap nach GC: niedrig ≤ 90 MB, max ≤ 230 MB |
| 12 | 3D → 2D | danach kein Canvas im DOM, `__viewer` entfernt, pick-worker beendet (Worker-Zahl ≤ 4, nur Spark-Pool), JS-Heap nach GC ≤ Heap vor 3D + 40 MB |
| 13 | Stufenwechsel max → niedrig → max | ohne Konsolenfehler; GPU-Prozess-RSS nach Wechsel auf niedrig ≤ 60 % des Werts bei max; Messungen und Kamera unverändert |
| 14 | Picks desktop metal, Stufe max | Klick (5 Strahlen) Median ≤ 1 ms; Profil 121 Strahlen ≤ 60 ms als ein Batch (vorher 3 ms / ≈ 420 ms) |
| 15 | Picker-Gitter gegen lineare Suche | 200 zufällige Bildschirmstrahlen aus 3 Kamerastellungen: identische Treffer (t gleich auf 1e-6 lokale Einheiten, gleiche null-Treffer) |
| 16 | `check-tiers` | jede Stufe lädt, `numSplats == count`, 0 Konsolenfehler; Dateigrößen gleich `bytes` |
| 17 | Bildvergleich Stufen | aus 3 festen Kamerastellungen Screenshots je Stufe; PSNR gegen max protokollieren; Anteil gedeckter (Nicht-Hintergrund-)Pixel ≥ 90 % von max. Für niedrig einmal `adaptive` gegen `importance` vergleichen und die bessere Methode in `scene.json` belassen (Begründung im Bericht) |
| 18 | Bundle | `npm run build` grün inklusive `check_bundle.mjs` |

> **Stand 21.11.2026, neue Szene (2.599.763 statt 1.786.380 Splats, SH 3, 40,1 MB)** – Abweichungen nach 6.5 mit Messwert und Ursache; die Ziele Nr. 5 und 11 waren für 1,79 Mio. Splats gesetzt. Ob sie für die größere Szene neu festgelegt werden, entscheidet Johannes (offen).
>
> - **Nr. 11 (verfehlt, Ursache Datenmenge):** JS-Heap nach GC bei max 283 MB (Ziel ≤ 230) in allen Läufen; Renderer-RSS 1.120–1.740 MB (Ziel ≤ 1.450, stark schwankend). Ursache: Spark hält die Splat-Daten zusätzlich zur GPU im Hauptthread (ExtSplats 32 B + SH1–3 64 B je Splat, 2,6 Mio. × 96 B ≈ 250 MB). Der Heap wächst linear mit der Splat-Zahl; ohne kleinere max-Datei oder Eingriff in Spark (CPU-Kopien nach dem Hochladen freigeben) ist das Ziel nicht erreichbar.
> - **Nr. 5 (Stellschraube umgesetzt, Ziel auf dem belasteten Messrechner nicht nachweisbar):** max bewegt sich jetzt mit `motionPixelRatio` 1,0 statt 1,5 (Ruhebild weiter 2,0). Im abwechselnden A/B-Lauf unter gleicher Last: 1,5 → 26,4 / 28,8 fps (GPU je Render im Mittel 68 / 62 ms), 1,0 → 59,1 / 49,3 fps (14 / 27 ms). Bei 2,6 Mio. Splats ist die Pixelzahl in Bewegung also doch ein Hebel (anders als bei 1,79 Mio., siehe 3.1). Während der Messungen liefen auf dem Rechner ein Android-Emulator und andere GPU-Last; selbst „hoch“ kam dabei nur auf 53–54 fps (p95 33 ms, vorher 60 / 16,7), max mit 1,0 auf 30–45 fps. In einem ruhigeren Moment: max 59,4 fps, p95 16,8 ms, GPU je Render 12,7 ms (Ziel erreicht). Das Ziel hängt also an der Fremdlast; eine Serie auf ruhigem Rechner steht aus.
> - **Nr. 13 (erfüllt, Messgröße präzisiert):** Auf Apple Silicon enthält das RSS des GPU-Prozesses keinen Grafikspeicher (max 198 MB → niedrig 189 MB, 0,95). `perf.mjs --scenario tiers` misst deshalb zusätzlich `footprint` (Kategorien „… (graphics)“): max 558 MB → niedrig 73 MB, Verhältnis 0,13 (Ziel ≤ 0,60); Messungen und Kamera unverändert, 0 Konsolenfehler. Nr. 13 gilt auf macOS für `gpuGraphicsRatioLowToMax`.

Die Handy-Zahlen sind Emulation auf einem M5 Pro. Füllrate, Weichzeichnen und Speichergrenzen echter Handys bildet das nicht ab; das muss im Bericht stehen. Eine Prüfung auf einem echten Gerät steht als offener Punkt drin.

### 6.3 Funktionsprüfungen

Per Playwright, in 2D **und** 3D, jeweils Desktop-Maus und Mobil-Touch. Screenshots ablegen.

1. Start ohne Ladeschirm in 2D. Titel und Untertitel aus `scene.json`. Statuszeile „2D-Karte“. Startausschnitt zeigt die eigenen Flurstücke vollständig.
2. Ebenen G/B/K schalten, Schutzstreifen-Stepper 0…6 m, in 2D Gebäude als Grundriss.
3. Strecke, Fläche (Schließen per Knopf, Enter und Doppelklick), Höhe und Maßstab: Werte plausibel gegen bekannte Planmaße. Seitenlänge Flurstück 214 aus `boundaries[1].sides` per Einrasten nachmessen, Abweichung ≤ 2 cm.
4. Einrasten auf Ecken, Grenzpunkte und Schächte; Alt verhindert es. Bei Höhe und Maßstab kein Einrasten.
5. Rückgängig (⌫), Abbrechen (Esc), Werkzeugtasten 1–5, H, M, ?, V; in 3D T und WASD/QE.
6. Höhenprofil: in 2D sofort mit Titel „Geländeprofil (Bodenmodell, 0,5-m-Raster)“, q1 gestrichelt mit Legende „geschätzt“, q0 als Lücke. In 3D über Picker-Batch mit Titel „Höhenprofil (Oberfläche von oben)“. Profil-Hover setzt den Marker in beiden Ansichten.
7. Messung in 2D anlegen, nach 3D wechseln: liegt an derselben Weltstelle. Umgekehrt ebenso. Auswahl, Liste und Draft bleiben erhalten.
8. Speicherung: Neuladen stellt alles wieder her. Migration: alten v1-Schlüssel mit 2 Messungen vorbelegen (`addInitScript`), dann erscheinen Übernahme und Toast, der alte Schlüssel bleibt bestehen.
9. CSV: Spalte „Punktherkunft“ korrekt, BOM, Semikolon, deutsches Zahlformat wie bisher (`measure.js:145-158`).
10. Qualitätsmenü: Auto-Grund sichtbar; Wahl wird gemerkt (Neuladen) und bestimmt den Knopftext; Stufen mit gleicher Datei ohne Neuladen (keine Netzwerkanfrage; heute gibt es keine solchen, siehe 3.4); jeder andere Wechsel, auch hoch↔max, mit Ladekarte „Qualität wird gewechselt …“.
11. Draufsicht und Start in 3D; Doppelklick-Drehpunkt; Maßstabsleiste in 2D exakt (`mpp`) und in 3D nach Picker-Init per centerDepth.
12. Hilfe zeigt 2D- und 3D-Bedienung; alle neuen Texte deutsch mit Umlauten (Textscan nach „ae/oe/ue“-Ersatzschreibungen in `src/` und `index.html`).
13. Kein Ton: Die Seite erzeugt keine Audio-Elemente (Prüfung `document.querySelectorAll('audio,video').length === 0`).

### 6.4 Fehlerpfade

Jeweils sichtbare Meldung plus `console.error` prüfen.

- **`scene.json`:**
  - `page.route` liefert 404 → Vollbild-Fehler mit „HTTP 404“.
  - Feld `splats.tiers[0].bytes` entfernt → Fehler nennt genau diesen Pfad.
  - `map.image.levels[1].tiles[0] = [99,99]` → Fehler.
- **`ground.json`:** `cols` verfälscht → Fehler mit Datei und Feld.
- **Kachel 404** → Toast plus rot schraffierte Kachel; Karte bleibt bedienbar.
- **Splat:**
  - 404 → Ladekarte „garden-400k.sog: HTTP 404“.
  - auf die Hälfte abgeschnitten → „unvollständig … statt … MB“.
  - Abbrechen in Phase 2 → Toast „3D-Laden abgebrochen.“, keine Fehlermeldung, 2D unverändert.
- **Kein WebGL 2** (`addInitScript`: `HTMLCanvasElement.prototype.getContext` liefert für `'webgl2'` null) → 3D-Knopf deaktiviert mit Grund; 2D und Messen funktionieren.
- **Kontextverlust:** `WEBGL_lose_context.loseContext()` in 3D → Fehlerkarte mit beiden Knöpfen; „Zur 2D-Karte“ funktioniert.
- **localStorage:** `Storage.prototype.setItem` wirft → Panel-Hinweis mit Fehlername; Messen geht weiter.
- **Picker:** Worker-URL per `page.route` mit 404 → Hinweisleiste rot, Messwerkzeuge in 3D deaktiviert, 2D-Messen weiter möglich.
- **`?tier=gibtsnicht`** → sichtbarer Fehler.

### 6.5 Fertig, wenn

- Alle Ziele in 6.2 sind erreicht, oder die Abweichung ist mit Messwert und Ursache begründet.
- 6.3 und 6.4 bestehen.
- `npm run build` ist grün.
- `tools/build_map.py` und `tools/build_splat_tiers.py` liefen mit den heutigen Daten und haben `scene.json` gefüllt.
- `README.md` ist aktualisiert: Aufbau mit 2D/3D, Module, `tools/` mit Kommandos, Schema-Kurzreferenz für `map` und `splats`, Hinweis auf den bleibenden Spark-Workerpool sowie auf `.sog` nur im veröffentlichten Ordner und in `.gitignore`.
- `main.js` ist gelöscht.
- Nichts ist committet, und außerhalb des Arbeitsordners wurde nichts geändert. Die erzeugten `public/scene/*.sog` bleiben ungetrackt. Ob `public/scene/map/*` (unter 1 MB) eingecheckt wird, entscheidet der Orchestrator.
- Die Dev- und Preview-Server sind beendet.

---

## 7. Bewusst getroffene Entscheidungen (Kurzliste)

1. **2D als DOM-`<img>`-Kacheln mit CSS-Transform**, kein Canvas und kein WebGL. Gemessen 16,6 ms/Frame auch bei ×6 CPU; Canvas2D lag bei 32–50 ms.
2. **Bodenhöhe in 2D aus neuem `ground.json` mit Qualitätsstufe.** `ortho.npz.ground` ist außerhalb der gültigen Zellen um bis zu 6 m falsch und wird nicht direkt verwendet.
3. **Datei-Stufen statt Laufzeit-LoD.** SOG v2 ist Pflicht, PackedSplats in niedrig/mittel, hoch/max teilen eine Datei.
4. **Stufenwechsel gibt zuerst frei, dann lädt er** (Spitzenspeicher). `spark.dispose()` bei jedem Dateiwechsel.
5. **Kein automatisches Herunterschalten**, nur ein Hinweis-Toast. Ein Kontextverlust führt zur Fehlerkarte mit Wahl.
6. **Speicherschlüssel `frame`** statt Datei/Transform, mit ausdrücklicher Migration. Punktherkunft je Punkt.
7. **Strichelung in Bewegung abschalten** nur, wenn die Messung nach der Kappung es rechtfertigt.
8. **`chunkSizeWarningLimit` 3700** plus harte Prüfung des Start-Chunks in `check_bundle.mjs`. Der Vite-Standard würde bei jedem Build für den unvermeidlich großen 3D-Chunk warnen.

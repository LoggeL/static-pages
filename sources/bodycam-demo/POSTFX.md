# C5: Bodycam-Post-FX

Einstieg: `public/bodycam-demo/js/postfx/bodycam.js`. Die Testseite ist unter
`/bodycam-demo/_dev/postfx/` erreichbar. Es gibt keinen Build-Schritt und keine zusätzliche JavaScript-Laufzeitbibliothek.
Alle Look-Werte stammen aus `research/STYLE.md`; technische Ergänzungen stehen zusammen mit ihnen in `js/postfx/params.js`.

## Einbindung

```js
import * as THREE from 'three';
import { createBodycamPost } from './postfx/bodycam.js';

const post = createBodycamPost(renderer, scene, camera, {
  quality: 'high',
  params: { osd: { startTime: '2026-10-14T23:14:07' } },
});

// Die Layer gehören an jedes renderbare Kind, nicht nur an die Group.
viewmodel.traverse(object => object.layers.set(1));
scene.traverse(object => {
  if (object.isLight) { object.layers.enable(0); object.layers.enable(1); }
});

const size = new THREE.Vector2();
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(size);
  post.setSize(size.x, size.y); // physische Pixel, keine CSS-Pixel
}

// state und die Vektoren wiederverwenden.
const state = {
  time: 0, angularVelocity: new THREE.Vector3(), linearVelocity: new THREE.Vector3(),
  shake: 0, muzzleFlash: 0, damage: 0, exposureHint: 0, flashlightOn: true,
};
function render(dt) {
  state.time += dt;
  // Zuerst Welt, Kamera und Waffenanimation aktualisieren.
  post.render(dt, state);
}

post.params.lens.k1 = 0.06;       // wirkt beim nächsten Frame
post.params.noise.rateHz = 30;
post.setQuality('medium');
post.overlay.connected();         // 1 s
post.overlay.disconnected();      // bis reset()/connected()
post.overlay.disconnected(2);     // alternativ 2 s
post.resetHistory();              // Teleport, Respawn, Kameraschnitt
// Beim Abbau: post.dispose();
```

Voraussetzungen: WebGL2, `EXT_color_buffer_float`, normale perspektivische Tiefenprojektion und Three.js **0.170.0**.
Logarithmische und Reverse-Depth-Renderer werden mit einer erklärenden Fehlermeldung abgelehnt.
Die Importmap muss `three` auf `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js` abbilden.
FOV, Szenenbeleuchtung, Waffenanimation und Pointer-Lock bleiben beim aufrufenden Modul. Empfohlenes Kamera-FOV: 82°.

`createBodycamPost()` liefert `render`, `setSize`, `setQuality`, `params`, `overlay` und zusätzlich `diagnostics`, `resetHistory`, `dispose`.
Die Kamera wird über eine interne Renderkamera mit erweitertem Sichtfeld abgebildet. Ihre Layer, Projektion und Transformation werden nicht geändert.
Tonemapping, Belichtung, Clear-Farbe/-Alpha, Auto-Clear, XR-Schalter, Viewport, Scissor, Render-Target, Cube-Face und Mip-Level werden nach dem Aufruf wiederhergestellt.
Ohne aktives Render-Target schreibt der Finalpass sRGB auf den Canvas. In ein bereits aktives Render-Target schreibt er lineare Farbwerte;
dessen eigener Viewport und Scissor bleiben maßgeblich. Diagnosemodi liefern Messdaten und sind für Canvas-Aufnahmen vorgesehen.

## Renderfolge

1. **Welt:** Layer 0, RGBA16F, MSAA und aufgelöste `DepthTexture`. Die Kamera bekommt den Faktor `lens.overscan` auf den Tangens des halben Bildwinkels.
2. **Viewmodel:** Layer 1, eigenes transparentes RGBA16F-Ziel mit eigenem Tiefenpuffer und MSAA. Die Tiefe der Welt beeinflusst die Waffe nicht.
3. **Bewegung:** aktuelle inverse ViewProjection und vorherige ViewProjection rekonstruieren die Bewegung einschließlich Kameratranslation.
   Die zentrierte Abtaststrecke beträgt `exposureSec / dt` mal Frame-Versatz, begrenzt auf `maxPx1080`.
   Eine relative Tiefenprüfung reduziert Farblecks an Tiefensprüngen. Danach wird das premultiplizierte Viewmodel eingeblendet.
4. **Belichtungsmessung:** standardmäßig 64 × 64, zentrumsgewichtete Log2-Luminanz der unverwaschenen Welt. Halbierung bis 1 × 1,
   RG16-Byte-Kodierung des Bereichs −16 bis +16 Log2-Luminanz in einem RGBA8-Ziel, asynchroner Readback mit 8 Hz.
   Die Waffe und das OSD beeinflussen den Messwert nicht.
5. **Bloom:** eigene HalfFloat-Down-/Upsample-Kette mit weichem Schwellwert. Die Schwelle gilt für bereits belichtete HDR-Werte;
   die steigende Flanke von `muzzleFlash` setzt genau einen Frame lang `flashThreshold` ein.
6. **Grading und OSD:** Belichtung, ACES-artige rationale Kurve, Sättigung/Wärme, Toe und kurzes Highlight-Knie mit Weißclip.
   Das sRGB-Canvas-OSD wird linear dekodiert und an dieser Stelle eingeblendet.
7. **Linse:** rektilineare Ausgangsprojektion, radiale Tonne, Overscan, kanalweise CA. Welt, Waffe und OSD nutzen dieselbe UV-Abbildung.
   Optionales Rolling Shutter sowie Schadens-/Shake-Versatz passieren hier.
8. **Sensor:** begrenzte Unsharp-Mask, zeitlich gehaltene dunkle Makroblöcke, helligkeitsabhängiges 30-Hz-Rauschen,
   Schaden/VHS, gemessene elliptische RGB-Maske und sRGB-Ausgabe.

Es werden keine Render-Targets, Materialien, Vektoren, typisierten Messpuffer oder Timer-Queries pro Frame angelegt.
Größen-/Qualitätsänderungen dürfen Ressourcen neu anlegen. OSD-Neuzeichnen erfolgt bei Inhaltsänderungen, normalerweise einmal pro Sekunde.
Three.js erzeugt intern pro **asynchronem Readback** einen PBO/Fence und ein Promise; deshalb ist dieser Vorgang auf 8 Hz begrenzt.
Es gibt keinen synchronen GPU-Readback in der Render-Schleife.

## Parameter und technische Entscheidungen

`params.js` ist die vollständige Konfiguration; verschachtelte Zahlen, Arrays, Texte und Schalter lassen sich live verändern.
Das Testpanel bietet für jedes Blatt einen Regler beziehungsweise ein passendes Eingabefeld. Zahlenfelder besitzen keine festen Min-/Max-Grenzen;
technisch erforderliche Grenzen setzt der Renderer, beispielsweise 1–32 Blur-Samples und 1–6 Bloom-Stufen.
`opts.params` ergänzt die Standardwerte. Bei Änderungen bestehende Objekte/Arrays bevorzugt in-place ändern, damit externe UI-Bindings gültig bleiben.

| Gruppe | Vorgabe / Bedeutung |
|---|---|
| `lens` | k1 0,06, k2 0,01, Overscan 1,06; Radius normiert auf halbe Bildbreite, einschließlich Seitenverhältnis |
| `lens.mask` | Achsen 0,5375 W / 0,7335 H; acht Radien und sieben RGB-Stützstellen plus `outside`; alle live editierbar |
| `osd` | 24 px Versalhöhe, links 100/95, rechter Rand 1790 bei 1920 × 1080; Skew 12°, Zeilendrehung ±3° |
| `exposure` | Szene wird dunkler: `tauDarken=0.9`; Szene wird heller: `tauBrighten=0.35`; Grenzen −2/+4 EV |
| `motionBlur` | 25 ms, 160 px bei 1080p, 10 Samples auf high; Qualitätsprofil begrenzt die Samplezahl |
| `noise` | σ dunkel 2/255, Mitte 0,8/255, hell 0,3/255; Chroma 0,4; Wechsel mit 30 Hz |
| `sharpen` | Stärke 0,5, Radius 1,2 px bei 1080p, Klemme ±0,1 im linearen Arbeitsbild |
| `blocks` | 48 px bei 1080p, nur unter Display-Luma 0,08 und über 30°/s oder bei Schaden; Mischung 0,35–0,6, Haltezeit 2–4 Frames bei 60 Hz |
| `rollingShutter` | standardmäßig aus; optional 18 ms gemäß STYLE §3.4 |
| `damage` | 0,4 s Hüllkurve, Multiply #ff4040, Wackeln und kurze zeilenweise Aussetzer |

Zusätzliche Setzungen sind bewusst separat einstellbar: Meter-Key 0,18, Messfrequenz 8 Hz, Zentrumgewicht 0,85 und Sigma 0,32;
Bloom-Stärke 0,16, Schwelle 1,0, Blitzschwelle 0,35; 80-ms-Messsperre nach Blitzen; Schaden und VHS-Amplituden.
Der Belichtungsregler ist ein analytisch integrierter zweiter Pol. `overshoot=0.15` bedeutet 15 % des **EV-Sprungs** vor der Min-/Max-Klemme.
Die Zeitkonstante folgt der Richtung der Szenenänderung und bleibt beim Überschwingen erhalten.

Die gemessene RGB-Maskentabelle hat Vorrang vor der vereinfachten GLSL-Skizze in STYLE §1.2.
Ihre Faktoren und das Sensorrauschen gelten im Display-Farbraum. Der Shader rechnet dafür in Displaywerte um und vor der finalen sRGB-Übertragung zurück in linear.
Eine direkte Multiplikation linearer Farben würde die gemessenen dunklen Ränder nach sRGB-Aufhellung verfehlen.
Außerhalb der Linse scheint eine Vierpunkt-Weichzeichnung durch; die 8 px sind der Abtastradius dieser Näherung, kein exakter Gauß-σ.
Die 8-Pixel-Ringing-Option auf high ist ein begrenztes Kosinusmodell an Kanten, kein vollständiger DCT-Encoder.
Bei den vorgegebenen 1,06 Overscan reichen einzelne äußere Eckpixel über das Quellbild hinaus; Clamp-to-edge füllt diese unter der dunklen Maske.

## State und OSD

| Feld | Verwendung |
|---|---|
| `time` | Simulationssekunden für Uhr, Noise-/Block-Takte und Effekte; ohne Angabe läuft die interne Uhr mit `dt` |
| `angularVelocity` | rad/s im Kameraraum, für Blockschwelle und Rolling Shutter; Motion Blur folgt den tatsächlichen Kameramatrizen |
| `linearVelocity` | Schnittstellenfeld des Aufrufers; die Translation wird für Blur aus den Kameramatrizen bestimmt |
| `shake` | 0–1, zusätzlicher Bildversatz |
| `muzzleFlash` | 0–1; steigende Flanke senkt Bloom-Schwelle einen Frame; solange aktiv und kurz danach keine Belichtungsmessung |
| `damage` | 0–1; startet/verlängert die kurze Schadenshüllkurve |
| `exposureHint` | optionaler additiver EV-Wert vor Min-/Max-Klemme |
| `flashlightOn` | Schnittstellenfeld; Taschenlampenlicht setzt der Aufrufer in der Welt, der Meter misst dessen tatsächlichen Einfluss |

Zeitsprünge rückwärts, Pausen über 250 ms, Projektionsänderungen, große Positions-/Rotationssprünge und Resize invalidieren die Reprojektion.
Für bewusste Kameraschnitte zusätzlich `post.resetHistory()` nutzen.

Die Schrift wird über Google Fonts geladen, mit überprüfbarem Monospace-Fallback. `await post.overlay.ready` wartet auf die Entscheidung;
`overlay.metrics.fontStatus` zeigt das Ergebnis. `startTime` ohne Zeitzone bezeichnet die ausgeschriebene Kamerazeit, unabhängig von der lokalen Browser-Zeitzone.
Datum und Uhrzeit werden mit UTC-Gettern fortgeschrieben; `dateFmt` ist in der Vorgabe `M/D/YYYY`.
Die eingestellten Koordinaten bezeichnen die tatsächlichen Glyphengrenzen **im Canvas vor der Linse**, nicht den Schatten.
CA, Tonne und Überschärfung verändern deren endgültige Ausdehnung. Beide Stufen sind in der Abnahmetabelle getrennt gemessen.
Bei anderem Seitenverhältnis skaliert die Schrift mit H/1080; der rechte Rand bleibt mit 130 × H/1080 Abstand rechts verankert.

## Testseite und reproduzierbare Abnahme

```sh
python3 -m http.server 8953 --bind 127.0.0.1 -d /Users/logge/Documents/Projects/static-pages/public
```

- `?tune=1`: sämtliche Live-Werte, JSON-Export/Download, validierter Import und Reset.
- `?spin=1`: kontinuierliche Kameradrehung.
- `?scenario=still|spin|dark|muzzle`: definierte Szenarien.
- `?paused=1&clean=1`: reproduzierbarer Zeitpunkt t=2 s ohne Bedienelemente im Screenshot.
- `?mode=raw`: Vorher-Ansicht mit Three.js-ACES, ohne Bodycam-Sensor; Welt und Viewmodel behalten getrennte Tiefenpuffer.
- `?quality=low|medium|high`: Qualitätsstufe.

Tasten: B Vorher/Nachher, P Pause, F Taschenlampe, M Blitz, X Schaden, T Parameter, 1/2/3 Qualität.
`window.postfxDemo` stellt Szene, Kamera, Renderer, State, Parameterpanel und deterministische Schritte bereit.
Ein Drehungsbild mit Historie entsteht durch `setScenario('spin'); setTime(2-1/60); step(1/60)`.
Danach ohne zusätzlichen Render-Aufruf aufnehmen, sonst entfällt die Kamerabewegung des letzten Frames.

Die automatisierten Werkzeuge liegen in `_dev/postfx/`. Playwright, Chromium, Python/Pillow/numpy sind **Testwerkzeuge** außerhalb der Laufzeit.
`PLAYWRIGHT_MODULE` und `CHROMIUM_PATH` können die lokalen Standardpfade überschreiben.

```sh
node public/bodycam-demo/_dev/postfx/check.mjs
node public/bodycam-demo/_dev/postfx/behavior.mjs
python3 public/bodycam-demo/_dev/postfx/measure.py --strict
python3 public/bodycam-demo/_dev/postfx/measure_behavior.py --strict
```

Ausgaben: `/Users/logge/Documents/Projects/bodycam-work/codex/C5/qa/`.
`check.mjs` erzeugt Szenario-/Diagnose-PNGs und `results.json`; `behavior.mjs` prüft kontrollierte Luminanzsprünge, Blur und Noise.
`measure.py` misst die PNGs gegen STYLE/Formeln, schreibt `measurements.md/.json` und `reference-contact.jpg` aus Referenzen 01/45/37/28.
Der Kontaktbogen ist eine Kontrolle unterschiedlicher Szenen; es wird kein Bildähnlichkeitswert behauptet und kein Look nach Gefühl verändert.

Die GPU-Messung verwendet `EXT_disjoint_timer_query_webgl2`: Welt- und Waffen-Rasterisierung liegen außerhalb, sämtliche Post-Pässe einschließlich
der anstehenden Meter-Reduktion innerhalb der Query. Ergebnisse werden später ohne Warten abgeholt. `diagnostics.gpu.snapshot()` gibt Median,
Mittel, p95 und Maximum aus. Ohne Extension bleibt die GPU-Zeit ausdrücklich nicht verfügbar; CPU-Aufrufzeit ist kein Ersatz dafür.
Aktuelle Zahlen, Pixelwerte und bekannte Grenzen stehen in `status/C5.md`.

Quellprüfung der verwendeten Three.js-Schnittstellen:
[WebGLRenderer r170](https://raw.githubusercontent.com/mrdoob/three.js/r170/src/renderers/WebGLRenderer.js) und
[WebGLTextures r170](https://cdn.jsdelivr.net/npm/three@0.170.0/src/renderers/webgl/WebGLTextures.js).

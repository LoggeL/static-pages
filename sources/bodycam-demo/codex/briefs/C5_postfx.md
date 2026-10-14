# Auftrag C5: Post-FX-Gerüst „Bodycam“ (Port 8953)

**Deine Dateien:** `public/bodycam-demo/js/postfx/**`, `public/bodycam-demo/_dev/postfx/**`, `sources/bodycam-demo/POSTFX.md`, `sources/bodycam-demo/status/C5.md`.

Schnittstelle laut CONTRACT: `createBodycamPost(renderer, scene, camera, opts) → { render(dt, state), setSize(w,h), setQuality(q), params, overlay }`.
Alle Zahlen aus `research/STYLE.md` §1–3, §6, §9, §10 (`BODYCAM_STYLE`). **Jeder Parameter live einstellbar** (`post.params`, plus
`?tune=1` öffnet ein schlichtes Regler-Panel auf der Testseite, das die Werte als JSON exportiert). Claude stimmt den Look später ab.

Pipeline (WebGL2, HalfFloat, keine Allokation pro Frame):
1. Welt (Layer 0) in HDR-RT mit DepthTexture (MSAA). Viewmodel (Layer 1) separat in eigenes RT (transparent), danach drübergelegt,
   damit die Waffe keinen Kamera-Motion-Blur bekommt und nicht in Wände clippt.
2. Kamera-Motion-Blur per Reprojektion (Tiefe + inverse/vorherige ViewProjection), Belichtungszeit `motionBlur.exposureSec`, max px, Samples.
3. Auto-Belichtung: zentrumsgewichtete Log-Luminanz per Downsample-Kette, asynchroner Readback (`readRenderTargetPixelsAsync`),
   Adaption mit `exposure.tauDarken/tauBrighten`, Grenzen minEV/maxEV, Overshoot.
4. Bloom (UnrealBloomPass oder eigene Kette), Schwelle relativ zur Belichtung; Mündungsfeuer senkt die Schwelle für 1 Frame.
5. Final-Shader: Belichtung → Tonemapping + Grading (`grade`) → rektilinear + leichte Tonne (k1, k2, Overscan) → CA (R/B radial) →
   OSD vor der CA einmischen (gleiche verzerrte UV) → Überschärfen mit Halo-Klemme → Makroblöcke in dunklen Flächen bei schneller Drehung
   (`blocks`) → Sensorrauschen helligkeitsabhängig, 30 Hz (`noise`) → elliptische Linsenmaske mit RGB-Farbsaum (Tabelle in STYLE §1.2,
   GLSL-Vorlage dort) → sRGB.
6. OSD-Canvas exakt nach STYLE §2.3/§2.1: links `BWC-4 X60A1972 ▶`, rechts `M/D/YYYY  HH:MM:SS  REC`, Positionen @1080 skaliert, Schrift
   „Share Tech Mono“ (Google Fonts) mit 12° Neigung, Schlagschatten, ±3° Wölbung. Startzeit per Parameter. `CAM CONNECTED` (grün, 1 s) und
   `CAM DISCONNECTED` mit VHS-Streifen als aufrufbare Effekte.
7. `state`: `angularVelocity, linearVelocity, shake, muzzleFlash, damage, flashlightOn` wie im CONTRACT. Treffer/Schaden: kurzes Wackeln + Bildaussetzer.
8. Qualitätsstufen low/medium/high (Renderskalierung, Samples, Bloom-Stufen).

Testseite `_dev/postfx/`: eigene Testszene (Raum mit Kisten, Punktlichter, Spot als Taschenlampe, rot/blaues Blinklicht, Text-Tafel für Schärfe,
gerade Linien für Verzerrung), `?spin=1` simuliert Drehung, Vorher/Nachher-Umschalter.
Abnahme: Screenshots ruhig/Drehung/Dunkel/Mündungsfeuer; Nachweis per Messung, dass Maskenprofil, OSD-Positionen und Verzerrung den STYLE-Werten
entsprechen (Pixelmessung am Screenshot, Tabelle in der Statusdatei); Frame-Zeit bei 1920×1080 auf high gemessen (Ziel < 6 ms für die Post-FX).
Vergleich mit Referenzframes unter `$WORK/ref/frames/` als Kontaktbogen beilegen (nur als Kontrolle, nicht „nach Gefühl“ nachregeln).

# C21: Dateiendungen der Texturen bereinigen

**Ausgangslage:** C7 hat 80 von 88 Texturbildern in WebP umkodiert, aber die Endungen `.jpg`/`.png` behalten (`status/C7.md`, Abschnitt
zur Endungsumstellung). Das funktioniert in Chromium nur über Content-Sniffing. GitHub Pages liefert den MIME-Typ nach Endung aus.

**Aufgaben:**
1. Alle Dateien, deren Inhalt WebP ist, auf `.webp` umbenennen (in `textures/`, `lightmaps/` und sonst überall unter
   `public/bodycam-demo/`, außer `audio/`). Bilder, die wirklich JPEG oder PNG sind, behalten ihren Namen. Inhalte bleiben bytegleich.
2. **Alle Verweise** konsistent anpassen: `textures/index.json`, `data/level.json`, Lightmap-Metadaten, JS-Lader und Materiallogik
   (`js/world/materials.js`, `lightmaps.js`, `decals.js`, …), `_dev/*`-Seiten, Optimierungs- und Bake-Skripte
   (`tools/optimize/`, `blender/bake_*`), damit ein künftiger Neulauf direkt `.webp` erzeugt.
   In GLBs eingebettete Bilder haben einen eigenen `mimeType`. Prüfen, ob er stimmt, und ihn gegebenenfalls korrigieren, ohne die
   Geometrie oder die `sharedImageBuffers`-Offsets zu verändern (`bake_validate.py` muss grün bleiben).
3. Prüfskript `sources/bodycam-demo/tools/check_mime.py`: Es vergleicht für jede ausgelieferte Bilddatei die Magic Bytes mit der Endung,
   prüft alle Verweise in JSON und JS auf Existenz und beendet sich mit Exit ≠ 0 bei Abweichungen.
4. **Abnahme:** App und `_dev/textures`, `_dev/lightmaps`, `_dev/world`: 0 Konsolenfehler, 0 fehlgeschlagene Requests, Screenshots
   vorher/nachher pixelgleich (bzw. Differenz ≈ 0). Zusätzlich einen Server testen, der den Content-Type strikt nach Endung setzt,
   so wie GitHub Pages.

**Port:** 8970. **Dateien:** `textures/`, `lightmaps/`, `data/level.json`, `js/world/materials.js`, `lightmaps.js`, `decals.js`,
`baked-level.js`, `world.js` (nur Pfade), `js/core/loaders.js` (nur falls nötig), `_dev/textures`, `_dev/lightmaps`, `_dev/world`,
`tools/optimize/`, `blender/bake_*`, neues `tools/check_mime.py`, `status/C21.md`.
**Nicht anfassen:** `js/world/lighting-config.js`, `js/weapon/*`, `js/postfx/*`, `js/fp/*`, `js/app/*` (C18 und Claude arbeiten dort).

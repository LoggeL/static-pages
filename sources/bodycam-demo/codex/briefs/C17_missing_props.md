# C17: Die neun fehlenden Props in Blender bauen

**Ziel:** Neun Prop-Typen fehlen, deshalb bleiben zehn Plätze in `layout.json` leer:
`toilet`, `bathtub`, `bath_vanity`, `mirror_cabinet`, `washing_machine`, `dryer`, `water_heater`, `tree_dead`, `bush_dead`.
Baue sie im Stil und Qualitätsniveau der vorhandenen Props, als glaubwürdige US-Vorstadt-Ausstattung der 1980er–2000er.
Sie sollen abgewohnt aussehen und keine Marken tragen.

**Vorbild:** Vorhandene Pipelines in `sources/bodycam-demo/blender/props_kitchenbath_*.py` und `props_clutter*.py`, `models/props/catalog.json`,
die Material-Konvention aus CONTRACT.md (`M_<textureId>`, UV in Weltmetern, `extras.surface`) und die Texturen in `textures/index.json`.
Lies die Platzdefinitionen dieser Typen in `sources/bodycam-demo/blender/layout.json`. Die Maße müssen in die dort vorgesehenen Nischen
und Raumgrößen passen, Rotation und Ursprung nach Vertrag (Ursprung am Boden mittig, Vorderseite Blender −Y).

**Qualitätsvorgaben:**
- Echte Maße: Toilette etwa 0,38 × 0,70 × 0,76 m (mit Spülkasten), Badewanne 1,52 × 0,76 × 0,50 m, Waschtisch 0,76–0,92 m breit
  und 0,84 m hoch, Spiegelschrank etwa 0,60 × 0,13 × 0,75 m (Wandmontage, der Ursprung sitzt an der Wand laut Layout-Höhe), Waschmaschine und
  Trockner Toplader bzw. Frontlader etwa 0,69 × 0,71 × 0,91–1,07 m, Boiler stehend Ø 0,50–0,56 m und 1,4–1,5 m hoch.
- Fasen und Abrundungen an sichtbaren Kanten, keine nackten Würfel. Porzellan glänzend, Email leicht angegriffen, Kalk und Rost über
  Vertex-Farbe oder Masken, wo es die vorhandenen Materialien hergeben. Spiegel als eigenes Material mit `extras.surface = "glass"`.
- Toter Baum: 4–6 m hoch, astig und unbelaubt, aus mehreren Zylindersegmenten mit Rinde. Toter Busch: etwa 1 m, verzweigt, braun.
  Low-Poly mit vernünftiger Silhouette, Budget unter 6k Dreiecke pro Pflanze, Innen-Props unter 8k.
- Kollisionsgeometrie wie bei den vorhandenen Props, Oberflächen-Tags für Einschlageffekte (`ceramic` bzw. `porcelain` gibt es nur,
  wenn die Surface-Liste in CONTRACT.md es vorsieht, sonst `metal`, `wood` oder `plastic`).

**Ausgabe:**
- `sources/bodycam-demo/blender/props_missing.py` (ein Skript, headless, erzeugt alle neun).
- `public/bodycam-demo/models/props/<typ>.glb`, Einträge in `models/props/catalog.json` ergänzen (bestehende Einträge nicht ändern).
- Eine Vorschau-Kontaktbogen-PNG unter `$WORK/codex/C17/` (alle neun Props, Blender-Render mit Maßstab). Sieh sie dir an und bessere nach.

**Nur diese Dateien:** das neue Skript, die neun neuen GLBs, ergänzte Zeilen in `catalog.json`, `status/C17.md`. Keine bestehenden GLBs
anfassen (sonst brechen die Byteoffsets der C6-Lightmap-Assembly). `js/world/available-props.js` **nicht** ändern, das macht C14.

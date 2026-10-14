# Auftrag C7: Asset-Optimierung (Port 8957), läuft als letzter Auftrag

**Deine Dateien:** `sources/bodycam-demo/tools/optimize/**`, Ausgaben unter `public/bodycam-demo/models/` und `textures/` (Originale vorher nach
`$WORK/codex/C7/originals/` sichern), Lader-Anpassung nur in einer neuen Datei `public/bodycam-demo/js/core/loaders.js`
(GLTFLoader mit MeshoptDecoder/KTX2Loader-Konfiguration), `sources/bodycam-demo/status/C7.md`.

- Bestandsaufnahme: Größen aller GLBs/Texturen/Lightmaps, Dreiecke, Texturauflösungen (Tabelle).
- GLB: gltf-transform (per npx) mit Meshopt-Kompression, Quantisierung, Texturen in eingebetteten GLBs nach WebP/KTX2, Dedup/Prune.
  Kacheltexturen: KTX2 (UASTC für Normal, ETC1S für Albedo/ORM) **oder** WebP, je nachdem was sichtbar verlustärmer ist; Vergleichsbilder ansehen.
- Ziel: `public/bodycam-demo` ohne `audio/` ≤ 60 MB, Ladezeit lokal messen (vorher/nachher). Alle Lader-Pfade bleiben gleich oder werden in `loaders.js`
  zentral umgestellt; prüfe, dass `_dev/world`, `_dev/weapon`, `_dev/lightmaps` und die App danach fehlerfrei laden (Screenshots vorher/nachher).
- Ein Skript `tools/optimize/run.sh`, das die Optimierung reproduzierbar aus den Originalen erzeugt.

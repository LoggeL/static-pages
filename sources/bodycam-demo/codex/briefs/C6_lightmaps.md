# Auftrag C6: Lightmap-Bake-Pipeline + Kollisionsmesh (Port 8956), startet nach C12

**Deine Dateien:** `sources/bodycam-demo/blender/bake_*.py`, `sources/bodycam-demo/blender/lighting_bake.json`,
`public/bodycam-demo/models/house.glb`, `models/house_collision.glb`, `public/bodycam-demo/lightmaps/**`, `public/bodycam-demo/data/level.json`,
`public/bodycam-demo/_dev/lightmaps/**`, `sources/bodycam-demo/status/C6.md`.

- Eingaben: `$WORK/blend/house_shell.blend` (bzw. `blender/house_shell.py` erzeugt sie neu), Props `models/props/*.glb`, Platzierung `blender/layout.json`
  (Blender-Koordinaten direkt verwendbar), Decals aus `layout.decals`.
- Szene in Blender zusammenbauen (Haus + Möbel laut layout), statische Geometrie pro Raum/Material zusammenführen (wenige Draw-Calls),
  Türen getrennt lassen (beweglich, nicht in die Atlanten).
- Lichtsetzung **nur als Parameterdatei** `lighting_bake.json` mit neutralem Standard: Mond (kühl, schwach, Richtung aus Parameter), Nachthimmel,
  Natriumdampf-Laterne (`layout.lights.streetlight`), Veranda-Lampe aus, Küche eine schwache Glühbirne, kein Blaulicht (dynamisch in der Engine).
  Claude legt die Stimmung später fest; der Bake muss mit einem Befehl reproduzierbar sein.
- Zweites UV-Set (Lightmap-Pack mit Rand), Cycles-Bake (Metal) Diffuse direkt+indirekt, Denoise, Atlanten 2048, Encoding RGBM (PNG) oder
  8-bit mit Skalierung; Dekodierformel und Zuordnung in `data/level.json` (`lightmapEncoding`, je Mesh `lightmap`, `lightmapIntensity`) **und** als glTF-Extras.
- Exporte: `house.glb` (Material-Konvention `M_<id>` ohne eingebettete Kacheltexturen, TEXCOORD_1 für Lightmap), `house_collision.glb`
  (vereinfachte Boxen/Hüllen, Möbel grob, Stufen als Rampen, Türen als `DOOR_*`-Kollider, Extras `surface`), `level.json` laut CONTRACT
  (playerSpawn, npcs aus `layout.suspects`, rooms, doors, lights, fog, lightmapEncoding).
- Größenbudget Lightmaps ≤ 40 MB. Testseite `_dev/lightmaps/` (lädt house.glb + Texturen nach Konvention + Lightmaps, `?cam=x,y,z,yaw,pitch`).
  Abnahme: Screenshots aus ≥ 10 Positionen, keine Nähte, Lecks, Schwarzflecken oder falsch zugeordneten Atlanten; Bake-Zeit und Größen dokumentiert.

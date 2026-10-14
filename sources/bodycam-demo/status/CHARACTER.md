# CHARACTER · Status (Lauf 3, laufend aktualisiert)

## Fertig (aus Lauf 1/2)
- Base-Mesh: Blender "Human Base Meshes" v1.4.1, "Body Male - Realistic" (CC0), $WORK/character/dl/
- Stages: prep.blend, rig.blend, garments.blend unter $WORK/character/stages/
- Skripte: sources/bodycam-demo/blender/character.py + character_lib/ (prep, rig, joints, garments, gutil, posing, posetest, preview)

## Gerade
- Stages gear/materials/assemble/export schreiben -> officer.blend + officer.glb so früh wie möglich

## Nächste Schritte
- Verfeinern (Materialien, Falten, Gewichte), Renderprüfung

## C10 abgeschlossen (2026-10-14)

Status: **done**. Technischer Abschluss und vollständiger Prüfbericht: [C10.md](C10.md).

- `public/bodycam-demo/models/officer.glb`, 11.711.344 Bytes, A-Pose, 67 unveränderte Knochen, keine Animationen, ein Skin, 2048er Albedo-/ORM-/Normalatlas eingebettet.
- Blender-Artefakt: `/Users/logge/Documents/Projects/bodycam-work/codex/C10/blend/officer.blend`, verwendete Texturen gepackt. Neue Zwischenstufen/Renderings ausschließlich im C10-Arbeitsordner; ursprüngliche Stages bleiben erhalten.
- Pipeline `character.py -- finish` ergänzt: Materialien, Bake, starre Knochenbindung, Gewichtsreparatur, Zusammenbau, geprüfter Export, Pose-Qualifizierung. Details und exakte Befehle in C10.md.
- Gewichte normalisiert und auf vier Einflüsse begrenzt. Kopf-, Finger-/Ärmel- und Torso-Band-Fehler repariert; Armheben zieht das Westenband nicht mehr auseinander. Untere Hosenbein-Normalen korrigiert.
- `_dev/character/`: echte GLB, sechs Posen, Skelett, Gewichtsfarben, Drahtgitter und 1,40-m-Brustkamera. WebGL2/Metal ohne Konsolenfehler getestet; Blender-/Browser-Deformation numerisch abgeglichen.
- Alle 16 Skin-Meshes gemessen und Posebilder angesehen. Keine gemessenen Hemd/Platten- oder Hose/Holster-Durchdringungen. Lokale Finger-/Stoffkontakte und LBS-Volumenverlust bleiben dokumentierte Grenzen; kein allgemeiner Kollisionsfrei-Nachweis.
- Für ANIM das C10-Blender-Artefakt bzw. `officer.glb` verwenden. Look/Farben/Ausrüstungsgeometrie aus den vorhandenen Rezepten erhalten, kein neues Design. Kein Git-Commit, kein Build und keine Veröffentlichung.

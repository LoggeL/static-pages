# Auftrag C10: Charakter, technischer Export (Port 8959)

**Deine Dateien:** `sources/bodycam-demo/blender/character.py`, `sources/bodycam-demo/blender/character_lib/**`, `$WORK/character/**`,
`$WORK/blend/officer.blend`, `public/bodycam-demo/models/officer.glb`, `public/bodycam-demo/_dev/character/**`, `sources/bodycam-demo/status/CHARACTER.md` (fortschreiben).

- Stand: `status/CHARACTER.md` lesen. Stufen `prep → rig → garments → gear` existieren unter `$WORK/character/stages/`; es fehlen u. a.
  Materialien/Bake, Zusammenbau, Export.
- Die Pipeline technisch zu Ende bringen: Ausrüstung starr an passende Knochen, Skin-Gewichte prüfen und reparieren (Ellbogen, Handgelenk,
  Finger, Schultern; keine Gewichte > 4 Einflüsse, normalisiert), Knochennamen laut CONTRACT/Status stabil, Materialien in Atlanten backen
  (2048, albedo/ORM/normal) aus den vorhandenen Rezepten, Export `officer.glb` (Skin, A-/T-Pose, keine Animation) + `officer.blend`.
- Automatische Prüfung: Testposen (Faust, Pistolengriff, Arme vorn, Hocke, Blick nach unten aus 1,40 m Brusthöhe) rendern, Durchdringungen und
  Kollaps per Messung (z. B. Volumenverlust, Mesh-Selbstüberschneidung grob) und Sichtprüfung dokumentieren.
- Testseite `_dev/character/`: lädt officer.glb, Skelett-Helfer, Pose-Umschalter. Größe ≤ 12 MB.
- Look (Stoffe, Farben, Ausrüstungsdesign) nicht neu gestalten: bestehende Entscheidungen beibehalten, nur technisch abschließen.

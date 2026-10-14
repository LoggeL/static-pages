# Status SHELL (Haus-Rohbau) – Lauf 3

Stand: 2026-10-14, Iteration 2 (erste vollständige Version steht).

## Fertig
- `blender/shell_lib.py` (Geometrie-Helfer; neu: world_uv mit Maserungsausrichtung `grain`)
- `blender/house_shell.py` – Generator, läuft in ~3 s: `blender -b -P house_shell.py -- [--blend X] [--layout Y] [--glb Z]`
- `blender/house_shell_preview.py` – Cycles-Vorschau mit Texturen (nur Vorschau, speichert nicht):
  `blender -b $WORK/blend/house_shell.blend -P house_shell_preview.py -- --views plan,hall,liv,kit,bed2,ext_day,ext_night`
- `blender/layout.json` – Räume, Türen, Fenster, Möbelanker, Decals, Spawn, Verdächtige
- `$WORK/blend/house_shell.blend` (~163 Objekte, ~75k Dreiecke)
- `blender/shell_tex/chainlink.png` (MU_chainlink, Maschendraht-Alpha, 1 Kachel = 1 m)

## In Arbeit
- Detail-Iteration: Steckdosen/Schalter, Lüftungsgitter, Rauchmelder, Dachbodenluke, Sicherungskasten; Teppichlasche; Feinschliff.

## Grundriss (Blender-Koordinaten, Z-up, Meter)
- Außenmaß x[-6.5, 6.5], y[0, 10]; Front (Straße) = −Y. Boden (FFL) z=0.60, Decke z=3.20, Gelände am Haus z=0.
- Räume: LIV x[-6.3,-1.0] y[0.2,5.0]; KIT x[-6.3,-1.0] y[5.12,9.8]; HAL (L-Form: Längsflur x[-0.88,0.32] y[0.2,8.0] + Querflur x[0.32,6.3] y[4.4,5.5]);
  BED1 x[0.44,6.3] y[0.2,4.28] (mit Einbauschrank CLO1); BATH x[0.44,2.58] y[5.62,8.0]; BED2 x[2.70,6.3] y[5.62,9.8]; UTIL x[-0.88,2.58] y[8.12,9.8].
- Veranda x[-3.1,2.1] y[-2.4,0], Deck z=0.57, Treppe 3 Steigungen. Straße y[-17.6,-10.4] z≈-0.25, Gehweg y[-9.2,-7.7] z=-0.10.

## Übergabe (ASSEMBLY)
- Materialien `M_<textureId>` ohne Bildtexturen (baseColor-Fallback, Custom Prop `textureId`). Zusätzliche ohne Textur: M_insulation, M_wire, M_metal_galv,
  M_metal_dark, M_rubber_black, M_porcelain, M_paint_red, M_paint_yellow_road, M_void, M_glass_dirty; Unikat MU_chainlink (gepackte PNG, Alpha-Clip); ME_sodium, ME_window_warm.
- UV in Weltmetern (Objekte am Ursprung; Türen lokal, ebenfalls Meter). Fassade `EXT_siding` mit v = z exakt: Lattenkanten bei z = k·0,2 passen zur Textur (tile 1,6 m, 8 Latten).
- Türen `DOOR_<id>`: Ursprung = Scharnierachse (unten). Props: hinge, openAngle, openDir, closedRotZ, maxAngle → rotZ = closedRotZ + openDir·Winkel.
- Kein Lightmap-Bake (macht ASSEMBLY).

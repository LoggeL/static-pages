# Auftrag C12: Welt-Lader + Spieler-Physik + Eingabe (Port 8951)

**Deine Dateien:** `public/bodycam-demo/js/core/**`, `js/world/**`, `js/player/**`, `public/bodycam-demo/_dev/world/**`,
`sources/bodycam-demo/status/C12.md`, `sources/bodycam-demo/ENGINE.md` (Abschnitte Welt/Spieler).

## Welt-Lader (`js/world/`)
- `models/house_shell.glb` laden (Rohbau, glTF Y-up, Materialien `M_<textureId>` ohne Bilder, Mesh-Extras `surface`, Türen `DOOR_*`
  mit Extras `hinge, openAngle, openDir, closedRotZ, maxAngle`; Ursprung der Tür = Scharnierachse).
- Materialien: `M_<id>` → `MeshStandardMaterial` mit `textures/<id>/{albedo,normal,orm}.jpg` aus `textures/index.json`
  (`repeat = 1/tileMeters`, Wrap, Anisotropie, sRGB nur Albedo, ORM → ao/roughness/metalness). Materialien pro ID teilen.
  `M_*` ohne Textur: glTF-Farbe behalten. `ME_*` emissiv, `M_glass*` transparent, `MU_*` mit eingebetteter Textur (Alpha-Test bei Maschendraht).
- Möbel: `sources/bodycam-demo/blender/layout.json` → `furniture` je Raum. Blender-Koordinaten `(x, y, z)` → three `(x, z, −y)`,
  `rotZ` (Grad) → `rotation.y` (rad). GLBs aus `models/props/<prop>.glb` (einmal laden, klonen). Fehlende Props (z. B. toilet, bathtub,
  washing_machine, tree_dead) als Liste loggen und in der Statusdatei aufführen; Platzhalter optional, standardmäßig aus.
  `layout.json` nach `public/bodycam-demo/data/layout.json` kopieren und von dort laden (die Quelle bleibt in sources/).
- Decals aus `layout.decals` (Textur `textures/decals/<id>.png`, Größe, Normale, Rotation; polygonOffset).
- Lichter-Platzhalter: neutrale Nachtbeleuchtung (schwaches Mondlicht, Natriumdampf-Laterne laut `layout.lights.streetlight`).
  Alle Lichtwerte in `js/world/lighting-config.js` als Parameter (Claude stimmt später ab).
- API: `export async function loadWorld(scene, { onProgress }) → { colliders, shootables, doors, rooms, surfaceAt(point), spawn, policeCar, suspects }`.
- Oberflächen: `surfaceOf(object)` über Extras in der Elternkette, sonst aus dem Materialnamen abgeleitet.

## Spieler (`js/player/`)
- Kapsel (Radius 0,3, Höhe 1,8) mit three-mesh-bvh-Shapecast gegen einen zusammengeführten statischen Collider plus bewegliche Türen
  (eigene BVHs, in lokalem Raum testen). 3–5 Substeps, Schwerkraft, Bodenkontakt, Stufen der Veranda (Steigung 0,19 m) müssen gehen,
  kein Durchrutschen an Wandecken und Türzargen.
- Geschwindigkeiten: Schleichen 1,0 (Alt), Gehen 1,5, Sprint 4,5 m/s (Shift), Ducken (C/Strg) mit niedrigerer Kapsel. Lehnen Q/E (0,3 m seitlich, 10° Roll).
- Kamera: Brusthöhe 1,40 m über Boden, 4° nach unten, vFOV 82° (STYLE §1/§4). Maus-Trägheit mit Zeitkonstante ~60 ms.
  Kamerawackeln beim Gehen nach STYLE §4.2 (Pitch mit Schrittfrequenz, Yaw/Roll mit halber Frequenz, Werte aus `BODYCAM_STYLE.bob`)
  als **eigenes Modul mit Parametern** (`js/player/bob.js`).
- Schritt-Events: pro Schritt `onStep({ surface, speed })` (Oberfläche per Abwärts-Raycast). Raum-Erkennung über `layout.rooms` (aabb) → `onRoomChange(room)`.
- Türen: E öffnet/schließt die Tür im Blick (≤ 2 m), animiert um das Scharnier, Kollision folgt.
- Eingabe: Pointer Lock, Tasten WASD, Shift, Alt, C/Strg, Q/E, E, R, F, B, V, LMB, RMB, Esc als Event-Bus `js/core/input.js` (andere Module abonnieren).
- Debug: `?debug=1` erlaubt Steuerung ohne Pointer Lock; `window.__bodycam = { teleport(x,y,z,yawDeg,pitchDeg), look(yawDeg,pitchDeg), stats(), player }`.

## Testseite
`_dev/world/index.html`: lädt Welt + Spieler, einfaches Rendering ohne Post-FX, Spawn laut `layout.playerSpawn`.
Abnahme: Screenshots von ≥ 8 Positionen (außen am Spawn, Veranda, Flur, jeder Raum), Konsole fehlerfrei, Draw-Calls und FPS gemessen,
ein automatisierter Lauf (Tasten per Playwright), der die Treppe hoch und durch die Haustür in den Flur geht (Positionslog als Nachweis).

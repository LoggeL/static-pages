# C18: Arme in der Ich-Perspektive, technisch (Rig, IK, Clip-Infrastruktur)

**Ausgangslage:** `models/officer.glb` (C10, 67 Knochen, A-Pose, keine Clips, Details in `status/C10.md`). Die Waffe `carbine.glb`
hat die Hand-Ziele `W_Grip_R` und `W_Grip_L`. Viewmodel, Haltung und Trägheit liegen in `js/weapon/weapon.js`, `poses.js` und `sway.js`;
Schnittstelle und Zustände in `status/C9.md`, `C3.md` sowie im Nachtrag vom 14.10. in `NOTES.md`. CONTRACT §First-Person ist verbindlich
(Clipnamen, `FP_*`-Knoten, `data/fp_anim.json`).

**Aufgaben:**
1. **FP-Modell:** Aus `officer.blend` (`$WORK/../C10/blend/`) per Blender-Skript `models/officer_fp.glb` ableiten: nur Arme, Hände,
   Ärmel und Handschuhe (Rumpf, Kopf und Beine entfernen bzw. nicht exportieren), Knochen von Schultern bis Fingern. Knoten `FP_Root`,
   `FP_Camera`, `FP_WeaponSocket` laut CONTRACT. Skript reproduzierbar unter `sources/bodycam-demo/blender/officer_fp.py`.
   Dreiecksbudget ≤ 40k, Texturen aus dem vorhandenen Atlas (verkleinern ist ok, Look nicht verändern).
2. **Laufzeit-Modul `js/fp/arms.js`:** Lädt `officer_fp.glb` über `js/core/loaders.js`, hängt die Arme in dieselbe Viewmodel-Ebene wie die
   Waffe (eigenes Render-Target, gleiche Kamera, kein Clipping in Wänden), folgt Haltung **und** Trägheit der Waffe.
   Zwei-Knochen-IK (Oberarm/Unterarm, Pol-Vektoren für die Ellbogen als Parameter) setzt die Handknochen auf `W_Grip_R`/`W_Grip_L`,
   inklusive Handrotation. Beim Nachladen muss die linke Hand von `W_Grip_L` lösbar sein und frei einem Ziel folgen können
   (z. B. `W_MagWell`, Magazin, Gürtel); dafür eine API wie `arms.setHandTarget('L', object3D | null, blend)`.
   Fingerhaltung pro Hand als Pose-Preset (Griff, Abzug am Finger, offen), überblendbar.
3. **Clip-Infrastruktur:** `AnimationMixer` mit Ebenen (Basis, Additiv) und Zustandsübergängen, gesteuert von den Ereignissen der
   Waffenlogik (`js/weapon/events.js`: Schuss, Nachladen leer/teilvoll, Zielen rein/raus, Licht, Sprint). Fehlende Clips sind der
   Normalfall (es gibt noch keine): Dann bleibt die IK-Haltung aktiv, ohne Fehler. `data/fp_anim.json` mit leerer Event-Tabelle
   nach CONTRACT anlegen und einlesen; Events feuern ins Audio (Schnittstelle aus `status/C4.md`).
4. **Parameter** (Ellbogen-Pole, Schulter-Offset, Fingerposen, Überblendzeiten) in `js/fp/arms-config.js`. Das Gefühl der Bewegung
   stimmt später Claude ab. Werte nur so setzen, dass nichts verdreht oder durchdringt.
5. **Prüfseite** `_dev/fp/` (Arme + Waffe, Schalter für Haltungen, IK-Ziele sichtbar) und Einbau in die App über einen schmalen Hook in
   `js/app/runtime.js` (Schalter `?arms=0` für den alten Zustand).
6. **Abnahme:** Screenshots Low-Ready, ADS, Nachladen (linke Hand am Magazinschacht), schnelle Drehung, Blick nach unten. Keine
   Konsolenfehler, Hände sitzen sichtbar am Griff (Abstand Handknochen ↔ Ziel < 5 mm messen und ausgeben), FPS wie vorher.

**Port:** 8967. **Dateien:** `js/fp/*` (neu), `models/officer_fp.glb`, `data/fp_anim.json`, `_dev/fp/*`, `blender/officer_fp.py`,
`js/app/runtime.js` (nur Einbau-Hook), in `js/weapon/weapon.js` nur ein lesender Zugriff auf Viewmodel-Szene und Knoten (falls nötig eine
kleine Getter-Funktion), `status/C18.md`.
**Nicht anfassen:** `js/weapon/sway.js`, `poses.js`, `effects-config.js`, `config.js`, `js/world/lighting-config.js`, `js/postfx/*`
(Claude stimmt dort parallel Licht und Look ab). Keine Dateiumbenennungen in `textures/`/`lightmaps/` (macht C21 parallel).

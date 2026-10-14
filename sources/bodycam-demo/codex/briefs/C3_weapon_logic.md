# Auftrag C3: Waffenlogik (Port 8955), startet nach C12

**Deine Dateien:** `public/bodycam-demo/js/weapon/**`, `public/bodycam-demo/_dev/weapon/**`, `sources/bodycam-demo/status/C3.md`.
Nutze die Module aus C12 (`js/core`, `js/world`, `js/player`), ohne sie zu ändern.

- Viewmodel: `models/carbine.glb` (Knoten: `W_Root` Ursprung Griff, `W_SightEye`, `W_Muzzle`, `W_LightEmitter`, `W_Mag`, `W_Ejection`;
  Lauf zeigt −Z). Als Kind der Kamera in **Layer 1** (eigene Ebene, damit Post-FX es getrennt rendern kann). Posen `lowReady`, `ads`,
  `sprint` als Transform-Parameter in `js/weapon/poses.js`. ADS legt `W_SightEye` auf den Kamerapunkt (STYLE §5.2). Werte für Low-Ready
  nach STYLE §5.1 (Mündung zeigt auf Bildpunkt (0,52; 0,55)). Rechne die Pose daraus aus, statt zu raten, und dokumentiere die Rechnung.
- Zustandsautomat: idle, lowReady, ads (Ein 0,28 s / Aus 0,22 s), fire, reload (3,7 s), reloadEmpty (2,9 s), inspect, sprint.
  30+1 Patronen, 4 Ersatzmagazine, Feuermodi Einzel/Auto (B), 650 Schuss/min, Trockenklick bei leer.
- Rückstoß als Feder-Dämpfer (ω 18, ζ 0,55) mit den Impulsen aus STYLE §6.2; Kamera bekommt 35 % (Event an Spieler/Post-FX).
- Treffer: Ray ab `W_Muzzle` in Laufrichtung gegen `shootables` (BVH, firstHitOnly), Ergebnis `{ point, normal, surface, object }`.
- Effekte als **austauschbare Hooks** mit einfachen Standard-Implementierungen: Mündungsfeuer (2 Frames, PointLight #ffb060, abklingend
  mit τ 15 ms, Sprite), Hülsenauswurf (Pool, `models/casing_556.glb`, einfache Physik, Abprall, Event mit Oberfläche),
  Einschlag (Decal `bullet_hole_<surface>` per DecalGeometry, Staub/Funken-Partikel als Pool), Waffenlicht F (SpotLight an `W_LightEmitter`,
  angle 24°, penumbra 0,75, Schatten 1024, zweiter Streu-Spot 40°/4 %).
- Nachladen ohne Arme vorerst prozedural: `W_Mag` raus/rein nach den Zeitmarken aus `BODYCAM_STYLE.reload`, Waffe kippt leicht.
  Alle Zeitmarken als Events (`magOut`, `magIn`, `boltRelease`, `shot`, `dryFire`, `casingHit`, `impact`) über einen Event-Bus für Audio/Post-FX.
- Testseite `_dev/weapon/`: Welt + Spieler + Waffe; `window.__bodycam.weapon = { fire(n), reload(), ads(on), light(on), state() }`.
  Abnahme: Screenshots Low-Ready, ADS (Absehen mittig), Mündungsfeuer, Einschläge auf Holz/Putz/Metall, Hülsen am Boden, Nachladen in der Mitte.

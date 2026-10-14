# Status WEAPON (Lauf 3)

## Fertig
- `sources/bodycam-demo/blender/weapon_geo.py` (Geometrie-Helfer), `weapon_parts.py` (alle Bauteile, mm-Rahmen) – aus Lauf 2.

## In Arbeit
- `blender/weapon.py` (Treiber: Bau, Hierarchie, Empties, UV, Bake, Export) – Geometrie-Testlauf.

## Nächste Schritte
1. Erste vollständige carbine.glb + carbine.blend exportieren (ANIM braucht sie).
2. Prozedurale Materialien + Atlas-Bake verfeinern, Previews, Three.js-Testseite.


## C9 abgeschlossen (2026-10-14)

Aktueller Stand: **done**. Der vorstehende Lauf-3-Stand ist historisch.

- Generator/Bake/Export mit einem Befehl fertig: `blender -b --python-exit-code 1 -P sources/bodycam-demo/blender/weapon.py --`.
- `carbine.glb`: 2.966.780 Byte, 56.002 Dreiecke, Gesamtlänge 0,847868 m. Alle 15 Pflichtknoten, vollständiges `W_Mag`, kein loses `CamPin`, bewegliche Teile exakt benannt.
- `mag_spare.glb` und `casing_556.glb` neu exportiert. Gepacktes `carbine.blend` und prozedurale Quelle unter `bodycam-work/codex/C9/blend/`.
- Materialrezepte erhalten, Farbräume und Seeds korrigiert, gewichtete Normalen nach Geometriereduktion wiederhergestellt. WebP-Atlanten und Quantisierung ohne zusätzlichen Laufzeitdecoder.
- Studio-/Spot-Testseite unter `_dev/weapon_model/`; CLI und GPU-Browser bestanden, 7/7 bewegliche Teile geprüft. Khronos-Validator für alle drei GLBs: 0 Fehler, 0 Warnungen.
- `W_SightEye` jetzt gemäß STYLE 130 mm hinter der Haube, glTF `(0, 0.125, 0.0527775)` m. Für ANIM/Integration den Knoten auslesen.
- Bekannte Grenzen: 117 mikroskopische UV-Sliver aus der Quellgeometrie; geringe GPU-Bake-Variation zwischen unabhängigen Läufen. Struktur, Geometrie, UVs und Albedo reproduzieren identisch.
- Entscheidungen, Parameter, Testbefehle, Hashes und Screenshot-Links: [C9.md](C9.md).

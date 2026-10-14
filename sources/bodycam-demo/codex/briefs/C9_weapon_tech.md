# Auftrag C9: Waffe, technischer Abschluss (Port 8958)

**Deine Dateien:** `sources/bodycam-demo/blender/weapon*.py`, `public/bodycam-demo/models/carbine.glb`, `casing_556.glb`, `mag_spare.glb`,
`$WORK/blend/carbine*.blend`, `public/bodycam-demo/_dev/weapon_model/**`, `sources/bodycam-demo/status/WEAPON.md` (fortschreiben).

- Stand: `sources/bodycam-demo/status/WEAPON.md` lesen. Geometrie (`weapon_geo.py`, `weapon_parts.py`), Materialien (`weapon_mat.py`), Treiber (`weapon.py`).
- Pipeline fertigstellen: alle Pflichtknoten laut CONTRACT („Waffen-Knoten“) vorhanden und korrekt orientiert (fehlen derzeit u. a. `W_Bolt`,
  `W_ChargingHandle`, `W_Selector`, `W_BoltCatch` als eigene bewegliche Objekte; prüfen und ergänzen, Maße eines realen AR-15/M4 als Quelle).
  Hierarchie sauber (`W_Root` als Wurzel, kein loses `CamPin`-Mesh im Export, `MagBody.001` gehört unter `W_Mag`).
- UV-Atlanten und Bake (albedo, ORM, normal) aus den vorhandenen prozeduralen Materialien zuverlässig und reproduzierbar mit einem Befehl;
  Texel-Dichte gleichmäßig, keine Bake-Fehler (Nähte, schwarze Stellen) – an Renderings prüfen.
- Größe: `carbine.glb` derzeit 8,5 MB → Ziel ≤ 3 MB (Atlas-Größen, JPEG/WebP-Qualität, unnötige Geometrie).
- Testseite `_dev/weapon_model/`: Modell unter Studio- und Spotlicht, Knotenliste mit Achsen-Gizmos. Abnahme: Screenshots + Prüfskript, das die
  Pflichtknoten, Achsen (Lauf −Z in three) und Maße (Gesamtlänge ~0,84 m) automatisch prüft.
- Look (Abnutzungsgrad, Farbnuancen) nicht neu erfinden: bestehende Material-Rezepte beibehalten, nur technisch sauber backen.

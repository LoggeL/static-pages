# C19: NPC-Technik (Verdächtiger), ohne Verhaltensgestaltung

**Voraussetzung:** C18 ist fertig (`status/C18.md`, gleicher Hook-Stil in `runtime.js`). Ein eigenes `suspect.glb` gibt es noch nicht.
Nutze bis dahin `officer.glb` als **Platzhalter mit gleichem Skelett** und kapsle das Modell so, dass später `models/suspect.glb`
(CONTRACT §NPC: Clips, `S_Muzzle`, `S_Head`, Pistole an der rechten Hand) ohne Codeänderung eingesetzt werden kann. Positionen aus
`data/level.json` bzw. `layout.suspects`.

**Aufgaben:**
1. **Navigation:** Begehbare Fläche aus `models/house_collision.glb` + Türen ableiten (Navmesh oder Raster mit A*, Wahl begründen),
   Bake-Skript unter `sources/bodycam-demo/tools/nav/`, Ergebnis `data/nav.json`. Offene/geschlossene Türen dynamisch berücksichtigen
   (Schnittstelle `js/world/doors.js` nur lesen; NPC darf Türen per `door.impulse` aufdrücken).
2. **Wahrnehmung:** Sichtlinie (Raycast gegen die Welt-BVH, Sichtkegel und Reichweite als Parameter), Hören von Schüssen und Schritten
   (Ereignisse aus Waffe und Spieler, Raumzuordnung über `world.roomAt`).
3. **Treffer:** Trefferzonen am Skelett (Kopf, Torso, Arme, Beine) als Kapseln an Knochen, Anschluss an den bestehenden Treffer-Raycast
   (`status/C3.md`), Ereignis `npc.hit {zone, point, normal}`. Kein Blut und keine Gestaltung.
4. **Zustandsautomat als Gerüst:** Zustände `idle`, `alert`, `flee`, `hide`, `aim`, `fire`, `surrender`, `hit`, `dead` mit Übergängen
   über **Parameter und Callback-Hooks** in `js/npc/npc-config.js`. Clipnamen laut CONTRACT, fehlende Clips ohne Fehler (dann
   Platzhalter-Pose). NPC-Schuss: Raycast von `S_Muzzle` mit Streuung als Parameter, Schaden ans Spielerobjekt als Ereignis. Timing,
   Persönlichkeit und Inszenierung macht später Claude, also neutral und einstellbar lassen.
5. **Debug:** `?npcdebug=1` zeigt Pfad, Sichtkegel und Zustand. Prüfseite `_dev/npc/`.
6. **Abnahme:** NPC läuft per Debug-Befehl von Raum zu Raum durch Türen, sieht den Spieler nur bei freier Sicht, Treffer liefern die
   richtige Zone, keine Konsolenfehler, FPS wie vorher. Regressionstests in `tools/harness` als neue Gruppe `npc` (nur neue Dateien).

**Port:** 8968. **Dateien:** `js/npc/*` (neu), `data/nav.json`, `tools/nav/*`, `_dev/npc/*`, `js/app/runtime.js` (nur Einbau-Hook),
neue Dateien in `tools/harness/`, `status/C19.md`. **Nicht anfassen:** alles in `js/weapon/`, `js/fp/`, `js/postfx/`, `js/world/` (nur lesen).

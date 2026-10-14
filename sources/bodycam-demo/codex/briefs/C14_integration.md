# C14: Lightmaps und optimierte Lader in die App integrieren (C6 + C7-Rest)

**Voraussetzung:** C17 hat neun neue Props gebaut (`status/C17.md`). Lies `status/C6.md`, `status/C7.md`, `status/C12.md`, `status/C11.md`.

**Aufgaben in dieser Reihenfolge:**
1. **Inventar:** `js/world/available-props.js` mit `js/world/refresh-props.py` neu erzeugen, sodass die neuen Props geladen werden.
   Fehlende Typen sollen danach 0 sein. Prüf die Platzierung im Browser (Bad, Waschküche, Garten) per Screenshot: nichts steckt in Wänden,
   nichts schwebt, Rotation passt. Falsche Ausrichtung meldest du in der Statusdatei; die GLBs selbst änderst du nicht.
2. **Lightmap-Bake neu:** Weil `house.glb` die Props mit einbackt, den C6-Bake mit den neuen Props neu laufen lassen (Befehl in
   `status/C6.md`) und `bake_validate.py` plus `_dev/lightmaps/acceptance.mjs` grün bekommen.
3. **App-Integration der Lightmaps:** Die App lädt heute `house_shell.glb` und Einzel-Props. Stelle die Welt auf `models/house.glb`
   + `lightmaps/` + `data/level.json` um (RGBM-Dekodierung, `channel=1`, `flipY=false`, `NoColorSpace`, `lightMapIntensity=PI` laut C6).
   Kollision über `house_collision.glb` bzw. die vorhandene Collider-Logik. Türen müssen weiter funktionieren: `js/world/doors.js`
   ist seit heute eine Scharnierphysik (Winkelgeschwindigkeit, `pusher`, `impulse`, `latched`). Schnittstelle nicht ändern; Türblätter
   müssen bewegliche, eigene Objekte bleiben. Dynamisches Licht (Waffenlicht, Mündungsfeuer) muss auf gelightmappten Flächen weiter
   wirken. Die Lichtstimmung (Werte, Farben, Belichtung) **nicht** tunen, das macht Claude. Nur korrekt verdrahten und einen Schalter
   `?lightmaps=0` für den alten Pfad lassen, damit Claude vergleichen kann.
4. **C7-Rest:** Alle direkten `new GLTFLoader()` in `js/world/*.js`, `js/weapon/weapon.js`, `js/weapon/effects.js` (und wo sonst nötig)
   auf `js/core/loaders.js` umstellen. Dann die Optimierung (`sources/bodycam-demo/tools/optimize/run.sh`) mit allen Assets inklusive
   der neuen Props und der neuen Lightmaps fahren. Ziel bleibt ≤ 60 MB für `public/bodycam-demo` ohne `_dev` und ohne `audio/`.
   Achtung: Wenn Prop-GLBs verändert werden, ändert das die `sharedImageBuffers`-Offsets; der C6-Export muss danach neu laufen
   (Reihenfolge so wählen, dass am Ende alles konsistent ist und `bake_validate.py` grün ist). Normaldetails dürfen nicht sichtbar
   verloren gehen (C7 hatte das als Problem).
5. **Abnahme:** App im Browser: 0 Konsolenfehler, 0 fehlgeschlagene Requests, FPS wie vorher (~60), Screenshots außen, Flur, Bad,
   Waschküche, Tür öffnen/schließen mit E. Vorher/Nachher-Bilder in `$WORK/codex/C14/`.

**Port:** 8964. **Dateien:** `js/world/*` (außer der Physik-Logik in `doors.js`, dort nur, falls Ladepfade es zwingend erfordern),
`js/core/loaders.js`, `js/weapon/weapon.js` und `effects.js` nur Lader-Zeilen, `js/app/runtime.js` nur Renderer-Übergabe an die Lader,
`models/`, `textures/`, `lightmaps/`, `data/level.json`, `sources/bodycam-demo/blender/bake_*`, `tools/optimize/`, `status/C14.md`.
Nicht anfassen: `js/weapon/sway.js`, `js/weapon/poses.js`, `js/postfx/*` (läuft parallel in C15), `js/player/*`.

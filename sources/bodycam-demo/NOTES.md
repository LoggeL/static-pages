# Bodycam-Tech-Demo · Stand und Erkenntnisse (2026-10-13, zweimal gestoppt)

Zwei Läufe des Build-Workflows `bodycam-demo-build`, beide auf Wunsch des Nutzers gestoppt:
- Lauf 1: `wf_a6086449-6c8`, etwa 22:33–22:45 Uhr, gestoppt nach etwa 10 Minuten.
- Lauf 2: `wf_36cf3179-85e`, etwa 23:00–23:17 Uhr, mit Wiederaufnahme-Hinweisen (vorhandene Teilergebnisse nutzen, yt-dlp drosseln).
  Gestoppt, weil das Wochenkontingent von Claude knapp wurde.

- Lauf 3: `wf_1a297cf3-12e`, ab 23:40 Uhr, mit Sessionende abgebrochen, um 23:59 Uhr per Resume neu gestartet (Woche 85 %) (neue Session, Woche bei 83 %, Reset 15.10. 17:00 Uhr). Nur 5 Agenten: Recherche (STYLE.md final), Waffe, Charakter, Haus-Rohbau, Sounds.
  Jeder Agent schreibt seinen Fortschritt laufend nach `status/<BAUSTEIN>.md`, damit beim Stoppen nichts verloren geht. Wächter in bash stoppt bei 98 %.
  Vorher erledigt: `textures/index.json` hat jetzt den Abschnitt `decals` (12 Einträge; Decal-PNGs unverändert neu verifiziert).

- Lauf 3 Ergebnis (gestoppt 14.10. ~00:30, Nutzer: „zu viel Zeit und zu viel Quota“): `STYLE.md` v1 final (436 Zeilen, Messwerte), Sounds fertig
  (198 Opus-Clips, 8,2 MB, `sounds.json`; die 119 genutzten Rohdateien liegen nur im Scratch `sound-raw/`, YouTube blockt Neu-Downloads),
  Haus-Rohbau fertig (`house_shell.py` → `house_shell.blend`, ~75k Dreiecke, `layout.json`), Waffe als `carbine.glb` + Hülse + Magazin exportiert
  (Materialien in Arbeit), Charakter bis Stufe `gear.blend` (noch kein Export). Details: `status/*.md`.
- **Pausiert (14.10. ~00:30):** Der Nutzer sagte „Workflow verbraucht zu viel Zeit und zu viel Quota, lass den wann anders weitermachen“.
  Das Projekt ruht und wird später fortgesetzt. Danach wurde nur noch `models/house_shell.glb` exportiert (5,4 MB, 78k Dreiecke, 172 Knoten,
  Türen `DOOR_*` mit Scharnier-Extras), sonst nichts.

### Vorschlag für die Fortsetzung (Vertical Slice zuerst)
Statt alle Assets vorab zu perfektionieren: früh etwas Spielbares im Browser, dann gezielt verbessern. Möglich ohne großen Workflow:
1. Engine: `house_shell.glb` laden, Möbel zur Laufzeit nach `layout.json` (`furniture` je Raum, Blender-Koordinaten → three `(x, z, −y)`,
   `rotZ` → `rotation.y`) aus `models/props/` platzieren, Decals aus `layout.decals`, Texturen per `M_<id>` + `textures/index.json`.
   Kollision: three-mesh-bvh-Kapsel (statisch zusammengeführt + Türen einzeln), Spawn `layout.playerSpawn`.
2. Waffe `carbine.glb` als Viewmodel in eigener Ebene (eigenes Render-Target, damit kein Kamera-Motion-Blur und kein Clipping in Wänden).
   Knoten: `W_Root` (Ursprung Griff), `W_SightEye` (0, 0,125, 0,149), `W_Muzzle` (0, 0,058, −0,539), `W_LightEmitter`, `W_Mag`, `W_Ejection`.
   ADS = `W_SightEye` auf den Kamerapunkt legen. Arme fehlen noch (Charakter erst bis `gear.blend`).
3. Post-FX und Audio direkt nach `BODYCAM_STYLE` in `research/STYLE.md` §10 (rektilinear vFOV 82° + leichte Tonne k1 0,06,
   elliptische Maske mit Farbsaum, OSD links `BWC-4 X60A1972 ▶`, rechts Datum M/D/YYYY + Uhrzeit + `REC`; Audio-Kette HP 60 / LP 12 k / Kompressor / Softclip).
4. Danach: Arme/Charakter fertig, NPC (`layout.suspects`), Streifenwagen (bis dahin nur Blaulicht ohne Auto), Lightmaps.

### Arbeitsteilung beim Fortsetzen (Vorgabe des Nutzers)
Codex bekommt nur „harte Fakten“ mit wenig Kreativität, alles Gestalterische macht Claude:
- **Codex:** Lader + Material-Konvention, `layout.json`-Platzierung, BVH-Kapselkollision, Türen aus Extras, Eingabe/Debug-Hooks,
  Waffen-Zustandsautomat (Munition, Feuermodi), Treffer-Raycast + Oberflächen; Audio-Engine-Verkabelung nach `STYLE.md` §8/§10 und `sounds.json`;
  Post-FX-Gerüst (Render-Targets, Belichtungs-Readback, Motion-Blur-Reprojektion, Formeln für Linse/Maske); Lightmap-Bake-Pipeline,
  Kollisionsmesh, GLB-Kompression, Build/README/Galerie-Boilerplate.
- **Claude:** Look-Tuning gegen die Referenzframes (Grading, Rauschen, Maske, Licht), Set-Dressing und Lichtstimmung, Streifenwagen und
  restliche Props (Modellierung mit Verschleiß), Arme/Charakter-Look, Animationen und ihr Gefühl (Nachladen, Rückstoß, Gehen), NPC-Verhalten,
  Intro/Ende, UI, Funksprüche; dazu die Aufgabenbeschreibungen für Codex, Prüfung und Integration.
- Codex-Aufruf (geklärt 14.10.): Das mit ChatGPT.app ausgelieferte Binary nutzen,
  `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex exec -C <dir> -o <letzte-nachricht.txt> "<prompt>"`
  (Konfig: gpt-6-astra, Effort ultra, volle Rechte ohne Rückfragen). Rauchtest erfolgreich. Keine Installation nötig.

In den Läufen 1 und 2 hat kein Agent sein Ergebnis zurückgegeben. Der Workflow-Cache ist leer, ein neuer Lauf startet jeden Agenten neu.
Die Arbeit auf der Platte bleibt aber erhalten (siehe unten) und wird über die Wiederaufnahme-Hinweise im Skript weiterverwendet.

## Delegiert an Codex (14.10., ab 00:45 Uhr)

Läuft losgelöst von Claude über `sources/bodycam-demo/codex/run.sh` (gpt-6-astra, Effort max/xhigh, Codex-Quota). Review später durch Claude und den Nutzer.
- Aufträge: `codex/briefs/` (`_common.md` + je Auftrag). Fortschritt: `codex/out/progress.log`; letzte Antwort je Auftrag: `codex/out/<ID>.last.md`;
  Status je Auftrag: `status/<ID>.md`; Rohlogs: `bodycam-work/codex/logs/`.
- Welle 1 parallel: C12 Welt-Lader + Spieler (max), C4 Audio-Engine, C5 Post-FX-Gerüst (max), C13 Test-Harness, C9 Waffe technisch, C10 Charakter technisch.
- Danach: C3 Waffenlogik + C6 Lightmap-Pipeline (max) nach C12; C11 App-Gerüst nach C3/C4/C5; C7 Asset-Optimierung zuletzt.
- Einzelnen Auftrag neu starten: `bash sources/bodycam-demo/codex/run.sh C4 xhigh`.
- **Zwischenstände liegen jetzt dauerhaft in `/Users/logge/Documents/Projects/bodycam-work/`** (statt /private/tmp). Skripte und CONTRACT sind umgestellt.

### Beim Review prüfen
- Haben sich die Aufträge an die Dateigrenzen und das Git-Verbot gehalten? (`git status`, keine Commits/Stashes)
- Läuft `_dev/world`, `_dev/weapon`, `_dev/postfx`, `_dev/lightmaps` und die App `index.html` fehlerfrei (Harness C13)?
- Danach Claude-Teil: Look-Tuning, Lichtstimmung (`lighting_bake.json`, `lighting-config.js`), Mischung (`mix-config.js`), Arme/Animationen,
  fehlende Props (Bad, Waschküche, Bäume/Büsche), Streifenwagen, NPC, Intro/Ende, UI-Design, Galerie-Karte.

## Entscheidungen des Nutzers

- Format: **spielbar im Browser** (Three.js), kein vorgerendertes Video.
- „end“ in der Anfrage bedeutet **Environment/Umgebung**. Umgebung, Waffe, Charakter und Animationen haben Priorität.
- Grafik über Blender und Codex-Imagegen, Sounds echt von YouTube (Privatkopie).
- Die 198 Soundclips werden auf ausdrücklichen Nutzerwunsch mit der Bodycam-Demo veröffentlicht (14.10.2026). `public/bodycam-demo/audio/` und `docs/bodycam-demo/audio/` sind Teil des Repositories. Die Synthese bleibt als Fallback für fehlende Dateien verfügbar.
- Nutzungsgrenze: Bei etwa **98 % Claude-Nutzung** stoppen.

## Architektur (siehe `CONTRACT.md`)

`CONTRACT.md` legt Pfade, Achsen, Materialkonvention (`M_<textureId>`, UV in Weltmetern, `extras.surface`), Pflicht-Knotennamen
(Waffe `W_*`, First-Person `FP_*`, NPC `S_*`), Animationsclips, Soundnamen und die Schnittstellen von Post-FX und Audio fest.

Abhängigkeitsgraph (17 Agenten):
- Unabhängig: Recherche, Sounds, Texturen, Waffe, Charakter, Haus-Rohbau, 4× Props (Wohnen, Küche/Bad, Kram, Streifenwagen)
- Nach der Recherche: Engine, Post-FX; nach Recherche und Sounds: Audio-Engine
- Nach Waffe und Charakter: FP-Animationen; nach dem Charakter: NPC; nach Rohbau, Props und Texturen: Zusammenbau mit Lightmap-Bake
- Zum Schluss: Integration (index.html, Menüs, Ende, Galerie-Karte 021, `npm run build`)

Workflow-Skript, mit Wiederaufnahme-Hinweisen:
`~/.claude/projects/-Users-logge-Documents-Projects-static-pages/472c6306-266f-4b95-b1c1-f10e0a21a9ca/workflows/scripts/bodycam-demo-build-wf_a6086449-6c8.js`

## Stand je Baustein (nach Lauf 2)

| Baustein | Stand | Wo |
|---|---|---|
| Recherche | `research/STYLE.md` als **Entwurf v0** (qualitative Kernbeobachtungen, noch ohne Messwerte). Videos, Frames, Kontaktbögen und WAVs liegen bereit. | Repo + Scratch `ref/` |
| Texturen | **Alle 24 Sets fertig** (albedo/normal/orm) + `index.json`. **12 Decals als PNG fertig** (Einschusslöcher mit eigenen Normal-PNGs), aber im `index.json` fehlt noch der Abschnitt `decals`. Testseite `_dev/textures/`. | `public/bodycam-demo/textures/`, Generator `sources/…/textures/` (`build.sh`, `gen.py`, `process.py`, `decals.py`, `sheet.py`, Prompts) |
| Props Wohnen | Weitgehend fertig: Sofa, Sessel, Couchtisch, Röhren-TV + Möbel, Regale, Esstisch/Stühle, Matratze, Bett, Kommode, Nachttisch, Spielzeugkiste, Bild, Vorhang, Jalousie, Deckenventilator, Lampen, Läufer. Drei Iterationen Kontaktbögen. Kleiderschrank fehlt vermutlich. | `models/props/*.glb`, `blender/props_living*.py`, `props_living.json`, Scratch `blend/props_living.blend` |
| Props Küche/Bad | Teilweise: Küchenschränke, Herd, Kühlschrank, Mikrowelle, Haube, Geschirr/Töpfe. **Bad und Waschküche fehlen** (Toilette, Wanne, Waschbecken, Spiegelschrank, Waschmaschine, Boiler). | `blender/props_kitchenbath*.py`, Scratch `blend/props_kitchenbath.blend` |
| Props Kram | Teilweise: Müllsäcke, Kartons, Flaschen, Dosen, Pizzakartons, Papier, Tüte, Spritze. Rest der Liste (Palette, Eimer, Trümmer, Schlafsack, Außen-Kram, Busch …) fehlt. | `blender/props_clutter*.py`, `props_clutter.json` |
| Streifenwagen | Nur Skripte (`props_vehicle*.py`) und Imagegen-Bilder, **noch kein GLB**. | Repo + Scratch `props_vehicle/` |
| Waffe | Nur Skripte (`weapon_geo.py`, `weapon_parts.py`) und Referenzmaterial, **noch kein GLB**. | Repo + Scratch `weapon/` |
| Charakter | Base-Mesh vorbereitet, Rig/Weights in Arbeit (viele Pose-Testrenderings `wt0/wt1/wt2_*`, `g1/g2_rest_*` in `previews/`), **noch kein GLB/Blend-Export**. | `blender/character.py`, `character_lib/`, Scratch `character/` |
| Haus-Rohbau | Nur `blender/shell_lib.py` und Tests, **noch nichts exportiert**. | Repo + Scratch `shell/` |
| Sounds | Etwa 45 Rohdownloads, Suchlisten/Analysen, `audio/soundlib.py` angefangen. **Noch keine geschnittenen Clips, kein `sounds.json`.** | Scratch `sound-raw/`, `sounds/` |
| Engine, Post-FX, Audio-Engine, Animationen, NPC, Zusammenbau, Integration | **Nicht gestartet** (warteten auf Recherche bzw. Assets). | — |

`public/bodycam-demo/` ist aktuell etwa 69 MB groß (Texturen + Props).

Scratch (`/Users/logge/Documents/Projects/bodycam-work/`, etwa 1,3 GB):
**Liegt unter /private/tmp und wird beim Neustart gelöscht.** Vor einem Neustart sichern, was wertvoll ist (`ref/frames` + `ref/all`, `blend/`, `character/`, `sound-raw/`).
Darin auch `tools/shot.mjs` (Screenshot-Tool).

## Technische Erkenntnisse

- **Nutzungskosten:** 17 parallele Agenten haben das Claude-Wochenkontingent um etwa **0,4 Prozentpunkte pro Minute** belastet
  (92 % um 23:07 → 95 % um 23:15; das 5-Stunden-Fenster stieg von 62 % auf 73 %). Ein kompletter Lauf (mehrere Stunden) passt nicht mehr ins aktuelle Wochenkontingent.
  Das Wochenkontingent wird am **14.10. um 3:00 Uhr** zurückgesetzt.
- **Nutzung abfragen:** `codexbar usage --provider claude --format json` → `usage.primary` (5-h-Fenster) und `usage.secondary` (Woche), `usedPercent`.
  Die Abfrage scheitert gelegentlich (leere Ausgabe bzw. kein `usage`-Feld), also robust parsen.
  **Bug im Wächter von Lauf 2:** In zsh teilt `set -- $P` den String nicht in Wörter, die 98-%-Prüfung hätte nie ausgelöst.
  Für Wächter `bash -c` verwenden oder die Zahl direkt in Python vergleichen.
- **Codex-Imagegen** funktioniert ohne Codex-CLI im PATH über
  `~/.codex/skills/codex-imagegen-models/scripts/codex_images.py` (`gpt-image-2`, etwa 30 s pro Bild, 1024 angefragt → 1254×1254 geliefert).
  Kachelbare Fotodraufsichten sind gut brauchbar; die 24 Sets sind in einem Lauf von etwa 25 Minuten entstanden.
- **Headless-WebGL:** Das Chromium aus `~/Library/Caches/ms-playwright/chromium-1243/` per `executablePath` nehmen.
  Playwright 1.55 erwartet sonst eine nicht installierte Version. GPU über `--use-angle=metal` liefert „ANGLE Metal Renderer: Apple M5 Pro“.
- **Port 8765** ist von einem anderen lokalen Server belegt. Für `public/` den Port **8941** verwenden (`python3 -m http.server 8941 --bind 127.0.0.1 -d public`).
- **ffmpeg** (Homebrew) hat **keinen `drawtext`-Filter**. Beschriftungen in Kontaktbögen mit PIL machen.
- **yt-dlp** liefert nach vielen schnellen Anfragen **HTTP 429 und „Sign in to confirm you're not a bot“**. Abhilfe: Anfragen drosseln,
  höchstens zwei Downloads gleichzeitig, `--sleep-requests 2`, notfalls `--cookies-from-browser chrome`. Schnelle Vorauswahl ohne Download:
  Storyboards (`-f sb1`, mhtml) oder einzelne Frames per `ffmpeg -ss` direkt aus der Stream-URL (`yt-dlp -g`).
- Die Referenz-Gameplay-Videos kommen als 1280×720 mit 60 fps, die echten Bodycam-Beispielaufnahmen als 30 fps.
- In den Gameplay-Spuren clippen die Schüsse tatsächlich (Peak 1.0, messbarer Clipping-Anteil). Das bestätigt den harten Limiter/Clipper am Master.
- Erste Stilbeobachtungen (Details in `research/STYLE.md`): starkes Fisheye mit runder dunkler Blende und orange-braunem Farbsaum in den Ecken,
  FOV deutlich über 120°, beim Zielen wandert das Visier vor die Brustkamera (unten mittig), Highlights clippen hart, Schatten saufen ab,
  Makroblöcke in dunklen Flächen, Overlay in schmaler kursiver Monospace-Schrift mit Schlagschatten.
- Python: numpy und PIL sind da, **scikit-image fehlt**.
- **Plattenplatz:** Anfangs 9,4 GB frei, zwischendurch 7,4 GB. Nach dem Aufräumen durch den Nutzer jetzt etwa **71 GB frei**. Der Engpass ist damit entschärft.
- Hardware: Apple M5 Pro, 48 GB RAM, 18 Kerne, Blender 5.2.1 LTS. Mehrere Blender-Headless-Instanzen parallel sind unproblematisch.

## Für einen neuen Anlauf

1. Nach dem Reset des Wochenkontingents (14.10., 3:00 Uhr) starten. Vorher den Scratch-Ordner an einen dauerhaften Ort sichern, falls ein Neustart ansteht.
2. ~~`textures/index.json` um `decals` ergänzen~~ (erledigt in Lauf 3).
3. Die Recherche zuerst allein fertigstellen lassen (`STYLE.md` mit Messwerten). Sie blockiert Engine, Post-FX, Audio und Animationen.
4. Nur die offenen Bausteine laufen lassen. Texturen und Props Wohnen sind praktisch fertig; deren Agenten weglassen oder nur nachprüfen lassen.
5. Weniger Parallelität (z. B. 6–8 Agenten statt 17), damit die Nutzung pro Stunde planbar bleibt, und einen funktionierenden Nutzungswächter mit 98-%-Grenze einbauen.

## Review der Codex-Delegation (14.10., unterbrochen bei 93 % Wochenquota)

Alle zehn Aufträge sind mit Exit 0 gelaufen, C7 nur teilweise (partial). Kein Commit, kein Stash. Ergebnisse stehen in `codex/out/*.last.md` und `status/*.md`.

Sichttest der App (Kontaktbogen `$WORK/review_app.jpg`): Start, Spawn, Flur, ADS, Schuss, Nachladen und Pause funktionieren. OSD und Maske sind da. Was auffällt:
- Die Außenszene sieht nach Tag aus (blauer Himmel, hell). Die Nachtstimmung fehlt; anzupassen in `js/world/lighting-config.js` und im Himmel.
- Waffenlicht und Mündungsfeuer sind stark überbelichtet. Beim Blick nach unten entsteht ein weißer Fleck, vermutlich das Waffenlicht auf dem Boden.
- Arme und Hände fehlen. Die Waffe ragt als lange Schiene diagonal ins Bild; das FP-Rig ist noch nicht integriert.
- Hinweis „9 Modelltypen fehlen“: bath_vanity, bathtub, bush_dead, dryer, mirror_cabinet, toilet, tree_dead, washing_machine, water_heater (10 Layoutplätze).

Integration offen:
- C6-Lightmaps (`models/house.glb`, `lightmaps/`, `data/level.json`) sind noch nicht in der App. Das Vorgehen ist in `status/C6.md` beschrieben (RGBM, channel=1, flipY=false, lightMapIntensity=PI).
- C7: `js/core/loaders.js` existiert, wird aber noch nirgends importiert. Die GLTFLoader-Aufrufe in `js/world/world.js`, `js/weapon/weapon.js` und `js/weapon/effects.js` sollen darauf umgestellt werden. Größe 81 MB, Ziel 60 MB. Achtung: Wenn sich Prop-GLBs ändern, muss der C6-Export neu erzeugt werden (sharedImageBuffers mit Byteoffsets).

Nächste Schritte in dieser Reihenfolge:
1. Lightmaps einbinden.
2. Nacht-Look und Belichtung gegen `$WORK/ref/frames/` abstimmen.
3. Waffenlicht und Mündungsfeuer dämpfen.
4. FP-Arme.
5. Fehlende Props.
6. NPC und Streifenwagen.
7. Inszenierung (Intro, Funk, Ende).
8. Galerie-Karte 021.

## Nachtrag 14.10.: Waffenträgheit, Haltung, Türphysik (Claude)
- `js/weapon/sway.js` (neu): Die Waffe hängt am Körper und folgt Drehungen und Bewegungen der Kamera über eine gedämpfte Feder um einen Drehpunkt auf Brusthöhe. Dazu kommen Schrittpendeln und Atmen; beim Zielen ist der Effekt auf 35 % reduziert. Die Parameter stehen in `WEAPON_POSES.sway` (`poses.js`), der Zustand in `weapon.state().sway`.
- Low-Ready neu: `muzzleUV [0.52, 0.6]`, `muzzleDepth 0.78`, Drehung `[9, 9, -6]`. Die Waffe kommt von unten rechts ins Bild. Ohne Arme schwebt sie aber weiter.
- `js/world/doors.js`: Die Türen haben jetzt ein Scharnier mit Winkelgeschwindigkeit, Reibung und Rückprall an Zarge und Anschlag. Geschlossen rasten sie ein. E stößt die Tür auf bzw. zu. Gegen eine offene Tür zu laufen, drückt sie weg (`door.pusher` aus `player.js`, über `wishVelocity`). Treffer stoßen die Tür an (`door.impulse`, verdrahtet in `runtime.js`). Parameter stehen in `DOOR_CONFIG`.
- `runtime.js`: `__bodycam.world` ist als Getter für Tests freigegeben.
- Getestet headless: Die Tür öffnet auf etwa 104°, federt zurück, schließt und rastet ein; die Schubrichtung stimmt auf beiden Seiten; keine Konsolenfehler. Den Harness (`npm test`) habe ich nicht laufen lassen.
- Aufgefallen: Bei schnellen Drehungen zeigt die Waffe blockige dunkle Kacheln, vermutlich durch Bewegungsunschärfe oder TAA in den Post-FX (C5).

## QC der zweiten Codex-Welle (14.10., 11:45, Claude, grob)
- Ergebnisse: C15 (Post-FX-Kacheln) done, C17 (9 Props, Katalog 69) done, C14 (Neu-Bake mit 85 Props, Lightmaps in der App, zentrale Lader) partial bei 77,97 MB statt 60 MB, C16 (Harness) 12 von 15 Gruppen grün.
- Dateigrenzen eingehalten: `sway.js`, `poses.js`, `player.js` und `doors.js` sind seit meinen Änderungen unverändert. Keine Git-Mutation. `docs/` hat Zeitstempel von 09:48, aber laut Logs hat kein Codex-Auftrag gebaut, vermutlich die andere Session. Getrackte Dateien sind unverändert.
- Code (grob): `world/lightmaps.js` prüft die Metadaten streng und gibt im Fehlerfall Ressourcen frei. `?lightmaps=0` schaltet auf den alten Pfad zurück. Lader laufen jetzt über `core/loaders.js`, auch in `weapon.js` (der Renderer wird übergeben).
- Behobener C16-Bug, mein eigener: Die Waffenfeder hat beim App-Teleport nicht zurückgesetzt. Jetzt setzt `sway.update(0)` die Feder zurück. Die Einzelregressionen sind grün: Trägheit 14/14, Türen 13/13.
- Offen aus C16: Der Meshopt-Decoder fehlt auf den Dev-Modellseiten. Der Standard-Audioausgang hängt nur in der Testumgebung.
- Sichttest (`$WORK/codex/C14/before-after-contact.jpg`): Mit Lightmaps entsteht endlich Nachtstimmung, innen dunkel, außen Mondlicht. Die neuen Props stehen plausibel. **Das Waffenlicht ist weiterhin stark überbelichtet** (weiße Flächen), das ist der nächste Look-Punkt für Claude.

## Welle 3 an Codex (14.10., ab 16:19, `codex/run4.sh`)
- C18 Arme technisch (officer_fp.glb, IK an `W_Grip_*`, Mixer, `?arms=0`) ∥ C21 Texturendungen WebP → `.webp` + `tools/check_mime.py`;
  danach C19 NPC-Technik (Navigation, Sicht, Trefferzonen, Zustandsgerüst; `officer.glb` als Platzhalter für `suspect.glb`);
  zuletzt C20 Prüfseiten auf Meshopt, stummer Audio-Sink im Test, kompletter Regressionslauf.
- **Größenbudget vorerst auf ≤ 100 MB angehoben** (Nutzer: „erstmal raisen, gucken wir später“). Stand 78 MB.
- Claude parallel: Waffenlicht/Mündungsfeuer (`js/weapon/effects-config.js`), danach Look. Diese Dateien sind für Codex gesperrt.
- **Codex-Modell ab Welle 3: `gpt-6.1-sol`** (Nutzer, 14.10.), Effort je nach Schwere `ultra`/`max`/`xhigh`: C18 ultra, C19 max, C20/C21 xhigh.
  `run.sh` liest `MODEL` aus der Umgebung (Standard noch gpt-6-astra). Erster Start um 16:20 scheiterte an 429, Neustart 16:24 mit Wiederholungen.

## Waffenlicht und Mündungsfeuer gedämpft (14.10., Claude)
- Ursache: Die Auto-Belichtung steht nachts innen dauerhaft am Anschlag +4 EV (gemessene Luminanz ~0,002–0,007 gegen Ziel 0,18).
  Deshalb wirken die Lichtwerte aus STYLE §5.3/§6.1 (die [V]-Schätzungen 55 bzw. 30) etwa 20-fach zu hell.
- `effects-config.js`: `light.intensity` 55 → **2,5**, `flash.intensity` 30 → **2**. Gemessen (1280×720, Messskript im Scratchpad):
  Flur mit Lampe 6,1 % → 0,26 % geclippt, p99,5 236; Blick auf den Boden 6,4 % → 0,65 %; Wand in ~0,8 m clippt im Kern weiter (5,9 %, gewollt wie `ref_34`).
  Ein Schuss hellt den dunklen Flur ×3,7 auf (Ziel ×1,9 bei hellerem Grundbild, absolut ähnlicher Zuwachs), 0,3 % geclippt, Raum orange.
- Post-FX: neuer Parameter `exposure.floorEV` (Untergrenze der Log-Messung, Standard −16 = altes Verhalten). Getestet mit −9: kein Effekt,
  weil die Szene insgesamt so dunkel ist. Stellschraube bleibt für später.
- Wenn die Belichtung später einmal nicht mehr am Anschlag steht (z. B. höheres `maxEV` oder hellere Lightmaps), müssen beide Lichtwerte neu abgestimmt werden.

# UNIT 27 · Bodycam-Tech-Demo — Vertrag zwischen den Bausteinen

Spielbare Browser-Demo (Three.js, WebGL2) im Stil des Spiels „Bodycam“ (UE5, fotorealistisch, Brustkamera-Optik).
Ziel: **maximaler Realismus**. Der Bodycam-Look (Fisheye, Bewegungsunschärfe, Sensorrauschen, Kompression, überschärftes Bild,
geclippter Ton) ist Teil des Realismus, ersetzt aber keine guten Assets.

Szene: Nacht, ca. 23 Uhr, Herbst, Nieselregen/Nebel. Ein heruntergekommenes, verlassenes einstöckiges US-Vorstadthaus
(Holz-/Vinyl-Fassade, Veranda). Davor eine Straße mit Streifenwagen, Blaulicht/Rotlicht flackert durch die Fenster.
Der Spieler (Polizist, Karabiner mit Holo-Visier und Waffenlicht) räumt das Haus. 2–3 bewaffnete Verdächtige im Haus.
Ende: alle Verdächtigen neutralisiert → „Gebäude gesichert“-Abspann (Integration).

## Pfade

| Was | Wo |
|---|---|
| Deploy (statisch, wird von Vite 1:1 nach `docs/` kopiert) | `public/bodycam-demo/` |
| Quellen, Generator-Skripte, Doku | `sources/bodycam-demo/` |
| Blender-Skripte | `sources/bodycam-demo/blender/*.py` (headless: `blender -b -P script.py -- args`) |
| Zwischenstände (.blend, Roh-PNGs, Videos, Frames, Previews) | `$WORK/…` – **nie** ins Repo |
| Lokaler Server (läuft bereits) | `http://127.0.0.1:8941/` = `public/` → Demo unter `http://127.0.0.1:8941/bodycam-demo/` |
| Screenshot-Tool (Headless Chromium, WebGL über Metal) | `node $WORK/tools/shot.mjs <url> <out.png> [--wait ms] [--w 1600 --h 900] [--keys "KeyW:1500,KeyF"] [--eval "js"]` (gibt Konsole + Fehler aus) |
| Referenz-Frames (Recherche) | `$WORK/ref/frames/` |

`$WORK = /Users/logge/Documents/Projects/bodycam-work` (Zwischenstände, außerhalb des Repos; bis 14.10. lag das unter /private/tmp/…/scratchpad/bodycam)

**Plattenplatz ist knapp (~9 GB frei).** Videos nur ≤720p und nur Abschnitte laden (`--download-sections`), nach Auswertung löschen.
Keine riesigen Blend-Dateien horten. Gesamtbudget Deploy-Ordner ≤ 120 MB (ohne `audio/`).

## Konventionen

- Einheiten: Meter. glTF ist Y-up. Blender ist Z-up; der glTF-Exporter wandelt um (Blender +Y → glTF −Z, Blender +Z → glTF +Y).
- **Alles, was der Spieler hält/trägt (Waffe, Arme, Körper): Vorwärts = Blender +Y** (= glTF −Z = Three.js-Kamerablickrichtung).
- **NPCs und Props: Vorderseite = Blender −Y** (= glTF +Z), Ursprung am Boden mittig.
- Türen: 0,90 × 2,05 m, Deckenhöhe 2,60 m, Augenhöhe Spieler 1,72 m, Bodycam (Brust) ca. 1,38 m (Recherche kann das präzisieren).
- Three.js **0.170.0** per Importmap von `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js` und `.../examples/jsm/`.
  Zusätzlich erlaubt: `three-mesh-bvh@0.8.3` (jsDelivr, ESM). Sonst keine Abhängigkeiten, kein Build-Schritt.
- UI-Texte Deutsch. Code-Kommentare knapp, Deutsch oder Englisch.
- Keine echten Marken/Logos (kein „AXON“, kein „Glock“, kein „Ford“ auf Assets). Generische Namen, z. B. Overlay „BWC-4 X60A1972“.
- Nicht committen. Keine Dateien anderer Bausteine ändern (Ausnahme: Integration).

## Texturen (Baustein TEXTURES)

`public/bodycam-demo/textures/<id>/albedo.jpg` (sRGB), `normal.jpg` (OpenGL, +Y), `orm.jpg` (R=AO, G=Roughness, B=Metalness), Kantenlänge 1024 oder 2048, nahtlos kachelbar.
`public/bodycam-demo/textures/index.json`: `{ "<id>": { "tileMeters": 2.0, "size": 2048, "maps": ["albedo","normal","orm"] } }`.
Decals (RGBA, PNG oder WebP mit Alpha): `public/bodycam-demo/textures/decals/<id>.png`, im selben index unter `"decals"`.

Pflicht-IDs: `concrete_floor`, `asphalt_wet`, `grass_dead`, `dirt_mud`, `wood_floor_worn`, `carpet_stained`, `tile_floor_dirty`,
`tile_wall_white`, `wallpaper_peeling`, `plaster_painted_dirty`, `plaster_damaged`, `ceiling_stained`, `wood_door_painted`,
`siding_vinyl_dirty`, `roof_shingles`, `wood_trim_painted`, `metal_rusty`, `fabric_sofa_dirty`, `mattress_stained`, `cardboard`,
`laminate_counter`, `cabinet_wood`, `brick_red`, `wood_planks_raw`.
Decals: `water_stain`, `grime_corner`, `graffiti_1`, `graffiti_2`, `bullet_hole_concrete`, `bullet_hole_wood`, `bullet_hole_plaster`,
`bullet_hole_metal`, `blood_splatter`, `papers_scattered`, `mold_patch`, `footprints_mud`.

## Material-Konvention für Umgebung und Props

Umgebungs- und Prop-GLBs **betten keine gekachelten Texturen ein**. Materialien heißen `M_<textureId>` (z. B. `M_wood_floor_worn`)
und bekommen einen passenden `baseColorFactor` als Fallback. UVs (TEXCOORD_0) in **Weltmetern** (1 UV-Einheit = 1 m, z. B. Cube-Projection);
die Engine setzt `repeat = 1 / tileMeters`. Unikate (Bildschirm, Poster, Etiketten) dürfen eingebettete Texturen haben, Material dann `MU_<name>`.
Glas: `M_glass`, `M_glass_dirty`. Emissiv: `ME_<name>` (z. B. `ME_bulb_warm`), emissive Farbe/Stärke im glTF.

Oberflächen-Tags (Schritte, Einschläge, Decals): Blender Custom Property `surface` am Objekt (glTF-Export mit „Custom Properties“ → `extras.surface`):
`concrete | wood | carpet | tile | metal | plaster | glass | dirt | grass | asphalt | fabric | cardboard | flesh`.

## Modelle

| Datei | Baustein | Inhalt |
|---|---|---|
| `models/carbine.glb` | WEAPON | Karabiner (AR-15/M4-Bauart, 14,5"), Holo-Visier, Waffenlicht, Winkelgriff, Riemenansatz. Eigene gebackene PBR-Texturen eingebettet. |
| `models/officer.glb` | CHARACTER | Polizist, voll geriggt (Uniformhemd dunkelblau, Plattenträger mit Magazintaschen + Funkgerät, Handschuhe, Hose, Stiefel). |
| `models/officer_fp.glb` | ANIM | First-Person-Rig: Arme + Oberkörper/Beine des Spielers + Karabiner, mit Animationen (s. u.). |
| `models/suspect.glb` | NPC | Verdächtiger (Hoodie, Jeans, Sneaker, Maske/Mütze), geriggt, mit Pistole, Animationen. |
| `models/props/*.glb` | PROPS-* | Einzelne Props, Ursprung am Boden mittig, Vorderseite Blender −Y. Katalog `models/props/catalog.json`. |
| `models/house.glb` | ASSEMBLY | Fertig zusammengesetzte Szene inkl. Props, mit Lightmaps. |
| `models/house_collision.glb` | ASSEMBLY | Vereinfachte Kollisionsgeometrie (ein oder wenige Meshes, `extras.surface` je Mesh). |
| `data/level.json` | ASSEMBLY | Spawn, NPCs, Räume (AABB + Hallprofil), Türen, dynamische Lichter, Lightmap-Zuordnung. |

### Waffen-Knoten (`carbine.glb`, Pflichtnamen)
Ursprung = Pistolengriff-Mitte (Griffstück, Höhe Abzugsfinger). Lauf zeigt Blender +Y.
Bewegliche Teile als eigene Objekte: `W_Mag`, `W_Bolt` (Verschlussträger, fährt beim Schuss zurück), `W_ChargingHandle`, `W_Trigger`,
`W_Selector`, `W_BoltCatch`, `W_DustCover`. Empties: `W_Muzzle` (Mündung, +Y), `W_Ejection` (Auswurföffnung, X+ = Auswurfrichtung),
`W_SightEye` (Punkt hinter dem Holo-Visier auf der Visierlinie, wo das Auge beim Zielen ist), `W_LightEmitter` (Lampenfront, +Y),
`W_Grip_R` (Hand-Ziel rechts), `W_Grip_L` (Hand-Ziel links am Winkelgriff/Handschutz), `W_MagWell`.
Dazu `models/casing_556.glb` (Hülse) und `models/mag_spare.glb` (einzelnes Magazin).

### First-Person (`officer_fp.glb`)
Wurzel `FP_Root` (im Kamera-Raum der Bodycam auszurichten), Empty `FP_Camera` = Position/Orientierung der Bodycam (Brust).
Die Waffe hängt an einem Waffen-Bone/Empty `FP_WeaponSocket`; alle `W_*`-Knoten bleiben mit Namen erhalten.
Animations-Clips (exakte Namen): `Idle`, `Walk`, `Sprint`, `Fire`, `FireADS`, `Reload`, `ReloadEmpty`, `Inspect`, `Draw`, `ADS_In`, `ADS_Idle`, `ADS_Out`,
`LowReady`, `LightToggle`. Feinbewegung (Atmung, Sway, Rückstoß-Zufall, Bob) kommt zusätzlich prozedural aus der Engine.
In `data/fp_anim.json`: Event-Zeitstempel je Clip (z. B. `Reload.magOut`, `Reload.magIn`, `ReloadEmpty.boltRelease`, `Fire.shot`) für Sounds.

### NPC (`suspect.glb`)
Clips: `Idle`, `IdleNervous`, `Walk`, `Run`, `AimPistol`, `FirePistol`, `HitReact`, `DeathForward`, `DeathBackward`, `Crouch`.
Empties: `S_Muzzle` (Pistolenmündung), `S_Head`. Pistole als Kind der rechten Hand.

## Sounds (Baustein SOUNDS) — liegen in `public/bodycam-demo/audio/`

Die 198 Clips werden mit der Demo unter `docs/bodycam-demo/audio/` veröffentlicht.

OGG (Opus) oder MP3, 48 kHz, normalisiert, ohne Stille am Anfang. Manifest (wird committet): `public/bodycam-demo/data/sounds.json`
`{ "<name>": { "files": ["audio/x_1.ogg", ...], "gain": 0.8, "desc": "...", "source": "YouTube-URL + Zeitstempel" } }`.
Pflichtnamen (mehrere Varianten pro Name, wo sinnvoll): `rifle_shot_indoor`, `rifle_shot_outdoor`, `rifle_tail_indoor`, `rifle_tail_outdoor`,
`rifle_mech`, `pistol_shot_indoor` (NPC), `pistol_shot_distant`, `dry_fire`, `mag_out`, `mag_in`, `mag_drop`, `bolt_release`, `charging_handle`,
`selector`, `light_click`, `casing_concrete`, `casing_wood`, `step_concrete`, `step_wood`, `step_carpet`, `step_tile`, `step_grass`, `step_asphalt`,
`gear_rattle`, `cloth_move`, `breath_calm`, `breath_heavy`, `door_open_creak`, `door_kick`, `door_close`, `impact_wood`, `impact_plaster`,
`impact_concrete`, `impact_metal`, `impact_glass`, `impact_flesh`, `glass_break`, `bullet_whiz`, `radio_chatter`, `radio_squelch`,
`ambient_night_suburb`, `ambient_rain_light`, `ambient_house_room_tone`, `siren_distant`, `dog_bark_distant`, `police_lightbar_hum`,
`suspect_shout` (ohne verständliche Wörter/Namen), `officer_shout_police` („Police! Show me your hands!“), `body_fall`, `ear_ringing`.

## Engine-Schnittstellen (ES-Module unter `public/bodycam-demo/js/`)

- `js/postfx/bodycam.js` (POSTFX): `export function createBodycamPost(renderer, scene, camera, opts) → { render(dt, state), setSize(w, h), setQuality('low'|'medium'|'high'), overlay }`
  `state = { time, angularVelocity: Vector3 (rad/s, Kameraraum), linearVelocity: Vector3, shake: 0..1, muzzleFlash: 0..1, damage: 0..1, exposureHint, flashlightOn }`.
  Verantwortlich für: Tonemapping/Grading, Auto-Exposure, Bloom, Fisheye/Linsenverzerrung, CA, Motion Blur, Rauschen, Überschärfung,
  Kompressionsartefakte, Rolling Shutter, Vignette, Bodycam-Overlay (Zeitstempel/Gerätekennung), Schadens-/Blendeffekte.
- `js/audio/engine.js` (AUDIO-ENGINE): `export async function createAudio({ manifestUrl, baseUrl }) → { unlock(), play(name, opts), gunshot({ weapon:'rifle'|'pistol', position, indoor, roomId, distance }), footstep(surface, speed), setListener(position, quaternion), setRoom(roomId, profile), setMasterVolume(v), update(dt) }`.
  Bodycam-Mikro-Kette am Master (hartes Limiting/Clipping bei Schüssen, Pumpen, leichtes Rauschen, Bandbegrenzung). Fallback-Synthese, falls Dateien fehlen (404) — die Demo muss ohne `audio/` laufen.
- Engine (ENGINE): `js/main.js` als Einstieg, Module unter `js/core/`, `js/player/`, `js/weapon/`, `js/ai/`, `js/fx/`, `js/world/`.

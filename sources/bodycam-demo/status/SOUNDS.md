# Status Baustein SOUNDS

Stand: Lauf 3 (14.10.) – **fertig** (alle 50 Pflichtnamen, 198 Clips, 8,2 MB).

## Fertig
- `public/bodycam-demo/audio/*.ogg` (Opus, 48 kHz; Punktquellen mono, Ambiences/Sirene stereo; gitignored) – 198 Dateien, 717 s, 8,2 MB.
- `public/bodycam-demo/data/sounds.json` – Manifest laut CONTRACT (`files`, `gain`, `desc`, `source` mit URL + Zeitstempel), Zusatzfelder `loop: true` / `stereo: true`.
- `sources/bodycam-demo/audio/fetch_sounds.py` (Treiber, reproduzierbar), `clips.py` (Schnittliste), `soundlib.py` (Kern), `SOUNDS.md` (Quellen, Hinweis Privatkopie).
- Testseite `public/bodycam-demo/_dev/sounds/index.html`: dekodiert alles per decodeAudioData (Headless-Chromium: 198/198 ok, Opus funktioniert, kein MP3-Fallback nötig) und spielt Clips per Klick ab.

## Varianten je Name
rifle_shot_indoor 5, rifle_shot_outdoor 5, rifle_tail_indoor 3, rifle_tail_outdoor 3, pistol_shot_indoor 5, pistol_shot_distant 5,
rifle_mech 3, dry_fire 3, mag_out 3, mag_in 4, mag_drop 4, bolt_release 2, charging_handle 2, selector 4, light_click 4,
casing_concrete 5, casing_wood 4, step_* je 5, impact_wood 3, impact_concrete 4, impact_plaster 3, impact_metal 5, impact_glass 4, impact_flesh 5,
glass_break 5, bullet_whiz 5, door_open_creak 4, door_close 5, door_kick 5, body_fall 2, gear_rattle 6, cloth_move 5, breath_calm 1 (Loop), breath_heavy 2 (Loop),
radio_chatter 8, radio_squelch 6, suspect_shout 6, officer_shout_police 4, siren_distant 2, dog_bark_distant 6, police_lightbar_hum 1 (Loop), ear_ringing 1,
ambient_night_suburb 2, ambient_rain_light 2, ambient_house_room_tone 2 (alle Loops).

## Übergabe AUDIO-ENGINE
- Punktquellen sind auf Peak -1 dBTP normalisiert; die relative Mischung steckt in `gain` (Schüsse 1.0, Schritte 0.35–0.5, Hülsen 0.35, Ambiences 0.45–0.5 …).
- `rifle_tail_indoor/outdoor`: zeitgleich mit dem Schuss starten (Transiente ist ausgeblendet, Pegel relativ zum Schuss → gain 1.0 = natürlich). `rifle_shot_*` enthalten bereits ihren natürlichen Raum; Tail nur für größere Räume/Außen dazulegen.
- `rifle_mech` leise (0.25) unter jeden eigenen Schuss. `gear_rattle` pro Schritt (nur Klappern, Schritt-Thump herausgefiltert).
- Loops (`loop: true`) nahtlos (Crossfade eingebacken) → `source.loop = true`, Start an zufälliger Position empfohlen.
- `siren_distant` (40 s/30 s, stereo) einmalig mit Pausen abspielen; `ear_ringing` 7 s mit langem Ausklang, nach Innenschüssen.
- `radio_chatter` enthält verständliche Leitstellen-Sprache (Bibliotheksaufnahmen); `suspect_shout` ohne verständliche Wörter.

## Erkenntnisse / Fallen
- YouTube: `ytsearch` funktioniert, aber jede Videoseite liefert „Sign in to confirm you're not a bot“ (auch nach Wartezeit, auch mit anderem player_client). Chrome ist nicht installiert → `--cookies-from-browser chrome` geht nicht. Andere Browser (Firefox, Brave, Arc …) existieren; nicht benutzt (Datenschutz, nicht freigegeben).
  → Alles aus den Lauf-1-Rohdateien. Ungenutzte Rohdateien gelöscht; die **119 genutzten (33 MB) liegen weiter in Scratch `bodycam/sound-raw/`**, weil sie derzeit nicht neu ladbar sind (vor Neustart sichern!). `fetch_sounds.py --raw <dir> --keep-raw` nutzt sie direkt.
- Werkzeuge (Scratch `bodycam/sounds/work/`): `scan.py overview|sheet` (Onsets + Spektrogramm), `check.py` (Prüfblatt fertiger OGGs).

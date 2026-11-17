# StemStage – Bauvertrag für alle Agenten

## Produkt
Web-App für den Musikunterricht: Ein Lehrer wirft einen QR-Code an die Wand, Schüler öffnen die App
auf dem Handy. Man sieht eine verspielte **3D-Band** auf einer Bühne (tanzt, Crowd davor, Lichtshow).
Jeder Musiker = ein Instrument-Stem (Gesang, Gitarre, Bass, Schlagzeug, Keyboard, Sonstiges).
Musiker antippen → Instrument geht **während der Song läuft** aus/an (sample-genau synchron).
Darunter **Spuren ("Lanes")** mit Wellenform, Mute-/Solo-Buttons, Seek. 3 Beispiel-Songs.
Mobile-first (Portrait-Handy), muss aber auch am Beamer/Desktop toll aussehen. UI-Sprache: **Deutsch**.
Look: "sexy" – dunkle Konzertbühne, Neon-Akzente, Glas-Panels, flüssige Micro-Animationen.

## Technik
- Rein statisch, **kein Build-Step**. ES-Module, `<script type="importmap">`.
- three.js: `"three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"`,
  `"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"`
- QR: `https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js` (globales `qrcode`).
- Lokal servieren: `cd app && python3 -m http.server 8080`.
- Keine weiteren externen Abhängigkeiten. Fonts nur über Google Fonts.

## Dateistruktur
```
app/
  index.html            (UI-Agent)
  css/style.css         (UI-Agent)
  js/main.js            (UI-Agent – verdrahtet alles)
  js/ui.js              (UI-Agent)
  js/audio-engine.js    (Audio-Agent)
  js/stage3d.js         (3D-Agent)
  songs/songs.json      (Demo-Song-Agent erzeugt, Pipeline-Agent ergänzt)
  songs/<songId>/<stemId>.mp3
tools/
  make_demo_songs.py    (Demo-Song-Agent)
  prepare_song.py       (Pipeline-Agent: yt-dlp + Demucs)
  README.md             (Pipeline-Agent)
```

## songs/songs.json
```json
{
  "songs": [
    {
      "id": "neon-nights",
      "title": "Neon Nights",
      "artist": "StemStage Demo",
      "bpm": 118,
      "duration": 72.0,
      "source": "demo",
      "stems": [
        { "id": "vocals", "label": "Gesang",    "instrument": "vocals", "file": "songs/neon-nights/vocals.mp3", "color": "#ff3d8b" },
        { "id": "guitar", "label": "Gitarre",   "instrument": "guitar", "file": "songs/neon-nights/guitar.mp3", "color": "#ffb020" },
        { "id": "bass",   "label": "E-Bass",    "instrument": "bass",   "file": "songs/neon-nights/bass.mp3",   "color": "#3dd6ff" },
        { "id": "drums",  "label": "Schlagzeug","instrument": "drums",  "file": "songs/neon-nights/drums.mp3",  "color": "#7cff4d" },
        { "id": "piano",  "label": "Keyboard",  "instrument": "piano",  "file": "songs/neon-nights/piano.mp3",  "color": "#b26bff" }
      ]
    }
  ]
}
```
- `instrument` ∈ `vocals | guitar | bass | drums | piano | other` (bestimmt Figur & Icon).
- Standardfarben: vocals `#ff3d8b`, guitar `#ffb020`, bass `#3dd6ff`, drums `#7cff4d`, piano `#b26bff`, other `#ff7a45`.
- Standardlabels: Gesang, Gitarre, E-Bass, Schlagzeug, Keyboard, Sonstiges.
- `file` ist relativ zu `app/`. Ein Song hat 3–6 Stems, Reihenfolge = Reihenfolge der Lanes.
- Alle Stems eines Songs haben exakt gleiche Länge und starten bei Sample 0.

## js/audio-engine.js  (`export class AudioEngine extends EventTarget`)
```
constructor()
async unlock()                      // AudioContext erstellen/resumen – im ersten User-Gesture aufrufen (iOS!)
async load(song, onProgress?)       // stoppt aktuellen Song, fetch+decode aller Stems parallel, onProgress(0..1)
play() / pause() / toggle()
seek(seconds)                       // funktioniert in Play & Pause
get currentTime  get duration  get isPlaying  get song
setEnabled(stemId, bool)  toggleStem(stemId)  isEnabled(stemId)
setSolo(stemId | null)  get soloId  // Solo erneut setzen auf gleiche id => aufheben (toggleSolo(id))
toggleSolo(stemId)
isAudible(stemId)                   // enabled && (soloId == null || soloId === stemId)
enableAll()
getLevel(stemId) -> 0..1            // geglätteter Pegel des Stems (auch wenn stumm: Pegel des *Signals*, damit Visuals wissen, ob "gespielt würde"), für Tanz/Visuals
getPeaks(stemId, buckets) -> Float32Array 0..1   // für Wellenform, gecacht
setMasterVolume(0..1)
```
Events (`CustomEvent`): `statechange` {isPlaying}, `stemchange` {stemId, enabled, audible, soloId},
`timeupdate` {currentTime} (~10×/s während Play), `ended`, `loaded` {song}.
Mute-Umschaltung mit Gain-Rampe (~25 ms, kein Klicken). Alle Stems über einen `AudioBufferSourceNode`
pro Stem, gemeinsam mit identischer `when`-Zeit gestartet → perfekte Synchronität.

## js/stage3d.js  (`export class Stage3D`)
```
constructor(containerEl, engine)    // erstellt Renderer/Canvas im Container, startet eigene rAF-Schleife
setSong(song)                       // baut pro Stem einen Musiker (nach instrument), stellt sie im Halbkreis auf
onMemberClick(cb)                   // cb(stemId) bei Tap/Klick auf Musiker (Raycast; Touch-tauglich)
highlight(stemId | null)            // optional: Hover/Fokus aus der Lane
dispose()
```
Liest pro Frame `engine.isPlaying`, `engine.isAudible(id)`, `engine.getLevel(id)`, `engine.song.bpm`, `engine.currentTime`.
Resize via ResizeObserver auf den Container.

## js/ui.js + main.js
`main.js`: lädt `songs/songs.json`, erstellt `AudioEngine`, `Stage3D`, UI; Song aus `?song=<id>` vorwählen;
Tap-to-Start-Overlay ruft `engine.unlock()`; Stage-Klick → `engine.toggleStem(id)`.

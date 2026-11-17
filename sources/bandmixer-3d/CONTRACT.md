# Shared Contracts — `stem-stage`

Project root: `/Users/logge/.gemini/antigravity/scratch/stem-stage`

## 1. Canonical Stem IDs, Order & Visual Palette
1. `vocals` — `label`: `"Gesang"`, `shortLabel`: `"Gesang"`, `color`: `"#f43f5e"`
2. `guitar` — `label`: `"E-Gitarre"`, `shortLabel`: `"Gitarre"`, `color`: `"#f97316"`
3. `bass` — `label`: `"E-Bass"`, `shortLabel`: `"Bass"`, `color`: `"#10b981"`
4. `drums` — `label`: `"Schlagzeug"`, `shortLabel`: `"Drums"`, `color`: `"#38bdf8"`
5. `keys` — `label`: `"Keyboard / Synth"`, `shortLabel`: `"Keys"`, `color`: `"#a855f7"`

## 2. Catalog Schema (`site/songs/index.json`)
```json
{
  "songs": [
    {
      "id": "american-idiot",
      "title": "American Idiot",
      "artist": "Green Day",
      "duration": 175.4,
      "bpm": 186,
      "accent": "#f43f5e",
      "manifestUrl": "./songs/american-idiot/song.json",
      "stemIds": ["vocals", "guitar", "bass", "drums"]
    }
  ]
}
```
Notice `manifestUrl` is relative to `site/` (e.g. `./songs/<slug>/song.json`).

## 3. Song Manifest Schema (`site/songs/<slug>/song.json`)
```json
{
  "id": "american-idiot",
  "title": "American Idiot",
  "artist": "Green Day",
  "duration": 175.4,
  "bpm": 186,
  "source": {
    "youtubeId": "kqkGY9jsBOw",
    "model": "htdemucs_ft+htdemucs_6s"
  },
  "stems": [
    {
      "id": "vocals",
      "label": "Gesang",
      "shortLabel": "Gesang",
      "color": "#f43f5e",
      "url": "./songs/american-idiot/vocals.mp3",
      "rmsDb": -14.2,
      "peaks": [0.12, 0.45, "... 240 floats in [0.0, 1.0] ..."]
    }
  ]
}
```
Notice `stems[i].url` is relative to `site/` (e.g. `./songs/<slug>/<stemId>.mp3`) so `fetch(stem.url)` works under both root `/` and subpath reverse proxies.

## 4. Network Info API (`GET /api/network-info` from `scripts/server.py`)
```json
{
  "lanIp": "192.168.178.167",
  "port": 8788,
  "suggestedUrl": "http://192.168.178.167:8788/"
}
```
Frontend (`qr-modal.js`) fetches `./api/network-info` with a short timeout (1200ms) and gracefully falls back to `window.location.href` when hosted statically on nginx.

## 5. `Stage3D` Contract (`site/js/stage3d.js`)
Imports Three.js modules strictly from `../vendor/three.module.js`, `../vendor/OrbitControls.js`, `../vendor/RoomEnvironment.js`.

```js
export class Stage3D {
  constructor(containerEl, { onToggleStem, onHoverStem })
  setAvailableStems(stemIds) // string[] of stem IDs present in current song
  setMutedState(mutedMap)    // { vocals?: boolean, guitar?: boolean, bass?: boolean, drums?: boolean, keys?: boolean } (true = muted)
  setAudioState({ isPlaying, stemLevels, totalEnergy, bpm, currentTime }) // stemLevels: { [id]: 0..1 }, totalEnergy: 0..1
  setCameraView(viewName)    // 'overview' | 'band' | 'crowd'
  resize()
  dispose()
}
```

## 6. `StemAudioEngine` Contract (`site/js/audio-engine.js`)
```js
export class StemAudioEngine {
  constructor({ onState, onTime, onLoad, onEnded })
  async activate()                 // resumes AudioContext synchronously on user gesture (Safari/iOS)
  async loadSong(manifest)         // fetches & decodes stem MP3s in parallel, releases prior buffers first
  async play()
  pause()
  seek(seconds)
  toggleMute(stemId)
  setMuted(stemId, muted)
  toggleSolo(stemId)
  setStemVolume(stemId, volume01)
  unmuteAll()
  getState()                       // { isPlaying, currentTime, duration, muted, soloId, volumes, availableStemIds }
  getStemLevels()                  // { levels: { [id]: 0..1 }, rawLevels: { [id]: 0..1 }, totalEnergy: 0..1 }
  dispose()
}
```

## 7. `renderQrSvg` Contract (`site/vendor/qrcode.js`)
```js
import { renderQrSvg } from '../vendor/qrcode.js';
const svgMarkup = renderQrSvg('http://192.168.178.167:8788/', 6);
```

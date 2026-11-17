# stem-stage (BandMixer 3D)

Interactive 3D band stage + synchronized DAW stem mixer with offline QR code sharing for classrooms.

> **Note:** Separated MP3 stems (`site/songs/*/*.mp3`) and vendored Three.js / QR-Code modules (`site/vendor/`) are hosted in [`../../public/bandmixer-3d/`](../../public/bandmixer-3d/) and excluded here to avoid duplication.

- **3D Stage (`site/js/stage3d.js`)**: Local Three.js venue with reactive lighting, three camera presets (`overview`, `band`, `crowd`), and click-to-toggle musicians (`vocals`, `guitar`, `bass`, `drums`, `keys`).
- **Web Audio Mixer (`site/js/audio-engine.js`, `site/js/lanes-ui.js`)**: Sample-accurate parallel MP3 decoding, per-stem Mute / Solo / Fader controls, 240-bucket waveform lanes, and keyboard shortcuts (`Space` Play/Pause, `1–5` Stems, `0`/`A` All on, `Q` QR code).
- **Classroom QR Code (`site/js/qr-modal.js`)**: Opens a crisp inline SVG QR code (`./api/network-info` LAN URL with fallback to `window.location.href` under static hosting) so students on the same Wi-Fi can scan and mix along on phones or tablets.

---

## Quick Start

1. Start the local HTTP server (supports byte-range requests and `/api/network-info`):

   ```bash
   python3 scripts/server.py --port 8788
   ```

2. Open `http://127.0.0.1:8788/` (or the printed LAN URL) in your browser.
3. Click **QR-Code** (or press `Q`) to project the join QR code for students.

---

## Adding Custom Songs (YouTube & Hybrid Demucs)

`scripts/add_song.py` fetches a YouTube track (`yt-dlp`), runs stem separation on the `logge-pc` GPU via Wake-on-LAN (or locally on Mac with `--local`), writes the stems and `song.json`, and updates `site/songs/index.json` via `scripts/build_catalog.py`.

```bash
# GPU offloading via logge-pc (Wake-on-LAN)
uv run python scripts/add_song.py --help

# Local Mac fallback (MPS / CPU)
uv run python scripts/add_song.py --local ...
```

To run separation and catalog generation directly on an existing audio file:

```bash
uv run python scripts/separate_song.py \
  --input work/raw/<slug>.wav \
  --slug <slug> \
  --title "Song Title" \
  --artist "Artist" \
  --youtube-id "<id>" \
  --out-dir site/songs/<slug>

python3 scripts/build_catalog.py
```

### Separation Pipeline (`scripts/separate_song.py`)

1. **Hybrid Two-Pass Inference**: Runs `htdemucs_ft` (`vocals`, `drums`, `bass`, `other`) and `htdemucs_6s` (`guitar`, `piano`, `other`).
2. **STFT Wiener Soft-Masking**: Splits `htdemucs_ft`'s `other` stem into `guitar` and `keys` using an STFT Wiener mask (`nperseg=4096`, `noverlap=3072`, Hann window) built from `htdemucs_6s` `guitar` vs. `piano + other`, preserving `guitar + keys == other_ft` sample-for-sample.
3. **Bleed Gate**: If `piano_6s` RMS `< -30.0 dBFS` and `keys / other_ft` energy `< 0.12` (unless `--force-5-stems` is passed), `keys` is merged back into `guitar` to keep a clean 4-stem rock arrangement without ghostly bleed.
4. **Metadata & Encoding**: Estimates integer BPM from drum onset autocorrelation, computes `rmsDb` and 240 normalized peak buckets, and encodes 44.1 kHz stereo 160 kbps MP3s via `ffmpeg`.

---

## Project Structure

```text
stem-stage/
├── CONTRACT.md                # Shared schemas, palette & module contracts
├── Dockerfile                 # nginx:1.27-alpine static container
├── nginx.conf                 # Static MIME (.mjs), Range/gzip-off audio & caching rules
├── pyproject.toml             # uv / Python 3.10–3.12 dependencies (demucs, torch, scipy, yt-dlp)
├── scripts/
│   ├── server.py              # Local Range HTTP server + /api/network-info
│   ├── separate_song.py       # Hybrid Demucs + STFT Wiener split + bleed gate
│   ├── add_song.py            # YouTube fetch + remote GPU (WoL) / --local pipeline
│   ├── build_catalog.py       # Generates site/songs/index.json from */song.json
│   └── verify_project.py      # Schema, ffprobe, PCM separation/reconstruction & import checks
├── site/
│   ├── index.html             # App shell (DE UI, relative asset paths)
│   ├── css/styles.css         # Responsive dark stage & mixer layout
│   ├── js/                    # app.js, audio-engine.js, stage3d.js, lanes-ui.js, qr-modal.js
│   ├── vendor/                # Self-hosted Three.js (r180) & QR SVG ESM modules (offline-safe)
│   └── songs/                 # index.json + <slug>/{song.json,vocals.mp3,...}
└── work/raw/                  # Downloaded WAV mixes & *.meta.json metadata
```

---

## Docker / nginx Deployment

Build and serve the static site (no external CDN dependencies, works at `/` or behind a subpath reverse proxy):

```bash
docker build -t stem-stage .
docker run --rm -p 8080:80 stem-stage
```

`nginx.conf` disables `gzip` on `.mp3`/`.wav` for clean byte-range seeking, serves `.mjs` as `application/javascript`, caches `/vendor/` and audio assets (`max-age=3600`), and marks HTML/CSS/JS/JSON manifests `no-cache`. When hosted statically without `scripts/server.py`, the QR modal automatically falls back to `window.location.href`.

---

## Verification

Run the full verification suite:

```bash
# Strict mode: requires american-idiot, in-the-end, get-lucky + all audio/import checks
python3 scripts/verify_project.py

# Pre-separation dry run (allows empty site/songs/index.json)
python3 scripts/verify_project.py --allow-empty
```

`verify_project.py` checks:
- `site/songs/index.json` and every `song.json` schema, canonical song/stem ordering, hex colors, `rmsDb`, and 240-bucket `peaks` in `[0.0, 1.0]`.
- `ffprobe` validation of every stem MP3 (`mp3`, `44100 Hz`, 2 channels, duration match, intra-song duration spread `<= 0.05s`).
- `ffmpeg` PCM decode against `work/raw/<id>.wav` (when present): pairwise stem distinctness (`|corr| < 0.7`) and lag-compensated (`±2500` samples) stem-sum mix reconstruction (`corr > 0.5`, positive residual SNR).
- Static HTML `src`/`href` and ES module `import`/`export ... from` integrity across `site/index.html`, `site/js/`, and `site/vendor/`.

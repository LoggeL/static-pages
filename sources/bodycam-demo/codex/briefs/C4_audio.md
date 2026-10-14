# Auftrag C4: Audio-Engine (Port 8952)

**Deine Dateien:** `public/bodycam-demo/js/audio/**`, `public/bodycam-demo/_dev/audio/**`, `sources/bodycam-demo/AUDIO.md`, `sources/bodycam-demo/status/C4.md`.

- Schnittstelle laut CONTRACT („Engine-Schnittstellen“): `createAudio({ manifestUrl, baseUrl })` → `unlock, play, gunshot, footstep, setListener, setRoom, setMasterVolume, update`.
  Zusätzlich Event-Adapter: `attachAudio(audio, bus)` reagiert auf `shot, dryFire, magOut, magIn, boltRelease, casingHit, impact, step, door, roomChange, lightToggle`.
- Manifest `data/sounds.json` (Felder `files, gain, loop, stereo, desc`); Dateien unter `audio/` (gitignored, können fehlen). Hinweise zur Mischung:
  `sources/bodycam-demo/status/SOUNDS.md` (Abschnitt „Übergabe AUDIO-ENGINE“) **genau befolgen** (Tails zeitgleich, rifle_mech 0,25, Loops nahtlos mit Zufallsstart …).
- Mikrofon-Kette am Master nach STYLE §8 und `BODYCAM_STYLE.audio`: HP 60 Hz, Präsenz +3 dB @ 2,5 kHz, LP 12 kHz, Kompressor (−24 dB, 6:1, 1 ms, 250 ms),
  Softclip (Drive 6 dB, Ceiling −0,3 dB), Rauschteppich −58 dB, Pumpen/Ducking der Ambience nach Schüssen, Tinnitus/`ear_ringing` nach nahen Innenschüssen.
- Nachhall: ConvolverNodes mit generierten IRs aus RT60 (Räume aus `layout.json` → `rooms[].reverb.rt60`; außen 2,0 s mit Hauswand-Echo); weiches Überblenden bei `setRoom`.
- Entfernung/Verdeckung: Pegel, Tiefpass, Laufzeit; Parameter `occlusion` 0..1.
- Variantenwahl ohne direkte Wiederholung, Pitch/Gain-Streuung; Ambiences innen/außen überblenden; Funk zufällig alle 40–90 s; Lichtbalken-Summen positional.
- **Fallback-Synthese**, wenn Dateien fehlen (404): prozedurale Schüsse, Schritte, Klicks, Ambience-Rauschen. Die Demo muss ohne `audio/` laufen.
- Alle Mischwerte zentral in `js/audio/mix-config.js` (Claude mischt später ab).
- Test: `_dev/audio/` mit Knöpfen pro Ereignis + automatischer OfflineAudioContext-Sequenz (Schüsse innen/außen, Schritte je Untergrund, Nachladen).
  Messe Peak, RMS, Clipping-Anteil und schreibe WAVs nach `$WORK/codex/C4/`; Spektrogramme per ffmpeg `showspectrumpic` ansehen.
  Beide Fälle testen: mit `audio/` und mit simuliertem 404 (Fallback).

# Status RECHERCHE (Lauf 3): FERTIG (2026-10-14 ~00:20)

## Fertig
- `research/STYLE.md` v1 (final) mit Messwerten: Projektion/FOV, Linsenmaske + Saum, CA, OSD-Layout @1080, Grading-Tabelle,
  Auto-Belichtung, Rauschen/Schärfe/Makroblöcke, Motion Blur, Gehen-Bob, Waffenposition Low-Ready/ADS, Waffenlicht,
  Mündungslicht/Feuerrate/Rückstoß, Nachlade-Timings (Reload 3,7 s / ReloadEmpty 2,9 s), Audio-Kette, JS-Parameterobjekt, Frame-Index, Quellen.
- Skripte: `research/scripts/` (u. a. plumb.py, lens_rotcal.py, maskprofile.py, burstaudio.py, curate.sh).
- 59 kuratierte Frames: `$WORK/ref/frames/ref_NN_*.jpg` (Kontaktbogen `ref/analysis/curated_sheet.jpg`).
- Videos gelöscht. Behalten: 1-fps-Frames `ref/all/`, Bursts, WAV-Spuren `ref/audio/` (für Audio-Engine/Sounds-Vergleich).

## Übergabe
- POSTFX: Projektion ist im Spiel rektilinear (hFOV 115°). Fisheye-Eindruck = Maske + Saum. Leichte Tonne k1 = 0,06 ist Vorschlag.
- ENGINE: vFOV 82°, Kamera 1,40 m, ADS: `W_SightEye` 0,13 m hinter der Optik, Optik zentriert.
- AUDIO: harte Clip-/Limiter-Kette, Tiefpass 12 kHz, Innen-RT60 0,9 s, Tinnitus 4078 Hz.
- ANIM: Event-Zeiten in STYLE.md §7 / `BODYCAM_STYLE.reload`.

## Fallen
- curate.sh braucht für die Burst-Frames (Nachladen/Schuss) die Video-Abschnitte; die sind gelöscht (Neuladen über die Quellen-Tabelle).
- yt-dlp lieferte „Sign in to confirm you're not a bot“ → Axon-Overlay nur aus Kenntnis.

# StemStage – Quellcode

Interaktiver Stem-Mixer für den Musikunterricht: Eine 3D-Band (Three.js) spielt einen Song, jeder Musiker ist eine Spur.
Antippen schaltet das Instrument mitten im Song stumm (sample-genau synchron per Web Audio). Mobile-first, QR-Code für den Beamer.

- `app/` – die App (statisch, kein Build-Step). Lokal: `cd app && python3 -m http.server 8080`.
  Unverschlüsselte Stems gehören nach `app/songs/<id>/*.mp3` (nicht im Repo).
- `tools/separate_hq.py` – Hochqualitäts-Trennung auf einer CUDA-GPU (audio-separator):
  Gesang mit Mel-Band-RoFormer, Rest mit BS-Roformer-SW (Gitarre, Bass, Drums, Piano, Sonstiges).
- `tools/import_stems.py` – WAV-Stems prüfen (stille Spuren verwerfen), MP3 kodieren, in `songs.json` eintragen.
- `tools/prepare_song.py` – All-in-one-Variante mit yt-dlp + Demucs (CPU/MPS).
- `tools/make_demo_songs.py` – erzeugt die drei frei verwendbaren Demo-Songs (eigene Kompositionen, numpy-Synthese).
- `tools/build_deploy.mjs` – baut `public/stemstage/`: echte Songs werden mit AES-256-GCM verschlüsselt
  (Schlüssel per PBKDF2-SHA-256 aus dem Klassen-Passwort), Demo-Songs bleiben frei.

## Urheberrecht

Die echten Songs sind urheberrechtlich geschützt und nur für den Unterricht gedacht. Sie liegen ausschließlich
verschlüsselt im Repo. Das Klassen-Passwort steckt im QR-Code der App (`#pw=…` im URL-Fragment, wird nie an den
Server gesendet) oder wird von der Lehrkraft genannt. Neues Passwort: `node tools/build_deploy.mjs --out <ordner> --password <neu>`.

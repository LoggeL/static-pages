# StemStage – Songs vorbereiten

Mit `tools/prepare_song.py` machst du aus einem echten Song eine StemStage-Band:

1. **Audio holen**: von YouTube (über `yt-dlp`) oder aus einer lokalen Datei (mp3, wav, flac, m4a …)
2. **Trennen** mit [Demucs](https://github.com/adefossez/demucs) (Meta, Hybrid Transformer Demucs) in
   Gesang, Gitarre, E-Bass, Schlagzeug, Keyboard und Sonstiges
3. **Aufräumen**: fast stille Spuren fliegen raus (oft das Keyboard), Tempo (BPM) wird grob geschätzt
4. **Kodieren** als MP3 (Stereo, 160 kbit/s, alle Spuren exakt gleich lang) nach `app/songs/<id>/`
5. **Eintragen** in `app/songs/songs.json` – danach erscheint der Song in der App

> **Urheberrecht – bitte lesen.** Das Werkzeug ist für den **Unterricht und die eigene Nutzung**
> gedacht. Getrennte Spuren kommerzieller Songs sind Bearbeitungen geschützter Werke. Nutze sie nur
> im Klassenraum bzw. im geschlossenen Kreis deiner Lerngruppe (in Deutschland u. a. § 60a UrhG,
> Unterricht und Lehre – mit Umfangsgrenzen) und **stelle sie nicht öffentlich ins Netz**, wenn du
> die Rechte nicht hast. Auch die Nutzungsbedingungen von YouTube schränken Downloads ein – am
> sichersten sind eigene Aufnahmen, lizenzfreie/CC-Musik oder Material, das deine Schule lizenziert
> hat. Das ist keine Rechtsberatung; im Zweifel die Medienberatung bzw. Schulleitung fragen.

---

## 1. Installation (macOS, einmalig)

Voraussetzungen: [Homebrew](https://brew.sh), etwa 3 GB freier Platz (PyTorch + Modelle).

```bash
brew install ffmpeg python@3.12 deno      # deno nur für YouTube-Downloads nötig

cd <Projektordner>
python3.12 -m venv tools/.venv
tools/.venv/bin/python -m pip install -U pip
tools/.venv/bin/python -m pip install -r tools/requirements.txt
```

Test:

```bash
tools/.venv/bin/python tools/prepare_song.py --help
```

Tipp: Existiert `tools/.venv`, startet sich das Skript bei Bedarf **automatisch** im venv neu –
`python3 tools/prepare_song.py …` funktioniert also auch ohne `source tools/.venv/bin/activate`.
Fehlt etwas (ffmpeg, yt-dlp, Demucs), sagt das Skript vorab genau, was zu tun ist.

### Stand der Abhängigkeiten (November 2026)

- **Demucs ≥ 4.1.0** (Juli 2026) ist die richtige Wahl: Es braucht **kein torchaudio** mehr (Audio
  wird über `sphn`/ffmpeg gelesen, WAV direkt geschrieben) und lädt Modelle mit
  `weights_only=False` – damit läuft es mit Python 3.12 und aktuellem PyTorch (≥ 2.6).
  Die Modelle kommen jetzt vom Hugging Face Hub.
- **Alte Demucs 4.0.1** (2023) scheitert mit torchaudio ≥ 2.9, weil `torchaudio.save` dort auf
  TorchCodec umgestellt wurde. Falls du aus irgendeinem Grund bei 4.0.1 bleiben musst:
  `pip install "demucs==4.0.1" "torch==2.5.1" "torchaudio==2.5.1" soundfile`.
- **Intel-Macs**: Demucs pinnt dort selbst `torch<2.3` – `pip` erledigt das automatisch, kein
  MPS-Beschleuniger, also nur CPU (langsam).
- **YouTube** verlangt von `yt-dlp` inzwischen eine JavaScript-Laufzeit: `brew install deno`
  (das Paket `yt-dlp[default]` aus der requirements.txt bringt den Rest mit). Wenn Downloads
  plötzlich scheitern: `tools/.venv/bin/python -m pip install -U "yt-dlp[default]"`.
- Beim **ersten Lauf** lädt Demucs das Modell herunter (je Modell ca. 80–350 MB, Cache unter
  `~/.cache/`).

---

## 2. Songs vorbereiten

```bash
# 3 Songs für eine Unterrichtsstunde (Titel/Künstler kommen aus den YouTube-Daten)
python3 tools/prepare_song.py --url "https://www.youtube.com/watch?v=AAAA" --id rock-klassiker
python3 tools/prepare_song.py --url "https://www.youtube.com/watch?v=BBBB" --id funk-groove --bpm 104
python3 tools/prepare_song.py --file ~/Musik/schulband-2026.wav --title "Unser Song" --artist "Schulband 7b"

# Nur einen Ausschnitt (z.B. Refrain von 0:45 bis 1:30) – schneller und urheberrechtlich sparsamer
python3 tools/prepare_song.py --url "https://www.youtube.com/watch?v=AAAA" \
    --start 45 --end 90 --id rock-refrain

# 6 Stems (Standard) vs. 4 Stems in besserer Qualität
python3 tools/prepare_song.py --file song.flac --model htdemucs_6s   # Gesang, Gitarre, Bass, Drums, Keyboard, Sonstiges
python3 tools/prepare_song.py --file song.flac --model htdemucs_ft   # Gesang, Bass, Drums, Sonstiges (sauberer, ~4× langsamer)

# Verwalten
python3 tools/prepare_song.py --list
python3 tools/prepare_song.py --remove rock-refrain           # mit Rückfrage
python3 tools/prepare_song.py --remove rock-refrain --yes     # ohne Rückfrage
```

Wichtige Optionen (alle: `--help`):

| Option | Bedeutung |
|---|---|
| `--id` | Kurzname für URL & Ordner (`a-z`, `0-9`, `-`). Ohne Angabe aus dem Titel gebildet. Gibt es die ID schon, fragt das Skript vor dem Ersetzen (`--yes` überspringt). |
| `--title`, `--artist` | Überschreiben die YouTube-Metadaten bzw. den Dateinamen. |
| `--bpm` | Tempo für die Tanz-Animation. Ohne Angabe grobe Schätzung (70–180) aus dem Schlagzeug-Stem; bei sehr schnellen Songs landet die Schätzung gern beim halben Tempo – dann einfach `--bpm` angeben. |
| `--start`, `--end` | Ausschnitt in Sekunden. |
| `--model` | `htdemucs_6s` (Standard, 6 Stems), `htdemucs_ft` (4 Stems, beste Qualität), `htdemucs` (4 Stems, schnell). |
| `--shifts` | Qualität vs. Zeit (Standard 2; `1` halbiert die Zeit, `5` ist sehr gründlich). |
| `--device` | `auto` (MPS auf Apple Silicon, sonst CPU), `mps`, `cpu`, `cuda`. Scheitert MPS, fällt das Skript automatisch auf die CPU zurück. |
| `--keep-silent` | Auch fast stille Spuren behalten. Schwelle mit `--silence-db` (Standard −35 dB relativ zur lautesten Spur). |
| `--bitrate` | MP3-Bitrate (Standard `160k`; `128k` spart Datenvolumen im Schul-WLAN). |
| `--keep-work` | Zwischendateien in `tools/.work/<id>/` behalten (sonst gelöscht). |

### Was Demucs kann – und was nicht

- **Zwei Gitarren** (z.B. Rhythmus- und Leadgitarre) trennt Demucs **nicht zuverlässig** – beide
  landen zusammen im `guitar`-Stem.
- `htdemucs_6s` liefert **Keyboard/Klavier** als eigenen Stem; der ist laut Demucs-Autoren der
  schwächste (Übersprechen, Artefakte). **Synthesizer, Streicher, Bläser** landen meist in
  „Sonstiges“ (`other`). Hat ein Song kein Klavier, ist `piano` fast still und wird automatisch
  weggelassen.
- `htdemucs_ft` kennt keine Gitarre/Keyboard-Spur (alles in „Sonstiges“), trennt Gesang, Bass und
  Schlagzeug aber am saubersten – gut für Gesangs- oder Rhythmus-Übungen.
- Alle Spuren werden **gemeinsam** pegelangepasst (nur abgesenkt, falls etwas übersteuern würde),
  damit die Lautstärkeverhältnisse wie im Original bleiben.

### Wie lange dauert das?

Grobe Richtwerte für einen **4-Minuten-Song**, `htdemucs_6s`, `--shifts 2` (stark rechnerabhängig):

| Rechner | Dauer |
|---|---|
| Apple Silicon (M1–M4) mit MPS | ca. 2–6 Minuten |
| Apple Silicon nur CPU | ca. 6–15 Minuten |
| Intel-Mac / ältere PCs (CPU) | ca. 15–40 Minuten |

`htdemucs_ft` braucht etwa 4× so lange (es sind vier Modelle). `--shifts 1` halbiert die Zeit,
ein Ausschnitt mit `--start/--end` verkürzt sie entsprechend. Tipp: Songs am Vortag vorbereiten.

---

## 3. App lokal starten

```bash
cd app
python3 -m http.server 8080
```

Dann im Browser: <http://localhost:8080> (oder direkt `http://localhost:8080/?song=<id>`).
Die App muss über einen Webserver laufen – ein Doppelklick auf `index.html` funktioniert nicht.

## 4. Im Klassenraum: Beamer + Schüler-Handys

1. Laptop und Schüler-Handys im **selben WLAN** (Schul-WLAN oder Hotspot).
2. App starten wie oben (`python3 -m http.server 8080` lauscht auf allen Netzwerk-Schnittstellen).
   Beim ersten Mal fragt die macOS-Firewall – „Erlauben“ wählen.
3. IP-Adresse des Laptops herausfinden:
   ```bash
   ipconfig getifaddr en0      # WLAN, z.B. 192.168.1.23
   ```
4. Auf dem Laptop die App über **diese IP** öffnen: `http://192.168.1.23:8080`
   (nicht `localhost` – sonst zeigt der QR-Code auf `localhost` und die Handys finden nichts).
5. In der App den **QR-Button** drücken und den Code an die Wand werfen. Schüler scannen ihn und
   landen direkt beim aktuellen Song.

Wenn die Handys die Seite nicht erreichen: Viele Schul-WLANs isolieren Geräte voneinander
(„Client Isolation“). Dann hilft ein Hotspot vom Laptop/Handy oder ein internes Hosting (s.u.).
Tipp: Mit `--bitrate 128k` und kurzen Ausschnitten wird das WLAN weniger belastet
(6 Spuren × 4 min × 160 kbit/s ≈ 29 MB pro Song und Gerät).

## 5. Hosting-Optionen

Die App ist **rein statisch** (kein Build-Schritt) – der Ordner `app/` kann auf jeden Webspace:

- **GitHub Pages**: Repository anlegen, Inhalt von `app/` hochladen, unter *Settings → Pages*
  aktivieren.
- **Netlify / Cloudflare Pages**: Ordner `app/` per Drag-and-drop hochladen.
- **Schulserver / Moodle-Webspace / NAS** im Schulnetz – oft die beste Wahl für echte Songs.

> **Wichtig:** Öffentlich hosten nur mit den **Demo-Songs** (selbst erzeugt) oder Material, für das
> du die Rechte hast (eigene Aufnahmen, CC-Lizenzen). Getrennte Spuren kommerzieller Songs gehören
> **nicht** auf eine öffentlich erreichbare Seite – auch nicht „versteckt“ unter einer geheimen URL.
> Für den Unterricht: lokal vom Laptop (Abschnitt 4) oder auf einem zugangsgeschützten Schulserver.
> Vor dem Veröffentlichen eigene Songs mit `--remove` entfernen bzw. `app/songs/` prüfen
> (`--list`).

---

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| `Python-Modul demucs fehlt` | Installation (Abschnitt 1) durchführen; das Skript nutzt `tools/.venv` automatisch. |
| `ffmpeg kann kein MP3` | `brew reinstall ffmpeg` |
| YouTube: „Sign in to confirm …“, „n challenge“ o.ä. | `pip install -U "yt-dlp[default]"`, `brew install deno`; notfalls Audio anders beschaffen und `--file` nutzen. |
| Demucs bricht auf MPS ab | Wird automatisch mit CPU wiederholt; dauerhaft: `--device cpu`. |
| Speicher knapp bei langen Songs | Ausschnitt mit `--start/--end` oder `--shifts 1`. |
| Falsches Tempo | `--bpm` angeben (Song einfach neu vorbereiten, `--yes` ersetzt ihn). |
| Song taucht in der App nicht auf | `--list` prüfen; Browser neu laden (Cache); läuft der Server im Ordner `app/`? |

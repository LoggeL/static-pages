# Gemeinsame Regeln für alle Codex-Aufträge (Bodycam-Tech-Demo)

Projekt: spielbare Browser-Tech-Demo im Stil des Spiels „Bodycam“ (Three.js 0.170.0, WebGL2, statisch, kein Build-Schritt).
Repo: `/Users/logge/Documents/Projects/static-pages`. Deploy-Ordner `public/bodycam-demo/`, Quellen und Doku in `sources/bodycam-demo/`.

## Vor dem Start lesen
1. `sources/bodycam-demo/CONTRACT.md`: Pfade, Achsen, Namen, Schnittstellen. **Verbindlich.**
2. `sources/bodycam-demo/NOTES.md`: Stand und Erkenntnisse.
3. `sources/bodycam-demo/research/STYLE.md`: gemessene Zielwerte (§10 enthält das Parameterobjekt `BODYCAM_STYLE`).
4. Die für deinen Auftrag genannten Dateien und `sources/bodycam-demo/status/*.md`.

## Deine Rolle
Du baust **Technik nach Vorgabe**: korrekt, robust, schnell, gut dokumentiert. Gestalterische Entscheidungen (Look, Stimmung,
Animationsgefühl, Set-Dressing, Texte, UI-Design) trifft später Claude. Wo du Geschmacksfragen berührst, nimm die Werte aus STYLE.md
oder einen neutralen, gut einstellbaren Standard und mach ihn **als Parameter zugänglich** (eine Konfig-Datei oder exportierte Konstanten),
statt ihn tief im Code zu vergraben.

## Harte Regeln
- **Git nur lesend.** Kein `commit`, `stash`, `checkout`, `reset`, `restore`, `clean`, `rebase`, `push`, kein Branchwechsel.
  Andere Aufträge arbeiten gleichzeitig im selben Arbeitsbaum.
- **Nur deine Dateien ändern** (Liste im Auftrag). Fremde Dateien lesen ja, ändern nein. Wenn du eine Änderung woanders brauchst,
  schreib sie als Vorschlag in deine Statusdatei.
- Nichts nach `docs/` bauen (`npm run build` **nicht** ausführen). `index.html` im Repo-Root und `README.md` nicht anfassen.
- Zwischenstände (Renderings, Logs, große Temp-Dateien) nach `$WORK = /Users/logge/Documents/Projects/bodycam-work/codex/<AUFTRAG>/`, nie ins Repo.
- Three.js nur per Importmap `https://cdn.jsdelivr.net/npm/three@0.170.0/...`, three-mesh-bvh `0.8.3` (jsDelivr ESM). Keine weiteren
  Laufzeit-Abhängigkeiten ohne Begründung in der Statusdatei. Werkzeuge zur Build-Zeit (z. B. gltf-transform per npx) sind ok.
- Lokaler Server für Tests: **eigener Port laut Auftrag**, z. B. `python3 -m http.server <PORT> --bind 127.0.0.1 -d /Users/logge/Documents/Projects/static-pages/public`.
  Server am Ende beenden.
- Headless-Screenshots mit WebGL (echte GPU): Playwright mit `executablePath` =
  `/Users/logge/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
  und `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`. Fertiges Tool: `node $WORK/tools/shot.mjs <url> <out.png> [--wait ms] [--keys ...] [--eval js]`.
- Blender 5.2 headless: `blender -b -P skript.py -- args`, Cycles-Device METAL. Homebrew-ffmpeg hat kein `drawtext`. Python: numpy und PIL ja, scikit-image nein.
- Keine echten Marken oder Logos.

## Fortschritt und Abschluss
- Halte `sources/bodycam-demo/status/<AUFTRAG>.md` laufend aktuell: fertig (mit Pfaden), in Arbeit, offen, Entscheidungen,
  Parameter zum späteren Tunen, bekannte Probleme, Schnittstellen für andere Aufträge.
- Teste, was du baust (Screenshots ansehen, Konsole fehlerfrei, Messwerte). Schreib die Testbefehle in die Statusdatei.
- Deine letzte Nachricht: knappe Zusammenfassung (Status done/partial/failed, Dateien, wie testen, offene Punkte).
- Nutze Sub-Agenten, wo es parallelisierbar ist, achte aber auf die Dateigrenzen.

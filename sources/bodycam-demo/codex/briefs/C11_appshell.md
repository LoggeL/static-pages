# Auftrag C11: App-Gerüst (Port 8960), startet nach C12, C3, C4, C5

**Deine Dateien:** `public/bodycam-demo/index.html`, `public/bodycam-demo/styles.css`, `public/bodycam-demo/js/main.js`, `public/bodycam-demo/js/app/**`,
`sources/bodycam-demo/status/C11.md`. **Nicht:** Repo-Root `index.html`, `README.md`, `docs/`.

- `index.html` mit Importmap (three 0.170.0, three-mesh-bvh 0.8.3), Canvas, UI-Container. `js/main.js`: `startDemo({ canvas, quality, onProgress, ui })`.
- Verdrahtet: Welt + Spieler (C12), Waffe (C3), Audio (C4, inkl. `attachAudio`), Post-FX (C5; Waffe in Layer 1), Event-Bus.
  Fehlt ein Modul oder Asset, mit klarer Meldung weiterlaufen (Fallback ohne Post-FX/ohne Audio).
- UI-Zustände als **schlichte, neutrale Platzhalter** (Gestaltung macht Claude): Laden mit Fortschritt, Start („Klicken zum Starten“, Qualität,
  Lautstärke, Steuerungsliste), Pause (Esc), Hinweis wenn `audio/` fehlt. Texte zentral in `js/app/strings.js`.
- Einstellungen in `localStorage` (try/catch).
- Spielablauf-Hooks vorbereiten (ohne Inhalte): `onIntro`, `onRoomEnter`, `onAllSuspectsDown`, `onPlayerDeath`, Funk-/Untertitel-API `ui.subtitle(text, ms)`.
- Abnahme: Screenshots aller UI-Zustände und von 6 Spielszenen (Spawn außen, Flur mit Licht, ADS, Schuss, Nachladen, Blick nach unten),
  Konsole fehlerfrei, FPS bei 1080p high gemessen. Liste der Integrationsprobleme zwischen den Modulen in der Statusdatei.

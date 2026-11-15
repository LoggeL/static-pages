# Grundstück · 3D-Begehung

Quelltext des Viewers unter `public/grundstueck-3d/`. Die Seite ist bewusst nicht in der
Galerie und nicht im Haupt-README verlinkt und trägt `noindex`.

Ein Gaussian Splat eines Gartengrundstücks (1,79 Mio. Splats, SOG-komprimiert, 28 MB), aus
einem 92-Sekunden-Begehungsvideo rekonstruiert, mit Messwerkzeugen im Browser: Strecke,
Fläche, Höhe, Höhenprofil entlang einer Strecke und Nachkalibrierung des Maßstabs.

## Bauen

```bash
npm install
cp ../../public/grundstueck-3d/scene/garden.sog public/scene/   # der Splat liegt nur einmal im Repo
npm run dev      # lokal ansehen
npm run build    # erzeugt dist/
```

Den Inhalt von `dist/` nach `public/grundstueck-3d/` kopieren und im Repo-Wurzelverzeichnis
`npm run build` ausführen (kopiert `public/` nach `docs/`).

## Aufbau

- `src/main.js` – Szene, Werkzeuge, Eingaben
- `src/picker.js`, `src/pick-worker.js` – Punktbestimmung: Ein Web Worker summiert die
  Gaußglocken entlang des Klickstrahls von vorn nach hinten auf und nimmt die Tiefe, bei
  der die Deckkraft 35 % erreicht (robuster als der erste getroffene Splat)
- `src/measure.js` – Messdaten, Flächenformel, CSV-Export, Speicherung im Browser
- `src/profile.js` – Höhenprofil über lotrechte Strahlen entlang der Strecke
- `src/overlay.js` – Linien, Punkte und Maßzahlen als SVG über dem 3D-Bild
- `public/scene/scene.json` – Titel, Transformation (Drehung, Maßstab), Startansicht

three.js 0.180.0 und Spark 2.4.0 sind exakt gepinnt.

## Maßstab

Kalibriert auf die mittlere Wegbreite von 2,00 m (im Modell 1,83 m bis 2,17 m);
Unsicherheit etwa ±5 %. „Oben“ stammt aus der mittleren Kamera-Hochachse, ausgerichtet an
Zaun und Tor (etwa ±2°).

# Grundstück · 3D-Begehung

Quelltext des Viewers unter `public/grundstueck-3d/`. Die Seite ist bewusst nicht in der
Galerie und nicht im Haupt-README verlinkt und trägt `noindex`.

Ein Gaussian Splat eines Gartengrundstücks (1,79 Mio. Splats, SOG-komprimiert, 28 MB), aus
einem 92-Sekunden-Begehungsvideo rekonstruiert, mit Messwerkzeugen im Browser: Strecke,
Fläche, Höhe, Höhenprofil entlang einer Strecke und Nachkalibrierung des Maßstabs. Aus dem
Katasterplan (1:500) eingepasst und einblendbar: die Flurstücke 214 und 215 mit Seitenlängen
und Fläche, die angrenzenden Flurstücke sowie der Kanal mit Schächten und einstellbarem
Schutzstreifen.

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
- `src/overlay.js` – Linien, Punkte und Maßzahlen als SVG über dem 3D-Bild, dazu Grenzen
  und Kanal
- `public/scene/scene.json` – Titel, Transformation (Drehung, Maßstab), Startansicht,
  Flurstücksgrenzen (`boundaries`) und Kanal (`sewer`) in Weltkoordinaten

three.js 0.180.0 und Spark 2.4.0 sind exakt gepinnt.

## Maßstab, Grenzen und Kanal

Maßstab und Lage stammen aus der Einpassung des Katasterplans: Mauer, Tor, Nachbargrenze und
Zaun treffen die Grenzen von Flurstück 214 im Mittel auf 15 cm. Der Weg ist danach am Tor
2,00 m breit. Die Höhen sind an den Schachtdeckelhöhen des Kanalplans ausgerichtet (etwa
±0,5°).

Die Grenzlinien sind auf etwa ±0,3 m eingepasst und kein amtlicher Grenznachweis; geprüft ist
die Lage nur an Flurstück 214. Die Breite des Schutzstreifens am Kanal ist eine Annahme –
verbindlich ist die Vorgabe des Kanalbetreibers.

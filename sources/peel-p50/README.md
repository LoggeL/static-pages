# Peel P50 · prozedurales 3D-Modell

Kein Bildgenerator, keine Fotos als Textur: Alles entsteht aus Code.

- `gen.mjs` beschreibt die Karosserie als Signed Distance Field (abgerundete Extrusionen mit Smooth-Union, geneigte Frontscheiben-Ebene, Radhäuser) und vernetzt sie per Surface Nets mit Newton-Projektion auf die Isofläche.
- Fenster, Dichtungen und die Türfuge sind 2D-Distanzfelder auf der Karosserie. Die Dreiecke werden an deren Isolinien zerschnitten (Marching Triangles), deshalb sind die Kanten sauber und nicht treppig.
- Anbauteile wie Räder mit Stollenprofil, Scheinwerfer, Leisten, Griff, Wischer, Spiegel und Innenraum sind Three.js-Primitive (Lathe, Tube, RoundedBox), die per Raymarching auf der Karosserie platziert werden.
- Export als GLB über den GLTFExporter in Node.

```sh
npm i three@0.170.0
node gen.mjs p50.glb 0.009   # Ausgabedatei, Gitterweite in Metern
```

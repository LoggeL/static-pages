# C6 Lightmap-Prüfseite

Start im Repo-Root:

```sh
python3 -m http.server 8956 --bind 127.0.0.1 -d public
```

Öffnen: `http://127.0.0.1:8956/bodycam-demo/_dev/lightmaps/`.

`?cam=x,y,z,yaw,pitch` bezeichnet die absolute Kameraposition in Metern (Y nach oben) und Winkel in Grad. Yaw 0 blickt nach −Z, positives Yaw nach links, positives Pitch nach oben. Ohne Parameter steht die Kamera 1,40 m über `level.playerSpawn.position`. Weitere Prüfparameter: `mode=baked|lighting|atlases|unlit`, `inspect=1`, `collision=1`, `fog=0`, `exposure=1`, `debug=1` (WASD ohne Pointer Lock).

Die Standardansicht verwendet ausschließlich Lightmaps. Die optionale Prüfleuchte ist ausdrücklich kein Teil des Bakes. Bewegliche Türen erhalten keine statische Lightmap; ihre dynamische Beleuchtung ist Aufgabe der Engine. Die Kamera fliegt frei und prüft keine Spielerkollisionen. Der Kollider-Modus zeigt die exportierte Kollisionsgeometrie und bewegt Tür-Kollider mit den sichtbaren Türen. Der Modus "Nur Lichtkarte" blendet Decals aus, weil die Lichtkarte selbst keine Deckkraftmaske enthält; im normalen Bake bleiben sie sichtbar.

`world.js` verwendet die vorhandene `createMaterialLibrary` für `M_`, `MU_` und `ME_`. Materialien werden je Atlas und Intensität geklont. Die Zuordnung wird aus glTF-Extras gelesen und gegen `level.meshes` geprüft. Originalnamen aus der glTF-Node-Zuordnung bleiben erhalten, auch wenn Three.js Blender-Suffixe wie `.001` bereinigt. `level.rooms.polygon` liegt in der XZ-Ebene. `EXT_meshopt_compression` wird durch den im erlaubten Three.js-0.170.0-Paket enthaltenen `MeshoptDecoder` unterstützt. Externe Decal-Bilder werden relativ zum GLB geladen.

Identische MU-Bilder können über normale glTF-BufferViews aus vorhandenen `models/props/*.glb` gelesen werden. Die Buffer-URI verweist dabei auf die Prop-Datei und der Byteoffset auf die Bilddaten innerhalb dieser Datei. Das funktioniert mit dem regulären GLTFLoader; die Abhängigkeiten und Hashes stehen in `level.bake.compression.sharedImageBuffers`. C7 und andere Asset-Optimierungen müssen nach einer Änderung dieser Prop-Dateien den C6-Export neu erzeugen, weil sich die Byteoffsets verschieben können. `house.glb` muss zusammen mit diesen Props und den externen Decals ausgeliefert werden.

`rgbm.js` dekodiert die ursprünglichen RGBA8-PNG-Werte ohne Canvas-Premultiplikation oder Farbkorrektur. Die PNG-Filter werden mit nativer `DecompressionStream('deflate')` rückgängig gemacht, ohne zusätzliche Laufzeitbibliothek. Dekodierung: `linearRGB = rgb * pow(alpha, multiplierExponent) * range`, jeweils mit `rgb` und `alpha` in `[0,1]`. Exponent und Range werden pro Atlas aus den Metadaten gelesen; ein fehlender Exponent bedeutet 1 (lineares RGBM). Exponent 2 hält dunkle Werte bei großen HDR-Ranges genauer fest. Erst nach der Dekodierung erfolgt die Umwandlung in `HalfFloatType` und die lineare Texturfilterung. Die DataTexture nutzt `NoColorSpace`, `flipY=false` und `channel=1` (glTF `TEXCOORD_1` entspricht Three.js `uv1`). Mipmaps bleiben aus, damit niedrigere Mip-Stufen keine Nachbarinseln vermischen. `lightMapIntensity=PI` wandelt die gebackene diffuse Strahldichte einer weißen Lambert-Fläche in Three.js-Bestrahlungsstärke um. Pro-Atlas-Range, Exponent und Intensität werden gegen die Mesh-Metadaten geprüft.

Zwölf RGBA-Half-Float-Atlanten mit 2048² Texeln benötigen 384 MiB pro vollständiger CPU- oder GPU-Kopie. Der Prüfviewer behält die CPU-Daten für Texelproben. Die PNG-Downloadgröße ist davon unabhängig.

Die Seite exportiert `window.__lightmaps` mit `ready`, `error`, `scene`, `camera`, `renderer`, `world`, `level`, `presets`, `config`, `setCamera(...)`, `getCamera()`, `setMode(...)`, `setInspection(bool)`, `setCollision(bool)`, `setFog(bool)`, `setExposure(number)`, `setDoor(id,angle)`, `stats()`, `sampleFrame()` und `resetMetrics()`. `window.__bodycam.ready` und `.stats()` unterstützen den C13-Harness.

Automatisierte Abnahme nach dem vollständigen Bake:

```sh
PLAYWRIGHT_MODULE=/Users/logge/Documents/Projects/bodycam-work/tools/node_modules/playwright/index.mjs \
  node public/bodycam-demo/_dev/lightmaps/acceptance.mjs
```

Die Abnahme verwendet Chrome 1243 und Metal, lehnt Software-Rendering ab und prüft PNG-Filter 0 bis 4, niedrige RGBM-Alpha-Werte, Half-Float-Genauigkeit, echte Shaderausgabe mit absichtlich unterschiedlichen UV0/UV1, Materialtrennung, Zuordnungen, Lichtfreiheit, Atlasbudget, Türbewegung und Scharniere, Fehlerkonsole und Requests. Der Bericht enthält SHA256-Hashes der tatsächlich geladenen C6-Dateien und gleicht die geladenen Prop-Buffer gegen die Exportmetadaten ab. Vier Raycasts auf importierte Küchenoberflächen sichern den behobenen MU-Bake-Fehler bei UV0 und Vertexfarben ab. Sie schreibt für elf Kamerapunkte jeweils Bake, Lichtkarte, Lichtkarte mit Diagnosebelichtung 16 und Prüfleuchte sowie zusätzliche Atlas-, Material- und Kollideransichten. Dunkelheit in Räumen ohne Lichtquelle wird als Messwert dokumentiert, ohne daraus einen technischen Fehler abzuleiten. Bilder müssen zusätzlich visuell auf Nähte, Lichtlecks und Flecken geprüft werden; die numerischen Prüfungen ersetzen das nicht.

Standardausgabe: `/Users/logge/Documents/Projects/bodycam-work/codex/C6/viewer/acceptance.json` und `screenshots/`. Variablen: `C6_WORK`, `C6_URL`, `CHROMIUM_PATH`, `PLAYWRIGHT_MODULE`. Keine Testdateien oder Screenshots werden ins Deploy-Verzeichnis geschrieben. Server nach Abschluss beenden.

# Waffenmodell prüfen

Statische Testseite mit Three.js 0.170.0. Aufruf über einen HTTP-Server mit
`public/` als Wurzel: `/bodycam-demo/_dev/weapon_model/`.

Die Seite lädt `../../models/carbine.glb` und prüft die unveränderte Grundpose vor
dem Hinzufügen von Hilfsobjekten. Studiolicht, Spotlicht, acht Ansichten,
Knotenachsen, Drahtgitter und isolierte Bauteile sind über die Oberfläche erreichbar.
Der Bewegungsschieber prüft nur Drehpunkte und Hierarchie; er ist kein Spielanimationsclip.
Die zentrale `createAssetLoaders({ renderer })`-Factory registriert Meshopt und
KTX2. Ihr `dispose()` läuft nach abgeschlossenem Parse auch im Fehlerfall;
die geladenen Modelle und Texturen bleiben Eigentum der Prüfseite.

## Offline-Abnahme

```sh
mkdir -p /Users/logge/Documents/Projects/bodycam-work/codex/C20/weapon/tools
curl --fail --silent --show-error \
  https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/meshopt_decoder.module.js \
  -o /Users/logge/Documents/Projects/bodycam-work/codex/C20/weapon/tools/meshopt_decoder.mjs
python3 public/bodycam-demo/_dev/weapon_model/validate.py \
  public/bodycam-demo/models/carbine.glb \
  --meshopt-decoder /Users/logge/Documents/Projects/bodycam-work/codex/C20/weapon/tools/meshopt_decoder.mjs \
  --json /Users/logge/Documents/Projects/bodycam-work/codex/C20/weapon/reports/validation.json
```

Python-Standardbibliothek. Für komprimierte GLBs sind zusätzlich Node und der
echte Decoder aus Three.js 0.170.0 erforderlich. Ein bereits vorhandenes Modul
kann per `--meshopt-decoder` oder `MESHOPT_DECODER` angegeben werden; nach dem
einmaligen Download braucht der Prüfer kein Netzwerk. Decoder und Berichte
liegen außerhalb des Repositories. Exitcode 0 bedeutet bestandene
Pflichtprüfungen, 1 bedeutet verletzte Vorgaben, 2 einen nicht lesbaren Export.
Der Aufruf ohne GLB-Pfad prüft das benachbarte `models/carbine.glb`.

Prüfungen: alle 15 Pflichtknoten genau einmal, Mesh-/Empty-Typen, aktive Szene,
vollständige W_Root-Hierarchie, kein separates CamPin, Magazinabmessungen und
Magazinunterobjekte, Lauf und Lampenrichtung, Auswurfrichtung, Länge 0,81 bis
0,87 m, Grenze 3.000.000 Byte, endliche Positions-/Normalendaten, Indexgrenzen,
Atlas-UVs, eingebettete Albedo-/ORM-/Normal-Texturen. Normierte Integer-Attribute
aus `KHR_mesh_quantization` sind unterstützt. `decode-meshopt.mjs` dekodiert
`EXT_meshopt_compression` einschließlich Filter aus den aktuell eingelesenen
GLB-Bytes. Source-Hash, Decoder-Hash, Bytezahlen und alle dekodierten
BufferView-Hashes stehen im Bericht. Ohne Decoder wird ein komprimiertes GLB
mit Exit 2 abgewiesen, statt virtuelle Fallback-Buffers als Geometrie zu lesen.
Unkomprimierte eingebettete GLB-Buffers bleiben ohne Node lesbar; Draco,
externe Buffer und Sparse-Accessors sind nicht Bestandteil des Exports.
Eingebettete WebP-Atlanten über `EXT_texture_webp` lädt Three.js mit dem nativen
Browserdecoder. Der Offline-Prüfer liest JPEG-, PNG- und WebP-Bildmaße
(VP8, VP8L, VP8X) ohne zusätzliche Bibliothek.

Die Achsenprüfung bezieht sich auf die exportierte glTF-Basis: lokale −Z von
W_Muzzle und W_LightEmitter zeigt nach Welt −Z. Der Blender-Exporter überführt
die lokale Blender-+Y-Richtung in diese glTF-Basis. W_Ejection verwendet lokale +X.
Die Länge wird aus allen tatsächlich transformierten Vertices bestimmt.

Geometrie- und UV-Dreiecke mit Fläche unter `1e-14` erscheinen als Warnungen.
Der Bericht enthält zudem Bildauflösungen und mittlere Texeldichten je Material.
Offline-Prüfer und Browserbericht liefern den SHA-256 des geprüften GLB
(im Browser über WebCrypto, auf localhost oder HTTPS).
Gleichmäßigkeit innerhalb einzelner Inseln, Nahtartefakte und schwarze Bake-Flecken
müssen anhand der Detailansichten und Atlanten visuell beurteilt werden.

## Browser-Automation

```js
await window.weaponTest.ready;              // Promise, Ergebnis = Prüfbericht
window.weaponTest.results;                  // unveränderte Abnahme-Grundpose
window.weaponTest.view('overview');         // auch left/right/top/receiver/muzzle/magazine/sight
window.weaponTest.light('spot');            // studio | spot
window.weaponTest.axes(false);              // Hilfsachsen aus für Screenshots
window.weaponTest.select('W_Mag');
window.weaponTest.pose('W_Mag', 1);          // 0..1, absolute Prüfpose
window.weaponTest.isolate(true);
window.weaponTest.reset();                  // alle Teile und Sichtbarkeit zurücksetzen
window.weaponTest.render();
```

Alle Licht-/Kamerawerte gehören ausschließlich zur Testseite. Einstellbare Werte
stehen in `VIEWER` in `viewer.js`, Prüfgrenzen in `LIMITS` in `checks.js` und als
entsprechende Konstanten im Offline-Prüfer. Die Seite verändert keine Quelldatei.

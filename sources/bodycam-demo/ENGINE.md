## Welt (C12)

Einstieg: `public/bodycam-demo/js/world/world.js` oder `js/world/index.js`.
Three.js 0.170.0 und three-mesh-bvh 0.8.3 kommen aus derselben Importmap wie auf
`_dev/world/index.html`. Keine weiteren Laufzeitabhängigkeiten und kein Build-Schritt.

```js
import { loadWorld, surfaceOf } from './world/world.js';
const world = await loadWorld(scene, {
  renderer, // begrenzt Anisotropie auf die tatsächliche GPU-Fähigkeit
  onProgress: ({ stage, progress }) => { /* progress: 0..1 */ },
});
```

Der Lader verwendet `models/house_shell.glb`, `data/layout.json`,
`textures/index.json`, `models/props/*.glb` und `textures/decals/*.png`.
Die veröffentlichte Layoutdatei ist eine unveränderte Kopie von
`sources/bodycam-demo/blender/layout.json`. Nach Layoutänderungen diese Kopie erneuern.

Rückgabe:

| Feld | Bedeutung |
| --- | --- |
| `colliders.static` | Unsichtbares Mesh mit zusammengeführter Positionsgeometrie und BVH in Weltkoordinaten |
| `colliders.doors` | Unsichtbare Meshes mit je einem BVH im lokalen Raum der bewegten Tür |
| `shootables` | Sichtbare Meshes mit beschleunigtem Raycast, Originalgeometrie und `userData` |
| `doors` | Türdatensätze mit Scharnierobjekt, Collider, Winkeln und Methoden |
| `rooms` | Raumdaten einschließlich `reverb`, Three.js-`Box3` als `bounds`/`aabb` und `contains(point)` |
| `roomAt(point)` | Präzise Raumprüfung, Teilrechtecke für Flur/Schlafzimmer, sonst Polygon/AABB, außerhalb `OUT` |
| `surfaceAt(point)` | Oberflächenname unter dem Fußpunkt per Abwärts-Ray; berücksichtigt Möbel und Teppiche |
| `floorHit(point)` | Vollständiger Boden-Ray-Hit auf einem Collider |
| `sourceOfHit(hit)` | Ursprüngliches Mesh zu einem Collider-Ray-Hit |
| `spawn`, `policeCar`, `suspects` | Umgerechnete Anker mit `position: Vector3`, `yawDeg`, `pitchDeg`, `rotationY` und `source` |
| `update(dt)` | Türen weiterbewegen; bei Nutzung des C12-Spielers erledigt dieser den Aufruf |
| `stats`, `missingProps` | Ladezeiten/Anzahlen und Liste nicht vorhandener Props |
| `dispose()` | Szene, BVHs, Materialien, Texturen und Lichtressourcen freigeben |

Blender `(x,y,z)` wird zu Three `(x,z,-y)`, `rotZ` in Grad zu Y-Rotation in Radiant.
Anker bewahren zusätzliche Metadaten. `policeCar` und `suspects` sind Platzierungsdaten,
keine erzeugten Fahrzeuge oder NPCs. Spawn hat standardmäßig `pitchDeg: -4`.
Nachträglich bewegte statische Möbel erfordern einen neuen statischen Collider.

`surfaceOf(object, materialIndex?)` sucht zuerst `extras.surface` (`userData.surface`)
in der Elternkette, danach den Materialnamen. Der zusammengeführte Collider speichert
die Oberfläche pro ursprünglichem Vertex; die BVH-Sortierung verändert die Zuordnung nicht.

Materialien werden pro Textur-ID geteilt. `M_<id>` benutzt Weltmeter-UV0 mit
`repeat=1/tileMeters`, RepeatWrapping und Anisotropie. Nur Albedo verwendet sRGB.
ORM belegt AO/Roughness/Metalness gleichzeitig; Roughness- und Metalness-Faktoren stehen
auf 1. `M_*` ohne Textureintrag behält die GLB-Farbe, `MU_*` die eingebetteten Texturen,
`ME_*` die importierte Emission. Glas ist transparent, Maschendraht verwendet Alpha-Test.

Das Prop-Inventar `js/world/available-props.js` vermeidet erwartbare 404-Anfragen.
Nach neuen oder gelöschten Prop-Dateien aus dem Repo-Root ausführen:

```sh
python3 public/bodycam-demo/js/world/refresh-props.py
```

Fehlende Props werden einmal per `console.info` gemeldet und ausgelassen.
Konfigurierbare Werte liegen in `WORLD_CONFIG`, `MATERIAL_CONFIG`, `DECAL_CONFIG`,
`DOOR_CONFIG` und insbesondere `js/world/lighting-config.js`. `loadWorld` akzeptiert
Overrides als `worldConfig`, `materials`, `decals`, `doors`, `lighting` und `baseUrl`.
Die Nachtbeleuchtung ist ein technischer Platzhalter, die spätere Lichtabstimmung bleibt offen.

Türen haben `object`, `collider`, `angle`, `targetAngle`, `maxAngle`, `openDir`,
`closedRotZ`, `isOpen`, `blocked` und `canMove`. Winkel beschreiben die Öffnung in Grad.
`setOpen(bool)` und `toggle()` setzen das Animationsziel. `setAngle(degrees)` setzt
unmittelbar den aktuellen Winkel; für eine Teststellung zusätzlich `targetAngle` setzen.
`update(dt)` dreht mit standardmäßig 100°/s um die importierte Scharnierachse.
Ein optionales `canMove()` prüft den vorgeschlagenen Transform und kann ihn zurückweisen;
das Ziel bleibt bestehen und die Tür versucht es im nächsten Schritt erneut.

## Touch und automatische Grafik

Die App unterstützt `controls: 'auto'|'touch'|'mouse'` und
`quality: 'auto'|'low'|'medium'|'high'`. `auto` ist die Voreinstellung.
`js/app/touch.js` erzeugt die Bildschirmsteuerung und räumt sie bei
Dispose auf. Virtuelle Tasten verwenden denselben Ereignisbus wie die
Tastatur; eigene Pointer-IDs halten Bewegung, Kamera und Feuer getrennt.

Die Eingabe ergänzt `setMode('pointer'|'touch')`,
`setVirtualKey(code, pressed, owner)`, `setMoveAxes(right, forward)`,
`getMoveAxes()`, `addLook(dx,dy)` und `reset(reason)`.
`setMoveAxes(null)` gibt die Achsen an die Tastatur zurück. Der Spieler
erhält analoge Werte innerhalb des Einheitskreises; die Kollision und
Bewegungsrichtung verwenden unverändert seine Blickrichtung.

`js/app/quality.js` kapselt Geräteklassen und Auflösungsanpassung.
`app.stats().graphics` nennt Modus, Geräteklasse, tatsächliche Stufe und
Auflösungsskalierung. Die Auswahl "Automatisch" wird getrennt von der
tatsächlichen Stufe gehalten. Pausen und große Zeitlücken setzen die
Messfenster zurück. Grafik-, Kontext- und Audioausfälle bleiben über
`stats().issues` sichtbar.

## Spieler und Eingabe (C12)

```js
import { createInput } from './core/input.js';
import { createPlayer } from './player/player.js';

const input = createInput(renderer.domElement, {
  debug: new URLSearchParams(location.search).get('debug') === '1',
});
const player = createPlayer({ camera, input, world,
  onStep: ({ surface, speed }) => audio?.footstep(surface, speed),
  onRoomChange: room => audio?.setRoom(room.id, room.reverb),
});
// Im Renderloop genau einmal:
player.update(dt); // enthält world.update(dt) in den Kollisions-Substeps
renderer.render(scene, camera);
```

Der Beispielcode setzt eine separat erzeugte Audioinstanz voraus. Welt/Spieler selbst
haben keine Audio-, Waffen-, Post-FX- oder NPC-Abhängigkeit. Vor dem Weltwechsel
`player.dispose()`, `input.dispose()`, `world.dispose()` aufrufen.

`PLAYER_CONFIG` in `js/player/config.js` stellt alle Physik-/Kamerawerte bereit.
Overrides über `createPlayer({config: {...}, bob: {...}})`:

| Größe | Standard |
| --- | --- |
| Kapsel | Radius 0,30 m, Höhe 1,80 m, geduckt 1,18 m |
| Tempo | Alt 1,0 m/s, Gehen 1,5 m/s, Shift 4,5 m/s, geduckt 0,85 m/s |
| Physik | 60 feste Ticks/s, je vier Substeps, Schwerkraft 22 m/s² |
| Stufenhilfe | Maximal 0,23 m, Aufstandsprobe vor der Kapsel für kurze 0,19-m-Tritte |
| Kamera | Brusthöhe 1,40 m, 0,12 m vor Körperachse, 4° nach unten, vFOV 82° |
| Maus | 0,002 rad/Pixel, Nachlauf-Zeitkonstante 60 ms |
| Lehnen | Q links/E rechts, 0,30 m und 10°, Kamera gegen Wände begrenzt |

Die Kapsel kollidiert per BVH-Shapecast mit dem statischen Weltmesh und den lokalen
Tür-BVHs. Die Collider erwarten starre oder gleichmäßig skalierte Transformationen.
Iterative Kontaktauflösung, Bodenschnappen, freie Kopfhöhe vor dem Aufstehen und
Stufenprüfung verhindern das Durchdringen von Zargen und niedrigen Decken.
Die Kontaktabfrage verwendet `ExtendedTriangle.closestPointToSegment` aus der
[offiziellen BVH-Implementierung 0.8.3](https://raw.githubusercontent.com/gkjohnson/three-mesh-bvh/v0.8.3/src/math/ExtendedTriangle.js).
Bodenschnappen sucht vertikal den ersten Kontakt und verschiebt den Spieler nicht
seitlich entlang einer geneigten Fläche.
Türen halten über `canMove` an, solange ihre neue Lage die Kapsel schneiden würde.
Ein Frame wird auf 100 ms begrenzt; verlorene Zeit ist in `stats().droppedTime` sichtbar.

`js/player/bob.js` enthält die unveränderten `BODYCAM_STYLE.bob`-Profile aus STYLE §10.
`BOB_TUNING` steuert Übergänge, optionale ADS-Dämpfung und Sprint-Rauschen.
Pitch und Schritt-Events teilen eine Phase, Yaw/Roll laufen mit halber Frequenz.
Im Stillstand und in der Luft entstehen keine Schritt-Events. Die Oberflächenprobe
verwendet die tatsächliche Geometrie, beispielsweise den Läufer im Flur.

`input.on(type, callback)` gibt eine Abmeldefunktion zurück. `input.emit(type,payload)`
ermöglicht weitere Ereignisse. `isDown(code)` nutzt DOM-Codes (`KeyW`, `ShiftLeft`,
`ControlRight`, `Mouse0`, `Mouse2`); `consumeLook()` liefert und leert `{x,y}` in Pixeln.
`locked` und `active` sind Getter. `requestLock()` liefert `Promise<boolean>`,
`exitLock()` und `dispose()` geben gehaltene Tasten/Maustasten frei.

| Ereignis | Auslöser/Inhalt |
| --- | --- |
| `keydown`, `keyup` | `{code, key?, repeat, synthetic, originalEvent}` |
| `look` | `{x,y,originalEvent}` |
| `interact` | E, einmal pro Tastendruck |
| `reload`, `flashlight`, `firemode`, `inspect` | R, F, B, V, einmal pro Tastendruck |
| `fire`, `aim` | LMB/RMB mit `{pressed:true/false}` |
| `action` | Kopie jeder benannten Eingabeaktion mit zusätzlichem `type` |
| `pause` | Esc oder verlorener Pointer Lock |
| `pointerlockchange`, `pointerlockerror`, `reset` | Lockstatus, Fehler beziehungsweise Zustandsbereinigung |
| `step` | Vom Spieler: `{surface,speed,position,room}` |
| `roomchange` | Vom Spieler: `{room,previous}` |
| `door` | Vom Spieler: `{door,opening}` |
| `respawn` | Vom Spieler: `{reason:'below-world'}` |

Ein Klick fängt die Maus ein, ohne dabei einen Schuss auszulösen. Fokusverlust,
verdeckte Seite und Freigabe des Pointer Locks erzeugen passende Release-Events.
Im Debugmodus funktionieren Tasten und Mausbewegungen über dem Canvas ohne Lock.
E bedient zuerst eine Tür im Fadenkreuz innerhalb von 2 m, mit Prüfung auf verdeckende
Wände. Dieser Tastendruck unterdrückt Rechtslehnen bis zum Loslassen. Ohne Türziel
dient E zum Lehnen. Ducken ist gehaltenes C oder Strg.

`player` hat `position` (Fußpunkt), `camera`, `physics`, `velocity`, `angularVelocity`,
`room`, `state`, `grounded`, `crouched`, `look`, `teleport`, `doorInView`, `interact`,
`stats` und `dispose`. `velocity` ist in Welt-Metern/s, `angularVelocity` in rad/s im Kameraraum.

Auf `_dev/world/?debug=1` steht die Debugschnittstelle bereit:

```js
__bodycam.teleport(x, y, z, yawDeg, pitchDeg);
__bodycam.look(yawDeg, pitchDeg);
__bodycam.stats();
__bodycam.player;
```

Koordinaten sind Three Y-up und beziehen sich auf die Füße. Yaw 0 blickt nach −Z,
positive Werte nach links. Pitch ist der tatsächliche Grundblickwinkel, positiv nach oben,
standardmäßig −4°. Nur die Testseite ergänzt `__bodycam.dev` mit Renderer, Szene,
Welt, Input, Ereignislog und einer schaltbaren Prüfleuchte (`F`, standardmäßig aus).
`stats()` ergänzt dort FPS, Draw-Calls, Dreiecke und Ressourcenanzahlen.

Abnahme und Reproduktionskommandos: `sources/bodycam-demo/status/C12.md`.

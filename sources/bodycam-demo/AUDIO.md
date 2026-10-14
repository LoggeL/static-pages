# Audio-Engine C4

Die Engine unter `public/bodycam-demo/js/audio/` läuft mit Web Audio ohne zusätzliche Laufzeitabhängigkeiten. Sie verwendet das Soundmanifest und lokale OGGs. Fehlende Dateien, Decode-Fehler und ein fehlendes Manifest führen zu prozeduralen Ersatzklängen.

## Einbindung

```js
import { createAudio, attachAudio } from './audio/engine.js';

// Beim Laden der Anwendung vorbereiten, vor dem Start-Klick.
const audio = await createAudio();
// Optional alle 198 Clips laden; alternativ eine Liste benötigter Klangnamen.
await audio.preload();
const detachAudio = attachAudio(audio, bus);

// unlock direkt im Pointer-/Tastatur-Handler aufrufen.
startButton.addEventListener('click', () => audio.unlock());

// Im Frame-Loop, Weltkoordinaten Y-up und Quaternion der Kamera:
audio.setListener(camera.position, camera.quaternion);
audio.update(dt);

// room ist ein Datensatz aus layout.rooms. OUT/PORCH sind Außenräume.
audio.setRoom(room.id, room.reverb);

// policeCar.position muss bereits nach Three-Koordinaten umgerechnet sein.
const hum = audio.play('police_lightbar_hum', { position: policeCar.position });
hum.setPosition(policeCar.position);
hum.setOcclusion(0.6);

// Beim Verlassen/Neustarten:
detachAudio();
await audio.dispose();
```

Ohne Parameter liegen Manifest und Audiodateien relativ zur Engine im Demo-Verzeichnis. Explizit: `createAudio({ manifestUrl, baseUrl })`; für `baseUrl` eine absolute URL des Demo-Verzeichnisses verwenden, einschließlich eines eventuellen GitHub-Pages-Unterpfads. Das Manifest enthält bereits `audio/` in seinen Dateipfaden. `baseUrl` zeigt deshalb auf das Demo-Verzeichnis und nicht auf dessen Audio-Unterverzeichnis.

`createAudio()` lädt zunächst das Manifest. Ereignisse warten nie auf Netzwerk oder Decoding: Noch nicht geladene Varianten spielen sofort als Synthese, während die Dateien für spätere Ereignisse im Hintergrund laden. Ein bereits gestarteter Loop behält seinen Buffer. Wer von Anfang an die Aufnahmen hören will, ruft vor `unlock()` bzw. dem ersten Ereignis `await preload()` auf. Fehlgeschlagene Downloads werden je Engine negativ gecacht. Nach Ergänzen der Dateien die Engine neu erstellen.

## API

| Methode | Verhalten |
|---|---|
| `unlock()` | Browser-Audio im Benutzerereignis freigeben; startet einmalig drei Ambience-Loops, Mikrofonrauschen und die Zeitplanung. Promise mit booleschem Ergebnis. |
| `play(name, opts)` | Synchroner Voice-Handle oder nach Dispose `null`. `opts`: `when`, `position`, `distance`, `occlusion`, `gain`, `loop`, `pitchCents`, `playbackRate`, `reverb`, `duration`, `fadeOut`. |
| `gunshot({weapon, position, indoor, roomId, distance, ...opts})` | Rifle/Pistol samt passenden Layern, Ducking und nahem Innentinnitus. Rückgabe: Liste der Handles. `own` überschreibt die Eigenschuss-Erkennung. |
| `footstep(surface, speed, opts)` | Ein Schritt; `speed` in m/s, bei 0 kein Klang. Eigene Schritte erhalten Gear und Mikrofonrumpeln. Ohne Position standardmäßig eigener Schritt; mit Position `own: true` setzen oder für NPCs `own: false`. |
| `setListener(position, quaternion)` | Arrays oder Objekte mit x/y/z bzw. w. Three.js-Vorwärtsrichtung ist −Z. Aktualisiert auch bewegte Entfernungen. |
| `setRoom(roomId, profile, {when})` | Weicher Wechsel von IR und Ambience. Profil kann `room.reverb` oder `{reverb: ...}` sein. |
| `setMasterVolume(v)` | Geglätteter Ausgangspegel 0 bis 1; 0 schaltet auch den Rauschboden stumm. |
| `update(dt)` | Pro Frame aufrufen. Plant Funk/Sirenen und räumt ausgeblendete Convolver auf. Zeitbasis ist `AudioContext.currentTime`, nicht aufsummiertes dt. |
| `preload(names?)` | Optionaler String oder Liste von Soundnamen; ohne Argument alle Dateien. Vier parallele Ladevorgänge, Timeout und 404-Cache. |
| `getDiagnostics()` | Lade-/Fallback-Zähler, aktive Quellen, Raumprofil, begrenzte Ereignishistorie und nächste Funk-/Sirenenzeit. |
| `dispose()` | Quellen stoppen, Graph trennen, Cache freigeben. Schließt nur einen selbst erzeugten AudioContext. Mehrfachaufruf ist erlaubt. |

`when` ist eine absolute Zeit in Sekunden auf der AudioContext-Uhr. Vergangene Zeiten werden auf jetzt begrenzt. Ohne Angabe wird sofort geplant. Offline-Ereignisse einschließlich Raumwechsel chronologisch planen, damit die jeweils gültigen Raumprofile angewendet werden. Die räumliche Laufzeit kommt zusätzlich als DelayNode hinzu; die normale Browser-/Kompressor-Latenz betrifft alle Ereignisse gleichermaßen.

Der Handle enthält `name`, `variant`, `file`, `fallback`, `startTime`, `arrivalTime`, `duration`, `offset`, `loop`, `playbackRate`, `finished`, `stop(when?, fade?)`, `setPosition(position)` und `setOcclusion(value)`. Eine bewegliche Quelle von Anfang an mit `position` anlegen. `finished` löst nach dem Ende der Quelle einschließlich Laufzeit auf; bei einem kürzeren Offline-Render spätestens durch `dispose()`. Ein früherer Stop kann einen bereits geplanten Stop vorziehen. Die maximale Stimmenzahl ist 96, auch für reine Loop-Last.

Für Tests zusätzlich möglich: `context: OfflineAudioContext`, `random: () => number`, `fetch`, `config` (partielle zentrale Mischkonfiguration), `autoStart: false`. Der zuletzt genannte Schalter unterdrückt automatische Hintergrundquellen und Scheduler, nicht explizite `play()`-Aufrufe. Kein eigener Timer läuft neben dem Frame-Loop.

## Event-Adapter

`attachAudio(audio, bus)` unterstützt `on/off`, `on/removeListener`, `on()` mit Rückgabe einer Abmeldefunktion sowie `EventTarget` mit `CustomEvent.detail`. Rückgabe ist eine mehrfach aufrufbare Detach-Funktion. Integrierende Module sollten den Adapter nur einmal an ihren Bus hängen.

| Ereignis | Klang / Daten |
|---|---|
| `shot` | Payload an `gunshot`; `weapon: 'rifle'|'pistol'`, `position`, optional `indoor`, `roomId`, `distance`, `own`. |
| `dryFire`, `magOut`, `magIn`, `boltRelease` | `dry_fire`, `mag_out`, `mag_in`, `bolt_release`. |
| `casingHit` | `surface`: Holz, Teppich, Stoff und Karton auf `casing_wood`, andere auf `casing_concrete`. |
| `impact` | `surface` auf Holz/Putz/Beton/Metall/Glas/Fleisch; `point` wird als Positionsalias akzeptiert. |
| `step` | `surface`, `speed`, optional `position`, `own`. |
| `door` | `action: 'open'|'close'|'kick'`; alternativ `open: false` für Schließen. |
| `roomChange` | `{ roomId, profile }` oder vollständiger Raum `{id, reverb}`. `null`/OUT führt nach außen. |
| `lightToggle` | `light_click`; der Tasterklick hat keine feste Weltposition. |
| `magDrop`, `chargingHandle` | Zusätzliche Animationsereignisse für `mag_drop`, `charging_handle`. |

Alle Ereignisse können `when` weitergeben, räumliche Ereignisse auch `position`, `distance`, `occlusion` und `gain`. Die Event-Anbindung führt keine Kollisionstests durch. Sicht-/Schallverdeckung als Zahl 0 bis 1 muss die Welt-/Gameplay-Integration liefern.

Schritte besitzen sechs Aufnahmegruppen. Die übrigen Contract-Tags sind zentral zugeordnet: Metall/Glas auf Fliese, Putz auf Beton, Erde auf Gras, Stoff/Fleisch auf Teppich und Karton auf Holz. Ausrüstung wird bei eigenen Schritten genau einmal mitgespielt. Für einzelne Animationsgeräusche können alle Manifestnamen auch direkt an `play` gehen.

## Mischung und technische Entscheidungen

Alle veränderlichen Misch-, Synthese-, Hall-, Streuungs- und Zeitplanwerte stehen in `js/audio/mix-config.js`. Das Manifest bleibt unverändert. Seine `gain`-Werte werden einmal mit dem jeweiligen Buspegel, optionaler Fallback-Korrektur, Aufruf-Gain und Streuung multipliziert. `rifle_mech` hat einen eigenen neutralen Bus: Manifestpegel 0,25, keine versehentliche zweite Multiplikation mit 0,25. Die Zufallsstreuung beträgt standardmäßig ±1,2 dB.

- Punktquellen und Hall werden am Mikrofon mono zusammengeführt. Stereo-Ambiences behalten maximal 20 % Breite. Das Lichtbalken-Brummen verwendet einen positionsabhängigen Loop; seine Position muss die Integration vom Fahrzeug liefern.
- Master: HP 60 Hz, Präsenz +3 dB bei 2500 Hz/Q 1, LP 12 kHz; Kompressor −24 dB, 6:1, 1 ms Attack, 250 ms Release. Einstellbares Makeup +12 dB gleicht die Kompression aus. Normiertes tanh-Softclipping mit +6 dB Drive/2× Oversampling, anschließend harter Sample-Ceiling bei −0,3 dBFS. Die Messung ist Sample-Peak, keine True-Peak-Zertifizierung.
- Rosa Mikrofonrauschen wird vor Ausgangspegel und finalem Ceiling eingespeist, nach dem Makeup. Damit bleibt es tatsächlich bei −58 dBFS RMS. Das 150-Hz-Handlingrumpeln wird vor der Mikrofonkette um Makeup/Drive kompensiert, ausgehend von −30 dB. Eigene Schritte übersteuern so nicht pauschal den Master.
- Schuss-Tails starten gleichzeitig mit dem Schuss. Aufgenommene Schüsse haben bereits natürlichen Hall, deshalb kleiner zusätzlicher Convolver-Send. Extra Tail nur außen oder ab Innen-RT60 0,95 s. Synthetische trockene Schüsse erhalten mehr Faltungshall. Die Tail-Schwelle ist ein neutraler, zentral einstellbarer Ersatz für eine noch nicht festgelegte Raumgrößenregel.
- Innenprofile übernehmen `rooms[].reverb.rt60`: LIV 0,55; KIT 0,8; HAL 0,65; BED1 0,75; CLO1 0,25; BATH 1; BED2 0,5; UTIL 0,9 s. Diese Werte liegen als Fallback im Mixobjekt; übergebene Raumprofile haben Vorrang. OUT/PORCH verwenden gemäß C4/STYLE 2 s, trotz der kürzeren Werte im aktuellen Blender-Layout. Außenreflexionen liegen bei 270/430/590 ms. Innen-Pre-Delay 8 ms, RT60-Hüllkurve −60 dB am Profilwert. Generierte IRs haben begrenzte Energie; `Convolver.normalize` ist aus. Raumwechsel: 350 ms Hall-, 650 ms Ambience-Überblendung.
- Entfernung: inverse Pegelabnahme, Höhenverlust und Laufzeit mit 343 m/s. Verdeckung: bis −18 dB und LP-Ziel 1000 Hz. Position/Verdeckung werden geglättet. Keine geometrisch berechneten Reflexionspfade.
- Schüsse drücken Ambience mit 4 ms Attack, 60 ms Hold und 650 ms Rückkehr. Nahe Innenschüsse bis 5 m lösen `ear_ringing` und kurzes Hör-Ducking aus. Die vorhandene Datei ist laut Manifest etwa 7,5 kHz: Playback-Rate 4078/7500 korrigiert sie auf STYLE. Begrenzung auf 7 s mit 1,5 s Ausblende, höchstens eine aktive Klingelspur. Die Synthese verwendet direkt 4078 Hz. 1,5 s Cooldown verhindert ständiges Neuansetzen.
- Varianten wiederholen sich bei mehreren verfügbaren Varianten nicht unmittelbar. Loops benutzen ihre eingebackene Naht und starten an zufälliger Bufferposition. Synthetische Loops bekommen eine deterministische Überblendungsnaht. Funk startet zufällig alle 40 bis 90 s. Sirenen sind einmalige Clips; die zufällige Pause beginnt erst nach dem Ende des vorherigen Clips.
- Ersatzklänge decken alle 50 Manifestnamen ab, ohne Dateien anzulegen. Kein Sprachmodell, kein Netzwerkanbieter und keine erfundenen gesprochenen Funksprüche. Sprachereignisse erhalten abstrakte Atem-/Rauschsignale; die inhaltlichen Texte gehören zur späteren Gestaltung.

## Prüfung und Integration

Testseite und reproduzierbare Befehle: `public/bodycam-demo/_dev/audio/README.md`. Zusätzlich führt `node public/bodycam-demo/_dev/audio/verify.mjs` gezielte Prüfungen mit echten Web-Audio-Nodes aus: Layer-Timing, Varianten, Raumprofile, fehlendes Manifest, negative Caches, Stop/Dispose, Loop-Limit, Laufzeit, Verdeckung, Lichtbalkenbewegung, Rauschboden, Mute, Ducking und Scheduler.

Messwerte und Artefaktpfade stehen in `status/C4.md`. Die technische Prüfung ersetzt keine abschließende Hör-/Stilabnahme durch Claude. Die spätere Hauptanwendung muss Startgeste, Eventbus, Listener, Raumwechsel und Fahrzeugposition anschließen; deren Dateien liegen außerhalb des C4-Auftrags.

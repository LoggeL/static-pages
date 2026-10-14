# C19 NPC-Prüfung

Die Seite lädt die echte App, `house.glb`, `house_collision.glb`, Türen, Spieler,
Karabiner, FP-Arme, Audio-Engine und drei NPCs. `officer.glb` dient als geriggter
Platzhalter. Es gibt keine Ersatzwelt oder simulierten Netzantworten.

```sh
python3 -m http.server 8968 --bind 127.0.0.1 -d public
# http://127.0.0.1:8968/bodycam-demo/_dev/npc/?npcdebug=1
```

WASD bewegt den Spieler, Ziehen mit der Maus dreht die Kamera. Die Schalter
setzen Zustände, Räume und Türwinkel ausdrücklich. Der NPC-Schuss verwendet
die echte `S_Muzzle`-Position und den Welt-Raycast. "Neue Instanzen" entsorgt
die vollständige App und lädt sie erneut. Die leere Szene lässt sich mit
`?npcs=0&npcdebug=1` als direkte technische Kontrolle öffnen.

Die neutrale Ausgabe und ihre Lichter gehören nur dieser Prüfseite. Alle Werte
stehen in `TEST_CONFIG` in `main.js`. "Neutrale Prüfausgabe" schaltet auf die
eigentliche Post-FX-Ausgabe um. Pfad und Sichtkegel kommen aus dem NPC-Modul;
die Kapsellinien in `capsules.js` lesen die echten Knochen-Endpunkte und Radien.
Die Seite wählt vor `resume()` den nativen stummen Chromium-Sink
`AudioContext.setSinkId({type:'none'})`. Die echten Aufnahmen werden geladen
und dekodiert; der Standard-Geräteausgang wird damit nicht geprüft.

Die öffentliche App bleibt unter `window.__bodycam` erhalten. Zusätzlich:

```js
npcTest.freeze(true);
npcTest.select('S1');
npcTest.moveTo('S1', 'BED1', {allowDoorPush:true});
npcTest.step(1);
npcTest.setState('S1', 'surrender');
npcTest.teleportNPC('S1', [-0.28, 0.603, -4.95], 180);
npcTest.inspect('S1');
npcTest.debug(true);
npcTest.neutral(false);
npcTest.stats();
await npcTest.rebuild();
```

Die rAF-Zahl im HUD gehört der Prüfseite. Ihre zusätzliche rohe Darstellung
und die manuelle Debug-Simulation sind kein Produktions-FPS-Vergleich.
Die Regression misst den Vergleich separat in der unveränderten App.

```sh
node sources/bodycam-demo/tools/harness/npc-suite.mjs --only npc --out /Users/logge/Documents/Projects/bodycam-work/codex/C19/neuer-npc-lauf
```

Der Runner verwendet den vorhandenen Harness-Server auf Port 8968, den
installierten Chromium und ANGLE Metal. Er schließt seinen Browser und seinen
Server am Ende. Der Ausgabeordner muss leer und außerhalb des Repos sein.
`report.json` enthält Rohwerte, Browser- und Netzwerkdiagnostik und Quellhashes;
`report.html` verlinkt die Prüfungen und Screenshots. Fehler werden gewertet,
einschließlich fehlgeschlagener Requests und App-Fallbacks.

`npc-regression.mjs` exportiert `runNPCRegression({page,origin,out})` für eine
spätere Einbindung in `suite.mjs`. C19 verändert die vorhandene Suite nicht.
Die neue Gruppe deckt Türdurchlauf, unabhängige BVH-Kapselabstände, Sicht,
Raumdämpfung, echte Waffen-/Spielereignisse, die vier Trefferzonen, NPC-Schüsse,
Zustände und Callback-Hooks sowie Dispose/Neuaufbau ab. Der Leistungstest
vergleicht drei wechselnde Paare mit gleicher Kamera, Qualität und Auflösung:
0 gegen 3 sichtbare NPCs bei Qualität high und 1920 × 1080, jeweils 3 Sekunden
nach 1,5 Sekunden Aufwärmen.
Die Grenzen sind mindestens 90 % der Basis-FPS und höchstens 3 ms zusätzliche
p95-rAF-Zeit. Gemessen wird rAF, keine isolierte GPU-Zeit.

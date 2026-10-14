# Kameralisten für C20

Erzeugen: `node sources/bodycam-demo/tools/harness/generate-shots.mjs`.
Prüfen: gleicher Befehl mit `--check`. Elf Listen, insgesamt 104 geplante Shots.

| Datei | Inhalt |
| --- | --- |
| world.json | 11 Räume/Wege, gebackene Welt |
| world-legacy.json | Dieselben 11 Punkte, `lightmaps=0`, ursprünglicher C13-Ladepfad |
| weapon-model.json | 8 Ansichten der Meshopt-kompatiblen `_dev/weapon_model`-Prüfseite |
| weapon.json | App-Viewmodel: Low-Ready, ADS, Schuss, Einschläge, Hülsen, Nachladen |
| postfx.json | C5-Testszene: still, spin, dark, gehaltenes Testfeuer, raw |
| lightmaps.json | 11 Kamerapunkte der C6-Prüfseite, echte `setCamera`-API |
| app.json | Start, außen und alle Räume, Waffenlicht, ADS, Schuss, Nachladen, Blick nach unten, Pause |
| app-lightmaps.json | Außen, Flur, Bad und Waschküche, jeweils `lightmaps=1/0` |
| character.json | Alle 6 statischen Charakterposen mit rohem Gewichts-Audit |
| arms-shots.json | 10 eingefrorene FP-Posen, Handkontakte und Finger |
| npc-shots.json | 8 NPC-Ansichten, echte Türnavigation und Zustände |

Beispiel ab Repo-Root:

```sh
node sources/bodycam-demo/tools/harness/run.mjs --shots sources/bodycam-demo/tools/harness/shots/app.json --out /Users/logge/Documents/Projects/bodycam-work/codex/C20/new-app
```

Der Generator speichert Layout-SHA und Blender-Koordinaten je Punkt.
Umrechnung `[x,y,z] -> [x,z,-y]`; Teleport verwendet die Fußposition, die
C6-Kamera `floorZ + 1.40 m`. Die Punkte liegen auf freien Wegen, nicht in
Raum-AABB-Mitten. Polygongrenzen und bestehende Katalog-Footprints werden
geprüft. Diese konservative Planung ersetzt nicht die echten Collider-/Bildprüfungen;
im schmalen Einbauschrank bleiben nur 1 cm Kapselreserve pro Seite.

Die Welt adaptiert das echte `stats().ready`; Post-FX das echte
`postfxDemo.ready`-Promise; das Waffenmodell `weaponTest.ready`. Abgewiesene
Promises bleiben Fehler. Die C9-Seite wird nicht durch einen Harness-Decoder
repariert. App-Listen prüfen, dass alle Module vorhanden und keine Fallbacks
aktiv sind, starten über `resume()`. Der Runner wählt den nativen Audioausgang (`none` als Standard oder `--audio-sink default`) vor `setup`.
Die App-Liste fotografiert vorher den Startdialog und beendet sich mit echtem
Escape und geprüftem `paused`-Zustand. Lightmap-Paare prüfen `world.stats.lightmaps`.

Kurze Waffenereignisse haben kein nachgelagertes FPS-Wartefenster vor dem
Screenshot. Nachladen wird über `dev.freeze(true)` und `dev.step(1.3)` exakt 1,3 s nach
`reload()` erfasst; Zustand und Fortschritt werden geprüft. Im folgenden
App-Shot wird die rAF wieder freigegeben. Der Zwei-Frame-Blitz
ist mit laufender rAF nicht framegenau garantiert. Holz/Putz/Metall sind
beabsichtigte Zieloberflächen; die Bilder allein beweisen keine Trefferklassifikation.
C5s gehaltenes Mündungsfeuer misst nicht die reale Blitzdauer.

FP-Readiness und Statistiken werden ausschließlich vom echten `fpTest`
weitergereicht. Die Posen entstehen mit dessen `createInstances`, `freeze`
und `step`; kein Pose- oder Asset-Mock. Die mobile Größe ist ein funktionaler
Check der Armregression. NPC-Bilder verwenden die reale `npcTest`-Prüfseite,
Officer-Platzhalter und debug-Kapseln. Der Pfad passiert die echte BED1-Tür,
Ankunft und Zustand werden geprüft. Fehlende NPC-Clips bleiben sichtbar.
Für die S3-Modellansicht wird diese echte Instanz ausdrücklich in den freien
Flur versetzt: Im engen CLO1 setzt `npcTest.inspect()` die Kamera ins Modell.
Die ursprünglichen Spawn-/Projektionsdaten bleiben in der Diagnose; die
funktionale NPC-Gruppe prüft die tatsächlichen Spawnpositionen getrennt.

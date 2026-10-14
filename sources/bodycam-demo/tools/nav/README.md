# C19 Navigation

`bake.py` liest das ausgelieferte Kollisions-GLB und `data/level.json`. Das
Ergebnis ist `public/bodycam-demo/data/nav.json`. Python 3 und numpy werden
ausschließlich für den Bake benötigt. Der Browser erhält keine neue Abhängigkeit.

```sh
python3 sources/bodycam-demo/tools/nav/bake.py
python3 sources/bodycam-demo/tools/nav/check.py --report /Users/logge/Documents/Projects/bodycam-work/codex/C19/nav/check.json
```

Die Ausgabe enthält keine Uhrzeit oder Zufallswerte. Die Bytegleichprüfung ist
mit einem zweiten Bake außerhalb des Repos reproduzierbar:

```sh
python3 sources/bodycam-demo/tools/nav/bake.py --output /Users/logge/Documents/Projects/bodycam-work/codex/C19/nav/repro-nav.json
cmp public/bodycam-demo/data/nav.json /Users/logge/Documents/Projects/bodycam-work/codex/C19/nav/repro-nav.json
```

SHA-256,
Dreieckzahlen und Namen der sieben ausgeschlossenen dynamischen Türblätter
stehen in den Metadaten. Der NPC-Modellpfad wird beim Bake festgelegt:
`models/suspect.glb`, wenn vorhanden, sonst `models/officer.glb`. Nach dem
Hinzufügen des Verdächtigen genügt ein erneuter Bake.

Gewählt wurde ein 10-cm-Raster mit A*: Das kleine, überwiegend horizontale
Level besitzt bereits vereinfachte Kollisionsgeometrie einschließlich Möbeln
und Schwellen. Jede Zelle braucht Boden unter neun Proben der Kapsel und Platz
für den Körper (Radius 24 cm, Höhe 1,75 m). Jede Kante erhält eine Mittelpunkt-
prüfung. Freie ebene Korridore verwenden zusätzlich eine geometrische
Abstandsschranke; nahe Hindernissen und Stufen wird in höchstens 3,5-cm-
Abständen geprüft. Eine Diagonale braucht beide freien seitlichen
Korridore. Auf einer kontinuierlichen Rampe wird der geometrische Höhenabstand
der Kapsel zu ihrer Ebene berücksichtigt. Sprünge zwischen Bodenflächen bleiben
auf 23 cm begrenzt.

Getrennte Komponenten bleiben getrennt. Raumziele enthalten ihre Komponente
und ob diese mit der Hauptkomponente des Hauses verbunden ist. `UTIL` ist bei
den vorgegebenen Kapselmaßen durch die echten Möbelboxen getrennt: Ein Regal
steht vor dem Flurzugang, der Zugang aus der Küche liegt zwischen
Kühlschrankboxen. Der Bake fügt keine Kante durch diese Hindernisse hinzu.
`spawns` enthält Rohpositionen, Kapselprüfung und eine Projektion im selben
Raum in die Hauptkomponente. Die Laufzeit dokumentiert ihre Anwendung separat.

`check.py` prüft die Kapselgeometrie aller Zellen, die Mittelpunkte aller
Innenraumkanten und aller Kanten mit Höhenänderung. Nachbarschaft, Symmetrie,
Komponenten und diagonale Korridore werden für sämtliche Kanten geprüft. Es
behauptet keine unabhängige geometrische Vollprüfung aller ebenen Außenkanten;
deren Mittelpunktprüfung erfolgt im Bake. `--report` akzeptiert ausschließlich
Pfade außerhalb des Repos. Bakevarianten mit `--output` ebenfalls, zusätzlich
zum regulären Ziel `data/nav.json`.

## Laufzeitschnittstelle

`createNavigation({world, data, config})` in `js/npc/navigation.js`:

- `plan(start, goal, {allowDoorPush:true})` liefert `{status, points, nodes, doors,
  distance, projectedStart, projectedGoal}`. `status:'unreachable'` enthält
  `reason` und leere Arrays. Start und Ziel werden innerhalb desselben Raums
  projiziert und brauchen einen statisch freien direkten Zubringer.
- `nearest(point, {roomId, maxDistance, preferMain:true})` liefert `Vector3` oder
  `null`. Für die ausdrücklich erlaubte Spawnprojektion `roomId` angeben.
- `roomGoal(roomId, start)` liefert einen geprüften Zielpunkt, auch in einer
  getrennten Komponente. `plan` meldet dann die tatsächliche Unerreichbarkeit.
- `canMove(start, end, {allowDoorPush:false})` prüft die echten BVHs einschließlich
  Türblättern bei ihrem aktuellen Winkel und den Rasterboden. Mit
  `allowDoorPush:true` wird ausschließlich der statische Zubringer geprüft.
- `doorAhead(position, target, maxDistance)` findet das erste aktuelle Türblatt
  auf dem lokalen Wegstück. `pushDoor(door, position,
  {unlatch:false,strength:120})` gibt einen positiven `door.impulse` am Griff.
  Zum Entriegeln ist ausdrücklich `unlatch:true` nötig. Der Griff muss höchstens
  1,2 m vom Fußpunkt des NPCs entfernt sein, horizontal gemessen.

Ein Plan mit Türschub berücksichtigt Türblätter am maximalen offenen Anschlag.
Ohne Schub verwendet er den aktuellen Winkel und sperrt Türen, die die
Welt-API als geschlossen bezeichnet. Der Wegfolger wartet anschließend auf
tatsächliche Kapselfreiheit. Türblätter werden weder teleportiert noch deaktiviert.

Alle Punkte sind Fußpunkte in Three.js Y-up, Meter. Agentmaße dürfen die Maße
des Bakes nicht überschreiten. Türkosten, Kapselmaße, Probenabstand und
Griffabstand bleiben Parameter.

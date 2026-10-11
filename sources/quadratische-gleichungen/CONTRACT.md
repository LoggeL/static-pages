# Quadratische Gleichungen ohne Formel · Vertrag für alle Agenten

## Worum es geht
Eine **handyoptimierte Lernseite** für Schülerinnen und Schüler der Mittelstufe (Klasse 9, Gymnasium/Realschule plus, Rheinland-Pfalz), die sich auf eine **HÜ** (kurze schriftliche Überprüfung) vorbereiten. Thema: **Quadratische Gleichungen auf drei Arten lösen – ohne Lösungsformel** (keine p-q-Formel, keine abc-/Mitternachtsformel; die Formeln werden höchstens am Rand als „kommt später“ erwähnt, nie benutzt).

Die drei Wege:
1. **Grafisch lösen** (Nullstellen der Parabel ablesen; Variante: Normalparabel mit Gerade schneiden; immer Probe!)
2. **Faktorisieren + Satz vom Nullprodukt** (x ausklammern, binomische Formeln rückwärts, Produkt-Summen-Trick / Satz von Vieta; Sonderfall reinquadratisch: x² = k → Wurzel ziehen, ±!)
3. **Quadratische Ergänzung** (auf binomische Formel ergänzen, Wurzel ziehen, ±)

Manche Lehrkräfte zählen „Wurzel ziehen“ (reinquadratische Gleichungen) als eigenen Weg. Deshalb kommt er ausführlich vor (im Kapitel Faktorisieren als eigener Abschnitt und in Grundlagen).

Zweites Publikum: eine **Nachhilfelehrkraft** (der Seitenbetreiber), die mit dem Material eine Nachhilfestunde gibt.

## Ton & Sprache
- Deutsch, **Du-Form**, freundlich, klar, ermutigend, leicht locker, aber **nicht cringe** (kein „Hey Leute!!“, keine Jugendwörter-Parade). Kurze Sätze. Ein Gedanke pro Absatz.
- **Korrekte Umlaute und ß** (ä ö ü ß), niemals ae/oe/ue. Echte Typografie: „Anführungszeichen“, Gedankenstrich –, Minus −, Malpunkt ·, Ellipse ….
- Fachbegriffe korrekt und konsistent (so wie im Unterricht in RLP üblich):
  - Normalform: **x² + px + q = 0**; allgemeine Form: **ax² + bx + c = 0** (a ≠ 0)
  - Scheitelpunktform: **f(x) = a·(x − d)² + e**, Scheitelpunkt **S(d | e)** (Punkte immer mit senkrechtem Strich: P(2 | −3))
  - Lösungsmenge: **L = {−3; 2}** (Semikolon als Trenner, aufsteigend sortiert), leere Menge **L = { }**
  - **Satz vom Nullprodukt**: „Ein Produkt ist genau dann null, wenn mindestens ein Faktor null ist.“
  - Binomische Formeln: 1. (a + b)² = a² + 2ab + b², 2. (a − b)² = a² − 2ab + b², 3. (a + b)(a − b) = a² − b²
  - Dezimalkomma (1,5), nie Dezimalpunkt in sichtbarem Text.
- Mathe-Schreibweise im HTML: Unicode statt LaTeX. x², x³, −, ·, √, ±, ≠, ≈, ⇔, ⇒. Für die Variable x im Fließtext immer `<span class="m">x</span>`. Brüche inline als `<span class="frac"><span>3</span><span>2</span></span>` (Core rendert gestapelt).

## Mathematische Korrektheit (höchste Priorität)
Jede Aufgabe, jedes Beispiel, jede Lösung, jede Zwischenzeile **muss stimmen**. Rechne **jede** Aufgabe mit einem kleinen `node -e`-Skript nach (Lösungen einsetzen → 0?). Bevorzuge „schöne“ Zahlen (ganzzahlige oder einfache Bruch-Lösungen), außer eine Aufgabe zielt bewusst auf √-Lösungen oder „keine Lösung“. Grafisch abzulesende Lösungen müssen ganzzahlig oder halbzahlig sein.

## Ordner & Dateien
Projektordner: `/Users/logge/Documents/Projects/static-pages/sources/quadratische-gleichungen/`

- `shell.html`, `css/base.css`, `js/core.js`, `build.py`, `CONTRACT.md` gehören dem **Core**. Kapitel-Agenten ändern sie **nicht**. Fehlt dir etwas, baue es in deinen eigenen Dateien; echte Core-Bugs nennst du im Abschlussbericht.
- **Deine Dateien:** `parts/NN-name.html`, `css/NN-name.css`, `js/NN-name.js` (nur deine NN). Eigene CSS-Regeln **immer** unter `#<deine-section-id>` scopen; eigene JS-Funktionen in eine IIFE packen bzw. über `QG.widget(...)` registrieren – keine globalen Namen außer `window.QG`.
- Nach jeder Änderung: `python3 -I build.py` (aus dem Projektordner). Das erzeugt `/Users/logge/Documents/Projects/static-pages/public/quadratische-gleichungen/` mit `index.html`, `style.css` (base.css + alle css/*.css alphabetisch) und `app.js` (core.js + alle js/*.js alphabetisch). **Nie** in `public/` editieren.
- Lokal ansehen: `python3 -m http.server 8765 -d /Users/logge/Documents/Projects/static-pages/public/quadratische-gleichungen` (bzw. anderer freier Port).
- Keine externen Abhängigkeiten außer evtl. Google Fonts (entscheidet der Core). Keine Bilder-Dateien nötig: Grafiken als **Inline-SVG** oder per JS gezeichnet.

## Kapitel (eine Kapitel-Ansicht pro `<section class="chapter">`)
Die Seite ist eine **App mit Hash-Routing**: Es ist immer genau ein Kapitel sichtbar (`#start`, `#grundlagen`, …). Unten im Kapitel blendet der Core automatisch „← Zurück / Weiter →“ ein.

| NN | id | data-title | data-short | data-color | data-icon | Inhalt |
|---|---|---|---|---|---|---|
| 00 | start | Start | Start | violet | 🏁 | Hero, Lernplan bis zur HÜ, Kapitel-Kacheln mit Fortschritt, „So nutzt du die Seite“ |
| 10 | grundlagen | Grundlagen & Vorwissen | Grundlagen | violet | 🧱 | Was ist eine quadr. Gleichung, Normalform, umformen, 0/1/2 Lösungen, Satz vom Nullprodukt, Probe, L = {…}, Fit-Check Vorwissen (binomische Formeln, Ausklammern, Wurzeln) |
| 20 | grafisch | Weg 1: Grafisch lösen | Grafisch | blue | 📈 | |
| 30 | faktorisieren | Weg 2: Faktorisieren | Faktorisieren | green | 🧩 | inkl. reinquadratisch/Wurzel ziehen |
| 40 | ergaenzung | Weg 3: Quadratische Ergänzung | Ergänzung | orange | 🟧 | |
| 50 | methodenwahl | Welcher Weg wann? | Welcher Weg? | pink | 🧭 | Entscheidungshilfe, Vergleich, Sortier-Spiel, Fehlerdetektiv |
| 60 | training | Trainingsraum | Training | teal | 🏋️ | unbegrenzte Zufallsaufgaben |
| 70 | probe-hue | Probe-HÜ | Probe-HÜ | red | 📝 | 2 Probe-HÜs mit Timer, Punkten, Lösungen |
| 80 | spickzettel | Spickzettel | Spickzettel | yellow | ⭐ | druckbares Merkblatt |
| 90 | nachhilfe | Für die Nachhilfe | Nachhilfe | slate | 🎓 | Leitfaden für die Nachhilfelehrkraft |

Pflicht-Markup:
```html
<section class="chapter" id="grafisch" data-title="Weg 1: Grafisch lösen" data-short="Grafisch" data-color="blue" data-icon="📈">
  <header class="ch-head">
    <p class="ch-kicker">Weg 1 von 3</p>
    <h1>Grafisch lösen</h1>
    <p class="ch-lead">Ein Satz, worum es geht.</p>
  </header>
  … Inhalt in <div class="block">-Abschnitten, jeweils mit <h2> …
</section>
```
Ein Part darf mehrere Sections enthalten (z. B. 70 enthält nur probe-hue; 80 nur spickzettel). Methoden-Kapitel (20/30/40) folgen ungefähr dem Muster: **Idee in einem Satz → Bild/Interaktion → Schritt-für-Schritt-Rezept → Durchgerechnetes Beispiel (Stepper) → typische Fehler → Übungsaufgaben (leicht → schwer, mindestens 8) → Kurz-Merkbox.**

## Core-Bausteine (HTML-Vertrag, vom Core automatisch verdrahtet)

**Inline-Mathe:** `<span class="m">x² + 5x + 6 = 0</span>` – der Core setzt einzelne Buchstaben (x, y, p, q, a, b, c, d, e, k) automatisch kursiv. Abgesetzte Formel: `<div class="mblock">…</div>`. Mehrzeilige Umformung (Gleichheitszeichen untereinander):
```html
<div class="calc">
  <div class="row"><span class="l">x² + 6x</span><span class="r">= 7</span><span class="op">| + 9</span></div>
  <div class="row"><span class="l">x² + 6x + 9</span><span class="r">= 16</span><span class="op">| binomische Formel</span></div>
</div>
```

**Boxen:** `<div class="box merke">`, `<div class="box tipp">`, `<div class="box achtung">` (typischer Fehler), `<div class="box beispiel">`, `<div class="box info">`. Erste Zeile optional `<p class="box-title">Merke</p>`.

**Schritt-für-Schritt-Stepper** (Schritte einzeln aufdecken):
```html
<ol class="steps" data-stepper>
  <li><div class="step-math"><span class="m">…</span></div><p class="step-why">Warum dieser Schritt?</p></li>
  …
</ol>
```
Der Core zeigt zuerst Schritt 1 und Buttons „Nächster Schritt“ / „Alle zeigen“ / „Neu starten“.

**Aufgaben mit Eingabe-Check:**
```html
<div class="task" data-id="graf-3" data-answer="-3;2" data-level="1">
  <p class="task-q">Löse grafisch: <span class="m">x² + x − 6 = 0</span></p>
  <!-- optional: Grafik, Zusatztext -->
  <div class="wrong" data-match="3;-2">Vorzeichen vertauscht? Setz deine Lösungen zur Probe ein.</div>
  <details class="hint"><summary>Tipp 1</summary>…</details>
  <details class="hint"><summary>Tipp 2</summary>…</details>
  <details class="solution"><summary>Lösung</summary>… vollständiger Lösungsweg …</details>
</div>
```
- `data-id` ist **global eindeutig**, Präfix je Kapitel: `grund-`, `graf-`, `fakt-`, `erg-`, `wahl-`, `train-` (nur generiert), `hue-`, `nh-`.
- `data-answer`: Lösungsmenge, Elemente mit `;` getrennt, Reihenfolge egal. Erlaubt sind ganze Zahlen, Dezimalzahlen (Punkt oder Komma), Brüche `3/2`, Wurzeln `sqrt(5)` / `√5` / `-2*sqrt(3)`, Ausdrücke wie `1+sqrt(2)`. **Keine Lösung:** `data-answer="leer"`. Eine einzige Lösung: `data-answer="4"`.
- `data-tol="0.1"` optional: erlaubte Abweichung (nur für Ablese-Aufgaben).
- `data-kind="number"`: Statt einer Lösungsmenge wird eine einzelne Zahl abgefragt (z. B. „Was musst du ergänzen?“). `data-answer` ist dann die Zahl.
- `data-kind="choice"`: Statt Eingabefeld Antwort-Buttons: `<div class="choices"><button type="button" class="choice" data-correct>…</button><button type="button" class="choice" data-why="Erklärung, warum falsch">…</button></div>` (ein oder mehrere `data-correct`).
- `data-kind="text"`: freie Text-/Termeingabe, `data-answer="(x+3)^2|(x+3)²|(3+x)^2"` (Alternativen mit `|`, Vergleich ohne Leerzeichen, case-insensitive, `^2`=`²`, `−`=`-`, `*`/`·` ignoriert).
- `data-kind="self"`: keine automatische Prüfung (z. B. „Zeichne …“): Core zeigt „Lösung ansehen“ und danach „Hatte ich richtig ✓ / Noch nicht ganz“.
- `.wrong[data-match]`: gezieltes Feedback, wenn die Eingabe genau dieser (falschen) Menge entspricht. Mehrere erlaubt. Mit `data-match="*1"` = Feedback, wenn genau eine von zwei Lösungen fehlt (Core stellt das sowieso generisch fest: „Eine Lösung fehlt noch – denk an ±!“).
- Der Core rendert das Eingabefeld + „Prüfen“-Button + Mini-Tastatur (−, ;, /, √, „keine Lösung“) selbst, zeigt Feedback, zählt Versuche, öffnet nach 2 Fehlversuchen einen Tipp-Hinweis, speichert gelöste Aufgaben (localStorage) und aktualisiert den Fortschritt.
- Für den Nutzer gilt: Eingabe wie `-3; 2`, `L={-3;2}`, `x1=-3, x2=2`, `2 und -3`, `keine`, `{}` – alles wird verstanden.

**Aufgabenliste:** Mehrere Aufgaben in `<div class="tasks">…</div>` → Core nummeriert sie („Aufgabe 1“ …) und zeigt oben „x/y gelöst“.

**Weitere Klassen:** `.lead`, `.small`, `.muted`, `.pill`, `.grid2` (auf Handy 1-spaltig), `.table-wrap > table.nice`, `.btn`, `.btn.primary`, `.btn.ghost`, `.kbd`, `.hl` (Textmarker), `.hl-blue/.hl-green/.hl-orange/.hl-red` (Farbmarker für Termteile), `details.more` (aufklappbarer Exkurs), `.print-only`, `.no-print`, `.print-page` (Seitenumbruch davor beim Drucken).

## Core-JS-API (`window.QG`)
- `QG.widget(name, initFn)`: registriert ein Widget; Core ruft `initFn(el, QG)` für jedes `[data-widget="name"]` auf, **sobald das Kapitel das erste Mal sichtbar wird** (damit Größen stimmen). Daten-Attribute des Elements selbst auslesen.
- `QG.on('chapter', (id) => {})`: Kapitelwechsel.
- `QG.parseAnswer(str)` → `{empty:bool, values:number[]}` oder `null` bei Unverständlichem; `QG.sameSet(a, b, tol)`.
- `QG.fmt(x)` → deutsche Zahl (Komma, echtes Minus, max. 2 Nachkommastellen, ganzzahlig ohne Komma); `QG.fmtFrac(x)` → Bruch-HTML wenn x ein einfacher Bruch ist (Nenner ≤ 12), sonst `fmt`; `QG.sign(x)` → `"+ 3"`/`"− 3"` für Terme; `QG.poly(a,b,c)` → hübscher HTML-Term wie `x² − 5x + 6` (lässt 1-Koeffizienten und Nullterme weg).
- `QG.math(el)`: wendet die Kursiv-Variablen-Formatierung auf neu eingefügtes HTML an. `QG.wire(el)`: verdrahtet Tasks/Stepper/Choices in dynamisch erzeugtem HTML (z. B. Trainingsraum, Probe-HÜ-Generator).
- `QG.task(spec)` → DOM-Element einer Aufgabe aus `{id, q (HTML), answer, kind, tol, hints:[HTML], solution:HTML, wrong:[{match, msg}], level}`, bereits verdrahtet.
- `QG.plot(el, opts)`: zeichnet ein responsives SVG-Koordinatensystem in `el`. `opts = {xmin, xmax, ymin, ymax, grid:true, fns:[{f:(x)=>…, color:'blue'|'green'|'orange'|'red'|'violet'|CSS, width, dash}], points:[{x, y, label, color}], lines:[…], interactive:false}`. Gibt `{update(opts), svg, toSvg(x,y)}` zurück. Achsen mit ganzzahligen Ticks und Beschriftung, Pfeile, „x“ und „y“.
- `QG.store.get(key, fallback)`, `QG.store.set(key, value)` (localStorage, in try/catch, Präfix `qg:`).
- `QG.solved(id)` / `QG.markSolved(id)`; `QG.toast(text)`; `QG.celebrate(el)` (kleiner Konfetti-Effekt, respektiert prefers-reduced-motion); `QG.go(chapterId)`.
- `QG.rand(min, max)`, `QG.pick(arr)`, `QG.shuffle(arr)`.

## Design
- **Mobile first**: Zielbreite 360–430 px, 16 px Seitenrand, keine horizontale Scrollbar (breite Tabellen/Rechnungen in `.table-wrap`/`.calc` scrollen intern). Touch-Ziele ≥ 44 px. Ab ~760 px zentrierte Spalte (max. ~720 px).
- Freundlich, farbig, modern, „App-Gefühl“: abgerundete Karten, klare Hierarchie, viel Luft, große gut lesbare Mathe. Jede Methode hat ihre Farbe (Grafisch blau, Faktorisieren grün, Ergänzung orange) – im Methodenvergleich und Spickzettel konsequent wiederverwenden. Farb-Tokens: `--c-blue`, `--c-green`, `--c-orange`, `--c-violet`, `--c-pink`, `--c-teal`, `--c-red`, `--c-yellow`, `--c-slate`, jeweils auch `--c-*-soft` (heller Hintergrund). Kapitel-Akzent: `var(--accent)` / `var(--accent-soft)` (setzt der Core je nach data-color).
- Hell- und Dunkelmodus (prefers-color-scheme + Umschalter). Nur Tokens benutzen: `--bg`, `--surface`, `--surface-2`, `--text`, `--text-dim`, `--line`, `--accent`, `--accent-soft`, `--ok`, `--bad`, `--radius`.
- Druck: `@media print` sauber (A4, schwarz-weiß-tauglich, Navigation aus, aktuelles Kapitel komplett aufgeklappt inkl. Lösungen nur dort, wo `data-print-solutions` am Kapitel steht).
- Barrierearm: semantische Überschriften, Buttons sind `<button type="button">`, Fokus sichtbar, `aria-live` für Feedback.

## Core-Ergänzungen nach der Integration
- **Alternativen mit `|`** gelten jetzt für alle Aufgabentypen, auch in `.wrong[data-match]` bei Mengen/Zahlen (`data-match="-6;4|-4;6"`). Ein echter senkrechter Strich in Text-Antworten wird als `\|` geschrieben (`data-answer="S(3\|−4)"`).
- Text-Antworten vergleichen Dezimalzahlen normalisiert (`1,50` = `1,5` = `1.5`).
- Gezielte Fehlermeldungen greifen zuerst exakt, danach auch bei gerundeten Eingaben (mind. 2 Nachkommastellen).
- Kurze Inline-Terme (`.m` bis 20 Zeichen) bekommen automatisch `.nw` (kein Umbruch mitten im Term); `.m.wrap` erlaubt den Umbruch. `.nw` gibt es auch als allgemeine Klasse, `.mblock.wrap` lässt einen abgesetzten Block an Leerzeichen umbrechen.
- Mathe (`.m`, `var`, `.frac`) wird nie in Versalien gesetzt – auch nicht in `.box-title` o. Ä.
- `.choice`, `.btn`, `.pill` und `summary` mit gemischtem Inhalt (Text + Mathe) packt der Core automatisch in `<span class="flex-txt">`. Eigene Wrapper-Spans sind nicht mehr nötig.
- `.calc`: Passt eine Zeile nicht in die Breite, setzt der Core `.stack-op` und schiebt den „| …“-Hinweis rechtsbündig unter die Zeile. Notizen (`.note`) verbreitern die Rechnung nicht mehr; Rechnungen mit Notizen nutzen die volle Breite.
- `QG.poly(a, b, c, {frac: true, maxDen: 16})`; Events `QG.on('peek', {el, id})` (Lösung geöffnet) und `QG.on('print', {phase: 'before'|'after'})`; `QG.task({…, nudge: false})` schaltet den Hinweis „Festgefahren? …“ ab.
- `train-…`-IDs werden nicht mehr in `localStorage` gespeichert (nur für die laufende Sitzung).
- Druck: keine Animationen; Tabellen dürfen umbrechen (Zeilen nicht); `.print-only-flex` für Flex-Elemente, die nur im Druck erscheinen.
- `package.json` im Projektordner setzt `"type": "commonjs"`, damit `require('./js/core.js')` in Node funktioniert.

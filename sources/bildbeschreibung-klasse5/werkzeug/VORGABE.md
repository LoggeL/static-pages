# Vorgabe: Unterrichtsreihe „Bildbeschreibung“ – Deutsch, Klasse 5

Diese Datei ist die **verbindliche gemeinsame Grundlage** für alle Teile. Alle Inhalte (Stundenthemen, AB-Nummern, HA-Nummern, Bildinhalte, Fachbegriffe) müssen exakt hierzu passen, damit die Materialien zusammengehören.

Zielgruppe: Lehrkraft (Lehrplan, Verläufe, Methoden, Erwartungshorizonte) **und** Schülerinnen und Schüler der 5. Klasse (Arbeitsblätter, Lernspiele, Hilfekarten). Schülertexte: **kindgerecht**, kurze Sätze, Du-Ansprache, schrittweise, ermutigend, mit Beispielen. Lehrertexte: professionell, konkret, praxistauglich (Zeitangaben, Impulse wörtlich, erwartete Antworten, Stolpersteine, Differenzierung).

Sprache: Deutsch mit korrekten Umlauten/ß (nie „ae/oe/ue“). Typografische Anführungszeichen „…“. Keine Emojis im Fließtext (sparsam in Lernspielen erlaubt).

---

## 1. Technik & Gestaltung

Projektordner: `/Users/logge/Documents/Projects/bildbeschreibung-klasse5/`

- `assets/style.css` – **gemeinsames Stylesheet. Unbedingt vorher lesen und dessen Klassen benutzen.** Nicht verändern. Seitenspezifisches CSS gehört als `<style>` an den Anfang des eigenen Inhaltsteils (Klassennamen dann mit eigenem Präfix, z. B. `.ue-…` für Lernspiele, `.ka-…` für Klassenarbeit).
- `assets/app.js` – Helfer: `data-auto-toc="Selektor"` erzeugt Inhaltsverzeichnis, `data-print` druckt Seite, `data-print-einzeln` (Button in einer `.blatt`/`.stunde`) druckt nur dieses Blatt, `data-toggle-loesungen` klappt alle `details.loesung` auf/zu.
- `werkzeug/build.py` – setzt Seiten zusammen. **Ihr schreibt nur Inhaltsteile** nach `_quellen/<name>.html`: reines HTML, das in `<main class="wrap">` eingesetzt wird (kein `<html>`, `<head>`, `<body>`, keine Navigation). Seitenspezifisches `<style>` oben, `<script>` ganz unten im Teil erlaubt. Danach `python3 werkzeug/build.py` ausführen und die fertige Seite prüfen.
- Bilder liegen in `bilder/` und werden relativ eingebunden: `<img src="bilder/sommertag-am-see.jpg" alt="…">`.
- Keine externen Bibliotheken außer den bereits eingebundenen Google Fonts. Alles muss offline (bis auf Schriften) im Browser per Doppelklick (file://) funktionieren → **kein fetch(), keine ES-Module**, nur klassisches inline-JS.
- Druckbarkeit: Arbeitsblätter, Klassenarbeit, Kopiervorlagen als `.blatt` (A4). Jedes `.blatt` bekommt oben rechts in der Werkzeugleiste einen Button `<button class="btn klein hell no-print" data-print-einzeln>Dieses Blatt drucken</button>` (z. B. absolut positioniert oder in einer `.werkzeugleiste.no-print` direkt im Blatt).

### Wichtige CSS-Bausteine (aus style.css)
- Seitenkopf: `<header class="seitenkopf"><div><div class="kicker">…</div><h1>…</h1><p>…</p></div><img src="bilder/lupo.png" alt=""></header>`
- Kästen: `.merke`, `.info`, `.tipp`, `.achtung`, `.ziel` (Beschriftung über `data-label="…"` änderbar)
- Lupo-Sprechblase: `<div class="lupo"><img src="bilder/lupo.png" alt="Lupo"><div class="bubble">…</div></div>`
- Stufen/Treppe: `<ol class="stufen treppe"><li><strong>…</strong> …</li>…</ol>`
- Badges Sozialform: `<span class="badge ea">EA</span>` (Einzelarbeit), `pa` (Partnerarbeit), `ga` (Gruppenarbeit), `ug` (Unterrichtsgespräch), `lv` (Lehrervortrag), `sp` (Spiel/Bewegung), `ha` (Hausaufgabe), `ab` (Arbeitsblatt), `zeit`
- Niveaus: `<span class="niveau n1">Basis</span>`, `n2` Standard, `n3` Profi
- Tabellen: `table.verlauf` mit Zeilenklassen `einstieg | erarbeitung | sicherung | vertiefung | abschluss | hausaufgabe`; `table.raster` für Bewertungsraster; bei breiten Tabellen `<div class="tabelle-scroll">` drumherum.
- Stunden: `<section class="stunde" id="s1">` mit `<div class="stunde-kopf"><div class="stunde-nr">1</div><div><h2>…</h2><div class="meta">badges</div></div></div>`
- Arbeitsblatt: 
  ```html
  <section class="blatt" id="ab1">
    <div class="blatt-kopf"><div class="ab-nr">AB<b>1</b></div><h2>Titel</h2>
      <div class="felder"><span>Name:</span><span>Klasse:</span><span>Datum:</span></div></div>
    <div class="aufgabe"><span class="nr">1</span><p>Auftrag … <span class="niveau n1">Basis</span></p> … <div class="linien l5"></div></div>
    <div class="fussnote">Stunde 3 · Wo genau?</div>
  </section>
  ```
- `.linien l2…l20` (Schreiblinien), `.luecke` / `.luecke.kurz` / `.luecke.lang` (Lücke im Text), `.kasten` (Zeichen-/Schreibfeld), `.wortspeicher` (+ `.gruen .orange .lila .gelb`, Kind `<span class="titel">`), `ul.checkliste`, `.karten` / `.karten.drei` mit `.karte` (Ausschneidekarten) + `.karte-titel`, `.schere`, `details.loesung > summary`, `figure.bild` (+ `.klein .mittel .rechts`), `.grid-2/3/4`, `.card`, `.btn`, `.btn.hell`, `.btn.klein`, `.werkzeugleiste`, `.toc`, `.spalten-2`, `.smileys`, `.ampel`(mit drei `<i>`), `.kreis`.

---

## 2. Maskottchen & roter Faden für Kinder

**Lupo, der Bilddetektiv** – eine Eule mit grüner Detektivmütze und Lupe (`bilder/lupo.png`). Lupo gibt Tipps, erklärt Schritt für Schritt, ermutigt. Lupos Motto: **„Erst schauen, dann ordnen, dann schreiben!“**

### Lupos 5 Stufen zur Bildbeschreibung (überall gleich verwenden!)
1. **Schauen** – Genau hinsehen wie ein Detektiv: erst das ganze Bild, dann die Einzelheiten. (Lupe!)
2. **Ordnen** – Das Bild einteilen (Vordergrund / Mittelgrund / Hintergrund oder links / Mitte / rechts) und Stichwörter sammeln (Schreibplan).
3. **Einleiten** – Die Einleitung beantwortet die W-Fragen: *Was für ein Bild? Wie heißt es? Wer hat es gemacht? Wann? Was zeigt es (Thema)?*
4. **Beschreiben** – Im Hauptteil Schritt für Schritt beschreiben: mit Ortsangaben, treffenden Verben, genauen Adjektiven, im Präsens, sachlich.
5. **Bewerten & Prüfen** – Im Schluss Wirkung und eigene Meinung nennen. Dann mit der Checkliste prüfen.

### Merkwissen (Fachinhalt, verbindlich)
- **Ziel einer Bildbeschreibung:** Jemand, der das Bild nicht sieht, soll es sich nach dem Lesen genau vorstellen können.
- **Aufbau:** Einleitung – Hauptteil – Schluss.
  - *Einleitung:* Bildart (Gemälde, Foto, Zeichnung, Illustration), Titel, Künstler/in bzw. Fotograf/in (falls bekannt), Entstehungsjahr (falls bekannt), Thema in einem Satz („Das Bild zeigt …“).
  - *Hauptteil:* in einer festen, sinnvollen Reihenfolge – z. B. **vom Vordergrund über den Mittelgrund zum Hintergrund**, oder **von links nach rechts**, oder **vom Wichtigsten (Blickfang) zu den Einzelheiten**. Eine Reihenfolge wählen und beibehalten! Zuerst das Auffällige/Große, dann Details.
  - *Schluss:* Wirkung/Stimmung (z. B. fröhlich, friedlich, gemütlich, lebhaft, ruhig, kalt, einsam, geheimnisvoll) + eigene Meinung mit Begründung („Mir gefällt das Bild, weil …“).
- **Sprache:**
  - **Präsens** (Gegenwart): „Der Hund rennt …“, nicht „Der Hund rannte …“.
  - **Sachlich** im Hauptteil: beschreiben, was man **sieht**. Gefühle/Meinung erst im Schluss. Vermutungen kennzeichnen: *vermutlich, wahrscheinlich, vielleicht, es sieht so aus, als ob, scheinbar/anscheinend*.
  - **Ortsangaben** (Fachbegriffe): im Vordergrund, im Mittelgrund, im Hintergrund, in der Bildmitte, am linken/rechten Bildrand, am oberen/unteren Bildrand, in der linken oberen Ecke, oben rechts, unten links, davor, dahinter, daneben, darüber, darunter, dazwischen.
  - **Präpositionen mit Dativ (Frage „Wo?“):** auf, unter, neben, zwischen, vor, hinter, über, in, an → „auf **dem** Bett“, „unter **dem** Bett“, „neben **der** Lampe“, „zwischen **den** Bäumen“.
  - **Treffende Verben statt „ist/sind/gibt es/sieht man/hat“:** stehen, sitzen, liegen, hängen, lehnen, sich befinden, ragen, schweben, wachsen, leuchten, strahlen, schwimmen, segeln, rennen, laufen, halten, tragen, verkaufen, zeigen, picken, spielen, lesen, angeln, sich erstrecken, sich ausbreiten, sich erheben, erkennen, entdecken.
  - **Genaue Adjektive:** Farben (hellblau, dunkelgrün, knallrot, rosa, lila, türkis, orange), Muster (gestreift, kariert, gepunktet, rot-weiß gestreift), Formen (rund, eckig, oval, spitz), Größen (riesig, winzig, groß, klein, schmal, breit), Material (hölzern, aus Holz, gläsern), Eigenschaften (lockig, glatt, lang, kurz). Adjektiv-Treppe: „ein Hund“ → „ein brauner Hund“ → „ein brauner Hund mit einem roten Halsband“.
  - **Abwechslungsreiche Satzanfänge:** Im Vordergrund … / Links daneben … / Dahinter … / Weiter hinten … / In der Bildmitte … / Am rechten Bildrand … / Über … / Neben … / Außerdem … / Auffällig ist …

---

## 3. Die Bilder (alle in `bilder/`) – genaue Inhaltslisten

**Neu (Stand 2026-10-05):** Alle Bilder sind einheitliche, farbige Bilderbuch-Illustrationen (mit Codex/KI-Bildgenerierung erstellt). Szenen als JPG im Querformat **1536 × 1024 (3:2)**, „Opa Willi in der Bibliothek“ im Hochformat **1024 × 1536 (2:3)**. Maskottchen: `bilder/lupo.png` (freigestellt, transparenter Hintergrund, Hochformat ca. 443 × 640). Es gibt **keine Gemälde berühmter Künstler** mehr (Bruegel/Spitzweg sind entfernt).

Die Inhaltslisten sind **verbindlich**: Aufgaben und Lösungen dürfen nur Dinge nennen, die wirklich im Bild sind. **Seht euch die Bilder selbst an** (JPG/PNG direkt mit dem Read-Werkzeug öffnen) – bei Zweifeln gilt das Bild.

**Bildangaben für Einleitungen (W-Fragen):** Bildart = „farbige Illustration“ (gemalte, digitale Zeichnung), Titel = der Titel unten in Anführungszeichen, Zeichner/in = nicht angegeben („aus unserem Unterrichtsmaterial“), Jahr = 2026. Bei echten Kunstwerken gehören Künstler/in und Entstehungsjahr in die Einleitung – das wird als Regel erklärt („Wenn du weißt, wer das Bild gemalt hat …“), aber nicht mehr an einem echten Gemälde geübt.

### Bild A: `sommertag-am-see.jpg` – „Sommertag am See“
- **Hintergrund:** hellblauer Himmel mit **zwei weißen Wolken** (eine größere links oben, eine kleinere in der Mitte); **in der rechten oberen Ecke eine gelbe Sonne** mit Strahlen. **Grüne, bewaldete Hügel** über die ganze Breite. **Links auf einem Hügel ein kleines weißes Haus mit rotem Ziegeldach**, Schornstein und Fenstern mit blauen Fensterläden. **Rechts am Ufer ein dunkelgrüner Tannenwald** (Nadelbäume).
- **Mittelgrund:** ein **glitzernder blauer See** über die ganze Bildbreite. **Links** auf dem Wasser schwimmen **zwei Enten** (ein Erpel mit grünem Kopf, ein braunes Weibchen). **In der Mitte** ein **Segelboot mit rotem Rumpf, zwei weißen Segeln und gelbem Wimpel**; es spiegelt sich im Wasser. **Vom rechten Bildrand** ragt ein **Holzsteg** in den See; darauf **sitzt ein Junge** (blaue Kappe, gelbes T-Shirt, blaue kurze Hose) mit dem Rücken zum Betrachter und **angelt**; die Angelschnur hängt mit einer **rot-weißen Pose** ins Wasser.
- **Vordergrund:** eine **Wiese voller bunter Wildblumen** (gelb, rosa, weiß, lila). **Am linken Bildrand** steht ein **großer Laubbaum** mit dickem braunem Stamm; seine Äste und Blätter ragen oben ins Bild. Darunter liegt eine **rot-weiß karierte Picknickdecke**; darauf **sitzt ein Mädchen** im Schneidersitz mit **langen braunen Haaren**, einem **ärmellosen blauen Kleid** und weißen Turnschuhen und **liest ein grünes Buch**; es lächelt. **Rechts neben ihr** steht ein **Weidenkorb mit roten und grünen Äpfeln**. **In der Bildmitte** springt ein **flauschiger brauner Hund mit rotem Halsband** fröhlich auf einen **roten Ball** zu. **Rechts unten** liegt ein **grünes Fahrrad** im Gras. In den unteren Ecken liegen ein paar **graue Steine**.
- Stimmung: fröhlich, friedlich, sommerlich, entspannt, sonnig.

**Musterbeschreibung (für Lösungen/Beispiele, darf leicht gekürzt werden):**
> Das Bild „Sommertag am See“ ist eine farbige Illustration aus unserem Unterrichtsmaterial. Es zeigt einen fröhlichen Sommertag an einem See, an dem Kinder ihre Freizeit verbringen.
>
> Im Vordergrund erstreckt sich eine grüne Wiese mit vielen bunten Blumen. Am linken Bildrand steht ein großer Laubbaum mit einem dicken braunen Stamm. Unter dem Baum liegt eine rot-weiß karierte Picknickdecke. Darauf sitzt ein Mädchen mit langen braunen Haaren und einem blauen Kleid im Schneidersitz. Es liest in einem grünen Buch und lächelt. Rechts neben dem Mädchen steht ein Weidenkorb mit roten und grünen Äpfeln. In der Bildmitte springt ein flauschiger brauner Hund mit einem roten Halsband auf einen roten Ball zu. Rechts unten liegt ein grünes Fahrrad im Gras.
>
> Im Mittelgrund breitet sich ein blauer See über die ganze Bildbreite aus. Auf der linken Seite schwimmen zwei Enten. Genau in der Mitte segelt ein kleines Segelboot mit einem roten Rumpf und zwei weißen Segeln. Von rechts ragt ein hölzerner Steg in den See. Darauf sitzt ein Junge mit einer blauen Kappe, einem gelben T-Shirt und einer blauen kurzen Hose. Er hält eine Angel ins Wasser.
>
> Im Hintergrund erheben sich grüne, bewaldete Hügel. Links auf einem Hügel steht ein kleines weißes Haus mit einem roten Dach. Auf der rechten Seite wächst ein dunkelgrüner Tannenwald. Über der Landschaft leuchtet ein hellblauer Himmel mit zwei weißen Wolken. In der rechten oberen Ecke strahlt eine gelbe Sonne.
>
> Das Bild wirkt auf mich fröhlich und friedlich. Die hellen Farben und die Sonne zeigen, dass es ein warmer Sommertag ist. Mir gefällt das Bild, weil ich auch gerne am See bin und mich bei diesem Anblick entspannt fühle.

### Bild B: `kinderzimmer.jpg` – „Das Kinderzimmer“ (+ Fehlerbild `kinderzimmer-b.jpg`)
- Wand **hellgelb**, Boden aus hellbraunen **Holzdielen**. Frontale Ansicht.
- **Links:** ein **Holzbett** mit **blauer Bettdecke mit weißen Punkten** und weißem Kissen. **Auf dem Bett vor dem Kissen** sitzt ein **brauner Teddybär mit roter Fliege**. **Unter dem Bett** (vorn am Bettende) liegt ein **schwarz-weißer Fußball**. **Über dem Bett** hängt an der Wand ein **dunkelblaues Poster mit einer weiß-roten Rakete**, Sternen und einem grauen Mond. **Vor dem Bett** auf dem Boden liegen **zwei lila Socken**. **Rechts neben dem Bett** lehnt eine **Gitarre** an der Wand.
- **Mitte:** ein **Fenster** mit **hellblauen Vorhängen** links und rechts und einer Gardinenstange aus Holz; durch das Fenster sieht man blauen Himmel, eine Wolke, die Sonne und grüne Baumkronen. **Auf der Fensterbank** (rechts) steht ein **orangefarbener Blumentopf mit einer roten Blume**. Auf dem Boden in der Mitte liegt ein **runder grüner Teppich** mit weißem gestricheltem Rand; **auf dem Teppich schläft eine grau getigerte Katze**.
- **Rechts vom Fenster:** ein **Bücherregal** aus Holz mit vier Fächern: oben **fünf** bunte Bücher (grün, blau, rot, gelb, lila), darunter **sechs** Bücher, im dritten Fach ein **rotes Spielzeugauto**, unten eine **türkisfarbene Kiste** (ohne Aufschrift).
- **Ganz rechts:** ein **Schreibtisch**; darauf ein **Stapel aus drei Büchern** (grün, rot, blau) und eine **gelbe Schreibtischlampe**. **Über dem Schreibtisch** hängt eine **runde Uhr mit rotem Rand** (sie zeigt **3 Uhr**). **Vor dem Schreibtisch** steht ein **roter Stuhl**; **an der Stuhllehne hängt ein orangefarbener Rucksack**.
- **Fehlerbild (`kinderzimmer-b.jpg`) – genau 8 Unterschiede** (sonst identisch). Klick-/Markierbereiche in **Prozent der Bildbreite/-höhe** (x von links, y von oben):
  1. Poster zeigt einen **orangefarbenen Planeten mit Ring** statt der Rakete – Bereich x 4–21 %, y 3–32 %.
  2. Der Ball unter dem Bett ist **gelb-schwarz** – x 4–11.5 %, y 70–81 %.
  3. Die Katze schläft **oben auf dem Bücherregal**, der Teppich ist leer – Regal oben x 65–79 %, y 0–10 % (auch ein Klick auf den leeren Teppich x 42–61 %, y 72–86 % zählt).
  4. Die Uhr zeigt **9 Uhr** – x 84–97 %, y 6–25 %.
  5. Die Schreibtischlampe ist **grün** – x 91–99.5 %, y 26–44 %.
  6. Der **Rucksack fehlt** – x 89–99.5 %, y 44–67 %.
  7. Die Blume auf der Fensterbank ist **gelb** – x 51–56 %, y 27–42 %.
  8. Im obersten Regalfach stehen nur **drei** Bücher (grün, blau, rot) – x 65–76 %, y 11–23 %.

### Bild C: `wochenmarkt.jpg` – „Auf dem Wochenmarkt“
- **Hintergrund:** blauer Himmel mit zwei Wolken. Eine Reihe **bunter Giebelhäuser** (rosa, gelb, hellblau, apricot, hellgrün, flieder) mit rotbraunen Ziegeldächern und Blumenkästen. **In der Mitte** ragt ein **Kirchturm** mit **grünem Spitzdach**, Kreuz und **Uhr** (zeigt **9 Uhr**) über die Häuser. Links und rechts je ein **Laubbaum**; ganz rechts eine **Straßenlaterne** und ein **Steinbrunnen**; links hinten Café-Tische.
- **Mittelgrund – drei Marktstände:**
  - **Links: Obststand** mit **rot-weiß gestreifter Markise** und dem Holzschild **„FRISCHES OBST“**. In Holzkisten: rote **Äpfel**, **Orangen**, gelbe **Bananen**. Dahinter ein **Verkäufer mit Glatze, grauem Haarkranz, Schnurrbart**, weißem Hemd und **grüner Schürze**; er **reicht eine braune Papiertüte** über den Stand.
  - **Mitte: Blumenstand** mit **grün-hellgrün gestreifter Markise**: vier **Metalleimer** mit **Sonnenblumen**, **roten Tulpen**, **rosa Tulpen** und **weißen Tulpen**; davor Kisten mit Lavendel und Topfpflanzen.
  - **Rechts: Bäckerstand** mit **blau-weiß gestreifter Markise** und dem Schild **„BÄCKEREI“** (mit Brezel-Symbolen); auf einem blau-weiß karierten Tisch **Brote, Brötchen und Brezeln**, dahinter Baguettes im Korb. Dahinter eine **Bäckerin** mit **blondem Haarknoten**, weißer Bäckerjacke und rosa Halstuch; sie stemmt **die Hände in die Hüften** und lächelt.
- Boden: graues **Kopfsteinpflaster**.
- **Vordergrund:** **Links** fährt ein **Junge** mit **roter Kappe**, grünem T-Shirt und blauer kurzer Hose auf einem **Tretroller**. **Vor dem Obststand** steht eine **Frau** (von hinten/seitlich) mit **lila Hut**, gelbem Oberteil, langem **braunem Rock** und **lila Handtasche**; sie **zeigt auf das Obst**. **In der Mitte vorn** **pickt eine graue Taube** Krümel vom Boden. **Rechts** gehen ein **Vater** (schwarze Haare, grauer Pullover, dunkle Hose) und seine **Tochter** (rosa Kleid mit weißen Blümchen, zwei schwarze Zöpfe) über den Markt; das Mädchen **reckt einen Arm hoch** und hält einen **lila Luftballon** an einer Schnur.
- Stimmung: lebhaft, bunt, fröhlich, geschäftig, sonniger Morgen.

### Bild D: `schulhof.jpg` – „Auf dem Schulhof“
- **Hintergrund:** blauer Himmel mit zwei Wolken. Ein großes, **zweistöckiges Schulgebäude aus rotem Backstein** mit vielen weißen Fenstern und einem Mittelteil mit Giebel. Über der **grauen Doppeltür** hängt das Schild **„SCHULE AM PARK“**, ganz oben am Giebel eine **große runde Uhr**. Links und rechts je ein großer grüner **Laubbaum**, vor dem Gebäude Büsche.
- **Mittelgrund:** **Links** ein **rotes Klettergerüst** (mit Kletternetz); oben darauf steht ein **Mädchen** mit **blondem Pferdeschwanz**, grünem Shirt und brauner Hose, **reißt die Arme hoch und lacht**. **In der Mitte** vor der Tür steht eine **Lehrerin** (Pausenaufsicht) mit **dunklem Haarknoten**, **lila Pullover**, dunkler Hose und einer **gelben Trillerpfeife** an einer Kordel um den Hals; sie stemmt die Hände in die Hüften. **Rechts** ein **weißes Fußballtor** mit Netz; im Tor steht ein **blonder Torwart** (gelbes Trikot, schwarze Hose, Handschuhe) mit ausgebreiteten Armen. Davor **läuft ein Junge** mit **schwarzen Locken**, blauem Trikot und weißer Hose (von hinten) auf den **schwarz-weißen Fußball** zu.
- **Vordergrund:** grauer Asphalt. **Links** spielen **drei Mädchen Seilspringen**: Ein Mädchen mit **schwarzen Zöpfen** (orangefarbenes T-Shirt, Jeans, lila Schuhe) hält das **lila Seil** an einem Ende, ein Mädchen mit **langen blonden Haaren** (türkisfarbenes T-Shirt, braun karierter Rock) am anderen Ende; **in der Mitte springt** ein Mädchen mit **braunen Haaren** (gelbes T-Shirt, roter Rock) hoch und lacht. **In der Mitte vorn** sind mit weißer Kreide **„Himmel und Hölle“-Kästchen** (Hüpfspiel, Zahlen 1 bis 4) auf den Boden gemalt. **Rechts** steht eine **Holzbank**; darauf **sitzt ein Junge mit roten Haaren** in einem **dunkelblauen Kapuzenpullover** und Jeans und **isst ein Pausenbrot**; neben ihm auf der Bank steht eine **offene rote Brotdose** mit einem Apfel.
- Stimmung: lebhaft, fröhlich, ausgelassen (große Pause).

### Bild E: `im-hafen.jpg` – „Im Hafen“ (**nur für die Klassenarbeit** – vorher nicht im Unterricht zeigen!)
- **Himmel:** Abendstimmung, **leuchtend orange-rosa Himmel** mit Wolken; links eine große, tief stehende **gelb-orange Sonne** über dem Meer; **drei Möwen** fliegen oben am Himmel.
- **Hintergrund:** **Rechts** auf einer **felsigen Insel** ein **rot-weiß gestreifter Leuchtturm** mit leuchtender Laterne; ein heller **Lichtstrahl** fällt nach links. In der Mitte weit hinten ein **kleines weißes Segelboot**.
- **Mittelgrund:** blaues **Meer**. Ein großes **blaues Fischerboot** mit weißem Rand und dem Namen **„MÖWE 3“**; ein **weißes Steuerhaus** mit Fenstern, ein hoher **Holzmast** mit vielen Seilen, Netze und Fender (Puffer) an der Seite. Das Boot ist mit einem dicken **Tau an einem schwarzen Poller** an der Kaimauer festgemacht.
- **Vordergrund:** eine **Kaimauer / ein Steinboden aus Steinplatten**. **Links** steht ein lächelnder **Fischer** mit **grauem Bart**, **dunkler Schiffermütze**, **gelber Regenkleidung** (Ölzeug) und Gummistiefeln; er **streckt einen Arm zum Boot** aus. Neben ihm stehen **drei hellblaue Kisten voller Fische** (zwei übereinander, eine daneben). **In der Mitte** liegt ein großer, dunkler **Anker mit Kette**. **Rechts** sitzt eine **orange-weiße Katze** und schaut nach oben; daneben steht ein **Kind** mit **schwarzen Locken**, **rotem T-Shirt** und **blauer kurzer Jeanshose** und **wirft Brotkrumen** in die Luft. Eine **Möwe** fliegt mit ausgebreiteten Flügeln heran und schnappt nach den Krumen, eine weitere **Möwe steht ganz rechts** auf der Kaimauer.
- Stimmung: ruhig, friedlich, abendlich, warm, etwas romantisch.

### Bild F: `winterabend.jpg` – „Winterabend am Dorfteich“ (ersetzt Bruegels „Jäger im Schnee“; Stunde 8 – Stimmung, Sehen/Vermuten/Meinen)
- Licht: später Winternachmittag/Abend; **rosa-violetter Himmel**, kalte blaue Schatten, ein **erster Stern**, ein **großer schwarzer Vogel** fliegt oben rechts.
- **Hintergrund:** **schroffe, schneebedeckte Berge**; ein **Dorf** mit verschneiten Dächern, **gelb leuchtenden Fenstern**, **Rauch aus den Schornsteinen**, einem **Kirchturm** in der Mitte, einem geschmückten Tannenbaum und einer kleinen **Steinbrücke** rechts.
- **Mittelgrund:** ein **zugefrorener Teich**, auf dem mehrere **Kinder Schlittschuh laufen**; **ein Kind ist hingefallen** und sitzt auf dem Eis; ein **kleiner brauner Hund** rennt über das Eis. Am Ufer steht eine **verschneite Holzbank**.
- **Vordergrund:** ein **verschneiter Hügel**. **Links:** **zwei Kinder ziehen einen Holzschlitten** den Hügel hinauf, auf dem ein **kleines Kind** (rosa Mütze) sitzt; dahinter **kahle Bäume** mit **drei schwarzen Krähen**; vorn Sträucher mit roten Beeren. **Mitte:** ein **Junge** mit **grüner Strickmütze** und **rotem Schal** baut einen **Schneemann** mit **Karottennase**, **schwarzem Zylinder** und rot karierten Schal. **Rechts:** ein **alter Mann** mit **grauem Bart**, Hut und braunem Mantel geht gebückt mit einem Stock; auf dem Rücken trägt er einen **Korb voller Brennholz**; im Schnee sieht man seine **Fußspuren**.
- Stimmung: kalt, still, winterlich – aber auch gemütlich (warme Fenster) und fröhlich (spielende Kinder). Gut für Vermutungen (Wohin geht der alte Mann? Hat sich das Kind wehgetan? Ist bald Weihnachten?).

### Bild G: `parkfest.jpg` – „Das große Parkfest“ (Wimmelbild; ersetzt Bruegels „Kinderspiele“; Stunde 11 – Expertengruppen zu den vier Vierteln)
Zwei **Kieswege** kreuzen sich und teilen das Bild in **vier Viertel**; in der Mitte steht ein **runder Steinbrunnen mit Fontäne**, in dem ein **Junge im orangefarbenen T-Shirt** mit dem Wasser plantscht; daneben Tauben.
- **Links oben:** ein **Teich** mit einem **roten Ruderboot** (ein Mann mit Hut rudert, ein Mädchen sitzt darin), einem **weißen Schwan**, einer **Entenfamilie** und Seerosen; **zwei Kinder** stehen auf einer **kleinen Holzbrücke** und **füttern die Enten**; weiter hinten lässt ein **Junge einen rot-gelben Drachen** steigen; eine **ältere Frau sitzt auf einer Bank**; im Baum ein **Eichhörnchen** und eine Meise; in der Ferne ein Kirchturm.
- **Rechts oben:** ein **Karussell** mit rot-weißem Dach und **Holzpferden**, auf denen **drei Kinder reiten**; ein **Eiswagen** mit rot-weißem Schirm, eine **Eisverkäuferin** und eine **Schlange von Kindern**; ein **Mann auf Stelzen** mit Zylinder **jongliert** mit Bällen; bunte **Wimpelketten**.
- **Links unten:** ein **Spielplatz**: **Rutsche** mit Holzhäuschen (rotes Dach), ein Junge rutscht; eine **Schaukel** mit einem Mädchen; eine **Wippe** mit zwei Kindern; ein **Sandkasten**, in dem **zwei kleine Kinder eine Sandburg bauen** (mit Eimer und Spielzeuglaster); ein Fußball, ein Rucksack auf einer Bank, **Sonnenblumen**, ein **Stoffhase** und ein **Igel**.
- **Rechts unten:** ein **Picknicktisch** mit **blau-weiß karierter Decke** und einer **Geburtstagstorte mit Kerzen**; **Kinder mit Partyhüten** feiern; ein **Clown** mit roter Nase und blauem Hut **macht Luftballontiere**; ein **Hund hat ein Würstchen geklaut** und rennt weg, ein **Mann mit Brille rennt hinterher** (sein Hut fliegt weg); eine **Katze** liegt auf einer Bank; Luftballons und Schmetterlinge.
- Stimmung: lebhaft, fröhlich, wuselig, laut, sommerlich.

### Bild H: `bibliothek.jpg` – „Opa Willi in der Bibliothek“ (Hochformat; ersetzt Spitzwegs „Bücherwurm“; Stunde 6 Einleitung + AB 16 Profi-Blatt)
- **Raum:** eine alte **Bibliothek** mit **hohen dunklen Holzregalen** voller Bücher bis zur Decke; **oben links ein hohes Bogenfenster**, durch das **warme Sonnenstrahlen** schräg in den Raum fallen; in den Regalen Pflanzen, Bilder, eine kleine **Büste**, eine **Eulenfigur**, ein Messing-Globus (Armillarsphäre). Auf dem Boden ein gemusterter **Teppich**.
- **Mitte/oben:** **Opa Willi**, ein **alter Mann** mit **weißen, wuscheligen Haaren**, **runder Brille**, weißem Hemd, **dunkelgrüner Weste**, **brauner Cordhose** und roten Schuhen, steht **ganz oben auf einer hohen Holzleiter**. Er hält ein **rotes Buch dicht vor das Gesicht** und liest; in der **anderen Hand** hält er ein **zweites, aufgeschlagenes blaues Buch**; **ein grünes Buch klemmt unter seinem Arm**, **ein rotes Buch zwischen seinen Knien**; aus der Hosentasche hängt ein **weißes Taschentuch**.
- **Unten links:** ein **roter Sessel** mit karierter Decke, darauf **schläft eine getigerte Katze**; daneben eine **grüne Leselampe**.
- **Unten Mitte:** ein **kleines Mädchen** mit **zwei braunen Zöpfen**, **gelber Regenjacke**, Jeans und braunen Stiefeln hält einen **Stapel Bücher** und **schaut staunend zu Opa Willi hinauf**.
- **Unten rechts:** ein **alter Globus** auf einem Holzständer.
- Stimmung: ruhig, gemütlich, warm, ein bisschen lustig (Opa Willi vergisst alles um sich herum).

### Maskottchen: `lupo.png`
Lupo ist eine **braune Eule mit großen Augen**, **grün karierter Detektivmütze** und einer **goldenen Lupe** in der rechten Flügelspitze; freigestellt (transparent). Einbinden z. B. `<img src="bilder/lupo.png" alt="Lupo">`.

---

## 4. Die Unterrichtsreihe – 13 Stunden à 45 Minuten (+ Rückgabe)

Spalten: Thema · Lernziel(e) · Bild · zentrale Methoden · Material · Hausaufgabe

| Std. | Titel | Lernziele (Die SuS können …) | Bild | Methoden (Kern) | AB | HA |
|---|---|---|---|---|---|---|
| 1 | **Genau hingeschaut!** – Warum beschreiben wir Bilder? | … ein Bild aufmerksam betrachten und viele Einzelheiten benennen; … Situationen nennen, in denen genaue Beschreibungen wichtig sind; … das Ziel einer Bildbeschreibung erklären. | A (Kim-Spiel), B + B-Fehlerbild | Kim-Spiel (Bild 20 Sek. zeigen, dann aus dem Gedächtnis notieren), Fehlerbild in PA, Brainstorming „Wo braucht man genaue Beschreibungen?“ (Fundbüro, Polizei/Zeuge, blinde Menschen/Audiodeskription, Museumsführung, Telefonat), Lernlandkarte | AB 0 (Lernlandkarte „Das kann ich schon“), AB 1 (Finde die 8 Unterschiede) | HA 1 |
| 2 | **Ordnung im Bild** – Vordergrund, Mittelgrund, Hintergrund | … Bildbereiche mit Fachbegriffen benennen (VG/MG/HG, Bildmitte, Bildränder, Ecken); … Bildelemente den Bereichen zuordnen. | A | „Bildstreifen“ (Bild in 3 Streifen zerschnitten → zuordnen), 9-Felder-Raster (Overlay im Beamer-Modus), Bild-Detektive in Gruppen (jede Gruppe untersucht einen Bereich), Zeigestock-Spiel | AB 2 (Was ist wo? VG/MG/HG-Tabelle), AB 3 (Das Bildraster: 9 Felder) | HA 2 |
| 3 | **Wo genau?** – Ortsangaben und Präpositionen | … Präpositionen für Orte (auf, unter, neben, zwischen, vor, hinter, über, in, an) richtig mit Dativ verwenden; … Fachbegriffe für Bildpositionen nutzen. | B | Bewegungsspiel „Lupo sagt …“ (Gegenstand im Raum positionieren), Bilddiktat Rücken an Rücken (A beschreibt, B zeichnet, dann Vergleich), Wortspeicher Ortsangaben | AB 4 (Präpositionen im Kinderzimmer), AB 5 (Bilddiktat-Karten A/B mit zwei einfachen Mini-Szenen) | HA 3 |
| 4 | **Mehr als „ist“ und „gibt es“** – treffende Verben | … langweilige Verben (ist, sind, gibt es, sieht man, hat) durch treffende Verben ersetzen; … ein Wortfeld „Verben für Bildbeschreibungen“ anlegen. | C | „Langweiler-Text“ vorlesen (SuS zählen „ist/gibt es“ per Strichliste), Verben-Pantomime, Verben-Wortfeld (Plakat), Text-Tuning in PA | AB 6 (Verben-Werkstatt: Wortfeld + Langweiler-Text verbessern) | HA 4 |
| 5 | **Bunt und genau** – Adjektive, Farben, Formen | … Farben, Formen, Muster, Größen und Materialien mit genauen Adjektiven beschreiben; … Nominalgruppen schrittweise erweitern (Adjektiv-Treppe). | C, A | „Ich sehe was, was du nicht siehst – Profi-Version“, Adjektiv-Treppe, Farbkarten-Spiel (Farbnuancen: hell-/dunkel-/knall-), Rätselbeschreibung (Gegenstand beschreiben, andere raten) | AB 7 (Adjektiv-Treppe & Farbenwerkstatt) | HA 5 |
| 6 | **Der Anfang zählt** – die Einleitung | … eine Einleitung mit Bildart, Titel, Zeichner/in bzw. Künstler/in (falls bekannt), Jahr und Thema schreiben; … gute und schwache Einleitungen unterscheiden. | A, H (Bibliothek) | HA-Rätselrunde zum Einstieg, Bild-Steckbrief, Einleitungs-Puzzle (Satzbausteine), Daumenprobe (gute/schwache Einleitung) | AB 8 (Einleitungen: Steckbrief & Puzzle) | HA 6 |
| 7 | **Der rote Faden** – der Hauptteil | … eine sinnvolle Reihenfolge wählen und einhalten (VG→MG→HG, links→rechts, Wichtiges zuerst); … abwechslungsreiche Satzanfänge/Überleitungen verwenden. | A | „Kamerafahrt“ (Papprolle/Hand als Kamera, Blickweg einzeichnen), Satzstreifen ordnen (GA, Hauptteil der Musterbeschreibung zerschnitten), Satzanfänge-Rad | AB 9 (Satzstreifen ordnen), AB 10 (Satzanfänge-Werkstatt) | HA 7 |
| 8 | **Sehen oder meinen?** – Schluss, Sachlichkeit, Präsens | … beschreibende, vermutende und wertende Aussagen unterscheiden; … im Präsens schreiben; … einen Schluss mit Wirkung und begründeter Meinung formulieren. | F (Winterabend) + A (Stimmungsvergleich) | Ampelkarten (grün = ich sehe, gelb = ich vermute, rot = ich meine), Stimmungsbarometer, Wortspeicher Wirkung, Zeitmaschine (Präteritum→Präsens) | AB 11 (Sehen – vermuten – meinen + Schluss schreiben) | HA 8 |
| 9 | **Jetzt schreibe ich!** – Schreibplan und erste ganze Bildbeschreibung | … mit einem Schreibplan (Stichwortzettel) eine vollständige Bildbeschreibung verfassen. | D | Lupos Schreibfahrplan (5 Stufen), Stichwortzettel, Schreibzeit mit gestuften Tippkarten (Hilfe 1–3 zum Abholen), Schreib-Ampel | AB 12 (Schreibplan Schulhof + Tippkarten) | HA 9 |
| 10 | **Die Textlupe** – Überarbeiten | … eigene und fremde Texte mit einer Checkliste überprüfen; … konstruktiv Rückmeldung geben („2 Sterne und 1 Wunsch“); … Texte gezielt verbessern. | D (eigene Texte) | Fehlertext „Detektiv-Fall“ (gemeinsam Fehler finden), Schreibkonferenz/Textlupe in 3er-Gruppen (jede/r prüft einen Bereich mit Farbe: grün Aufbau, blau Ortsangaben, orange Verben/Adjektive, rot Präsens & sachlich) | AB 13 (Checkliste & Textlupe-Bogen), AB 14 (Fehlertext überarbeiten) | HA 10 |
| 11 | **Das große Wimmelbild** – Experten für jedes Viertel | … ein großes, detailreiches Bild arbeitsteilig genau beschreiben; … in Expertengruppen Bildausschnitte beschreiben und präsentieren; … Teilbeschreibungen zu einem Ganzen zusammenfügen. | G (Parkfest) (+ H Bibliothek als Differenzierung) | Bildführer-Spiel / Audioguide sprechen, Expertengruppen zu den 4 Vierteln (Gruppenpuzzle), Gallery Walk | AB 15 (Das große Parkfest: Expertenauftrag), AB 16 (Opa Willi in der Bibliothek – Profi-Blatt) | HA 11 |
| 12 | **Fit für die Klassenarbeit** – Lerntheke | … ihr Wissen an Stationen selbstständig wiederholen und sich selbst einschätzen. | alle bekannten | Lerntheke mit 6 Pflicht- und 2 Wahlstationen, Laufzettel, Selbstkontrolle mit Lösungskarten, Ampel-Selbsteinschätzung | AB 17 (Laufzettel + Stationskarten) | HA 12 |
| 13 | **Klassenarbeit** „Im Hafen“ (45 Min., optional 90) | Anwenden aller Teilkompetenzen | E | Klassenarbeit (Teil A Übungsaufgaben, Teil B Bildbeschreibung) | – | – |
| (14) | **Rückgabe & Reflexion** | … ihre Arbeit mit dem Bewertungsbogen nachvollziehen, eine Berichtigung schreiben und ihren Lernweg reflektieren. | E | Bewertungsbogen, Berichtigung, Lernlandkarte (AB 0) erneut ausfüllen | – | – |

### Hausaufgaben (verbindliche Nummern & Kurzinhalt)
- **HA 1:** Bring ein Bild mit (Postkarte, Kalenderbild, Foto aus einer Zeitschrift – ohne Personen aus deiner Familie). Schreibe 8 Dinge auf, die du darauf siehst (Stichwörter). → *Überprüfung S2:* „Bild-Speed-Dating“ (Partner zeigen sich ihr Bild, vergleichen Listen).
- **HA 2:** Teile dein mitgebrachtes Bild in Vordergrund, Mittelgrund und Hintergrund ein (Tabelle, je mind. 3 Dinge). → *Überprüfung S3:* Partnercheck mit Kontrollfragen + Stichprobe am Beamer.
- **HA 3:** Beschreibe dein Zimmer (oder ein Zimmer bei dir zu Hause) in 8 Sätzen. Benutze 8 verschiedene Präpositionen und unterstreiche sie. → *Überprüfung S4:* „Präpositionen-Bingo“ (wer welche Präposition hat, darf ankreuzen) + Selbstkontrolle Dativ.
- **HA 4:** Schreibe 6 Sätze über den Wochenmarkt. Benutze 6 verschiedene treffende Verben aus dem Wortspeicher – kein „ist“, kein „gibt es“! → *Überprüfung S5:* Verben-Detektive (Partner markieren Verben, „Ist-Polizei“).
- **HA 5:** Beschreibe einen Lieblingsgegenstand in 5–6 Sätzen mit mindestens 6 genauen Adjektiven – ohne seinen Namen zu verraten! → *Überprüfung S6:* Rätselrunde (vorlesen, die Klasse rät).
- **HA 6:** Schreibe eine Einleitung zu deinem mitgebrachten Bild (oder zum „Schulhof“-Bild, als Ausdruck/auf dem AB abgebildet). → *Überprüfung S7:* Einleitungs-Check mit W-Fragen-Daumen (Partner hakt ab).
- **HA 7:** Beschreibe den Vordergrund des Bildes „Sommertag am See“ in 5–7 Sätzen mit abwechslungsreichen Satzanfängen. → *Überprüfung S8:* Satzanfänge-Zählung + Vorlesen mit „2 Sterne, 1 Wunsch“.
- **HA 8:** Schreibe einen Schluss (3–4 Sätze) zum Bild „Sommertag am See“ und forme 6 Sätze vom Präteritum ins Präsens um (Übung auf AB 11). → *Überprüfung S9:* Kurztest „5-Minuten-Check“ (Mini-Quiz, Selbstkorrektur).
- **HA 9:** Schreibe deine Bildbeschreibung zum „Schulhof“ fertig (Reinschrift). → *Überprüfung S10:* Textlupe/Schreibkonferenz (ist zugleich Stundeninhalt).
- **HA 10:** Schreibe die überarbeitete Endfassung. Markiere drei Stellen, die du verbessert hast. → *Überprüfung S11:* Lehrkraft sammelt ein, Feedback mit Bewertungsraster (formativ, ohne Note).
- **HA 11:** Gestalte einen Spickzettel (DIN A6 Karteikarte) „Bildbeschreibung – das Wichtigste“ – darf in S12 an der Lerntheke benutzt werden. → *Überprüfung S12:* Galerie der Spickzettel, Kriterien-Check.
- **HA 12:** Fülle die Selbsteinschätzung aus (Lernlandkarte AB 0, Spalte „vor der Arbeit“) und wiederhole die Stationen, bei denen du gelb/rot hast. → *Überprüfung S13:* keine (Arbeit); Lehrkraft sammelt Selbsteinschätzung vorher ein.

### Arbeitsblätter (verbindliche Nummern)
- **AB 0** Lernlandkarte „Was kann ich schon?“ (9 Ich-kann-Sätze mit Ampel, Spalten: Start / vor der Arbeit / nach der Arbeit)
- **AB 1** Finde die 8 Unterschiede (Kinderzimmer A + B)
- **AB 2** Was ist wo? Vordergrund – Mittelgrund – Hintergrund (Sommertag am See)
- **AB 3** Das Bildraster: 9 Felder (Sommertag am See)
- **AB 4** Präpositionen im Kinderzimmer (Lückentext + Dativ)
- **AB 5** Bilddiktat-Karten A/B (zwei Mini-Szenen als einfache inline-SVG, Zeichenfeld)
- **AB 6** Verben-Werkstatt (Wochenmarkt)
- **AB 7** Adjektiv-Treppe & Farbenwerkstatt (Wochenmarkt/Sommertag)
- **AB 8** Die Einleitung: Steckbrief & Einleitungs-Puzzle (Sommertag + Bibliothek)
- **AB 9** Der rote Faden: Satzstreifen ordnen (Hauptteil Sommertag, zum Ausschneiden)
- **AB 10** Satzanfänge-Werkstatt
- **AB 11** Sehen – vermuten – meinen (Winterabend am Dorfteich) + Präsens + Schluss
- **AB 12** Mein Schreibplan: Auf dem Schulhof + Tippkarten (Hilfe 1–3)
- **AB 13** Checkliste & Textlupe-Bogen
- **AB 14** Detektiv-Fall: Der Fehlertext (Wochenmarkt-Beschreibung mit eingebauten Fehlern: ist/gibt es, Präteritum, Meinung im Hauptteil, falsche/fehlende Ortsangaben, Sprünge in der Reihenfolge, fehlende Einleitung-Infos)
- **AB 15** Das große Parkfest – Expertenauftrag (4 Gruppen: links oben / rechts oben / links unten / rechts unten)
- **AB 16** Profi-Blatt: Opa Willi in der Bibliothek
- **AB 17** Lerntheke: Laufzettel + Stationskarten (S1 Ortsangaben, S2 Verben, S3 Adjektive, S4 Einleitung, S5 Reihenfolge, S6 Sachlich & Präsens, W1 Bilddiktat, W2 Kim-Spiel/Unterschiede)
- Zusätzlich (Anhang der AB-Seite): **Lernplakat „Lupos 5 Stufen zur Bildbeschreibung“** (A4/A3 zum Aufhängen) und **Großer Wortspeicher** (Ortsangaben, Verben, Adjektive, Satzanfänge, Wirkung).

### Differenzierung (durchgängig)
- Drei Niveaus: ★ Basis (mit Wortspeicher, Satzanfängen, Lückentexten), ★★ Standard, ★★★ Profi (freies Schreiben, Begründen, Zusatzaufgaben).
- Hilfekarten/Tippkarten von Lupo, Partnerhilfe („Frag erst drei, dann mich“), Zusatzaufgaben „Für Schnelle“.
- DaZ-Hilfen: Artikel bei Nomen im Wortspeicher angeben (der/die/das), Satzmuster.

### Klassenarbeit (verbindlich)
- Bild E „Im Hafen“, 45 Minuten, insgesamt **40 Punkte**.
- **Teil A (15 P.)**: kurze Übungsaufgaben: Fachbegriffe/Bildbereiche zuordnen, Präpositionen mit Dativ, langweilige Verben ersetzen, Sätze ins Präsens setzen, Sehen/Meinen unterscheiden, Einleitung-Infos.
- **Teil B (25 P.)**: vollständige Bildbeschreibung zu „Im Hafen“ (Einleitung, Hauptteil, Schluss).
- Notenschlüssel (40 P.): 1 = 40–37, 2 = 36–31, 3 = 30–24, 4 = 23–17, 5 = 16–8, 6 = 7–0 (als anpassbar kennzeichnen).
- Bildangaben für die Einleitung in der KA: „Im Hafen“, Zeichnung/Illustration, (Zeichner: unbekannt / aus dem Unterrichtsmaterial).

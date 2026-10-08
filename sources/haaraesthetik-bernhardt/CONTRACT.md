# LUMEN · Vertrag für alle Agenten

**Projekt:** Konzept-Website „Die Lumen Edition“ für Haarästhetik Christian Bernhardt (Friseur, Kirchheim a. d. Weinstraße). Sie wird als eigenständige Seite gebaut und soll **Awwwards-Niveau** erreichen. Alle sichtbaren Texte sind auf Deutsch, mit korrekten Umlauten (ä ö ü ß), niemals ae/oe/ue.

**Ästhetik:** realistisch, avantgardistisch, zukunftsorientiert, **edel** (Quiet Luxury, Architekturfotografie, Travertin, Glas, Champagner-Licht), mit einem Hauch KI-Interface. Kein Neon, kein Sci-Fi-Kitsch, keine Galaxien.

**Leitidee „Ein Tag im Licht“:** Die Seite erzählt einen Salontag von 09:00 bis 18:00 (echte Öffnungszeiten). Scrollen bedeutet, dass Zeit vergeht. Der Core färbt den Seitenhintergrund (`--bg`) und die Schrift (`--fg`) passend zur Tageszeit ein, vom kühlen Morgen-Elfenbein über die goldene Stunde (16:30) bis zum Graphit-Abend (ab 17:30). Kapitel nutzen deshalb **`var(--bg)`, `var(--fg)`, `var(--fg-dim)`, `var(--line)`, `var(--accent)` und `var(--card)`** statt fester Farben, wo es sinnvoll ist.

**Leitform:** der Travertin-**Bogen** (Arch, Klasse `.arch` = runder oberer Abschluss). Bögen tauchen immer wieder auf: Bildmasken, Rahmen, Buttons.

**Jedes Kapitel hat ein EIGENES, einzigartiges Layout.** Keine Wiederholung desselben Schemas: kein „Bild oben, Text unten“ als Standard, keine generischen Card-Grids. Denk wie ein preisgekröntes Studio (Locomotive, Active Theory, Resn, Immersive Garden): großzügige Typografie, mutige Komposition, Asymmetrie, Weißraum, präzise Mikro-Interaktionen und scroll-gekoppelte Inszenierung.

## Ordner
`/private/tmp/claude-501/-Users-logge-Documents-Projects/aa9e3b1a-af27-4cce-bcbd-f81daff67ce3/scratchpad/hb-editions/lumen/`

- `shell.html`, `css/base.css`, `js/core.js`, `build.py` gehören dem **Core**. **Nicht ändern.** Wenn dir im Core etwas fehlt, ergänze es in deinen eigenen Dateien. Echte Core-Bugs meldest du in deinem Abschlussbericht.
- **Deine Dateien:** `parts/NN-name.html`, `css/NN-name.css`, `js/NN-name.js` (nur die dir zugeteilten NN). Nach jeder Änderung `python3 -I build.py` ausführen: Es setzt `index.html` aus allen Parts zusammen und verlinkt alle CSS- und JS-Dateien automatisch (alphabetisch, base.css/core.js zuerst).
- **Nie direkt `index.html` editieren** (wird generiert).
- Bilder liegen in `img/`: `hero, analyse, schere, farbe, pflege, lengths, hochzeit, bart, salon`, jeweils als `.webp` (1536×1024) und `-s.webp` (768×512). Layered-Parallax-Ebenen kommen eventuell später nach `img/layers/<szene>/` (siehe `img/layers/README.md`, sobald vorhanden).
- **Bildinhalte:**
  - hero: Frau im Profil links mit Hochsteckfrisur, rechts eine helle Travertinwand, Pool und Meer links.
  - analyse: Hand mit Haaranalyse-Gerät an braunem Haar, feine Lichtlinien.
  - schere: Schere auf Travertinkante mit Haarsträhne, Meerblick.
  - farbe: 5 Strähnen (Kupfer, Rosé, Platin, Aschbraun, Espresso) an einer Messingstange.
  - pflege: Milchglasflaschen auf Travertinsockel mit Wasser-Kaustik.
  - lengths: Frau von hinten mit sehr langem welligem Haar in einer Galerie.
  - hochzeit: Braut von hinten in einer Glaskapelle mit Blick auf Weinberge im Sonnenuntergang.
  - bart: Rasiermesser, Pinsel und Schaum auf schwarzem Marmor mit Messing (dunkel).
  - salon: Salon-Interieur mit schwarzen Stühlen, Holz und Glasfront zu den Weinbergen.

## Kapitel-Markup (Pflicht)
```html
<section class="chapter" id="beratung" data-time="09:00" data-title="Ankommen" data-sub="Beratung & Analyse" data-img="img/analyse-s.webp">
  …dein Layout…
</section>
```
| NN | id | data-time | data-title | data-sub |
|---|---|---|---|---|
| 00 | hero | (kein .chapter!) `<section class="hero" id="hero">` | | |
| 10 | beratung | 09:00 | Ankommen | Beratung & Analyse |
| 20 | schnitt | 10:30 | Schnitt | Haardesign & heiße Schere |
| 30 | farbe | 12:00 | Farbe | Coloration |
| 40 | pflege | 13:30 | Pflege | Hårtræt |
| 50 | laengen | 15:00 | Länge | Great Lengths |
| 60 | hochzeit | 16:30 | Hochzeit | Goldene Stunde |
| 70 | bart | 17:30 | Kontur | Bart & Gesicht |
| 80 | salon | 18:00 | Salon | Raum & Team |
| 90 | kontakt | 20:00 | Nacht | Kontakt & Termin |

Jedes Kapitel braucht einen Kapitel-Kopf mit der großen Uhrzeit. Die Gestaltung ist frei, als Basis gibt es `.ch-head` mit `.t-time`, `.ch-meta`/`.t-mono` und `.t-h2`. Gestalte die Uhrzeit pro Kapitel ruhig unterschiedlich (Position, Größe, Animation), aber erkennbar als Motiv. Die Kapitelnummer kannst du als römische Ziffer im Mono-Meta zeigen (I–IX).

## Core-API (`window.LUMEN`, als L)
- `L.onFrame((t, L) => {})`: gemeinsamer rAF-Loop. Nutze ihn statt eigener Loops. Halte die Arbeit pro Frame billig: nur sichtbare Elemente, Transforms und Opacity.
- `data-scroll` an einem Element: Der Core setzt jeden Frame `--p` (0..1) = Fortschritt beim **Pinning**: `-rect.top / (rect.height - vh)`. Typisches Muster: äußeres Element mit `height: 300vh; data-scroll`, darin `position: sticky; top: 0; height: 100vh`.
- `L.progress(el)` liefert dasselbe als Zahl, `L.through(el)` den Durchlauf-Fortschritt 0..1 (Oberkante unten bis Unterkante oben), ideal für Parallax.
- `L.vw`, `L.vh`, `L.y`, `L.vel` (geglättete Scroll-Geschwindigkeit), `L.mouse` `{x, y, nx, ny}` (nx/ny = -0.5..0.5), `L.time` (aktuelle Tageszeit in Minuten), `L.fmtTime(min)`.
- `L.clamp`, `L.lerp`, `L.smooth(v, a, b)`, `L.reduce` (prefers-reduced-motion), `L.fine` (Maus vorhanden).
- **Reveal-Klassen** (der Core beobachtet sie automatisch beim Start):
  - `.rv`: Fade plus Hochfahren.
  - `.rv-fade`.
  - `.rv-clip`: Clip-Reveal von unten.
  - `data-words` auf Headlines: wortweise maskiertes Hochfahren; `.cap`/`.pearl`-Initialen bleiben erhalten.
  - `[data-in]`: bekommt nur die Klasse `.in`.
  - Verzögerung per `style="--d:.2s"`.
  - Event `lumen:in` am Element, sobald es sichtbar wird.
  - Für dynamisch erzeugtes Markup: `L.initReveal(rootEl)` aufrufen.
- **Preise:** `<span data-price="schnitt"></span>` rendert automatisch den Preis passend zur global gewählten **Haarlänge** (`L.length`: kurz/mittel/lang/aufwendig). Es gibt eine Roll-Animation bei Änderung, und `–` erscheint, wenn eine Leistung für diese Länge nicht angeboten wird. Mit `data-len="lang"` fixierst du eine Länge.
  - Keys: siehe `L.PRICES` in core.js (erstgespraech, analyse, gl-beratung, braut-beratung, kurzhaar, fade, kurzhaar-rasur, schnitt, schnitt-foehn, heisse-schere, heisse-schere-foehn, kinder, styling, rasur, nassrasur, brauen-formen, brauen-faerben, wimpern-faerben, augen-paket, ansatz, komplettfarbe, glossing, highlights-teil, highlights-komplett, balayage, umformung-teil, umformung-komplett, pflegeritual).
  - `L.price(key, len?)` liefert die Zahl oder null, `L.fmt(n)` den Text.
  - `L.setLength(len, source)` setzt die Länge global; das Dock unten hat ebenfalls einen Schalter. Event `lumen:length` an `document`.
  - Nach dem Erzeugen von Preis-Markup per JS: `L.renderPrices()`.
- Weitere Events an `document`:
  - `lumen:loaded`: Preloader fertig (Hero-Intro-Animation startet hier; `L.loaded`).
  - `lumen:chapter`: aktives Kapitel.
  - `lumen:status`: Öffnungsstatus `{open, text, next, day, min}`, auch als `L.status`. Weitere Felder: `L.HOURS` (Wochentag → `[von, bis]` in Minuten, 0 = So), `L.berlinNow()`.
- **Cursor:** `data-cursor="Label"` an einem Element zeigt einen goldenen Cursor-Kreis mit Label (nur Desktop).
- `L.scrollTo('#id')`. Links mit `href="#…"` scrollen automatisch weich.
- Header (oben rechts: Status, Menü, Termin buchen) und Dock (unten mittig, ca. 64px hoch, auf dem Handy 58px) sind fix. Halte unten etwa 90px Luft frei, wo wichtige Inhalte bei gepinnten Szenen sonst verdeckt würden.

## Fonts (schon geladen)
- `--f-display` „Inter Tight“ (200/300/400): riesige, ultraleichte Display-Typo und Uhrzeiten.
- `--f-serif` „Cormorant Garamond“ (400/500, kursiv): Headlines, Leads, Zitate.
- `--f-sans` „Inter“: Body und Labels.
- `--f-mono` „IBM Plex Mono“: Meta und KI-Anmutung.
- Klassen: `.t-mega`, `.t-time`, `.t-h2`, `.t-h3`, `.t-lead`, `.t-body`, `.t-label`, `.t-mono`, `.cap` (Perlmutt-Initiale), `.pearl` (Perlmutt-Kursive).
- Buttons und Chips: `.btn`, `.btn-solid`, `.btn-gold`, `.btn-lg`, `.chip`.

## Palette
`--ivory #f3f0ea`, `--travertine #e7e1d6`, `--sand #d9cfbf`, `--graphite #0e0d0c`, `--ink #1a1816`, `--dim #6f685e`, `--gold #c9a46a`, `--gold-2 #e8d5b0`, `--gold-deep #9a7640`, `--pearl` (Verlauf für dunklen Grund), `--pearl-ink` (für hellen Grund).

## Effekt-Modul `js/fx.js` (kommt von einem anderen Agenten)
- `<canvas class="threads" data-mode="hero">`: Lichtfäden, liest `--p` vom nächsten `[data-scroll]`-Vorfahren.
- `<canvas class="threads" data-mode="ambient">`: ruhige Licht-Orbits.
- `[data-decode]` auf Headlines: KI-Decode-Text beim Sichtbarwerden. **Nicht gleichzeitig mit `data-words`** auf demselben Element verwenden.
- `<div class="motes">`: feiner Goldstaub (absolut, vollflächig).

Du darfst diese Hooks nutzen; fehlt fx.js, darf nichts kaputtgehen.

## Fakten (nur diese, nichts erfinden)
- Christian Bernhardt · Haarästhetik, Bissersheimer Straße 2A, 67281 Kirchheim an der Weinstraße. Tel. 06359 840 080, info@haaraesthetik-bernhardt.de.
- Online-Termin: https://kmkx.mitdenkt.io/ . Instagram: https://www.instagram.com/haaraesthetik_bernhardt , Facebook: https://www.facebook.com/haaraesthetikbernhardt .
- Öffnungszeiten: Mo geschlossen, Di–Fr 09:00–18:00, Sa 09:00–14:00, So geschlossen.
- Terminanfragen und Absagen nur online oder telefonisch, nicht per Kontaktformular.
- Längen-Kategorien: kurz = bis einschließlich Ohr; mittel = über Ohr bis einschließlich Kinn; lang = über Kinn bis einschließlich Schulter; aufwendig = über Schulterlänge bzw. sehr dichtes Haar.
- Schnittleistungen inkl. Haarbad und Pflege, wahlweise ohne oder mit Föhnen. Die heiße Schere ist auch zusätzlich zum Schnitt buchbar.
- Kinderhaarschnitt bis einschließlich 14 Jahre.
- Ansatzfarbe: bis 3 cm Nachwuchs. Preise gelten als Grundpreise, gültig ab 09/2026, Endpreise inkl. MwSt.; bei außergewöhnlichem Aufwand wird vorher informiert.
- **Hårtræt** („The science of beautiful hair“, Eigenmarke):
  - Organische, nachhaltige Wirkstoffe.
  - Der digitale Haartester analysiert das Haar im Salon.
  - Jedes Produkt hat eine Funktion: reinigen, pflegen oder schützen.
  - Die Produkte balancieren den Protein- und Feuchtigkeitshaushalt, reparieren und stärken die äußere Haarschicht und stellen den Säureschutzmantel der Kopfhaut wieder her.
  - Individuelles Pflegeritual 15 €.
- **Great Lengths:** Echthaar-Strähnen, unsichtbare Bondings, sicherer Halt, hoher Tragekomfort, natürlicher Haarfall. Ultraschallsystem MultiSonic. Effekte (Strähnen ohne Färben) möglich, verschiedene Haarstrukturen auch für feines Haar. Größte Auswahl an Farben, Strukturen, Längen, Stärken.
- **Hochzeit:** Hochzeitsfrisuren und Make-up. Stile:
  - Romantisch gesteckt: sanft fallende Locken, weich gesteckte Strähnen, hält von der Zeremonie bis zum letzten Tanz.
  - Natürlich schön: Make-up, das die natürliche Schönheit betont; feiner Lidstrich, makelloser Teint.
  - Wellen & Leichtigkeit: seidig fließende Wellen, lose Strähnen.
  - Romantisch & Modern: geflochtene Frisuren, locker im Nacken, ideal für Rückenausschnitt und Gartenhochzeiten.
  - Einzigartige Twists: der Bauernzopf/französische Zopf neu interpretiert, lockerer Twist im Nacken, mattes Finish.
- **Salon:** 120 m², 10 Bedienplätze, 3 Waschplätze. Schlicht, dunkle Farben, schwarze Möbel, viel Holz, großzügige Glasfront. Wechselnde Kunstwerke lokaler Künstler (Unterstützer der regionalen Kunstszene). Zitat: »Creating something that is universally beautiful. That is art.« – Shu Uemura.
- **Christian Bernhardt:**
  - Meister und Betriebswirt (Deutsche Friseur-Akademie Neu-Ulm), Colorist und Pflegeexperte.
  - Lehrlingswart und Vorstandsmitglied der Friseurinnung Süd-Pfalz Deutsche Weinstraße.
  - Eigener Salon seit 2018.
  - 2023 sechswöchige Seminarreihe in Miami und New York zu Business Consulting für die Beauty-Branche.
- **Team:** Yvo, Tatjana, Walled, Hendrik, Hamza, Lucien, Nero (keine Fotos vorhanden, keine Rollen erfinden).
- **Modelle gesucht:** Auszubildende suchen Übungsmodelle, immer unter Anleitung einer Fachkraft, Rabatt je nach Ausbildungsjahr. Karriere: https://haaraesthetik-bernhardt.de/karriere/ . Team: https://haaraesthetik-bernhardt.de/friseure/ . Hårtræt: https://haaraesthetik-bernhardt.de/hartraet/ .
- Partner: Intercoiffure, Harologi, Hårtræt (nur als Text, keine Logos).

## Qualität
- **Mobil zuerst mitdenken:** 390px Breite, 16px Seitenrand, kein horizontaler Scroll, Touch statt Hover (Hover-Interaktionen brauchen eine Tap-Alternative).
- **Performance:** Bilder mit `loading="lazy"` (außer Hero) und Breiten-/Höhenattributen bzw. aspect-ratio; nur transform und opacity animieren.
- `prefers-reduced-motion` respektieren (`L.reduce`).
- **A11y:** sinnvolle alt-Texte, echte Buttons, Fokus-Stile, `aria-live` für dynamische Antworten.
- **CSS:** immer unter deiner Section-ID scopen, z. B. `#farbe .strand {…}`, damit nichts kollidiert. JS in eine IIFE packen, keine globalen Variablen außer bei Bedarf `window.LUMEN_<NAME>`.
- **Testen mit Playwright** (Server läuft bereits als Hot-Reload auf **http://127.0.0.1:5578/**; keinen eigenen Server starten):
  - `cd /private/tmp/claude-501/-Users-logge-Documents-Projects/aa9e3b1a-af27-4cce-bcbd-f81daff67ce3/scratchpad/pw && node check.js http://127.0.0.1:5578/ shots/<PREFIX> 1440 900 "y1,y2,…"`
  - Das Skript gibt Konsolenfehler aus und speichert JPGs; ansehen mit dem Read-Tool.
  - Für dein Kapitel kannst du die y-Position per JS ermitteln oder ein eigenes kleines Playwright-Skript im pw-Ordner schreiben (Dateiname mit deinem Prefix). Die Chromium-Executable steht in check.js.
  - Der Preloader erscheint nur beim ersten Besuch pro Session; in Playwright ist jede Session neu. Warte also ca. 3 s nach dem Laden oder setze vorher `sessionStorage.setItem('lumen-seen','1')` per `page.addInitScript`.
  - Teste Desktop 1440×900 **und** Mobil 390×844. Schließe Browser immer (RAM sparen).
- **Iteriere visuell**, bis es wirklich nach Award aussieht. Schau dir deine Screenshots kritisch an: Typo-Hierarchie, Weißraum, Ausrichtung, Lesbarkeit auf Bildern.

## NEU (Kundenwunsch): Keine sichtbaren Uhrzeiten mehr
Kunde: Uhrzeiten wie „12:00“ verwirren (Termin? Dauer?). Die Tages-Idee und die Farbübergänge bleiben, sichtbar wird aber nur noch das **Licht** genannt.
- `data-time` am `<section>` bleibt (steuert intern die Farben), wird aber nirgends mehr angezeigt.
- Lichtnamen (auch in `LUMEN.LIGHTS`, `LUMEN.lightOf(section)`):

| Kapitel | id | Licht |
|---|---|---|
| I | beratung | Morgenlicht |
| II | schnitt | Klares Licht |
| III | farbe | Zenit |
| IV | pflege | Mittagsruhe |
| V | laengen | Lange Schatten |
| VI | hochzeit | Goldene Stunde |
| VII | bart | Streiflicht |
| VIII | salon | Blaue Stunde |
| IX | kontakt | Nacht |

- Große Uhrzeit-Typo (`.t-time`, „16 / 30“, „20:00“ …) ersetzen durch den Lichtnamen als große Display-/Serif-Typo (gern mit der bestehenden Animation sinngemäß, z. B. Buchstaben statt Ziffern) oder durch eine typografisch starke Kombination aus römischer Ziffer + Lichtname.
- Auch Mono-Labels, Bildunterschriften, `aria-label`, sr-only-Texte, laufende Uhren (z. B. Hochzeit `data-hz-clock`, Kontakt-24h-Uhr) und Sätze wie „Von 09:00 bis 18:00“ ohne Uhrzeit formulieren.
- **Ausnahme – echte Infos bleiben:** Öffnungszeiten-Liste im Kontakt, Header-Status „Geöffnet bis …“. Die Kontakt-Headline „Wir sehen uns morgen um 09:00.“ → ohne Uhrzeit („Wir sehen uns morgen.“ / „heute“ / „bald“).
- Dock (Core): zeigt jetzt Lichtname + „II · Schnitt“. Menü: römische Ziffer + Titel.

# STYLE.md: Bodycam-Look, gemessen (v1, 2026-10-14)

Referenz: das Spiel „Bodycam“ (Reissad Studio, UE5) in 8 Gameplay-Mitschnitten sowie 4 Aufnahmen echter Body-Worn-Kameras
(nur Produkt-, Demo- und Testmaterial). Gemessen wurde auf 1280×720-Frames (YouTube, 60 fps bzw. 30 fps), die Werte sind hier
auf **1920×1080** umgerechnet (Faktor 1,5), wenn „@1080“ dasteht. Skripte liegen in `research/scripts/`, die Frames liegen im Scratch
(`$SCRATCH/bodycam/ref/frames/`, Index am Ende) und **nicht** im Repo.

Legende: **[M]** = gemessen, **[S]** = aus Sichtprüfung geschätzt, **[V]** = Vorschlag/Setzung ohne direkte Messung.

> **Wichtigste Korrektur gegenüber Entwurf v0:** Das Spiel rendert **kein echtes Fisheye**. Die Projektion ist rektilinear mit sehr
> weitem Bildwinkel (hFOV ≈ 115°). Der „Fisheye“-Eindruck entsteht aus drei Dingen: der Weitwinkel-Streckung an den Rändern,
> einer **elliptischen Linsenmaske** mit orange-braunem Saum und dem dunklen Außenbereich. Echte Bodycams (Transcend, Axon Flex)
> sind dagegen deutlich tonnenförmig verzeichnet. Für die Demo: rektilinear plus leichte Tonne (k1 ≈ 0,04–0,08) plus Maske.

---

## 1. Projektion, FOV, Linse

### 1.1 Projektion und FOV [M]
- **Plumb-Line-Test** (Datei `ref_01`): Eine 490 px lange Deckenleiste mit 360 px Abstand zur Bildmitte (@720) weicht nur
  **2,9 px** von der Geraden ab, eine 500 px lange Raumkante 1,5 px. Ein Fisheye (äquidistant, f = 405 px) würde sie um ~18 px
  durchbiegen. Die beste radiale Korrektur liegt bei **k1 = 0,02–0,06** (normiert auf W/2), also praktisch null (`plumb.py`, `groove.py`).
- **Brennweite** aus orthogonalen Fluchtpunkten (144 Frame-Paare, rektilineare Annahme, `vpfocal.py`): Median **f = 405 px @1280**
  (IQR 392–437) in den Innenkarten und 464–471 px auf der Außenkarte (anderer Spieler, FOV-Regler). Eine Rotations-Selbstkalibrierung
  (`lens_rotcal.py`, k = 1) liefert 375–475 px und bestätigt das.

| Größe | Innenkarten (Standard) | Außenkarte |
|---|---|---|
| f @1080 (px) | **607** | 700 |
| hFOV | **115°** | 108° |
| vFOV (Three.js `fov`) | **83°** | 75° |
| dFOV | 122° | 115° |

**Umsetzung:** `PerspectiveCamera(fov = 82, aspect)`, Standardwert **82°** vertikal (hFOV ≈ 114° bei 16:9). Danach im Post-FX
eine leichte Tonne für den Bodycam-Charakter: `uv_src = c + d·(1 + k1·r² + k2·r⁴)` mit r = |d|/(W/2·aspect-normiert),
**k1 = 0,06, k2 = 0,01** [V]. Bei dieser Tonne die Szene mit 1,06 überscannen (FOV +3°), damit die Ränder gefüllt bleiben.
Für einen Modus „echte Kamera“ [V]: k1 = 0,18, k2 = 0,04 (Transcend/Axon wirken so; echte Body-Cams haben 140–170° dFOV).

### 1.2 Elliptische Linsenmaske mit Farbsaum [M]
Gemessen am Mittelwert-Frame aus 180 Frames (`maskfit.py`, `maskprofile.py`). Die Maske ist eine **zentrierte Ellipse**:

- Halbachsen: **a = 1,075 · W/2**, **b = 1,467 · H/2** (Außenkarte: 1,138 / 1,412). Die Ecken liegen außerhalb, die Kanten
  oben/unten/links/rechts schneiden die Maske nicht. Normierter Radius: `ρ = sqrt((x/a)² + (y/b)²)`, x, y in Pixeln ab Bildmitte.
- Profil (Faktor relativ zur Helligkeit bei ρ = 0,9; R/G/B getrennt, denn Blau fällt zuerst ab, daher der warme Saum):

| ρ | R | G | B | Wirkung |
|---|---|---|---|---|
| 0,00 → 0,90 | 1,08 → 1,00 | 1,06 → 1,00 | 1,08 → 1,00 | sanfte Innenvignette (−8 %) |
| 0,94 | 0,99 | 0,98 | 0,97 | |
| 0,97 | 0,95 | 0,90 | 0,81 | Saum beginnt |
| 0,99 | 0,83 | 0,69 | 0,53 | **orange-braun** |
| 1,01 | 0,55 | 0,41 | 0,32 | dunkles Braun |
| 1,03 | 0,32 | 0,26 | 0,26 | |
| 1,05 | 0,22 | 0,22 | 0,23 | |
| ≥ 1,08 | **0,17** | **0,19** | **0,20** | Außen: dunkelgrau, leicht kühl, **nicht** schwarz (absolut ≈ RGB 33/37/37) |

Die Saumbreite beträgt ρ 0,94–1,05, also ~16 px @720 bzw. ~24 px @1080 an der Seite. Außen schimmert das Bild weichgezeichnet durch
(×0,17 + Unschärfe σ ≈ 8 px @1080) [S]. In 2 von 8 Mitschnitten ist die Maske abgeschaltet (Spieleroption), dort fehlt auch der Saum.

```glsl
// Maske; p = fragCoord - 0.5*res (Pixel), res in px
float rho = length(vec2(p.x/(0.5375*res.x), p.y/(0.7335*res.y)));
vec3 rim = vec3(smoothstep(1.05,0.955,rho), smoothstep(1.04,0.965,rho), smoothstep(1.03,0.975,rho)); // B fällt zuerst
vec3 inner = mix(vec3(1.0), vec3(0.92), smoothstep(0.0,0.9,rho));
vec3 outside = vec3(0.17,0.19,0.20) * blurredScene;   // oder konstant ~0.13
col = mix(outside, col*inner, rim);
```

### 1.3 Chromatische Aberration [M]
- Lateral sehr gering: im Mittel +0,08 px (R nach außen) bzw. −0,06 px (B nach innen) bei r = 400–700 px @1280. Lokal in
  kontrastreichen Randbereichen bis **R +1,2 px, B −0,8 bis −1,9 px** (`ca.py`, `ref_48`). Abhängig von der Bewegung ist sie nicht (`ca_motion.py`).
- **Umsetzung:** radialer Skalierungsversatz R ×(1 + 0,0012·r²n), B ×(1 − 0,0015·r²n) (r_n = 1 am Bildrand), ≈ 1,5 px @1080 am
  Rand. Dazu der Masken-Farbsaum (siehe oben). Auch das OSD hat einen ~1-px-Rot/Cyan-Saum (es liegt also **vor** der CA im Stack).

---

## 2. Bodycam-Overlay (OSD)

### 2.1 Spiel [M] (`ref_01`, `osd_zoom.png`)
- **Oben links:** Kartenname in Versalien + Dreieck „▶“ (z. B. `WORNHOUSE▶`). **Oben rechts:** Datum `12/9/2025` (US-Format
  **M/D/YYYY**, ohne führende Nullen), Abstand, dann `REC`. **Keine Uhrzeit**, kein roter Punkt.
- Schrift: **kursive, schmale, technisch-eckige Sans** mit monospace-artigen Ziffern (Charakter ähnlich „Share Tech Mono“
  bzw. „Chakra Petch Italic“), Neigung ~12°.
- Farbe: **RGB 237/240/235** (leicht kühles Weiß). Schlagschatten schwarz, **+2…3 px rechts/unten @720**, ~60–70 % deckend,
  leicht weich. Dazu ein 1-px-CA-Saum Rot/Cyan.
- Maße @720 → **@1080**:

| Element | @720 | **@1080** |
|---|---|---|
| Versalhöhe | 16 px (2,2 % H) | **24 px** |
| Links: x-Start / Versal-Oberkante | 65–70 / 63 | **100 / 95** |
| Links: Textbreite (10 Zeichen + ▶) | 125 | 187 |
| Datum: x-Bereich | 1007–1124 | **1510–1686** |
| Lücke Datum → REC | 33 | **50** |
| REC: x-Bereich (rechter Rand) | 1157–1193 | **1736–1790** (130 px Rand) |
| Zeichenvorschub Ziffern | ~12,9 | ~19,5 (≈ 0,8 × Versalhöhe) |

- **Gewölbt:** Die Textzeilen folgen einer Tonnenwölbung. Links steigt die Zeile um **−3,3°** nach rechts an, rechts fällt sie um
  **+3,1°** nach außen ab. Das OSD also mit der Linsen-Tonne mitverzerren (oder beide Blöcke um ±3° drehen).
- Spawn: grünes **`CAM CONNECTED`** (klein, Bildmitte, ~1 s, `ref_43`). Tod: rotes **`CAM DISCONNECTED`** mittig auf
  schwarz-weißem VHS-Streifenrauschen (vertikale Streifen, horizontale Sync-Balken, `ref_44`).

### 2.2 Echte Kameras (zum Vergleich)
- Transcend DrivePro Body 20 [M] (`ref_56`): **unten** links das Modell, unten rechts `09/17/2016 07:01:48 PM`, Orange (186/132/50),
  Sans, Versalhöhe ~11 px @720 (1,5 % H), ohne Schatten.
- Axon Body 2/3 [V, aus Kenntnis, nicht am Frame geprüft; die yt-dlp-Bot-Sperre verhinderte den Abruf]: oben rechts zweizeilig
  `2024-10-14 T04:14:07Z` / `AXON BODY 3 X60A1972`, weiß mit schwarzer Kontur, Zeitstempel in UTC mit „Z“.

### 2.3 Vorgabe für die Demo [V]
Spiel-Layout übernehmen (Positionen, Größe, Schrift, Schatten, Wölbung), Inhalte an den Vertrag angepasst:
- links: `BWC-4 X60A1972 ▶`
- rechts: `10/14/2026  23:14:07  REC` (Uhrzeit sekundengenau mitlaufend; Datum im Spielformat M/D/YYYY)
- `CAM CONNECTED` beim Start, `CAM DISCONNECTED` mit Streifen-Glitch beim Tod.

---

## 3. Farbe, Tonwert, Belichtung

### 3.1 Statistik je Mitschnitt [M] (`colorstats.py`, Luma Y 0–255, jeder 2. Frame bei 1 fps)

| Clip | Y 0,5 % | Y 5 % | Y 50 % | Y 95 % | Y 99,5 % | ≥250 (%) | ≤6 (%) | Sättigung (Mittel) | b* (gelb+) |
|---|---|---|---|---|---|---|---|---|---|
| Innen Tag (g1) | 9 | 24 | 101 | 199 | 235 | 0,1 | 0,2 | 30 | **+6,8** |
| Innen düster (g1) | 2 | 10 | 72 | 187 | 228 | 0,0 | 2,6 | 40 | **+11,5** |
| Betonbau Tag (g4) | 5 | 16 | 80 | 198 | 253 | 0,8 | 0,9 | 21 | −0,2 |
| **Nacht innen (g5)** | 1 | 1 | **3** | 109 | 250 | 0,6 | **65** | 8 | 0,5 |
| **Dunkel + Lampe (g3)** | 1 | 1 | **3** | 59 | 167 | 0,1 | **64** | 10 | 0,4 |
| Schießstand (g2/g7) | 2–7 | 12–21 | 87–112 | 219–252 | 254 | **2,4–5,8** | 0,4–2 | 16 | +4…+5 |
| Echt Nacht (Transcend) | 0 | 1 | 25 | 117 | 236 | 0,3 | 33 | 72 | +7,5 (grünstichig) |

Daraus:
- **Schwarz säuft ab:** Bei Nacht liegen 65 % der Pixel bei Y ≤ 6. Ein Toe, der alles unter ~0,6 % linear auf 0 drückt [V].
- **Lichter clippen hart:** Fenster und Lampen gehen auf 255 (2–6 % der Fläche in hellen Szenen, `ref_47`). Keine sanfte Schulter,
  eher ein kurzes Knie ab ~0,9 und dann hart clippen.
- **Sättigung niedrig:** HSV-S im Mittel 16–30 von 255, also deutlich entsättigt (Faktor **0,75–0,85** [V]).
- **Farbstich:** Innen **warm-gelblich** (b* +7…+12, Glühlampenlicht, verwittertes Weiß), außen bzw. bei Tageslicht neutral bis
  leicht kühl. Mondlicht-Himmel bläulich (`ref_42`). Echte Bodycams sind grün-gelb (Leuchtstoff/Natrium, `ref_56`).
- **Kurve [V]:** ACES-artiger Filmic-Tonemapper mit Belichtung so, dass der Innen-Median bei Y ≈ 100 liegt, dazu
  `y = smoothstep(0.012, 1.0, x)^1.05` als Toe-Crush und Weißpunkt-Clip bei 0,97.

### 3.2 Automatische Belichtung [M/S]
- Übergang dunkel → hell (`analysis/motion`, Tag-Haus t = 68,5 s): Mittel-Luma 60 → **134 (Überschwinger, +20 %)** → 110–116,
  Anstieg ~1,0 s, Einschwingen bis ~1,5 s.
- **Umsetzung [V]:** Adaption hell→dunkel τ = 0,9 s, dunkel→hell τ = 0,35 s, 15 % Überschwinger (zweiter Pol), Bereich
  −2…+4 EV. Mündungsfeuer darf die Belichtung **nicht** sofort ziehen (Blitz < 50 ms).

### 3.3 Rauschen, Schärfe, Kompression [M]
- **Rauschen:** In den YouTube-Mitschnitten praktisch unsichtbar (Hochpass-σ 0,3–0,46 / 255 in allen Helligkeiten, gleich bei
  Spiel und echten Kameras, weil die Kompression es glättet). Sichtbar wirkt es nur als **Flackern dunkler Flächen**.
  **Umsetzung [V]:** Luma-Rauschen σ = 2,0/255 bei Y < 0,1, 0,8/255 in den Mitten, 0,3/255 in Lichtern; Chroma-Rauschen 40 %;
  Muster mit 30 Hz wechseln (bei 60 fps je 2 Frames halten).
- **Schärfe:** Das Spiel ist **weich** (10–90-%-Kantenbreite 1,68 px @720, kaum Halo: −3 % Unterschwinger, TAA-Look).
  Echte Bodycams sind **stark überschärft** (Lowlight-Sample: **−59 % Unterschwinger**, Kante 1,09 px).
  **Umsetzung [V]:** Unsharp-Mask Stärke 0,5, Radius 1,2 px @1080, Halo auf ±10 % begrenzen. Das ist ein Mittelweg, den der Vertrag („überschärft“) verlangt.
- **Kompression:** In dunklen, detailarmen Flächen und bei Bewegung entstehen **große flache Blöcke** (`ref_37`, `ref_38`):
  Blockkante **~32 px @720 → 48 px @1080**, Blockinneres fast einfarbig, Grenzen hart, besonders um den Lampen-Hotspot.
  Messbar auch als Gitterenergie mit 8- und 16-px-Periode (Kantenverhältnis 1,7–2,7). Teils kommt das von YouTube (AV1), es gehört aber
  zum Look. **Umsetzung [V]:** In Bereichen mit Y < 0,08 und Bewegung (|ω| > 30°/s) auf 48-px-Kacheln (@1080) mitteln, zu 35–60 %
  einblenden, Kacheln 2–4 Frames halten (zeitliche Trägheit). Zusätzlich 8×8-DCT-Ringing an harten Kanten nur auf „high“.

### 3.4 Bewegungsunschärfe [M]
- Unschärfelänge ≈ **1,5 × Bildversatz pro Frame bei 60 fps** (Schwenks mit 8–60 px/Frame @720 → 14–98 px Wischer, `mblur.py`).
  Das entspricht einer Belichtung von **~25 ms**. Echte Bodycams zeigen bei Nacht weniger Wischer, dafür Rolling Shutter.
- Drehgeschwindigkeiten im Spiel (Yaw): Median 10°/s, p90 ~100°/s, p99 **~470–530°/s** (Pitch: p99 160–300°/s).
- **Umsetzung:** Kamera-Rotations-Blur aus `state.angularVelocity`: Blurvektor = ω · 0,025 s · f (f = 607 px @1080), Begrenzung
  bei 160 px @1080, 8–12 Abtastungen. Die Waffe bekommt beim Rückstoß zusätzlich Objekt-Blur (siehe 6.2).
- **Rolling Shutter:** im Spiel nicht nachweisbar [S]. Optional für „echte Kamera“: Zeilenauslesezeit 18 ms [V].

---

## 4. Kamera am Körper und Bewegung

### 4.1 Position [S/V]
- Die Brustkamera sitzt mittig am Plattenträger, **1,40 m über Boden** (12 cm vor der Körperachse, ~0,32 m unter Augenhöhe 1,72 m)
  und ist um **~4° nach unten** geneigt [V]. Beim Blick nach unten (`ref_49`) sieht man Hände, Waffe und Boden, aber **keine Beine**
  (der Weste-/Körperrand verdeckt sie) [S].

### 4.2 Gehen (Kamerawackeln) [M] (`bob.py`, `bob2.py`; Phasenkorrelation, Autokorrelation)

| Quelle | Pitch-Frequenz | Pitch Spitze-Spitze | Yaw-Frequenz | Yaw Spitze-Spitze |
|---|---|---|---|---|
| Spiel, taktisches Gehen | **1,25–1,36 Hz** | **2,6–3,7°** (Median 3,7°) | 0,65–1,1 Hz | **3,9–6,4°** |
| Spiel, schnelleres Gehen (g4/g5) | 1,0–1,1 Hz | 4–6° | 1,1–1,4 Hz | 3,9–7,6° |
| Echte Bodycam, normales Gehen | **1,9–2,0 Hz** (Schritt) | **6,6–8,1°** | **0,97 Hz** (Doppelschritt) | **16–20°** |

**Umsetzung [V]:** Pitch mit Schrittfrequenz f_s, Yaw und Roll mit f_s/2.
- Schleichen/taktisch (1,0 m/s): f_s = 1,3 Hz, Pitch ±1,6°, Yaw ±2,2°, Roll ±1,2°.
- Gehen (1,5 m/s): f_s = 1,8 Hz, Pitch ±2,4°, Yaw ±3,5°, Roll ±1,8°.
- Sprint (4,5 m/s): f_s = 2,6 Hz, Pitch ±4°, Yaw ±6°, Roll ±3°, plus Rauschen (1/f) ±1°.
- Positionsbob: vertikal ±1,5 cm (Gehen), seitlich ±1 cm. Echte Kameras schaukeln deutlich mehr (Yaw ±8°). Das Spiel ist ruhiger,
  wir orientieren uns am Spiel und legen 20 % drauf.

### 4.3 Zielen und Drehen
- Spielerdrehungen mit Trägheit: Die Kamera folgt dem Maus-Input mit einer Zeitkonstante von ~60 ms (der Körper dreht nach) [V],
  sonst wirkt der Blur nicht organisch.

---

## 5. Waffe im Bild

Koordinaten in Bildanteilen (0,0 = oben links) bei vFOV 82–83° [M an `ref_02/03/05/07/09/10/11/29`, Raster in `analysis/weaponpos_grid.jpg`].

### 5.1 Low-Ready / Bereitschaft
- **Kompakte Bereitschaft (Standard beim Durchsuchen):** Die Waffe kommt **von unten rechts** ins Bild, die **Mündung zeigt auf
  (0,52; 0,55)**, also knapp unter die Bildmitte. Handschutz und Hände belegen das untere mittlere Drittel (x 0,40–0,70, y 0,55–1,0).
  Die linke Hand am Handschutz sitzt bei ~(0,50; 0,70), die rechte Hand liegt außerhalb unten rechts.
- **Tiefe Bereitschaft (Idle am Stand, `ref_05`):** Mündung bei (0,52; 0,78–0,90), nur Hand und Mündung sichtbar.
- Im Kameraraum: Mündungsrichtung 3–8° (kompakt) bzw. 25–30° (tief) unter der Kameraachse, Waffe ~0,35–0,45 m vor der Kamera [V].

### 5.2 Zielen (ADS)
- Die Visieroptik steht **zentral vor der Kamera**: Optikmitte bei **x = 0,46–0,50, y = 0,45–0,52** (Rotpunkt/Holo: 0,50/0,50;
  Kimme bei Eisenvisier: 0,49/0,45–0,57). Der Optikring ist **9–11 % der Bildbreite** groß (≈ 190 px @1080 ≙ 18° Winkeldurchmesser).
- Darunter füllt das Gehäuse einen Keil bis zum unteren Bildrand (x 0,40–0,60 unten), Hände unten links und rechts.
- Geometrie: Bei 18° für ~40 mm Optik-Außendurchmesser liegt die Kamera **~0,13 m hinter der Optik**. Also `W_SightEye`
  0,12–0,14 m hinter die Rückseite des Holo-Visiers legen und beim ADS den Kamerapunkt auf `W_SightEye` ausrichten (Spielkonvention:
  Die „Bodycam“ sieht beim Zielen durch das Visier) [M/V].
- Ein FOV-Zoom beim ADS ist nicht belegt [S]. Empfehlung: höchstens −5° (82 → 77°). ADS-Ein/Aus 0,28 s / 0,22 s, ease-out [V].

### 5.3 Waffenlicht
- Hotspot hart geclippt (Y = 255) mit Radius **5–10°** um die Laufachse, 50 % Helligkeit bei **10–15°**, ~10 % bei **20–25°**,
  schwaches Streulicht bis ~40°, darüber schwarz (`flashcone.py`, 11 Frames, `ref_32–36`). Großer weicher Bloom-Hof um den Hotspot,
  wenn die Wand nah ist (`ref_34`).
- **Umsetzung [V]:** SpotLight angle = 24°, penumbra = 0,75, Intensität so, dass eine Wand in 2 m Abstand im Hotspot clippt.
  Dazu ein zweiter, schwacher Spot (angle 40°, 4 % Intensität) für den Streuring. Die Lampe sitzt am Handschutz rechts: Bei
  Low-Ready liegt der Hotspot bei (0,40–0,60; 0,45–0,70), beim ADS 3–5 % unterhalb des Visierpunkts.

---

## 6. Schuss

### 6.1 Feuerrate und Licht [M]
- Feuerstoß-Periode **88–106 ms**, also **570–680 Schuss/min** (Autokorrelation der Hüllkurven g2/g4/g7). Vorgabe: **92 ms (650/min)**.
- **Mündungslicht** beleuchtet die Szene **2 Frames bei 60 fps (≈ 33 ms) pro Schuss**: In dunklen Innenräumen steigt die
  Bildhelligkeit ×1,9, am Tag ×1,15–1,2. Das Licht ist **warm** (Zuwachs R:G:B ≈ 1 : 0,65 : 0,15; Grundbild 79/62/38 → Blitz 150/108/49).
  Muster bei Dauerfeuer: `###..###...###` (2–3 Frames hell, 3 dunkel).
- Sichtbares Feuer: Beim ADS verdeckt die Waffe den Feuerball, die **Visierränder bekommen orange Kantenlicht** (`ref_29`).
  Bei Low-Ready zeigt sich ein großer orange-weißer Glutball mit Blendenstern an der Mündung, der über ~15 % der Bildbreite
  überstrahlt (`ref_28`). Hülsen fliegen als **messingfarbene Wischspur nach oben rechts** (1 Frame sichtbar).
- **Umsetzung [V]:** PointLight an `W_Muzzle`, Farbe #ffb060, Intensität ~30 (physikalisch) für 2 Frames, dann exponentiell mit
  τ = 15 ms abklingen. Flash-Sprite mit 3 Varianten zufällig drehen, Bloom-Threshold für 1 Frame senken.

### 6.2 Rückstoß [M]
- **Kamera** (Brust): Spitze **1,5–2,1° Pitch** (Median je Schuss; p25 0,6°, p75 3–5°), **1,0–1,5° Yaw** zufällig,
  Maximum **60–80 ms** nach dem Schuss, Erholung auf < 0,3° in **~0,5–0,7 s**. Das Bild springt also nur wenig.
- **Waffe im Bild:** Sie springt deutlich stärker (Kimme +3–5 % der Bildhöhe nach oben) und ist im Frame nach dem Schuss
  **bewegungsunscharf**. Rückkehr nach 2–3 Frames (≈ 40 ms), bei Dauerfeuer bleibt ein Restversatz von ~2 %, der sich aufbaut.
- **Umsetzung [V]:** Feder-Dämpfer-System (ω₀ = 18 rad/s, ζ = 0,55) für die Waffe mit Impuls `pitch 2,2° + rand(±0,8°)`,
  `yaw rand(±0,9°)`, `back 2,5 cm`. Die Kamera bekommt 35 % davon, dazu `state.shake` 0,25 pro Schuss.

---

## 7. Nachladen (Spiel, M4) [M] (`bursts/`, Transienten `transients.py`, Frames `ref_12–27`)

Zeiten relativ zum Animationsstart. Die Ereignis-Zeitstempel stammen aus Audio-Transienten (in Klammern: Peak in dBFS).

### 7.1 `Reload` (Teil-Nachladen, Magazin wird verstaut), Dauer **3,7 s**
| t (s) | Schritt | Bild |
|---|---|---|
| 0,00 | Waffe aus Bereitschaft anheben und ~40° nach rechts kanten | `ref_12` |
| 0,40 | Waffe fast senkrecht vor der Brust, Magazinschacht in Bildmitte unten, linke Hand greift das Magazin | `ref_14` |
| 0,56 | **magOut** (Klick, −17,9) | |
| 0,6–1,2 | Magazin nach unten links aus dem Bild (in die Tasche), Waffe bleibt gekantet | `ref_15` |
| 1,33 | Magazin in die Tasche (−3,9, dumpf) | |
| 1,4–1,9 | neues Magazin kommt mit Wischunschärfe von unten links | `ref_16`, `ref_17` |
| 2,1–2,7 | Magazin am Schacht ansetzen und einschieben | `ref_18` |
| **2,67** | **magIn** (Einrasten, −13,6 / −10,9 Doppelklick) | |
| 2,8–3,4 | Waffe zurückdrehen und senken, Kantung lösen | `ref_19` |
| 3,60 | wieder in Bereitschaft | `ref_20` |
| 3,62 | Abschluss-Ruck/Riemengeräusch beim Absetzen (−11,1) | |

### 7.2 `ReloadEmpty` (Kampf-Nachladen, Magazin fällt), Dauer **2,9 s**
| t (s) | Schritt | Bild |
|---|---|---|
| 0,00 | Waffe hochreißen und kanten | `ref_21` |
| 0,26 | **magOut** (−11,4), Magazin fällt frei | `ref_22` |
| 0,4–1,0 | **Kamera nickt ~20–25° nach unten** (Blick zur Magazintasche), Hand holt das neue Magazin, Boden im Bild | `ref_23` |
| 1,28 | **magDrop**: Magazin schlägt auf den Boden (−5,8) | |
| 1,2–1,5 | Waffe wieder senkrecht vor der Brust, Kamera hebt sich | `ref_24` |
| **1,66** | **magIn** (−13,6, +28 dB Transient) | `ref_25` |
| 2,0–2,6 | Hand schlägt auf den Verschlussfang, Waffe dreht zurück | `ref_26` |
| **2,55** | **boltRelease** (−11,5) | |
| 2,90 | Bereitschaft | `ref_27` |

Merkmale beider Varianten: Die Waffe kommt **sehr nah** an die Kamera (Handschutz füllt bis zu 40 % der Bildhöhe), ist stark
gekantet (40–70°), alles schnelle Teilbewegungen sind bewegungsunscharf, und die Kamera (Torso) dreht während des Nachladens
leicht mit (Yaw ±3°). Nach einem ReloadEmpty mit Ladehebel statt Verschlussfang (`g2`, 5,4 s): Ladehebel-Ruck bei t = 4,0 s (+32 dB Transient).

Zusätzlich [V] für `fp_anim.json`: `Fire.shot` = 0,0 s; `LightToggle.click` = 0,12 s; `Draw` 0,6 s; `Inspect` 3,5–5 s (Waffe kanten, Ladehebel-Pressecheck).

---

## 8. Ton: Bodycam-Mikrofon [M] (`burstaudio.py`, `shotaudio.py`, Spektrogramme `analysis/audio/`)

- **Clipping ist echt und hart:** Schüsse erreichen **0 dBFS** (Sample-Peak 1,000). In Feuerstößen liegen 0,03–1,1 % der Samples
  über 0,97, bei Nahschüssen auf der Außenkarte **12,7 %**. Die Crest-Faktoren in Feuerstößen sind sehr niedrig (**5–12 dB**), es gibt
  also massives Limiting. In den Spektrogrammen erscheinen beim Clipping Spitzen bis 24 kHz (Aliasing-Obertöne).
- **Dynamik:** Raumgeräusch −35 bis −50 dBFS RMS, Schüsse 0 dBFS. Mittel-RMS der Clips −15 bis −17 dBFS.
- **Spektrum eines Schusses** (170-ms-Fenster): energiereich von **20 Hz bis 1 kHz** (−6…−9 dB relativ), dann Abfall um ~6 dB/Oktave:
  2–4 kHz −9…−15, 4–8 kHz −12…−21, 8–12 kHz −18…−30, über 16 kHz < −36. Medianfrequenz 0,25–1,0 kHz, 95-%-Rolloff 1,7–6 kHz.
  Ein Spiel-Schuss klingt also **dumpf, wuchtig und verzerrt**, kein heller Knall.
- **Nachhall innen** (nach dem letzten Schuss eines Feuerstoßes): −10 dB nach ~100 ms, −20 dB nach ~190–350 ms, −28 dB nach 400 ms,
  das Grundrauschen (~−40 dB) ist nach ~650 ms erreicht. Effektive **RT60 ≈ 0,9–1,0 s** in den Holzhaus-Räumen.
  Außen: nicht sauber isoliert. Vorgabe [V]: langes Echo, 1,5–2,5 s, mit Slapback-Reflexionen bei 0,25–0,6 s.
- **Tinnitus nach Nahtreffer/Dauerfeuer** (g3): reiner Sinus bei **4078 Hz**, dominiert das Spektrum, ~−20 dBFS, hält **> 15 s**
  und wird langsam leiser. Andere Geräusche werden dabei gedämpft. `ear_ringing` entsprechend als Sinus 4,08 kHz + leise Oberwelle bauen.
- **Bandbreite echter Body-Cams:** −20-dB-Grenze bei 7,8–15,7 kHz (Axon Flex 15,7 kHz, Transcend 7,8 kHz), mono, AAC.
- **Master-Kette (AUDIO-ENGINE) [V]:**
  1. Mono-Summe (Body-Cam-Mikro ist mono; leichte Stereobreite nur für Ambience ≤ 20 %).
  2. Hochpass 60 Hz, Tiefpass **12 kHz** (12 dB/Okt), Präsenzanhebung +3 dB bei 2,5 kHz (Q 1) für das kleine Mikro.
  3. Kompressor: Threshold −24 dB, Ratio 6:1, Attack 1 ms, **Release 250 ms** (sorgt für Pumpen: Raumton taucht nach Schüssen weg).
  4. Soft-Clipper (tanh, Drive +6 dB) und danach ein harter Clip bei −0,3 dBFS. Schüsse treiben das Signal bewusst in die Sättigung.
  5. Rauschen: rosa Rauschen bei −58 dBFS + Mikrofon-Handling-Rumpeln bei Schritten (Tiefpass 150 Hz, −30 dB).
- Schuss-Tail innen per Faltungshall (RT60 0,9 s, Pre-Delay 8 ms), außen 2 s mit Slapback (siehe oben). Tipp für SOUNDS: Devlog
  „This Is What a Gunshot Really Sounds Like | Devlog [2/4]“ (Bodycam Game, https://www.youtube.com/watch?v=Oz66Ek1RYWU).

---

## 9. Sonstige Effekte
- **Schaden:** Vollbild-Rotfärbung (Multiply #ff4040, Sättigung hoch) für ~0,3–0,5 s, dazu Makroblock-Zerfall und Bildzittern (`ref_39`).
- **Nacht außen:** Himmel blaugrau mit kräftig hellen Wolken (Mond), Boden praktisch schwarz, beleuchtete Fenster clippen warmweiß
  (`ref_40–42`). Für unsere Szene: Blaulicht/Rotlicht als einzige weitere Quelle, die Wände rhythmisch färbt.
- **Überbelichtung:** Durch Fenster hereinfallendes Tageslicht clippt flächig auf Weiß, mit sichtbarem Bloom-Saum (`ref_47`).
- **Material-Look innen:** abblätternde Farbe, Graffiti, Schmutz an den Kanten, staubige Holzböden mit Papierresten. Hohe
  Mikrodetails, dabei matte Rauigkeit (`ref_03`, `ref_48`).

---

## 10. Parameter-Übersicht (Kopiervorlage)

```js
export const BODYCAM_STYLE = {
  camera: { vFov: 82, height: 1.40, pitchDown: 4, adsFovDelta: -5, sightEyeOffset: 0.13 },
  lens:   { k1: 0.06, k2: 0.01, overscan: 1.06, caR: 0.0012, caB: -0.0015,
            mask: { a: 0.5375 /*·W*/, b: 0.7335 /*·H*/, rimInner: 0.94, rimOuter: 1.05, outside: [0.17,0.19,0.20], innerVignette: 0.08 } },
  osd:    { capPx1080: 24, left: [100,95], rightEdge: 1790, color: '#edf0eb', shadow: [3,3,0.65], skewDeg: 12, arcDeg: 3,
            textLeft: 'BWC-4 X60A1972 ▶', dateFmt: 'M/D/YYYY', showTime: true, rec: 'REC' },
  grade:  { saturation: 0.8, warmIndoor: 0.06, toeCrush: 0.012, whiteClip: 0.97, highlightsKnee: 0.9 },
  exposure: { tauDarken: 0.9, tauBrighten: 0.35, overshoot: 0.15, minEV: -2, maxEV: 4 },
  noise:  { lumaDark: 2.0/255, lumaMid: 0.8/255, lumaHigh: 0.3/255, chroma: 0.4, rateHz: 30 },
  sharpen:{ amount: 0.5, radiusPx1080: 1.2, haloClamp: 0.1 },
  blocks: { sizePx1080: 48, lumaMax: 0.08, minAngVel: 30, mix: [0.35,0.6], holdFrames: [2,4] },
  motionBlur: { exposureSec: 0.025, maxPx1080: 160, samples: 10 },
  bob:    { walk: { stepHz: 1.8, pitch: 2.4, yaw: 3.5, roll: 1.8, posY: 0.015 },
            sneak:{ stepHz: 1.3, pitch: 1.6, yaw: 2.2, roll: 1.2, posY: 0.01 },
            sprint:{ stepHz: 2.6, pitch: 4.0, yaw: 6.0, roll: 3.0, posY: 0.03 } },
  fire:   { rpm: 650, flashFrames60: 2, flashColor: '#ffb060', flashDecayMs: 15, sceneGainDark: 1.9 },
  recoil: { weaponPitch: 2.2, weaponPitchRand: 0.8, weaponYawRand: 0.9, weaponBack: 0.025, cameraShare: 0.35,
            spring: { omega: 18, zeta: 0.55 }, camPeakMs: 70, camRecoverS: 0.6 },
  reload: { Reload: { dur: 3.7, magOut: 0.56, magStow: 1.33, magIn: 2.67, settle: 3.62 },
            ReloadEmpty: { dur: 2.9, magOut: 0.26, magDrop: 1.28, magIn: 1.66, boltRelease: 2.55, lookDownDeg: 22 } },
  light:  { angleDeg: 24, penumbra: 0.75, spillAngleDeg: 40, spillGain: 0.04 },
  audio:  { hp: 60, lp: 12000, presenceHz: 2500, presenceDb: 3, comp: { thr: -24, ratio: 6, atk: 0.001, rel: 0.25 },
            softClipDriveDb: 6, ceilingDb: -0.3, noiseDb: -58, rt60Indoor: 0.9, rt60Outdoor: 2.0, tinnitusHz: 4078 },
};
```

---

## 11. Frame-Index (`$SCRATCH/bodycam/ref/frames/`, 1280×720, nicht im Repo)

Erzeugt mit `research/scripts/curate.sh $SCRATCH/bodycam/ref`. Kontaktbogen: `ref/analysis/curated_sheet.jpg`.

| Datei | Inhalt |
|---|---|
| ref_01_osd_spiel_tag_innen | OSD des Spiels (Kartenname ▶, Datum, REC), Linsenmaske mit Saum, Innenraum Tag. Zentraler Messframe für OSD und Plumb-Line |
| ref_02_lowready_gewehr_tag | kompakte Bereitschaft, Waffe von unten rechts, Wohnzimmer |
| ref_03_lowready_gewehr_schlafzimmer | Hände/Handschutz Mitte unten, warmes Innenlicht, Dreck |
| ref_04_lowready_raum_leichen | Bereitschaft, Leichen am Boden, Türen |
| ref_05_lowready_m4_idle | tiefe Bereitschaft am Schießstand (nur Hand + Mündung) |
| ref_06_ads_reddot_veranda | Rotpunkt-ADS auf der Veranda |
| ref_07_ads_reddot_flur | ADS Flur, Optik zentriert |
| ref_08_ads_reddot_treppe | ADS Treppe |
| ref_09_ads_reddot_kueche | ADS Küche, roter Punkt mittig |
| ref_10_ads_optik_aussen | ADS außen, Optikring ~10 % Bildbreite |
| ref_11_ads_kimme_korn_beton | Eisenvisier-ADS im Betonbau |
| ref_12 … ref_20_reload_normal_t69.60 … t73.40 | Sequenz `Reload` (siehe 7.1) |
| ref_21 … ref_27_reload_combat_t78.40 … t81.00 | Sequenz `ReloadEmpty` (siehe 7.2) |
| ref_28_schuss_muendungslicht_kueche | Mündungsfeuer bei Low-Ready, Raum orange ausgeleuchtet |
| ref_29_schuss_auto_lichtframe | Dauerfeuer, Licht-Frame (warme Kanten an der Kimme) |
| ref_30_schuss_auto_blurframe | Dauerfeuer, Rückstoß-Blur-Frame |
| ref_31_schuss_feuergefecht_beton | Feuergefecht, Mündungsfeuer des Gegners im Raum |
| ref_32_taschenlampe_flur | Waffenlicht im dunklen Flur |
| ref_33_taschenlampe_raum | Lichtkegel auf Möbeln, Rest schwarz |
| ref_34_taschenlampe_nah_bloom | Wand nah: Hotspot clippt, großer Bloom-Hof |
| ref_35_taschenlampe_ads_nacht | ADS mit Waffenlicht, Optik als Silhouette im Hotspot |
| ref_36_taschenlampe_ads_tuer | ADS mit Licht auf Tür |
| ref_37_kompression_makrobloecke | Makroblöcke in Dunkelheit (~32 px @720) |
| ref_38_kompression_bloecke_lampe | Blöcke um den Lampen-Hotspot |
| ref_39_schaden_rot | Schadensflash rot |
| ref_40_nacht_aussen_veranda | Nacht außen, Mondhimmel blaugrau, Lampe |
| ref_41_nacht_aussen_fenster_innenlicht | Nacht außen, warm leuchtende Fenster |
| ref_42_nacht_himmel_aussen | Nachthimmel mit Bäumen, fast schwarzer Boden (ohne Maske) |
| ref_43_overlay_cam_connected | „CAM CONNECTED“ (grün) |
| ref_44_overlay_cam_disconnected_glitch | „CAM DISCONNECTED“ mit VHS-Streifen |
| ref_45_bewegungsunschaerfe_drehung | starker Rotations-Blur |
| ref_46_bewegungsunschaerfe_stark | Blur beim Schwenk, Treppe |
| ref_47_ueberbelichtet_fenster | Fenster clippt flächig, Treppenhaus |
| ref_48_innen_tag_materialien_ca | Materialien Tag, CA-Messframe |
| ref_49_blick_nach_unten_haende | Blick nach unten: Hände, Gewehr, Boden, keine Beine |
| ref_50_tuer_durchgang_waffe | Tür und Durchgang mit Waffe |
| ref_51_pistole_ads_fassade | Pistolen-ADS vor Holzfassade (Plumb-Line „Rillen“) |
| ref_52_trailer_graben_tiefwinkel | Trailer: Weitwinkel nach oben, Maske |
| ref_53_trailer_optik_nah | Trailer: Zielfernrohr nah |
| ref_54_trailer_innen_dunkel | Trailer: dunkler Innenraum, Fensterlicht |
| ref_55_treppenhaus_weitwinkel | Treppenhaus, gerade Linien am Rand (rektilinear) |
| ref_56_echt_bodycam_nacht_halle | echte Body-Cam (Transcend), Nacht, Grünstich, OSD unten |
| ref_57_echt_bodycam_fisheye_treppe | echte Body-Cam, deutlich tonnenförmige Verzeichnung |
| ref_58_echt_bodycam_lowlight | echte Body-Cam (Pinnacle Low-Light-Demo), Kirmes nachts, Überschärfung |
| ref_59_echt_axonflex_buero | Axon-Flex-Testvideo (640×480), Fisheye, Büro |

Weitere Hilfsbilder in `$SCRATCH/bodycam/ref/analysis/`: `mean_*.png` (Mittelwert-Frames bzw. Maske), `plumb_osd.png`, `osd_zoom.png`,
`weaponpos_grid.jpg`, `ads_grid.jpg`, `lowready_grid.jpg`, `audio/spec_*.png`. Bursts in `ref/bursts/` (5 fps: Nachladen; 60 fps: Schuss).

## 12. Quellen (nur Abschnitte, 720p, nach der Auswertung gelöscht)

| Kürzel | Video | Abschnitt |
|---|---|---|
| g1_house_day / g1_house_dark | Zylo FPS: „BODYCAM GAME – MAX GRAPHICS 4K60FPS FULL GAMEPLAY (NO COMMENTARY)“, https://www.youtube.com/watch?v=opKIK1PIzfc | 0:00–3:00 / 6:20–9:43 |
| g2_m4_reload | The Prototype: „BODYCAM – All Weapon Reload, Inspect Animations & Sounds in 18 Minutes“, https://www.youtube.com/watch?v=GfDTNdfx7x8 | 5:50–7:25 |
| g3_dark_flash | Kryptek Muted: „Bodycam – Max Graphics Full Gameplay! (No Commentary)“, https://www.youtube.com/watch?v=rkou-6YTWtI | 9:15–12:30 |
| g4_house_ext | Immersive Realistic Gameplay: „BODYCAM: Ultra Realistic Graphics & Combat Showcase in 4K“, https://www.youtube.com/watch?v=zpmYTxQXRDM | 9:00–11:40 |
| g5_night | JSumo: „Bodycam | The Night time experience is Intense!“, https://www.youtube.com/watch?v=8cfC6fb2DwM | 0:00–1:12 |
| g6_trailer | Bodycam Game: „Locked & Loaded Major Update | Official Trailer“, https://www.youtube.com/watch?v=AQ3DPo2fvSc | 0:00–2:10 |
| g7_reload_cmp | BEQA: „Bodycam – Normal Reload vs Combat Reload Animations Comparison“, https://www.youtube.com/watch?v=UU5PotmrEys | 0:00–2:30 |
| r1_lowlight | Body Cameras by Pinnacle Response: „Body Camera Low Light Capture“, https://www.youtube.com/watch?v=Zj_D7_Hnr5E | 0:00–2:30 |
| r2_walk_night | SwirlingOverCoffee: „Transcend DrivePro Body 20 Sample Footage, at night while walking“, https://www.youtube.com/watch?v=gwE4B1NL9eo | 0:00–2:00 |
| r3_body4 | Axon: „Presenting: Axon Body 4“ (Werbefilm, wenig Messwert), https://www.youtube.com/watch?v=GQYChn3CQFs | 0:00–1:09 |
| r4_axonflex | Police Video Requests: „Test Axon Flex (body camera) video from Liberty Lake, Washington“, https://www.youtube.com/watch?v=ng7hxZDP4Dw | komplett (40 s) |

## 13. Grenzen dieser Messung
- Alle Bildmessungen laufen über YouTube-Kompression (VP9/AV1, 720p). Rauschen und Feinschärfe sind daher nur bedingt aussagekräftig.
  Die Makroblöcke stammen teilweise von YouTube.
- Das Vorzeichen des Kamera-Rückstoßes ist aus der Phasenkorrelation nicht eindeutig. Visuell hebt sich die Waffe, das Bild bleibt fast ruhig.
- Kamerahöhe, Lehnen (Q/E), Türöffnen und ADS-Übergangszeiten sind nicht gemessen (Werte dort [V]). In den Mitschnitten gab es kein sauberes Material dafür.
- Roll-Anteil beim Gehen und Rolling Shutter sind nicht gemessen (die Phasenkorrelation erfasst nur Translation).
- Die Außen-Nachhallzeit ist nicht isoliert messbar gewesen (Dauerfeuer überlagert).

# Sounds – Quellen (UNIT 27 · Bodycam-Tech-Demo)

**Privatkopie für ein privates, nicht kommerzielles Projekt.** Alle Clips sind Ausschnitte aus öffentlich zugänglichen YouTube-Videos
(überwiegend Soundeffekt-Bibliotheken wie Sound Ideas, The Hollywood Edge, ProSound Effects, Watson Wu sowie einzelne Feldaufnahmen).
Die geschnittenen Dateien liegen in `public/bodycam-demo/audio/` und sind **gitignored** – sie werden weder committet noch veröffentlicht.
Committet werden nur Schnittliste, Skripte und das Manifest `public/bodycam-demo/data/sounds.json`. Ohne `audio/` muss die Demo per Fallback-Synthese laufen.

## Neu erzeugen

```sh
# aus dem Repo-Root; lädt die Quellen (nur bestaudio), schneidet, normalisiert und kodiert Opus/OGG 48 kHz
python3 -I sources/bodycam-demo/audio/fetch_sounds.py            # alles
python3 -I sources/bodycam-demo/audio/fetch_sounds.py --only "step_*,rifle_shot_indoor" --keep-raw --raw /tmp/sraw
```

- `clips.py`: Schnittliste (Name, YouTube-ID, Start/Ende in Sekunden, Filter/Normalisierung). `soundlib.py`: Verarbeitung. `fetch_sounds.py`: Treiber + Manifest.
- Punktquellen: Onset-genau geschnitten (≤ ~1–4 ms Vorlauf), kurzer Fade-in, Schwanz bis -50…-55 dB unter Spitze, Peak -1 dBTP, mono.
  Relative Lautstärke steht im Manifest als `gain`. `rifle_tail_*` behalten ihren Pegel relativ zum Schuss und starten zeitgleich mit ihm.
- Schleifen (`loop: true`): Ende per Equal-Power-Crossfade in den Anfang geblendet, LUFS-normalisiert (Ambiences Stereo, -23 bzw. -30 LUFS).
- YouTube blockierte bei vielen Anfragen mit „Sign in to confirm you’re not a bot“. Dann einige Minuten warten bzw. `--cookies firefox` o. Ä. angeben.

## Quellen je Name

### `rifle_shot_indoor` (5×, gain 1.0)
5.56-Karabiner im Innenraum, Schütze-Perspektive, natürlicher Raumhall ~0,6 s (inkl. Hülsenklingeln)
- https://www.youtube.com/watch?v=78zgY95U8Q4 – pressphotog8854: „RUGER AR-556 at the indoor shooting range“ – 0:38.73–0:39.90
- https://www.youtube.com/watch?v=78zgY95U8Q4 – pressphotog8854: „RUGER AR-556 at the indoor shooting range“ – 0:42.62–0:43.75
- https://www.youtube.com/watch?v=78zgY95U8Q4 – pressphotog8854: „RUGER AR-556 at the indoor shooting range“ – 0:45.98–0:47.38
- https://www.youtube.com/watch?v=78zgY95U8Q4 – pressphotog8854: „RUGER AR-556 at the indoor shooting range“ – 0:51.57–0:52.70
- https://www.youtube.com/watch?v=78zgY95U8Q4 – pressphotog8854: „RUGER AR-556 at the indoor shooting range“ – 0:58.33–0:59.56

### `rifle_shot_outdoor` (5×, gain 1.0)
AR-15/M4 im Freien, Schütze-Perspektive, mit Gebäude-/Geländeecho
- https://www.youtube.com/watch?v=y5FMmbY2qm4 – Sound Ideas - Topi: „Single Shot from Colt Ar-15 H Bar Automatic Rifle“ – 0:00.02–0:02.60
- https://www.youtube.com/watch?v=aOl_17UOaBk – Sound Ideas - Topi: „Single Shot from Colt M16 A2 Automatic Rifle“ – 0:00.03–0:02.40
- https://www.youtube.com/watch?v=SMCiY2Z4mxk – The Hollywood Edge: „Ar-15 Automatic Rifle Firing One Bullet“ – 0:00.34–0:02.80
- https://www.youtube.com/watch?v=Rdxw9VRmJsY – Watson Wu: „WEAPON RECORDINGS - INDOOR, OUTSIDE, and FOREST“ – 1:01.12–1:03.60
- https://www.youtube.com/watch?v=Rdxw9VRmJsY – Watson Wu: „WEAPON RECORDINGS - INDOOR, OUTSIDE, and FOREST“ – 1:04.99–1:07.40

### `rifle_tail_indoor` (3×, gain 1.0)
Raumhall eines Gewehrschusses ohne Transiente; zeitgleich mit dem Schuss starten
- https://www.youtube.com/watch?v=awf0v7tXi14 – Pole Position Prod: „Recording Gunshots Sounds - The Indoor Gun Acoustics 2 Sound Effects L“ – 0:42.33–0:44.00
- https://www.youtube.com/watch?v=awf0v7tXi14 – Pole Position Prod: „Recording Gunshots Sounds - The Indoor Gun Acoustics 2 Sound Effects L“ – 0:45.43–0:47.20
- https://www.youtube.com/watch?v=awf0v7tXi14 – Pole Position Prod: „Recording Gunshots Sounds - The Indoor Gun Acoustics 2 Sound Effects L“ – 1:11.61–1:14.00

### `rifle_tail_outdoor` (3×, gain 1.0)
Außenecho/Nachhall eines Gewehrschusses ohne Transiente; zeitgleich mit dem Schuss starten
- https://www.youtube.com/watch?v=2Z-7slP1NmU – SOUND Effects Publ: „Rifle Shot Echo YOUTUBE SOUND Effect“ – 0:01.14–0:05.00
- https://www.youtube.com/watch?v=y6mjfW_AO8Y – The Hollywood Edge: „Rifle Shot with Echo“ – 0:00.31–0:04.50
- https://www.youtube.com/watch?v=Rdxw9VRmJsY – Watson Wu: „WEAPON RECORDINGS - INDOOR, OUTSIDE, and FOREST“ – 1:01.12–1:03.60

### `pistol_shot_indoor` (5×, gain 0.9)
9-mm-Pistole im Innenraum (NPC-Schuss, nah)
- https://www.youtube.com/watch?v=5bYu9cTfZXc – Sound Ideas - Topi: „Single Shot from C275 9mm Hand Gun“ – 0:00.06–0:01.60
- https://www.youtube.com/watch?v=F0V01VJseUU – Sound Ideas - Topi: „Single Shot Beretta Model 92f 9mm Parabellum Semi Automatic Pistol“ – 0:00.02–0:01.80
- https://www.youtube.com/watch?v=OROFMGvxt5Q – Sound Ideas - Topi: „Single Shot from a Beretta M9 Hand Gun“ – 0:00.06–0:01.50
- https://www.youtube.com/watch?v=kuMpJhSeudY – Sound Effects: „Gun Shot Indoor Pistol Shooting l Sound Effect“ – 0:00.46–0:01.80
- https://www.youtube.com/watch?v=4p5kjTLx4_4 – The Hollywood Edge: „Single Handgun Shot Take 1“ – 0:00.02–0:01.80

### `rifle_mech` (3×, gain 0.25)
Verschluss-/Federgeräusch des Karabiners; leise unter jeden eigenen Schuss legen
- https://www.youtube.com/watch?v=G4D_681z8nQ – Sound Effects Libr: „Gun, Machine, Foley - M-16: Pull and Release Charge Handle Machine Gun“ – 0:00.44–0:00.85
- https://www.youtube.com/watch?v=1Ala1S6gG7I – Bluefox Studio: „AR-15 With P-MAG Sound Effects (free for public use)“ – 0:11.20–0:11.65
- https://www.youtube.com/watch?v=WmG10On2Jhs – Sound Ideas - Topi: „M-16 Machine Gun: Lock and Load“ – 0:03.85–0:04.30

### `dry_fire` (3×, gain 0.6)
Abzug auf leerer Kammer (Klick)
- https://www.youtube.com/watch?v=1Ala1S6gG7I – Bluefox Studio: „AR-15 With P-MAG Sound Effects (free for public use)“ – 0:16.53–0:16.95
- https://www.youtube.com/watch?v=S5qfBAZuIxU – Sound Ideas - Topi: „Dry Fire from Colt Ar-15 H Bar, Automatic Rifle“ – 0:00.02–0:00.50
- https://www.youtube.com/watch?v=G8PdJf1ZRbE – Sound Ideas - Topi: „M-16 Machine Gun: Dry Fire“ – 0:00.01–0:00.45

### `mag_out` (3×, gain 0.6)
Magazinhalter drücken, Magazin herausziehen
- https://www.youtube.com/watch?v=1Ala1S6gG7I – Bluefox Studio: „AR-15 With P-MAG Sound Effects (free for public use)“ – 0:19.63–0:20.40
- https://www.youtube.com/watch?v=PZGpLE2uPYE – ProSound Effects: „Gun Foley Assault Rifle (Magazine Remove)“ – 0:00.07–0:00.75
- https://www.youtube.com/watch?v=TpvlcTt0M7s – ProSound Effects: „Gun Foley Assault Rifle (Magazine Remove)“ – 0:00.07–0:00.75

### `mag_in` (4×, gain 0.7)
Magazin einsetzen und einrasten
- https://www.youtube.com/watch?v=1Ala1S6gG7I – Bluefox Studio: „AR-15 With P-MAG Sound Effects (free for public use)“ – 0:02.46–0:03.05
- https://www.youtube.com/watch?v=1Ala1S6gG7I – Bluefox Studio: „AR-15 With P-MAG Sound Effects (free for public use)“ – 0:04.92–0:05.40
- https://www.youtube.com/watch?v=1Ala1S6gG7I – Bluefox Studio: „AR-15 With P-MAG Sound Effects (free for public use)“ – 0:07.77–0:08.30
- https://www.youtube.com/watch?v=uBQAR4jda-c – ProSound Effects: „Gun Foley Assault Rifle / Gun Foley, Assault Rifle, Bushmaster AR-15,“ – 0:00.84–0:01.25

### `mag_drop` (4×, gain 0.6)
Leeres Magazin fällt auf den Boden
- https://www.youtube.com/watch?v=bHrVxdS0ceA – The Sound Pack Tree: „Drop Magazine On Various Surfaces | Sound Effect“ – 0:00.08–0:00.75
- https://www.youtube.com/watch?v=bHrVxdS0ceA – The Sound Pack Tree: „Drop Magazine On Various Surfaces | Sound Effect“ – 0:05.72–0:06.35
- https://www.youtube.com/watch?v=bHrVxdS0ceA – The Sound Pack Tree: „Drop Magazine On Various Surfaces | Sound Effect“ – 0:09.22–0:09.80
- https://www.youtube.com/watch?v=bHrVxdS0ceA – The Sound Pack Tree: „Drop Magazine On Various Surfaces | Sound Effect“ – 0:14.00–0:14.70

### `bolt_release` (2×, gain 0.7)
Verschlussfang lösen, Verschluss schlägt vor (mit Pufferfeder-Nachklang)
- https://www.youtube.com/watch?v=1Ala1S6gG7I – Bluefox Studio: „AR-15 With P-MAG Sound Effects (free for public use)“ – 0:08.40–0:09.00
- https://www.youtube.com/watch?v=L3tfNyPGGmg – OldMateGaza: „AR-15 Bolt Release Sound (basically ASMR)“ – 0:27.10–0:27.70

### `charging_handle` (2×, gain 0.7)
Spannhebel zurückziehen und vorschnellen lassen
- https://www.youtube.com/watch?v=G4D_681z8nQ – Sound Effects Libr: „Gun, Machine, Foley - M-16: Pull and Release Charge Handle Machine Gun“ – 0:00.03–0:00.85
- https://www.youtube.com/watch?v=ueIBF5aH1V4 – The Hollywood Edge: „Load and Cock an M-16 Rifle“ – 0:01.10–0:01.95

### `selector` (4×, gain 0.4)
Sicherungs-/Feuerwahlhebel klickt
- https://www.youtube.com/watch?v=1Vc0_yo4Kuo – SFX BOX: „Rifle Switch Firing Mode Click Sound Effect“ – 0:01.07–0:01.30
- https://www.youtube.com/watch?v=1Vc0_yo4Kuo – SFX BOX: „Rifle Switch Firing Mode Click Sound Effect“ – 0:04.62–0:04.85
- https://www.youtube.com/watch?v=1Vc0_yo4Kuo – SFX BOX: „Rifle Switch Firing Mode Click Sound Effect“ – 0:08.33–0:08.55
- https://www.youtube.com/watch?v=1Vc0_yo4Kuo – SFX BOX: „Rifle Switch Firing Mode Click Sound Effect“ – 0:11.61–0:11.83

### `light_click` (4×, gain 0.4)
Taster des Waffenlichts
- https://www.youtube.com/watch?v=_f3PGXD8JBY – SoundEffectsFactor: „Flashlight Switch Turn On Sound Effect“ – 0:01.08–0:01.40
- https://www.youtube.com/watch?v=_f3PGXD8JBY – SoundEffectsFactor: „Flashlight Switch Turn On Sound Effect“ – 0:03.20–0:03.50
- https://www.youtube.com/watch?v=sEQOkbANLWM – The Hollywood Edge: „Flashlight Clicks on and Off“ – 0:00.46–0:00.63
- https://www.youtube.com/watch?v=sEQOkbANLWM – The Hollywood Edge: „Flashlight Clicks on and Off“ – 0:00.64–0:00.84

### `casing_concrete` (5×, gain 0.35)
Messinghülse fällt auf Beton/harten Boden und springt
- https://www.youtube.com/watch?v=aDw-dENQ-LQ – Sound Ideas - Topi: „7.62 X 51 Mm Nato Cartridge Casing Falls on Concrete Floor“ – 0:00.00–0:01.50
- https://www.youtube.com/watch?v=kOEZysagwHo – SOUND Effects Publ: „Brass Bullet Shell Drop Onto Concrete Multiple Takes SOUND Effect“ – 0:02.38–0:04.05
- https://www.youtube.com/watch?v=kOEZysagwHo – SOUND Effects Publ: „Brass Bullet Shell Drop Onto Concrete Multiple Takes SOUND Effect“ – 0:04.14–0:05.45
- https://www.youtube.com/watch?v=kOEZysagwHo – SOUND Effects Publ: „Brass Bullet Shell Drop Onto Concrete Multiple Takes SOUND Effect“ – 0:09.98–0:11.60
- https://www.youtube.com/watch?v=FPzya0-3aHM – Sound Ideas - Topi: „.357 Cartridge Casing Falls on Concrete Floor“ – 0:00.00–0:01.50

### `casing_wood` (4×, gain 0.35)
Messinghülse fällt auf Holzboden
- https://www.youtube.com/watch?v=wF96mAC6imo – Sound Ideas - Topi: „.223 Remington Cartridge Casing Falls on Wood Floor 1“ – 0:00.00–0:01.30
- https://www.youtube.com/watch?v=x1W3qjGtZq8 – Sound Ideas - Topi: „.223 Remington Cartridge Casing Falls on Wood Floor 2“ – 0:00.00–0:01.30
- https://www.youtube.com/watch?v=tS_5iGRO5wA – Sound Ideas - Topi: „7.62 X 51 Mm Nato Cartridge Casing Falls on Wood Floor“ – 0:00.00–0:01.30
- https://www.youtube.com/watch?v=Gs4klLSg01A – Sound Ideas - Topi: „.357 Cartridge Casing Falls on Wood Floor“ – 0:00.00–0:01.30

### `step_concrete` (5×, gain 0.45)
Einsatzstiefel auf Beton, ein Schritt
- https://www.youtube.com/watch?v=KLkHTvP_YiY – UH Sound: „Footsteps Boots Walking on Concrete Sound Effect“ – 0:01.61–0:02.21
- https://www.youtube.com/watch?v=KLkHTvP_YiY – UH Sound: „Footsteps Boots Walking on Concrete Sound Effect“ – 0:02.48–0:03.08
- https://www.youtube.com/watch?v=KLkHTvP_YiY – UH Sound: „Footsteps Boots Walking on Concrete Sound Effect“ – 0:04.21–0:04.81
- https://www.youtube.com/watch?v=KLkHTvP_YiY – UH Sound: „Footsteps Boots Walking on Concrete Sound Effect“ – 0:07.68–0:08.28
- https://www.youtube.com/watch?v=KLkHTvP_YiY – UH Sound: „Footsteps Boots Walking on Concrete Sound Effect“ – 0:09.41–0:10.01

### `step_wood` (5×, gain 0.5)
Einsatzstiefel auf Holzdielen, ein Schritt
- https://www.youtube.com/watch?v=8AnRxVsEnBU – Sound Ideas - Topi: „Heavy Boots Walk Across Porch and Down Steps on Wood Porch“ – 0:00.08–0:00.68
- https://www.youtube.com/watch?v=8AnRxVsEnBU – Sound Ideas - Topi: „Heavy Boots Walk Across Porch and Down Steps on Wood Porch“ – 0:00.79–0:01.39
- https://www.youtube.com/watch?v=8AnRxVsEnBU – Sound Ideas - Topi: „Heavy Boots Walk Across Porch and Down Steps on Wood Porch“ – 0:01.47–0:02.07
- https://www.youtube.com/watch?v=L8Q5ZjizTaQ – Quality Sound FX: „Wooden Floor Steps - Sound Effect (HD)“ – 0:04.95–0:05.55
- https://www.youtube.com/watch?v=L8Q5ZjizTaQ – Quality Sound FX: „Wooden Floor Steps - Sound Effect (HD)“ – 0:09.03–0:09.63

### `step_carpet` (5×, gain 0.35)
Einsatzstiefel auf Teppich (über Holz), ein Schritt
- https://www.youtube.com/watch?v=ErYOrIpWzpg – Sound Ideas - Topi: „Heavy Boots Take Slow Steps on Carpet Covered Wood Stairs“ – 0:00.09–0:00.69
- https://www.youtube.com/watch?v=ErYOrIpWzpg – Sound Ideas - Topi: „Heavy Boots Take Slow Steps on Carpet Covered Wood Stairs“ – 0:01.62–0:02.22
- https://www.youtube.com/watch?v=ErYOrIpWzpg – Sound Ideas - Topi: „Heavy Boots Take Slow Steps on Carpet Covered Wood Stairs“ – 0:04.31–0:04.91
- https://www.youtube.com/watch?v=ErYOrIpWzpg – Sound Ideas - Topi: „Heavy Boots Take Slow Steps on Carpet Covered Wood Stairs“ – 0:06.95–0:07.55
- https://www.youtube.com/watch?v=ErYOrIpWzpg – Sound Ideas - Topi: „Heavy Boots Take Slow Steps on Carpet Covered Wood Stairs“ – 0:08.27–0:08.87

### `step_tile` (5×, gain 0.45)
Einsatzstiefel auf Fliesen, ein Schritt
- https://www.youtube.com/watch?v=Na6w0mPGTWE – Everyday Cinematic: „Footsteps on Tile Flooring“ – 0:07.53–0:08.13
- https://www.youtube.com/watch?v=Na6w0mPGTWE – Everyday Cinematic: „Footsteps on Tile Flooring“ – 0:08.12–0:08.72
- https://www.youtube.com/watch?v=Na6w0mPGTWE – Everyday Cinematic: „Footsteps on Tile Flooring“ – 0:09.19–0:09.79
- https://www.youtube.com/watch?v=Na6w0mPGTWE – Everyday Cinematic: „Footsteps on Tile Flooring“ – 0:12.21–0:12.81
- https://www.youtube.com/watch?v=Na6w0mPGTWE – Everyday Cinematic: „Footsteps on Tile Flooring“ – 0:14.22–0:14.82

### `step_grass` (5×, gain 0.4)
Einsatzstiefel auf (nassem) Gras, ein Schritt
- https://www.youtube.com/watch?v=VyQLTIenpbU – Sound Ideas - Topi: „Heavy Boots Walk at Medium Pace on Grass“ – 0:00.95–0:01.55
- https://www.youtube.com/watch?v=VyQLTIenpbU – Sound Ideas - Topi: „Heavy Boots Walk at Medium Pace on Grass“ – 0:02.55–0:03.15
- https://www.youtube.com/watch?v=VyQLTIenpbU – Sound Ideas - Topi: „Heavy Boots Walk at Medium Pace on Grass“ – 0:03.40–0:04.00
- https://www.youtube.com/watch?v=VyQLTIenpbU – Sound Ideas - Topi: „Heavy Boots Walk at Medium Pace on Grass“ – 0:08.97–0:09.57
- https://www.youtube.com/watch?v=VyQLTIenpbU – Sound Ideas - Topi: „Heavy Boots Walk at Medium Pace on Grass“ – 0:09.76–0:10.36

### `step_asphalt` (5×, gain 0.45)
Einsatzstiefel auf Asphalt, ein Schritt
- https://www.youtube.com/watch?v=nBUMP_182rQ – UH Sound: „Footsteps Man Walking in Heavy Boots Asphalt Sound Effect“ – 0:02.39–0:02.99
- https://www.youtube.com/watch?v=nBUMP_182rQ – UH Sound: „Footsteps Man Walking in Heavy Boots Asphalt Sound Effect“ – 0:03.60–0:04.20
- https://www.youtube.com/watch?v=nBUMP_182rQ – UH Sound: „Footsteps Man Walking in Heavy Boots Asphalt Sound Effect“ – 0:04.20–0:04.80
- https://www.youtube.com/watch?v=nBUMP_182rQ – UH Sound: „Footsteps Man Walking in Heavy Boots Asphalt Sound Effect“ – 0:05.44–0:06.04
- https://www.youtube.com/watch?v=nBUMP_182rQ – UH Sound: „Footsteps Man Walking in Heavy Boots Asphalt Sound Effect“ – 0:12.28–0:12.88

### `impact_wood` (3×, gain 0.6)
Geschoss schlägt in Holz ein (Splittern)
- https://www.youtube.com/watch?v=3MGi1if3Erg – Sound Ideas - Topi: „Bullet Impact on Wood 2“ – 0:00.12–0:00.70
- https://www.youtube.com/watch?v=ERdpaHzO1B0 – Sound Ideas - Topi: „Bullet Impact on Wood 1“ – 0:00.00–0:00.50
- https://www.youtube.com/watch?v=MykNvlwocwg – The Hollywood Edge: „Bullet Impact into Wood“ – 0:00.10–0:00.60

### `impact_concrete` (4×, gain 0.6)
Geschoss schlägt in Beton/Mauerwerk ein
- https://www.youtube.com/watch?v=_D2JCvEOego – Cinematic Sound Ef: „Bullet hit ciment“ – 0:02.59–0:03.20
- https://www.youtube.com/watch?v=_D2JCvEOego – Cinematic Sound Ef: „Bullet hit ciment“ – 0:03.31–0:03.90
- https://www.youtube.com/watch?v=n49bNiFBvgU – Mr Vibe SFX: „Bullet Impact, Body, Concrete, Metal, Fly by - Play Once - Free SFX -“ – 0:07.79–0:08.40
- https://www.youtube.com/watch?v=n49bNiFBvgU – Mr Vibe SFX: „Bullet Impact, Body, Concrete, Metal, Fly by - Play Once - Free SFX -“ – 0:10.57–0:11.20

### `impact_plaster` (3×, gain 0.55)
Geschoss schlägt in Putz/Gipskarton ein (aus Holz-/Beton-Einschlägen gefiltert)
- https://www.youtube.com/watch?v=ERdpaHzO1B0 – Sound Ideas - Topi: „Bullet Impact on Wood 1“ – 0:00.00–0:00.50
- https://www.youtube.com/watch?v=_D2JCvEOego – Cinematic Sound Ef: „Bullet hit ciment“ – 0:02.59–0:03.20
- https://www.youtube.com/watch?v=n49bNiFBvgU – Mr Vibe SFX: „Bullet Impact, Body, Concrete, Metal, Fly by - Play Once - Free SFX -“ – 0:07.79–0:08.40

### `impact_metal` (5×, gain 0.6)
Geschoss trifft Metall (Klang/Klingeln)
- https://www.youtube.com/watch?v=-3XncwQA92Y – Sound Ideas - Topi: „Bullet Impact on Metal“ – 0:00.13–0:00.70
- https://www.youtube.com/watch?v=8rJ1-Kc_OaI – Sound Ideas - Topi: „Bullet Impact into Metal 2“ – 0:00.00–0:00.60
- https://www.youtube.com/watch?v=n49bNiFBvgU – Mr Vibe SFX: „Bullet Impact, Body, Concrete, Metal, Fly by - Play Once - Free SFX -“ – 0:13.62–0:14.60
- https://www.youtube.com/watch?v=n49bNiFBvgU – Mr Vibe SFX: „Bullet Impact, Body, Concrete, Metal, Fly by - Play Once - Free SFX -“ – 0:16.95–0:17.90
- https://www.youtube.com/watch?v=uGGkjt7DnVQ – Sound Ideas - Topi: „Bullet Impact on Heavy Metal 1“ – 0:00.00–0:00.80

### `impact_glass` (4×, gain 0.6)
Geschoss durchschlägt Glas
- https://www.youtube.com/watch?v=3TY6uHoebmY – Sound Ideas - Topi: „Single Bullet Impact Through Glass 1“ – 0:00.02–0:00.90
- https://www.youtube.com/watch?v=9VJAKgEnApQ – Sound Ideas - Topi: „Single Bullet Impact Through Glass 1“ – 0:00.04–0:00.90
- https://www.youtube.com/watch?v=_81r02hS4yE – Sound Ideas - Topi: „Single Bullet Impact Through Glass 2“ – 0:00.03–0:01.00
- https://www.youtube.com/watch?v=gGiN1ILTqjA – Sound Ideas - Topi: „Single Bullet Impact Through Glass 2“ – 0:00.03–0:01.00

### `impact_flesh` (5×, gain 0.55)
Treffer im Körper (dumpf, nass)
- https://www.youtube.com/watch?v=ThFYeby_RLo – The Hollywood Edge: „Bullet Hits Human Body with Juicy Impact Take 1“ – 0:00.05–0:00.50
- https://www.youtube.com/watch?v=cgTQ49sqo-I – The Hollywood Edge: „Bullet Hits Body with Wet Impact Take 1“ – 0:00.15–0:00.70
- https://www.youtube.com/watch?v=1Kz5vKZ3fHQ – The Hollywood Edge: „Bullet Tears into Body“ – 0:00.11–0:00.70
- https://www.youtube.com/watch?v=n49bNiFBvgU – Mr Vibe SFX: „Bullet Impact, Body, Concrete, Metal, Fly by - Play Once - Free SFX -“ – 0:03.02–0:03.60
- https://www.youtube.com/watch?v=n49bNiFBvgU – Mr Vibe SFX: „Bullet Impact, Body, Concrete, Metal, Fly by - Play Once - Free SFX -“ – 0:05.15–0:05.80

### `pistol_shot_distant` (5×, gain 0.6)
Schuss aus größerer Entfernung im Freien (dumpf, mit Echo)
- https://www.youtube.com/watch?v=W4aErfms544 – Copperfield: „distant gunshot sound effect 1“ – 0:00.02–0:01.95
- https://www.youtube.com/watch?v=W4aErfms544 – Copperfield: „distant gunshot sound effect 1“ – 0:05.97–0:07.90
- https://www.youtube.com/watch?v=W4aErfms544 – Copperfield: „distant gunshot sound effect 1“ – 0:09.96–0:11.90
- https://www.youtube.com/watch?v=eMuXTFeamdU – RoyaltyFree SoundF: „RF SFX )) Gun distant outside shots“ – 0:01.09–0:04.50
- https://www.youtube.com/watch?v=zKLc9E0O4w8 – Sound Treasures: „gun shot from distance sound effect“ – 0:00.05–0:02.50

### `glass_break` (5×, gain 0.7)
Fensterscheibe zerbricht, Scherben fallen
- https://www.youtube.com/watch?v=3gN-G_E9RBM – Sound Ideas - Topi: „Window Breaking Sound“ – 0:00.00–0:02.20
- https://www.youtube.com/watch?v=PwHVUZyKXBI – Sound Ideas - Topi: „Large Glass Window Pane Break“ – 0:00.00–0:02.40
- https://www.youtube.com/watch?v=ZJC6ONEBfL4 – Sound Ideas - Topi: „Small Window Glass Crash“ – 0:00.00–0:01.80
- https://www.youtube.com/watch?v=nqexGlQDANs – Sound Ideas - Topi: „Glass Window Breaking“ – 0:00.00–0:02.60
- https://www.youtube.com/watch?v=dI_khq7ZHwM – Sound Ideas - Topi: „Broken Glass Falling from the Frame of Small Window“ – 0:00.00–0:01.80

### `bullet_whiz` (5×, gain 0.6)
Geschoss zischt/knallt knapp vorbei
- https://www.youtube.com/watch?v=-hQpk-cSpyo – Sound Ideas - Topi: „Bullet Ricochet or Pass By“ – 0:00.04–0:00.80
- https://www.youtube.com/watch?v=mpL0VXZP4SI – The Hollywood Edge: „Bullet Ricochet or Whiz By“ – 0:00.20–0:01.00
- https://www.youtube.com/watch?v=stzSY1gT0m0 – Letme ShowYou: „Sound of a Bullet Whizzing By!“ – 0:12.20–0:12.90
- https://www.youtube.com/watch?v=n49bNiFBvgU – Mr Vibe SFX: „Bullet Impact, Body, Concrete, Metal, Fly by - Play Once - Free SFX -“ – 0:20.25–0:21.20
- https://www.youtube.com/watch?v=n49bNiFBvgU – Mr Vibe SFX: „Bullet Impact, Body, Concrete, Metal, Fly by - Play Once - Free SFX -“ – 0:23.67–0:24.30

### `door_open_creak` (4×, gain 0.6)
Alte Holztür öffnet sich knarrend (inkl. Klinke)
- https://www.youtube.com/watch?v=D3ZuJ-I78yI – Free Audio Zone: „Old Wooden Doors - Open and Close - with Creaking Sound Effect“ – 0:00.24–0:04.05
- https://www.youtube.com/watch?v=D3ZuJ-I78yI – Free Audio Zone: „Old Wooden Doors - Open and Close - with Creaking Sound Effect“ – 0:06.30–0:10.20
- https://www.youtube.com/watch?v=xu0e1eikUK8 – Digiffects Sound E: „Open and Close Interior Wood Door“ – 0:03.35–0:06.60
- https://www.youtube.com/watch?v=p1xOeIKpH5w – Sound Ideas - Topi: „Short High Pitched Door Creak“ – 0:00.00–0:00.90

### `door_close` (5×, gain 0.6)
Holztür schließt/fällt ins Schloss
- https://www.youtube.com/watch?v=EjuBvpSzJaU – Sound Ideas - Topi: „Residential Interior Wood Door with Push Handle Closes“ – 0:00.23–0:02.20
- https://www.youtube.com/watch?v=QmnVBw_CZ9U – Digiffects Sound E: „Open and Close Indoors Wood Door Version 2“ – 0:03.40–0:04.80
- https://www.youtube.com/watch?v=D3ZuJ-I78yI – Free Audio Zone: „Old Wooden Doors - Open and Close - with Creaking Sound Effect“ – 0:04.14–0:05.80
- https://www.youtube.com/watch?v=xu0e1eikUK8 – Digiffects Sound E: „Open and Close Interior Wood Door“ – 0:15.96–0:17.60
- https://www.youtube.com/watch?v=gpL7BC79uao – Digiffects Sound E: „Slamming Interior Wood Door Version 2“ – 0:02.37–0:03.90

### `door_kick` (5×, gain 0.9)
Tür wird eingetreten, Schloss/Rahmen bricht
- https://www.youtube.com/watch?v=SY8D9Dun3DQ – The Hollywood Edge: „Wooden Door Kicked Open, Breaking Lock“ – 0:00.36–0:02.40
- https://www.youtube.com/watch?v=UEkfyiIm_6I – Sound Ideas - Topi: „Wooden Door Smashed“ – 0:00.08–0:01.50
- https://www.youtube.com/watch?v=Uz5omH4CZg8 – Captain Audio - To: „Door - Wood - Kick in with Debris“ – 0:00.03–0:02.80
- https://www.youtube.com/watch?v=8xbIyaZuYuw – Sound Ideas - Topi: „Framing & Wooden Door Collapses from Being Hit or Kicked“ – 0:00.00–0:02.60
- https://www.youtube.com/watch?v=MPuUTDDzbyY – Dr. Sound Effects: „Kick in and Break Down Wood Door“ – 0:04.18–0:05.80

### `body_fall` (2×, gain 0.7)
Körper fällt auf Holzboden
- https://www.youtube.com/watch?v=i0zjZEutHuo – The Hollywood Edge: „Body Falls onto Wooden Floor Take 5“ – 0:00.41–0:01.60
- https://www.youtube.com/watch?v=ncj_Wzmby-Y – The Hollywood Edge: „Body Falls onto Wooden Floor Take 2“ – 0:00.17–0:01.40

### `gear_rattle` (6×, gain 0.25)
Ausrüstung (Gürtel, Magazintaschen, Weste) klappert bei Schritt/Bewegung
- https://www.youtube.com/watch?v=nPOMmDn7A0E – The Hollywood Edge: „Futuristic Soldiers March Steady with Armor and Gear Take 1“ – 0:02.30–0:02.90
- https://www.youtube.com/watch?v=nPOMmDn7A0E – The Hollywood Edge: „Futuristic Soldiers March Steady with Armor and Gear Take 1“ – 0:04.88–0:05.45
- https://www.youtube.com/watch?v=nPOMmDn7A0E – The Hollywood Edge: „Futuristic Soldiers March Steady with Armor and Gear Take 1“ – 0:06.60–0:07.20
- https://www.youtube.com/watch?v=nPOMmDn7A0E – The Hollywood Edge: „Futuristic Soldiers March Steady with Armor and Gear Take 1“ – 0:09.20–0:09.80
- https://www.youtube.com/watch?v=nPOMmDn7A0E – The Hollywood Edge: „Futuristic Soldiers March Steady with Armor and Gear Take 1“ – 0:12.10–0:12.70
- https://www.youtube.com/watch?v=Vit00UEenoM – Sound Ideas - Topi: „Police Officer Puts on Equipment Belt“ – 0:01.30–0:02.30

### `cloth_move` (5×, gain 0.3)
Kleidung raschelt (Jacke/Nylon) bei Drehungen
- https://www.youtube.com/watch?v=yl_hw7rhuBk – The Hollywood Edge: „Jacket Adjustment Clothes Movement“ – 0:00.50–0:02.10
- https://www.youtube.com/watch?v=yl_hw7rhuBk – The Hollywood Edge: „Jacket Adjustment Clothes Movement“ – 0:05.80–0:08.30
- https://www.youtube.com/watch?v=9x6O-UZMhQg – Digiffects Sound E: „Nylon Rustle Version 2“ – 0:02.00–0:03.20
- https://www.youtube.com/watch?v=9x6O-UZMhQg – Digiffects Sound E: „Nylon Rustle Version 2“ – 0:06.00–0:07.20
- https://www.youtube.com/watch?v=KkoWuCFB0W8 – Everyday Cinematic: „Shirt Fabric Foley“ – 0:33.00–0:35.50

### `breath_calm` (1×, gain 0.25)
Ruhiges Atmen des Spielers (Schleife)
- https://www.youtube.com/watch?v=AwJtUdKAxSU – Filmcrew Sound Eff: „Slow breathing sound effect“ – 0:00.30–0:11.20

### `breath_heavy` (2×, gain 0.35)
Schweres/schnelles Atmen nach Sprint oder Gefecht (Schleife)
- https://www.youtube.com/watch?v=79druzCcl98 – Sound Ideas - Topi: „Heavy Human Breathing“ – 0:01.50–0:29.00
- https://www.youtube.com/watch?v=JwrNRw1ULBU – Sound Effects Libr: „Human, Breath - Fast Heavy Breathing: Male Male Only Human Voices, Bre“ – 0:00.50–0:17.50

### `radio_chatter` (8×, gain 0.45)
Polizeifunk, Leitstelle spricht (Bibliotheksaufnahmen, fiktive Einsätze)
- https://www.youtube.com/watch?v=gBP_NQsvWrg – Sound Ideas - Topi: „Police Radio Call with Voices“ – 0:00.00–0:11.00
- https://www.youtube.com/watch?v=zNJ4hlwfwog – Sound Ideas - Topi: „Police Radio Dispatch Noise“ – 0:00.00–0:10.40
- https://www.youtube.com/watch?v=y5xa66uYmIY – Sound Ideas - Topi: „Call Dispatch Police Radio Inside of Cruiser“ – 0:00.00–0:11.90
- https://www.youtube.com/watch?v=xldiyZ8Y7ms – Sound Effects Libr: „Police, Radio - Int of Police Car: Call Dispatch, Emergency Equipment“ – 0:00.00–0:05.90
- https://www.youtube.com/watch?v=WMhgNfKlAyM – Sound Effects Libr: „Police, Radio - Int of Police Car: Call Dispatch, Emergency Equipment“ – 0:00.00–0:17.50
- https://www.youtube.com/watch?v=jjnRFLuHlwU – Sound Effects Libr: „Police, Radio - Int of Police Car: Call Dispatch, Emergency Equipment“ – 0:00.00–0:10.20
- https://www.youtube.com/watch?v=s5jWNKFgRBk – Sound Effects Libr: „Radio, Dispatch - Police Dispatch: Verbal Dispute: Female Voice, Emerg“ – 0:00.00–0:13.90
- https://www.youtube.com/watch?v=ln7Op4RmZGU – Sound Ideas - Topi: „Calling Dispatch on Radio Inside of Police Car“ – 0:00.00–0:16.20

### `radio_squelch` (6×, gain 0.4)
Funkgerät: Squelch/Rauschen beim Senden/Empfangen
- https://www.youtube.com/watch?v=AnWVHQfRK6w – Chrdwight: „Radio Squelch Sound Effects“ – 0:00.50–0:01.90
- https://www.youtube.com/watch?v=AnWVHQfRK6w – Chrdwight: „Radio Squelch Sound Effects“ – 0:02.05–0:03.30
- https://www.youtube.com/watch?v=AnWVHQfRK6w – Chrdwight: „Radio Squelch Sound Effects“ – 0:06.39–0:08.20
- https://www.youtube.com/watch?v=AnWVHQfRK6w – Chrdwight: „Radio Squelch Sound Effects“ – 0:10.21–0:12.10
- https://www.youtube.com/watch?v=xzAxTZ4x4ZI – RoyaltyFreeUseSoun: „two way radio squelch open sound effect“ – 0:03.11–0:03.60
- https://www.youtube.com/watch?v=RfUDIUz4_0U – Sound Ideas - Topi: „Old Walkie Talkie Squelch and Static Noises“ – 0:00.84–0:01.90

### `suspect_shout` (6×, gain 0.8)
Verdächtiger schreit (ohne verständliche Wörter)
- https://www.youtube.com/watch?v=WdhqoL8gNiA – The Hollywood Edge: „Man Yells and Screams in Anger“ – 0:00.00–0:01.60
- https://www.youtube.com/watch?v=lo4AD4JTCBo – Sound Ideas - Topi: „Adult Male Short Combat Yell (Version 1)“ – 0:00.03–0:01.50
- https://www.youtube.com/watch?v=BZrVIfBRHBc – Epic Sound Effects: „Male Battlecry/Angry Yelling Sound effect“ – 0:00.92–0:02.15
- https://www.youtube.com/watch?v=BZrVIfBRHBc – Epic Sound Effects: „Male Battlecry/Angry Yelling Sound effect“ – 0:04.62–0:05.30
- https://www.youtube.com/watch?v=SYmju7D0Ev4 – The Hollywood Edge: „Man Yells, Various, Long and Pained Yells“ – 0:05.87–0:08.30
- https://www.youtube.com/watch?v=SYmju7D0Ev4 – The Hollywood Edge: „Man Yells, Various, Long and Pained Yells“ – 0:11.19–0:13.90

### `officer_shout_police` (4×, gain 0.9)
Beamter ruft ("Show me your hands!", "This is the police", "Let me see your hands!")
- https://www.youtube.com/watch?v=0wa6FkqSE68 – Eccentric Sounds: „Show Me Your Hands - Sound Effect“ – 0:00.30–0:02.20
- https://www.youtube.com/watch?v=81gscXvRL0k – Awesome Sound FX: „This is the police - come out with your hands up!“ – 0:00.09–0:01.30
- https://www.youtube.com/watch?v=81gscXvRL0k – Awesome Sound FX: „This is the police - come out with your hands up!“ – 0:06.78–0:10.45
- https://www.youtube.com/watch?v=64JeXDdWzaA – Skydasgroup: „Let me see your hands!“ – 0:25.55–0:26.75

### `siren_distant` (2×, gain 0.35)
Sirene in der Ferne (Stereo, lang, einmalig abspielen)
- https://www.youtube.com/watch?v=gknL4rrKUHw – JiggySounds: „Police Siren, Distant, royalty free sound“ – 0:00.00–0:40.00
- https://www.youtube.com/watch?v=uA3Ac7Aq6c0 – Sound Ideas - Topi: „Police Car Siren Wailing in Distance“ – 0:00.00–0:30.00

### `dog_bark_distant` (6×, gain 0.3)
Hund bellt in der Ferne
- https://www.youtube.com/watch?v=ZQGK-cdDom0 – Sound Effects Hudd: „Distance Dog Barking Sound effect“ – 0:13.20–0:16.20
- https://www.youtube.com/watch?v=ZQGK-cdDom0 – Sound Effects Hudd: „Distance Dog Barking Sound effect“ – 0:25.50–0:28.60
- https://www.youtube.com/watch?v=ZQGK-cdDom0 – Sound Effects Hudd: „Distance Dog Barking Sound effect“ – 0:44.40–0:47.60
- https://www.youtube.com/watch?v=xVBVAHiy22E – Chaitanya Chadha: „Stock Sound Effect - Dogs howling and barking far away at night“ – 0:01.50–0:04.20
- https://www.youtube.com/watch?v=xVBVAHiy22E – Chaitanya Chadha: „Stock Sound Effect - Dogs howling and barking far away at night“ – 0:08.90–0:11.60
- https://www.youtube.com/watch?v=kdZUyA3IWT0 – Sound Ideas - Topi: „Dogs Barking, Medium Distance“ – 0:29.60–0:32.60

### `police_lightbar_hum` (1×, gain 0.3)
Leerlauf/Brummen des Streifenwagens als Punktquelle (Schleife; echte Lichtbalken sind fast lautlos)
- https://www.youtube.com/watch?v=eaKRCsvdkIw – Sound Ideas - Topi: „Ford Police Car Starts, Idles, Drives at Slow Speed, Slows to Stop & S“ – 0:30.00–1:00.00

### `ear_ringing` (1×, gain 0.25)
Ohrenklingeln (Tinnitus ~7,5 kHz) nach Schuss in Innenräumen, mit langem Ausklang
- https://www.youtube.com/watch?v=jHhjWxBWLmQ – Sound Relief Tinnitus: „Tinnitus 7500 Hz Tone“ – 0:01.00–0:08.00

### `ambient_night_suburb` (2×, gain 0.5)
Vorstadt nachts: entfernter Verkehr, Grillen (Stereo-Schleife)
- https://www.youtube.com/watch?v=tDTkQjsh4nQ – The Hollywood Edge: „Suburban Night Ambience with Crickets and Distant Highway“ – 0:20.00–1:20.00
- https://www.youtube.com/watch?v=m_siEe_yhbo – Sound Ideas - Topi: „Suburban Neighborhood at Night“ – 0:10.00–1:10.00

### `ambient_rain_light` (2×, gain 0.45)
Nieselregen/leichter Regen mit Tropfen (Stereo-Schleife)
- https://www.youtube.com/watch?v=JmeoAcbhnRs – Sound Ideas - Topi: „Light Rain & Drizzle Coming Down in Urban Area“ – 0:20.00–1:20.00
- https://www.youtube.com/watch?v=VpD7soH3PiQ – Sound Ideas - Topi: „Light Rain, Heavy Dripping“ – 0:02.00–0:50.00

### `ambient_house_room_tone` (2×, gain 0.5)
Raumton leeres Haus (leises Rauschen/Brummen, Stereo-Schleife)
- https://www.youtube.com/watch?v=bxDriu6XchY – The Hollywood Edge: „Empty Interior Room Tone Empty Interior“ – 0:05.00–0:55.00
- https://www.youtube.com/watch?v=En92wSBi2TM – The Hollywood Edge: „Generic Room Tone with a Good Hum Take 2“ – 0:20.00–1:00.00

## Bekannte Schwächen

- `impact_plaster`: keine saubere Putz-/Gipskarton-Aufnahme verfügbar (Downloads blockiert) – aus Holz-/Beton-Einschlägen dumpfer gefiltert.
- `body_fall` nur 2 Varianten, `breath_calm` nur 1 Schleife (verrauschte Quelle, entrauscht).
- `rifle_shot_indoor` stammt aus einer Handy-Aufnahme (Innenstand); per EQ an das Spektrum von Bodycam-Gameplay angenähert (mehr Druck/Präsenz).
- `officer_shout_police_4` stammt aus einer realen, stark übersteuerten Aufnahme („Let me see your hands!“); bei Bedenken aus `clips.py` entfernen.
- `police_lightbar_hum` ist Leerlauf/Brummen eines Streifenwagens (echte LED-Lichtbalken sind praktisch lautlos).

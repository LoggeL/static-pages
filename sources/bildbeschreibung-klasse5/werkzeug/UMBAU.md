# Umbau-Auftrag: neue Bilder (2026-10-05)

Die Unterrichtsreihe ist fertig, aber **alle Bilder wurden ausgetauscht**: statt selbst gezeichneter SVGs und Gemälde (Bruegel, Spitzweg) gibt es jetzt einheitliche KI-Illustrationen als JPG/PNG. Deine Aufgabe: die dir zugeteilten Inhaltsteile in `_quellen/` so überarbeiten, dass sie **exakt zu den neuen Bildern** passen. Qualität, Umfang und Struktur der Seiten bleiben erhalten – nur anpassen, was nötig ist (aber gründlich!).

## Pflicht vorher
1. `werkzeug/VORGABE.md` lesen, **besonders Abschnitt 3 (neue Bildinhalte)** und die geänderten Zeilen in Abschnitt 4 (Stunde 6, 8, 11; AB 8, 11, 15, 16).
2. **Die neuen Bilder selbst ansehen** (mit dem Read-Werkzeug direkt öffnen): `bilder/sommertag-am-see.jpg`, `kinderzimmer.jpg`, `kinderzimmer-b.jpg`, `wochenmarkt.jpg`, `schulhof.jpg`, `im-hafen.jpg`, `winterabend.jpg`, `parkfest.jpg`, `bibliothek.jpg`, `lupo.png`. Bei Zweifeln gilt, was im Bild zu sehen ist.

## Was sich geändert hat
- Dateinamen: `bilder/<name>.svg` → `bilder/<name>.jpg` (gleiche Namen), `bilder/lupo.svg` → `bilder/lupo.png`.
- Ersetzt: `jaeger-im-schnee.jpg` (Bruegel) → **`winterabend.jpg` „Winterabend am Dorfteich“**; `kinderspiele.jpg` (Bruegel) → **`parkfest.jpg` „Das große Parkfest“** (Wimmelbild, 4 Viertel); `buecherwurm.jpg` (Spitzweg) → **`bibliothek.jpg` „Opa Willi in der Bibliothek“** (Hochformat).
- **Stunde 11** heißt jetzt **„Das große Wimmelbild – Experten für jedes Viertel“** (statt „Ab ins Museum!“). Expertengruppen zu den vier Vierteln des Parkfests; „Museumsführer“ wird zum **„Bildführer“/Audioguide-Spiel** („Stellt euch vor, ihr führt eine Besuchergruppe durch das Bild …“). Gallery Walk bleibt.
- Es gibt **keine echten Künstler/Gemälde** mehr. In Einleitungen: Bildart „farbige Illustration“, Titel, „Zeichner/in nicht angegeben / aus unserem Unterrichtsmaterial“, Jahr 2026. Die Regel „Bei Kunstwerken: Künstler/in und Entstehungsjahr nennen, wenn bekannt“ darf als Merkwissen bleiben (ohne Bruegel/Spitzweg-Beispiele; ein erfundenes Beispiel ist nicht erlaubt).
- Bildinhalte haben sich im Detail geändert (z. B. Haus am See ist weiß mit rotem Dach; Mädchen sitzt unter dem Baum und liest ein grünes Buch; Hund ist flauschig und springt; Junge auf dem Steg von hinten; Regal-Kiste hat **keine** Aufschrift „SPIELE“ mehr; Poster hat zusätzlich einen Mond; Obstverkäufer trägt grüne Schürze und reicht die Tüte; Bäckerstand hat Brote, Brötchen, Brezeln; zusätzlich Brunnen, Laterne, Bäume auf dem Markt; Schulhof-Uhr ohne feste Uhrzeit; Junge auf der Bank trägt dunkelblauen Kapuzenpulli; Brotdose mit Apfel; Hafen: Fischkisten zwei übereinander + eine daneben, kein roter Rettungsring mehr, Kind wirft Krumen zu einer heranfliegenden Möwe, Katze orange-weiß, Anker mit Kette, Leuchtturm auf felsiger Insel …). **Alles mit Abschnitt 3 abgleichen**: jede Bildaussage in Aufgaben, Lösungen, Mustertexten, Quizfragen, Beispielsätzen, Lückentexten, Fehlertexten.
- Fehlerbild: dieselben 8 Unterschiede wie vorher (Ball jetzt gelb-schwarz). Klickbereiche in **Prozent** stehen in VORGABE Abschnitt 3, Bild B.
- Bildformat jetzt **3:2** (1536×1024) statt 800×560; die Bibliothek ist **Hochformat 2:3**. Alles, was mit Koordinaten/Seitenverhältnissen arbeitet (Overlays, Raster, Ausschnitte, Hotspots, `aspect-ratio`, `object-position`, `background-position`, viewBox-Koordinaten), muss neu berechnet werden – am besten in Prozent.
- Lupo ist jetzt ein freigestelltes PNG im Hochformat: Breite statt Höhe begrenzen ist ok, aber nicht verzerren (kein festes width+height ohne `object-fit: contain`).

## Regeln
- Nur die dir zugeteilten Dateien in `_quellen/` ändern. `assets/`, `bilder/`, `werkzeug/` nicht verändern.
- Danach: `grep -n -i -E "bruegel|spitzweg|kinderspiele|jäger|bücherwurm|museum|\.svg" <deine Dateien>` muss leer sein (Ausnahme: „Museum“ nur, wenn es allgemein als Alltagssituation gemeint ist, z. B. „Museumsführung“ im Brainstorming von Stunde 1).
- `python3 werkzeug/build.py` ausführen, html.parser-Check auf Tag-Fehler. Bei JS: `node --check` auf extrahierte Skripte.
- Sichtprüfung im Headless-Browser: `~/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-gpu --hide-scrollbars --virtual-time-budget=3000 --window-size=1300,3000 --screenshot=<scratch>/x.png file:///Users/logge/Documents/Projects/bildbeschreibung-klasse5/<seite>.html` (im Hintergrund starten und nach ~15 s beenden, falls es hängt) und Screenshot mit Read ansehen; Scratch-Ordner: `/private/tmp/claude-501/-Users-logge-Documents-Projects/944d020d-3dc7-478d-83d0-0ab1d93061cf/scratchpad/<deinname>/`.
- Am Ende kurz (3–6 Zeilen) berichten, was du geändert hast und was du geprüft hast.

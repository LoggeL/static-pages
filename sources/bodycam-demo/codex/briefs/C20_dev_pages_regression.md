# C20: Restbefunde aus C14/C16 beheben und vollständiger Regressionslauf

**Voraussetzung:** C18, C19 und C21 sind fertig. Lies `status/C14.md` (Abschnitt „Offene Grenzen“), `status/C16.md` (offene Befunde),
`status/C18.md`, `C19.md`, `C21.md`.

**Aufgaben:**
1. Prüfseiten auf die zentrale Lader-Factory `js/core/loaders.js` umstellen (Meshopt): `_dev/weapon_model/viewer.js`,
   `_dev/character/viewer.js`. `_dev/character/audit.js` muss rohe Accessoren vor der Gewichtsnormalisierung des GLTFLoaders
   dekodieren. `_dev/weapon_model/validate.py` braucht einen Decoder oder eine unkomprimierte Prüfquelle in `$WORK`.
2. Testumgebung: Standardmäßig einen stummen Audioausgang nutzen, damit der Fehler mit dem Default-Ausgabegerät in Headless-Chromium
   nicht als App-Fehler erscheint. Einen Schalter für den echten Ausgang behalten und den Befund weiter dokumentieren.
3. Kompletter Lauf `npm test --prefix sources/bodycam-demo/tools/harness`, inklusive der neuen Gruppen aus C18 (Arme) und C19 (NPC).
   Shot-Listen für Arme und NPC ergänzen, falls sie fehlen. Fehler in Harness- und `_dev`-Dateien beheben, echte App-Bugs mit
   Datei, Zeile und Reproduktion in `status/C20.md` dokumentieren (App-Code nicht ändern).
4. **Größenbudget:** Das Ziel ist vorerst auf **≤ 100 MB** angehoben (ohne `_dev`, ohne `audio/`). Nur messen und berichten, nicht optimieren.

**Port:** 8969. **Dateien:** `_dev/weapon_model/*`, `_dev/character/*`, `sources/bodycam-demo/tools/harness/*`, `status/C20.md`.

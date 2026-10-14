# C16: Testsuite vervollständigen und Regressionslauf

**Voraussetzung:** C14 (Integration) und C15 (Post-FX) sind fertig. Lies `status/C13.md`, `C14.md`, `C15.md`, `C17.md` und den
Nachtrag vom 14.10. am Ende von `sources/bodycam-demo/NOTES.md` (Waffenträgheit, Haltung, Türphysik).

**Aufgaben:**
1. Die in C13 fehlenden Shot-Listen ergänzen: Waffe (`_dev/weapon_model`, App-Viewmodel in Low-Ready, ADS, Nachladen), Lightmaps
   (Prüfseite und App mit `?lightmaps=1/0`), App (Start, außen, Flur, Bad, Waschküche, Pause).
2. Die 18 Request-Abbrüche der Welt-Seite aus C13 klären: echte Fehler beheben (nur in deinen Dateien) oder als harmlos begründen.
3. Neue Regressionstests:
   - **Türen:** Öffnen per `door.toggle()`, Verlauf des Winkels über die Zeit (öffnet, prallt am Anschlag ab, schließt, rastet ein),
     Schub durch den Spieler von beiden Seiten (Tür schwingt vom Spieler weg), Blockade durch den Spieler (Tür dringt nicht in den
     Spieler ein), Projektiltreffer stößt eine nicht eingerastete Tür an, eingerastete Tür bleibt bei Treffern zu.
   - **Waffenträgheit:** Nach schneller Drehung ist `weapon.state().sway.angle` ungleich 0 und klingt innerhalb ~1 s ab; beim
     Teleport keine Auslenkung; beim ADS ist die Auslenkung kleiner; keine NaN-Werte.
   - **Post-FX:** Bildvergleich bei schneller Drehung ohne Block-Artefakte (Metrik selbst wählen, z. B. Blockiness-Kennzahl).
4. Komplette Suite laufen lassen (`npm test --prefix sources/bodycam-demo/tools/harness`) und alle Fehler entweder beheben (nur
   Harness-Dateien) oder als echte Bugs mit Datei/Zeile und Reproduktion in `status/C16.md` dokumentieren. App-Code **nicht** ändern.

**Port:** 8966. **Dateien:** `sources/bodycam-demo/tools/harness/*`, `status/C16.md`.

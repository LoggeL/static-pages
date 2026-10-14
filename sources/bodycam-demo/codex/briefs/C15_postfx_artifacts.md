# C15: Block-Artefakte in den Post-FX beheben

**Befund (Claude, Headless-Screenshot):** Bei schnellen Mausdrehungen erscheinen auf der Waffe und an Kanten große, dunkle, blockige
Kacheln (grob 16–32 px), wie ein fehlerhafter Tile- oder Motion-Blur-Pass bzw. eine falsche History-Rückprojektion im TAA.
Seit heute schwingt die Waffe außerdem träge nach (`js/weapon/sway.js`), bewegt sich also relativ zur Kamera. Die Viewmodel-Ebene
(Layer 1) darf deshalb nicht so behandelt werden, als ob sie fest an der Kamera hinge.

**Aufgabe:**
1. Reproduzieren: App laden (Startknopf), dann `__bodycam.look()` bzw. Mausbewegungen in Folge, Screenshots in Bewegung.
   Am besten deterministisch per Testpfad, der dieselbe Drehgeschwindigkeit erzeugt (z. B. 300–600 °/s).
2. Ursache finden (Motion-Vektoren, Velocity-Buffer für Layer 1, Tile-Max/Neighbor-Max, TAA-Clamping, Auflösungsskalierung) und
   sauber beheben. Kein Ausschalten von Effekten als „Fix“. Wenn ein Effekt für die Waffe nicht sinnvoll ist, maskiere ihn begründet.
3. Prüfen, dass Motion Blur der Welt bei Drehungen noch vorhanden ist und die GPU-Zeit nicht nennenswert steigt (Vorher/Nachher-Messung
   wie in `status/C5.md`).

**Port:** 8962. **Nur diese Dateien:** `public/bodycam-demo/js/postfx/*`, bei Bedarf `js/app/runtime.js` nur dort, wo Post-FX-Daten übergeben
werden (minimal, Kommentar dazu), `status/C15.md`. Waffen- und Weltdateien nicht ändern.

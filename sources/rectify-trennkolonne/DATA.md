# RECTIFY 2: Stoffdatenprotokoll

## Herkunft und Reproduzierbarkeit

Die publizierten Zahlen werden zur Build-Zeit mit `thermo==0.6.0` erzeugt. Im Browser laufen ausschließlich lokale JavaScript-Module. Es gibt weder einen Stoffdaten-Webservice noch ein externes Schrift- oder Chart-CDN.

```sh
npm run data
npm run prepare:cases
npm test
npm run build
```

Der Datengenerator legt die Methoden für Dampfdruck, Flüssigkeits- und ideales Gas-cp, Flüssigkeitsvolumen und Verdampfungsenthalpie ausdrücklich auf `HEOS_FIT` fest. Das sind Korrelationen zu Fundamentalgleichungsdaten; keine in diesem Projekt erhobenen Messreihen. Siehe [thermo Property Objects](https://thermo.readthedocs.io/property_objects.html) und [Volumenkorrelationen](https://thermo.readthedocs.io/thermo.volume.html). Die derzeitige Webdokumentation kann neuer sein als die hier festgeschriebene Bibliotheksversion.

Stoffe: Ethanol (64-17-5), Wasser (7732-18-5), Benzol (71-43-2), Toluol (108-88-3), n-Hexan (110-54-3), n-Heptan (142-82-5). Metadaten enthalten die jeweiligen direkten NIST-WebBook-Links zum Nachschlagen. Die Zahlen dieses Exports wurden aus thermo berechnet, nicht von diesen NIST-Seiten kopiert.

## Datenformat

`data/properties.js` exportiert `PROPERTY_DATA`. Jeder Reinstoff besitzt acht Zahlenreihen mit je 86 Werten, von 280 bis 450 K in Schritten von 2 K. Insgesamt 4.128 Rasterwerte, zusätzlich Metadaten.

| Reihe | Einheit | Bedeutung |
| --- | --- | --- |
| logPsat | ln(Pa) | natürlicher Logarithmus des Sättigungsdampfdrucks |
| dLogPsat | 1/K | Temperaturableitung |
| hL | J/mol | Flüssigkeitsenthalpie relativ zu 298,15 K |
| cpL | J/(mol K) | Temperaturableitung von hL |
| hV | J/mol | Dampfenthalpie mit derselben stoffweisen Referenz |
| cpV | J/(mol K) | ideales Gas-cp |
| vL | m³/mol | molarer Flüssigkeitsraum |
| dvL | m³/(mol K) | Temperaturableitung |

`mw` ist kg/mol. Der Normalsiedepunkt `boilingK` und die kritische Temperatur `criticalK` stehen in Kelvin. Die Referenztemperatur ist 298,15 K. Die Quellenwerte werden auf zwölf signifikante Stellen eingefroren. Reinstoffdaten werden kubisch-hermitisch interpoliert, der Dampfdruck im logarithmischen Raum. Die Ableitung der Interpolation wird direkt verwendet, damit die numerische Speicherbilanz konsistent bleibt.

Die Flüssigkeitsenthalpie ergibt sich aus dem Integral von cp,L ab 298,15 K. Die Dampfenthalpie wird bei jedem Normalsiedepunkt Tb mit `hL(Tb) + Hvap(Tb)` verankert und mit dem Integral des idealen Gas-cp nach T fortgesetzt. Diese Niederdrucknäherung berücksichtigt keine Druckabhängigkeit der Enthalpie und keine Dampf-Departure-Funktion. Die temperaturabhängige effektive Verdampfungsenthalpie ist `hV(T) - hL(T)`.

## Ethanol/Wasser

NRTL mit Komponente 1 = Ethanol, Komponente 2 = Wasser:

```
tau_ij = a_ij + b_ij/T, T in K
a12 = -0.8009   b12 = 246.18 K
a21 =  3.4578   b21 = -586.081 K
alpha12 = alpha21 = 0.3
```

Quelle: [DTU, Cyclic Distillation Technology, Tabelle 4.4](https://backend.orbit.dtu.dk/ws/portalfiles/portal/271074589/2Thesis.pdf), dort Aspen zugeordnet. Die NRTL-Exzessenthalpie wird aus den analytischen Temperaturableitungen der Aktivitätskoeffizienten berechnet: `hE = -R*T²*sum(x_j*dln(gamma_j)/dT)`. Volumenkontraktion beim Mischen wird nicht berücksichtigt. Der Parametersatz wird im gesamten erlaubten Modellbereich verwendet. Dies ist keine Behauptung einer experimentellen Validierung dieses gesamten Bereichs oder der berechneten Mischungsenthalpie.

## Referenzprüfungen

`tests/thermo-reference.json`: 30 Reinstoffpunkte außerhalb der Rasterknoten, 28 NRTL-Punkte aus `thermo.NRTL`, 54 Blasenpunkte aus SciPy-Brent und thermo. Diese Prüfungen decken Implementierung und Interpolation ab, nicht die absolute Messgenauigkeit der gemeinsamen Ausgangskorrelationen.

Als separate Messreferenz dient das Azeotrop bei 101.325 Pa aus [Pemberton & Mash (1978)](https://doi.org/10.1016/0021-9614(78)90160-X): xEtOH = 0,8933 ± 0,0005, T = 351,320 ± 0,002 K. RECTIFY berechnet x = 0,89069758 und T = 351,39759 K. Die Modellabweichung übersteigt die experimentelle Unsicherheit und ist in der Wissensseite ausdrücklich ausgewiesen.

`data/validation.json`: reproduzierbare Resultate aller acht Modellbeispiele über jeweils 30 min, einschließlich kumulierter Bilanzfehler. Keine gemessenen Kolonnenprofile. Nach Änderungen am Rechenkern `npm run prepare:cases` erneut ausführen.

# RECTIFY 2

Dynamisches Browser-Labor für eine gefüllte, siedende binäre Rektifikationskolonne. Drei Stoffsysteme, acht Szenarien, Stoff- und Energiebilanzen, variable Flüssigkeitsvorräte, Murphree-Effizienz, Wehrhydraulik und verzögerte PI-Regelung. Keine Anlagenfreigabe oder experimentell kalibrierte Industrieanlage.

## Entwicklung

```sh
npm test
npm run prepare:cases
npm run build
# Im Repository-Root anschließend:
npm run build
npm run dev -- --host 127.0.0.1
```

Die erste Build-Stufe kopiert nur die Runtime und Dokumentation nach `public/rectify-trennkolonne`. Vite erzeugt im Repository-Root den veröffentlichten `docs`-Stand. Für ES-Module und Web Worker muss die Seite über HTTP/HTTPS geöffnet werden, nicht als `file://`. Nach dem Laden braucht die Simulation keinen externen Dienst. Es wird kein Service Worker installiert und keine Offline-Verfügbarkeit nach einem Neuladen versprochen.

## Zuständigkeiten

- `thermo.js` und `data/properties.js`: Stoffdaten, NRTL, Blasenpunkte, Temperatur- und Qualitäts-Feedflash, Sättigungspfade.
- `model.js`: Parameterprüfung, Stufenbilanzen, stationärer Solver, adaptive Integration, Regler und Bilanzprüfung. DOM-unabhängige Schnittstelle: `ColumnModel`, `solveSteady`, `operating`, `advance`, `snapshot`, `save/restore`.
- `session.js`: Historie alle 5 s (maximal 3.601 Punkte), exakte Ereigniszeiten, Referenzprofile und versionierte Speicherung.
- `worker.js`: Laufsteuerung und Hintergrundpause. Szenario- und Konfigurationswechsel werden erst nach erfolgreicher Berechnung übernommen.
- `app.js`, `charts.js`, `styles.css`: Bedienoberfläche und SVG-Visualisierungen echter Modellzustände. Die Flussanimation illustriert Richtung und relativen Strom, keine Teilchengeschwindigkeit.
- `wissen.html`, `knowledge.js`, `DATA.md`: Annahmen, Datenherkunft, Beispiele, Referenzprüfungen.

## Reduzierte Energiebilanz

Stufen werden von oben nach unten nummeriert: 0 = gesättigter Kopfbehälter, 1..N = Böden, N+1 = Gleichgewichtsverdampfer/Sumpf. Jede Stufe besitzt M (mol) und A=M*x (mol). Der Flüssigkeitsdruck bleibt vorgegeben. Die Temperatur T(x,P) folgt aus `sum(x*gamma*Psat)=P`.

Mit `E = M*hL(x,T(x)) + Cwall*(T(x)-Tref)` und

```
K = dhL/dx entlang der Sättigung + Cwall/M * dT/dx
dE/dt = hL*dM/dt + K*(dA/dt - x*dM/dt)
```

wird die Energiebilanz nach dem austretenden Dampfstrom gelöst:

```
Vout = [Lin*(hLin-hL-K*(xIn-x))
      + Vin*(hVin-hL-K*(yIn-x))
      + F*(hFeed-hL-K*(z-x)) + Q - Qloss]
     / [hVout-hL-K*(yOut-x)]
```

Der tatsächliche Dampfanteil ist `yOut = eta*yEquilibrium + (1-eta)*yIn`, im Sumpf `yOut = yEquilibrium`. Dampfenthalpien werden bei dieser tatsächlichen Zusammensetzung und der Temperatur der jeweiligen Stufe ausgewertet. Man berechnet y und V von unten nach oben. Die Gesamt- und Komponentenbilanzen werden anschließend konservativ integriert. Die Wärmeübertragung im Kopf schließt die gesättigte Kondensatorbilanz.

Die gespeicherte Flüssigkeitsenergie verwendet die Näherung U≈H ohne pV-Term. Die Wärmekapazität des Metalls ist an dieselbe Temperatur gekoppelt; kein eigener Metalltemperaturzustand. Das Dampfvolumen speichert keine Masse/Energie. Somit gibt es keine Druckdynamik und keinen thermischen Kaltstart. Der Flüssigkeitsraum wird ideal gemischt. Dampf ist idealgasförmig.

## Numerik und Prüfung

Der stationäre Solver ist ein gedämpftes Newton-Verfahren mit pivotierter dichter linearer Lösung, Gleichungen für Komponenten und Energie sowie aus den Gesamtbilanzen eliminierten Flüssigkeitsströmen. Er initialisiert positive Produktströme und die hydraulischen Vorräte; Newton-Nichtkonvergenz ist kein Beweis physikalischer Nichtexistenz.

Die Dynamik verwendet Dormand-Prince 5(4), standardmäßig rtol=2e-8, maximal 2 s je Integrationsschritt und größenabhängige Absoluttoleranzen. Kein impliziter DAE-Solver und keine Konvergenzgarantie für beliebig extreme Einstellungen. Modellgrenzen führen zu zurückgewiesenen Schritten und bei notwendiger Schrittweite unter 1e-5 s zu einer klaren Pause. Einheiten im Kern: mol, s, K, Pa, J/mol, m³; Heizleistungszustand MW. Bedienung: kmol/h, MW, bar, °C, mol-%.

Bilanzfehler werden aus Inventaränderung minus integrierten Außenströmen berechnet. Relative Gesamtstoff- und Komponentenfehler werden durch aktuelle Vorräte bzw. kumulierte Feedmengen normiert. Der relative Energiefehler ist auf den größeren Wert aus 1 MJ, anfänglichem Energieinhalt oder kumulierter Heizenergie plus Feedmengen-Betrag mal aktueller Feedenthalpie bezogen. Der letzte Term ist eine Rechenskalierung, nicht die integrierte absolute Feedenergie. Absolute Fehler werden zusätzlich angezeigt.

Die Tests prüfen Referenzstoffdaten, NRTL, Blasenpunkte, Sättigungsinterpolation, Feed-Flash, acht 30-min-Verläufe, Schrittweitenkonvergenz, Erhaltung, Szenariozeitpunkte, gemischten Start, Import und ungültige Zustände. Alle Quellen und die Unterscheidung zwischen Implementierungsprüfung und experimenteller Validierung stehen in `DATA.md` und auf der Wissensseite.

## Bedienung

Leertaste pausiert außerhalb von Eingabefeldern. Böden im Prozessbild sind mit Maus oder Tastatur auswählbar; alternativ über die Stufenauswahl und Zahlentabelle. Die Diagramm-Tabs reagieren auf Pfeiltasten, Pos1 und Ende. Animationen respektieren reduzierte Bewegung. Export: semikolongetrennte CSV mit Dezimalkomma oder `rectify-session-v2`-JSON, das nach Prüfung pausiert geladen wird. Alte hypothetische Stoffmodelle sind nicht kompatibel.

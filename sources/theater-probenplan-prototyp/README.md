# Bühnenplan – Theater-Probenplan

Klickbarer Web-App-Prototyp für die Organisation des Kolpingtheaters Ramsen rund um das Stück „Creepshow“. Das schlichte Light-Mode-Design greift das Kolping-Orange und das Theaterlogo auf.

## Enthaltene Abläufe

- persönliche Übersicht mit nächster Probe und Anwesenheitsserie
- automatische Zusage sowie Absage mit dargestellten Fristen
- Vereinskalender für alle, Gruppen und einzelne Mitglieder
- längere Abwesenheitsmeldung
- Terminabstimmung mit anschließender Admin-Bestätigung
- Adminbereich für Termine, Gruppen und Erinnerungen
- Check-in der tatsächlich anwesenden Mitglieder durch die Probenleitung
- persönliche und vereinsweite Statistiken
- Export für Apple Kalender und Outlook sowie Übergabe an Google Kalender
- responsive Desktop- und Mobilnavigation

## Hinweis

Dies ist ein Frontend-Prototyp mit Beispieldaten. Anmeldung, echte Benachrichtigungen, dauerhafte Datenspeicherung, Rechteverwaltung und produktive Kalender-Synchronisation sind noch nicht angebunden.

## Lokal starten

```bash
npm install
npm run dev
```

Der lokale statische Produktionsstand entsteht mit `npm run build` in `dist/client`.
Für die veröffentlichte Unterseite im Repository `LoggeL/static-pages` wird mit
`npm run build:static-pages` gebaut. Der Export wird anschließend unter
`public/theater-probenplan-prototyp/` und `docs/theater-probenplan-prototyp/` abgelegt.

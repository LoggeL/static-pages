# Flora & Grete · Drei Entwürfe

Klick-Prototyp mit drei Website-Entwürfen für Flora & Grete (Cathrin, Schneiderin in Ramsen/Pfalz) plus gemeinsamer Verwaltung.

- `index.html` – Übersicht zum Vergleichen
- `leinen/`, `millefleur/`, `lookbook/` – die drei Entwürfe (Vanilla JS, ES-Module, kein Build)
- `verwaltung/` – Mini-CMS (Hinweis-Banner, Termine, Links, Anprobe-Planer, Shop-Auswahl, Atelier-Status, Über mich)
- `shared/data.js` – Shop-, Produkt-, Bewertungs- und FAQ-Daten aus dem Etsy-Shop (Stand 19.11.2026)
- `shared/store.js` – localStorage-Store, live synchronisiert über BroadcastChannel/`storage`-Event
- `etsy-images.txt` – Etsy-Bild-IDs je Produkt; Bilder liegen als WebP (max. 1400 px) in `public/floraundgrete/img/`

Für eine Live-Version: `noindex` in den Seiten entfernen, Impressum/Datenschutz ergänzen, Store durch echtes Backend bzw. Etsy-API ersetzen.

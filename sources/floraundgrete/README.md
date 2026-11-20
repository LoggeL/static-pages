# Cathrin Raasch Atelier · Website

Website für Cathrin Raasch Atelier (Cathrin, Schneiderin in Ramsen/Pfalz) im Design „Nachtatelier“ – ausgewählt aus fünf Entwürfen – plus Verwaltung.

- `index.html`, `style.css`, `main.js`, `product.js`, `planner.js`, `util.js`, `dims.js` – die Website (Vanilla JS, ES-Module, kein Build)
- `verwaltung/` – Mini-CMS (Hinweis-Banner, Termine, Links, Anprobe-Planer, Shop-Auswahl, Atelier-Status, Über mich)
- `shared/data.js` – Shop-, Produkt-, Bewertungs- und FAQ-Daten aus dem Etsy-Shop (Stand 19.11.2026)
- `shared/store.js` – localStorage-Store, live synchronisiert über BroadcastChannel/`storage`-Event
- `leinen/`, `atelier/`, `lookbook/`, `schnittmuster/`, `nachtatelier/` – nur noch Weiterleitungen der alten Entwurfs-Adressen auf die Website
- `etsy-images.txt` – Etsy-Bild-IDs je Produkt; Bilder liegen als WebP (max. 1400 px) in `public/floraundgrete/img/`

Für eine Live-Version: `noindex` entfernen, Impressum/Datenschutz ergänzen, Store durch echtes Backend bzw. Etsy-API ersetzen.

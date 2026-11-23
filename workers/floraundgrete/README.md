# Cathrin Raasch Atelier – Worker (Website, Shop, Verwaltung)

Ein Cloudflare Worker liefert die Website aus `public/floraundgrete` aus und stellt unter `/api/*` alles bereit, was einen Server braucht:

- **Shop-Kasse** mit Stripe Checkout (Karte, PayPal, Apple Pay, Google Pay, Klarna … – was im Stripe-Dashboard aktiviert ist)
- **Bestand und Reservierung:** Stücke sind 30 Minuten an der Kasse reserviert, ein Einzelstück kann nicht doppelt verkauft werden
- **Verwaltung** (`/verwaltung/`) mit Passwort-Anmeldung: Inhalte, Termine, Anprobe-Anfragen, Artikel, Fotos, Bestellungen, Erstattungen
- **Anprobe-Anfragen** von der Website landen direkt in der Verwaltung

Ohne Worker (z. B. GitHub Pages) bleibt alles ein Klick-Prototyp: Website und Verwaltung speichern dann nur im Browser und die Kasse ist simuliert.

Preise rechnet immer der Worker, mit demselben Code wie der Browser (`public/floraundgrete/shared/shop-core.js`). Preise aus dem Browser werden nie übernommen.

## Bausteine

| Was | Wofür |
| --- | --- |
| Static Assets | alle Dateien aus `public/floraundgrete`; der Worker läuft nur für `/api/*` und `/` |
| D1 `floraundgrete` | Inhalte, Artikel, Bestellungen, Reservierungen, verarbeitete Stripe-Ereignisse |
| R2 `floraundgrete-bilder` | Fotos aus der Verwaltung, ausgeliefert unter `/api/img/…` |
| Rate Limiting | Kasse/Anfragen 10 pro Minute, Anmeldung 5 pro Minute (je IP) |
| Cron alle 15 Minuten | gibt abgelaufene Reservierungen frei |
| Turnstile (optional) | Bot-Schutz an der Kasse |

## Lokal ausprobieren

```bash
cd workers/floraundgrete
npm install
cp .dev.vars.example .dev.vars   # Passwort und SESSION_SECRET eintragen
npm run db:migrate:local
npm run dev                      # http://localhost:8787
```

Mit `ALLOW_DEMO_PAYMENTS=1` und ohne Stripe-Schlüssel wird die Zahlung nur simuliert: Die Bestellung gilt sofort als bezahlt. Das ist nur für Tests gedacht.

Mit Stripe im Testmodus `STRIPE_SECRET_KEY=sk_test_…` setzen und Webhooks weiterleiten:

```bash
stripe listen --forward-to localhost:8787/api/stripe/webhook
```

Das ausgegebene `whsec_…` kommt als `STRIPE_WEBHOOK_SECRET` in `.dev.vars`. Testkarte: `4242 4242 4242 4242`, beliebiges Datum in der Zukunft, beliebige Prüfziffer.

`npm run smoke:webhook -- whsec_…` schickt gefälschte, veraltete, doppelte und echte Webhook-Ereignisse an den laufenden `wrangler dev`. Dafür muss es in der lokalen Datenbank eine offene Bestellung 900 mit der Session `cs_test_900` geben.

## Einmalig für den echten Betrieb

1. **Datenbank und Bildspeicher anlegen**
   ```bash
   npx wrangler d1 create floraundgrete
   ```
   Die ausgegebene `database_id` in `wrangler.jsonc` eintragen. Dann:
   ```bash
   npx wrangler r2 bucket create floraundgrete-bilder
   npm run db:migrate:remote
   ```

2. **Geheimnisse setzen** (jeweils wird nach dem Wert gefragt)
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put SESSION_SECRET      # z. B. openssl rand -hex 32
   npx wrangler secret put STRIPE_SECRET_KEY   # sk_live_… (oder erst sk_test_…)
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
   `ALLOW_DEMO_PAYMENTS` im echten Betrieb **nicht** setzen.

3. **Stripe-Webhook einrichten.** Im Stripe-Dashboard unter Entwickler → Webhooks einen Endpunkt anlegen:
   `https://<deine-domain>/api/stripe/webhook`.
   Diese Ereignisse auswählen:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `charge.refunded`
   - `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`

   Das Signing Secret (`whsec_…`) ist `STRIPE_WEBHOOK_SECRET`.

4. **Zahlungsarten:** Im Stripe-Dashboard unter Einstellungen → Zahlungsmethoden PayPal, Apple Pay, Google Pay und Klarna einschalten. Stripe Checkout zeigt dann automatisch, was passt.

5. **Optional Turnstile:** In Cloudflare ein Turnstile-Widget anlegen. Den Site Key als `TURNSTILE_SITEKEY` in `wrangler.jsonc` eintragen und den Secret Key setzen:
   ```bash
   npx wrangler secret put TURNSTILE_SECRET
   ```

6. **Veröffentlichen**
   ```bash
   npm run deploy
   ```
   Danach in Cloudflare die eigene Domain mit dem Worker verbinden. Beim ersten Aufruf der Verwaltung mit dem Passwort anmelden: Die bisherigen Inhalte und das Startsortiment werden übernommen und von da an im Worker gespeichert.

## Vor dem Start mit echtem Geld

- **Rechtstexte:** Impressum, Datenschutzerklärung (Stripe, Cloudflare), AGB mit Widerrufsbelehrung und Muster-Widerrufsformular. Auf Maß genähte Stücke sind vom Widerruf ausgeschlossen (§ 312g Abs. 2 Nr. 1 BGB). Den Hinweis dazu pflegt Cathrin in der Verwaltung unter Shop → Versand & Kasse.
- **Kleinunternehmerregelung:** Ist sie an, steht „keine Umsatzsteuer nach § 19 UStG“ an jedem Preis. Gilt sie nicht mehr, den Schalter in der Verwaltung umlegen.
- **Bestellbestätigung per E-Mail:** Stripe verschickt die Zahlungsbestätigung, wenn im Dashboard unter Einstellungen → Kunden-E-Mails „Erfolgreiche Zahlungen“ an ist. Versandmails schickt Cathrin aus der Verwaltung, mit vorbereitetem Text und Sendungsnummer.
- **Ein Testkauf** im Live-Modus mit kleinem Betrag, danach in der Verwaltung erstatten.

## Wie eine Bestellung abläuft

1. Die Website schickt den Warenkorb an `POST /api/checkout`. Der Worker prüft Artikel, Varianten, Mengen, Bestand und die Auftragspause, rechnet Preis und Versand und reserviert die Stücke. Dann legt er eine Stripe-Checkout-Session an, die nach 31 Minuten abläuft.
2. Nach der Zahlung meldet Stripe `checkout.session.completed`. Der Worker prüft die Signatur, merkt sich das Ereignis gegen doppelte Zustellung, setzt die Bestellung auf „bezahlt“ (bzw. „wird abgeholt“) und zieht den Bestand ab.
3. Die Kundin landet auf `/?bestellung=danke&t=…` und sieht ihre Bestellnummer, sobald die Zahlung bestätigt ist.
4. Wird die Kasse abgebrochen oder läuft sie ab, gibt der Worker die Reservierung frei (Webhook `checkout.session.expired` oder spätestens der Cron).
5. In der Verwaltung trägt Cathrin die Sendungsnummer ein, markiert Abholungen als abgeholt oder erstattet ganz (wahlweise mit Rückbuchung in den Bestand). Rückbuchungen der Bank (Disputes) erscheinen dort als Warnung.

## Sicherheit in Kürze

- Die Anmeldung zur Verwaltung ist ein signiertes Cookie (HttpOnly, Secure, SameSite=Strict, 30 Tage). Falsche Passwörter sind auf 5 Versuche pro Minute begrenzt.
- Alle schreibenden Anfragen außer dem Stripe-Webhook müssen von der eigenen Domain kommen (Origin-Prüfung).
- Artikel tragen eine Stand-Nummer: Bearbeiten zwei Geräte gleichzeitig, überschreibt keins das andere stillschweigend.
- Webhooks werden mit HMAC-SHA256 und 5 Minuten Toleranz geprüft, jedes Ereignis wird nur einmal verarbeitet.

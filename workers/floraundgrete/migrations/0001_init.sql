-- Veröffentlichte Website-Inhalte (Termine, Kurse, Galerie, Anprobe-Anfragen, Shop-Einstellungen) als ein JSON-Dokument
CREATE TABLE content (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Artikel. Preise in Cent. stock NULL = wird auf Bestellung genäht (keine feste Stückzahl).
-- rev schützt vor Überschreiben: Verkäufe und Änderungen zählen hoch, die Verwaltung schickt ihren Stand mit.
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sort INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  price INTEGER NOT NULL CHECK (price >= 0),
  stock INTEGER CHECK (stock IS NULL OR stock >= 0),
  data TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- Bestellungen. items/customer/dispute als JSON. token = geheimer Schlüssel für die Danke-Seite.
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  delivery TEXT NOT NULL,
  items TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  shipping INTEGER NOT NULL,
  total INTEGER NOT NULL,
  customer TEXT,
  tracking TEXT NOT NULL DEFAULT '',
  carrier TEXT NOT NULL DEFAULT 'dhl',
  note TEXT NOT NULL DEFAULT '',
  dispute TEXT,
  stripe_session TEXT UNIQUE,
  payment_intent TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  updated_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX orders_status ON orders (status, expires_at);
CREATE INDEX orders_pi ON orders (payment_intent);

-- Stücke, die gerade an der Kasse liegen (verhindert Doppelverkauf von Einzelstücken)
CREATE TABLE reservations (
  order_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
CREATE INDEX reservations_product ON reservations (product_id, expires_at);

-- Bereits verarbeitete Stripe-Ereignisse (Stripe schickt bei Fehlern erneut)
CREATE TABLE stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at TEXT NOT NULL);

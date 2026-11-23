// Cathrin Raasch Atelier – Cloudflare Worker
//
//   /                     Startseite aus den statischen Dateien, veröffentlichte Inhalte + Shop direkt ins HTML
//   /api/health           Ist ein Server da? Welche Bezahlart (live/test/demo/off)?
//   /api/checkout         Warenkorb prüfen, Stücke reservieren, Stripe-Bezahlseite anlegen
//   /api/order?t=…        Status für die Danke-Seite (nur mit geheimem Token)
//   /api/stripe/webhook   Signierte Stripe-Ereignisse: bezahlt, abgelaufen, erstattet, Rückbuchung
//   /api/fitting          Anprobe-Anfrage von der Website
//   /api/img/…            Hochgeladene Fotos aus R2
//   /api/admin/…          Verwaltung (Anmeldung per Cookie): Inhalte, Artikel, Bestellungen, Fotos
import {
  priceCart, normalizeProduct, normalizeShopSettings, defaultProducts, qtyByProduct, RESERVE_MINUTES, isPaid, pauseActive,
} from "../../../public/floraundgrete/shared/shop-core.js";
import { paymentsMode, stripeRequest, verifyStripeSignature, checkoutParams, customerFromSession } from "./stripe.js";
import { authConfigured, checkPassword, sessionCookie, clearCookie, isAdmin } from "./auth.js";

const CONTENT_VERSION = 4;
const MAX_CONTENT = 1_500_000; // Bytes; Fotos gehören nach R2, nicht ins Inhalts-JSON
const MAX_IMAGE = 4_000_000;

// ---------- Antworten ----------
const BASE_HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" };
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...BASE_HEADERS, ...headers } });
const fail = (status, error, extra = {}) => json({ ok: false, error, ...extra }, status);

class HttpError extends Error {
  constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; }
}

async function readJson(request, limit = 64_000) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > limit) throw new HttpError(413, "Das ist zu groß zum Speichern.");
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, "Das ist zu groß zum Speichern.");
  try { return JSON.parse(text || "{}"); } catch { throw new HttpError(400, "Ungültige Daten."); }
}

const nowIso = () => new Date().toISOString();
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const clientIp = (request) => request.headers.get("cf-connecting-ip") || "local";

async function limited(binding, key) {
  if (!binding) return false;
  try { const { success } = await binding.limit({ key }); return !success; } catch { return false; }
}

// Schreibende Anfragen nur von der eigenen Seite (Schutz gegen fremde Formulare, zusätzlich zu SameSite-Cookies)
function sameOrigin(request, url) {
  const origin = request.headers.get("origin");
  return origin === url.origin;
}

// ---------- Inhalte ----------
async function readContent(env) {
  const row = await env.DB.prepare("SELECT json FROM content WHERE id = 1").first();
  return row ? JSON.parse(row.json) : null;
}

async function writeContent(env, content) {
  const text = JSON.stringify(content);
  if (text.length > MAX_CONTENT) throw new HttpError(413, "Die Inhalte sind zu groß. Lade Fotos bitte über die Verwaltung hoch statt sie einzubetten.");
  await env.DB.prepare("INSERT INTO content (id, json, updated_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET json = ?1, updated_at = ?2")
    .bind(text, content.updatedAt).run();
}

/** Öffentliche Fassung: Anprobe-Anfragen ohne Namen/Kontakt, nur belegte Zeiten */
function publicContent(c) {
  if (!c) return null;
  const out = structuredClone(c);
  out.fitting = out.fitting || {};
  out.fitting.bookings = (out.fitting.bookings || [])
    .filter((b) => b.status !== "abgelehnt")
    .map((b) => ({ id: b.id, date: b.date, start: b.start, status: b.status }));
  out.fitting.deletedIds = [];
  out.shop = { settings: normalizeShopSettings(out.shop?.settings), orders: [] };
  return out;
}

const shopSettings = (content) => normalizeShopSettings(content?.shop?.settings);

// ---------- Artikel ----------
async function ensureSeed(env) {
  const seeded = await env.DB.prepare("SELECT value FROM meta WHERE key = 'seeded'").first();
  if (seeded) return;
  const t = nowIso();
  const stmts = defaultProducts().map((p) => env.DB.prepare(
    "INSERT OR IGNORE INTO products (id, sort, visible, price, stock, data, rev, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)",
  ).bind(p.id, p.sort, p.visible ? 1 : 0, p.price, p.stock, JSON.stringify(productData(p)), t));
  stmts.push(env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('seeded', ?1)").bind(t));
  await env.DB.batch(stmts);
}

const productData = (p) => ({
  name: p.name, subtitle: p.subtitle, description: p.description, details: p.details, images: p.images,
  optionLabel: p.optionLabel, optionValues: p.optionValues, noteLabel: p.noteLabel, leadTime: p.leadTime,
});

function rowToProduct(r) {
  const reserved = Number(r.reserved || 0);
  return {
    ...normalizeProduct({
      ...JSON.parse(r.data), id: r.id, sort: r.sort, visible: !!r.visible, price: r.price, stock: r.stock,
      available: r.stock === null ? null : Math.max(0, r.stock - reserved),
    }),
    rev: r.rev, reserved,
  };
}

async function loadProducts(env, { onlyVisible = false } = {}) {
  await ensureSeed(env);
  const { results } = await env.DB.prepare(
    `SELECT p.*, COALESCE((SELECT SUM(r.qty) FROM reservations r WHERE r.product_id = p.id AND r.expires_at > ?1), 0) AS reserved
     FROM products p ${onlyVisible ? "WHERE p.visible = 1" : ""} ORDER BY p.sort, p.id`,
  ).bind(Date.now()).all();
  return results.map(rowToProduct);
}

const IMAGE_RE = /^(?:[\w.-]+\.(?:webp|jpe?g|png|avif)|\/api\/img\/[\w./-]+|data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/;

function cleanProduct(input) {
  const p = normalizeProduct(input);
  p.images = p.images.filter((x) => IMAGE_RE.test(x) && x.length < 700_000);
  if (!p.name) throw new HttpError(400, "Bitte gib dem Artikel einen Namen.");
  if (!(p.price > 0 && p.price <= 500_000)) throw new HttpError(400, "Bitte gib einen Preis zwischen 0,01 € und 5.000 € an.");
  return p;
}

// ---------- Bestellungen ----------
function rowToOrder(r) {
  return {
    id: String(r.id), number: r.number, status: r.status, delivery: r.delivery,
    items: JSON.parse(r.items), subtotal: r.subtotal, shipping: r.shipping, total: r.total,
    customer: r.customer ? JSON.parse(r.customer) : { name: "", email: "", phone: "", address: "" },
    tracking: r.tracking, carrier: r.carrier, note: r.note, dispute: r.dispute ? JSON.parse(r.dispute) : null,
    createdAt: r.created_at, paidAt: r.paid_at, updatedAt: r.updated_at, hasPayment: !!r.payment_intent,
  };
}

async function orderById(env, id) {
  return env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(Number(id)).first();
}

/** Zahlung bestätigt: Status setzen, Bestand abziehen, Reservierung lösen. Mehrfach aufgerufen = nur einmal wirksam. */
async function markPaid(env, orderId, { paymentIntent = null, customer = null } = {}) {
  const t = nowIso();
  const upd = await env.DB.prepare(
    `UPDATE orders SET status = CASE delivery WHEN 'abholung' THEN 'abholbereit' ELSE 'bezahlt' END,
       paid_at = ?2, payment_intent = COALESCE(?3, payment_intent), customer = COALESCE(?4, customer), updated_at = ?2
     WHERE id = ?1 AND status IN ('offen', 'in_zahlung', 'abgebrochen')`,
  ).bind(orderId, t, paymentIntent, customer ? JSON.stringify(customer) : null).run();
  if (!upd.meta.changes) return false;
  const order = await orderById(env, orderId);
  const items = JSON.parse(order.items);
  const now = Date.now();
  const notes = [];
  const stmts = [];
  for (const [pid, qty] of qtyByProduct(items)) {
    // Reicht der Bestand noch? (Reservierung kann bei sehr langsamer Zahlung abgelaufen sein)
    const row = await env.DB.prepare(
      `SELECT p.stock, COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.product_id = p.id AND r.order_id != ?2 AND r.expires_at > ?3), 0) AS others
       FROM products p WHERE p.id = ?1`,
    ).bind(pid, orderId, now).first();
    if (row && row.stock !== null && row.stock - row.others < qty) notes.push(`Achtung: „${items.find((x) => x.productId === pid)?.name}“ war beim Bezahlen nicht mehr vorrätig. Bitte melde dich bei der Kundin.`);
    stmts.push(env.DB.prepare("UPDATE products SET stock = MAX(stock - ?2, 0), rev = rev + 1 WHERE id = ?1 AND stock IS NOT NULL").bind(pid, qty));
  }
  stmts.push(env.DB.prepare("DELETE FROM reservations WHERE order_id = ?1").bind(orderId));
  if (notes.length) stmts.push(env.DB.prepare("UPDATE orders SET note = TRIM(note || ' ' || ?2) WHERE id = ?1").bind(orderId, notes.join(" ")));
  await env.DB.batch(stmts);
  return true;
}

async function cancelOrder(env, orderId, statuses = ["offen", "in_zahlung"]) {
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE orders SET status = 'abgebrochen', updated_at = ?2 WHERE id = ?1 AND status IN (${statuses.map((s) => `'${s}'`).join(",")})`).bind(orderId, t),
    env.DB.prepare("DELETE FROM reservations WHERE order_id = ?1 AND EXISTS (SELECT 1 FROM orders WHERE id = ?1 AND status = 'abgebrochen')").bind(orderId),
  ]);
}

/** Abgelaufene Kassen-Reservierungen freigeben (Cron und vor jedem Checkout) */
async function expireOrders(env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET status = 'abgebrochen', updated_at = ?2 WHERE status = 'offen' AND expires_at < ?1").bind(now, nowIso()),
    env.DB.prepare("DELETE FROM reservations WHERE expires_at < ?1").bind(now),
  ]);
}

// ---------- Öffentliche Endpunkte ----------
async function handleCheckout(request, env, url) {
  if (await limited(env.CHECKOUT_LIMIT, "checkout:" + clientIp(request))) throw new HttpError(429, "Zu viele Versuche. Bitte warte eine Minute.");
  const mode = paymentsMode(env);
  if (mode === "off") throw new HttpError(503, "Die Bezahlung ist noch nicht eingerichtet. Schreib Cathrin gern eine Nachricht.");
  const body = await readJson(request, 32_000);
  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env, body.turnstile, clientIp(request));
    if (!ok) throw new HttpError(403, "Bitte bestätige kurz, dass du kein Bot bist, und versuch es nochmal.");
  }
  await expireOrders(env);
  const [products, content] = await Promise.all([loadProducts(env), readContent(env)]);
  const settings = shopSettings(content);
  // Auftragspause gilt auch serverseitig (Datum in deutscher Zeit)
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const cart = priceCart(body.lines, products, settings, body.delivery, { madeToOrderPaused: pauseActive(content?.orderPause, today) });
  if (!cart.ok) throw new HttpError(409, cart.errors[0].msg, { errors: cart.errors });
  const byId = new Map(products.map((p) => [p.id, p]));
  cart.items = cart.items.map((x) => ({ ...x, image: byId.get(x.productId)?.images[0] || "" }));

  const now = Date.now();
  const sessionExpires = Math.floor(now / 1000) + (RESERVE_MINUTES + 1) * 60; // Stripe verlangt mindestens 30 Minuten
  const holdUntil = (sessionExpires + 5 * 60) * 1000;
  const token = randomHex(16);
  const t = nowIso();
  const storedItems = cart.items.map(({ image, ...x }) => x);
  const ins = await env.DB.prepare(
    `INSERT INTO orders (token, status, delivery, items, subtotal, shipping, total, created_at, updated_at, expires_at)
     VALUES (?1, 'offen', ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8) RETURNING id`,
  ).bind(token, cart.delivery, JSON.stringify(storedItems), cart.subtotal, cart.shipping, cart.total, t, holdUntil).first();
  const order = { id: ins.id, number: `FG-${1000 + ins.id}` };
  await env.DB.prepare("UPDATE orders SET number = ?2 WHERE id = ?1").bind(order.id, order.number).run();

  // Reservieren: eine Anweisung pro Artikel, die nur greift, wenn noch genug frei ist (atomar in SQLite)
  for (const [pid, qty] of qtyByProduct(cart.items)) {
    const r = await env.DB.prepare(
      `INSERT INTO reservations (order_id, product_id, qty, expires_at)
       SELECT ?1, p.id, ?3, ?4 FROM products p
       WHERE p.id = ?2 AND p.visible = 1 AND (p.stock IS NULL OR p.stock - COALESCE((SELECT SUM(r.qty) FROM reservations r WHERE r.product_id = p.id AND r.expires_at > ?5), 0) >= ?3)`,
    ).bind(order.id, pid, qty, holdUntil, now).run();
    if (!r.meta.changes) {
      await cancelOrder(env, order.id);
      throw new HttpError(409, `„${byId.get(pid)?.name || "Ein Artikel"}“ hat sich gerade jemand anderes geschnappt.`);
    }
  }

  if (mode === "demo") {
    await markPaid(env, order.id, { customer: { name: "Demo-Bestellung", email: "", phone: "", address: cart.delivery === "versand" ? "(im Testbetrieb keine Adresse)" : "" } });
    return json({ ok: true, url: `${url.origin}/?bestellung=danke&t=${token}`, demo: true });
  }

  let session;
  try {
    session = await stripeRequest(env, "checkout/sessions",
      checkoutParams({ origin: url.origin, order, cart, settings, token, expiresAtSec: sessionExpires }),
      { idempotencyKey: `checkout-${order.id}-${token}` });
  } catch (e) {
    console.error("Stripe checkout:", e.message);
    await cancelOrder(env, order.id);
    throw new HttpError(502, "Die Bezahlseite ist gerade nicht erreichbar. Bitte versuch es gleich nochmal.");
  }
  await env.DB.prepare("UPDATE orders SET stripe_session = ?2 WHERE id = ?1").bind(order.id, session.id).run();
  return json({ ok: true, url: session.url });
}

async function verifyTurnstile(env, token, ip) {
  if (!token || typeof token !== "string" || token.length > 4096) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    return !!(await r.json()).success;
  } catch { return false; }
}

async function handleOrderStatus(env, url) {
  const token = url.searchParams.get("t") || "";
  if (!/^[0-9a-f]{32}$/.test(token)) throw new HttpError(404, "Bestellung nicht gefunden.");
  const r = await env.DB.prepare("SELECT number, status, delivery, total, items FROM orders WHERE token = ?1").bind(token).first();
  if (!r) throw new HttpError(404, "Bestellung nicht gefunden.");
  return json({ ok: true, number: r.number, status: r.status, delivery: r.delivery, total: r.total, count: JSON.parse(r.items).reduce((s, x) => s + x.qty, 0) });
}

const BOOKING_ID = /^[a-z0-9]{4,16}$/;
async function handleFitting(request, env) {
  if (await limited(env.CHECKOUT_LIMIT, "fitting:" + clientIp(request))) throw new HttpError(429, "Zu viele Anfragen. Bitte warte eine Minute.");
  const b = await readJson(request, 8_000);
  const s = (v, n) => String(v ?? "").trim().slice(0, n);
  const booking = {
    id: BOOKING_ID.test(b.id) ? b.id : randomHex(5), status: "angefragt", createdAt: nowIso(),
    date: s(b.date, 10), start: s(b.start, 5), name: s(b.name, 80), email: s(b.email, 120), phone: s(b.phone, 40),
    product: s(b.product, 80), note: s(b.note, 500),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date) || !/^\d{2}:\d{2}$/.test(booking.start) || !booking.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)) {
    throw new HttpError(400, "Bitte fülle Name, E-Mail und Termin aus.");
  }
  const content = (await readContent(env)) || { version: CONTENT_VERSION, fitting: { bookings: [] } };
  content.fitting = content.fitting || {};
  const list = content.fitting.bookings = content.fitting.bookings || [];
  if (list.length > 500) throw new HttpError(503, "Gerade sind sehr viele Anfragen offen. Schreib Cathrin bitte eine Nachricht.");
  if (list.some((x) => x.id === booking.id)) return json({ ok: true });
  if (list.some((x) => x.date === booking.date && x.start === booking.start && x.status !== "abgelehnt")) throw new HttpError(409, "Dieser Termin ist inzwischen vergeben.");
  list.push(booking);
  content.updatedAt = nowIso();
  await writeContent(env, content);
  return json({ ok: true });
}

// ---------- Stripe-Webhook ----------
async function handleWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, "Webhook nicht eingerichtet.");
  const payload = await request.text();
  if (payload.length > 512_000) throw new HttpError(413, "Zu groß.");
  const ok = await verifyStripeSignature(payload, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) throw new HttpError(400, "Signatur ungültig.");
  const event = JSON.parse(payload);
  const seen = await env.DB.prepare("SELECT 1 FROM stripe_events WHERE id = ?1").bind(event.id).first();
  if (seen) return json({ ok: true, duplicate: true });
  await applyStripeEvent(env, event);
  await env.DB.prepare("INSERT OR IGNORE INTO stripe_events (id, type, received_at) VALUES (?1, ?2, ?3)").bind(event.id, event.type, nowIso()).run();
  return json({ ok: true });
}

async function orderForSession(env, s) {
  const id = Number(s.metadata?.order_id || s.client_reference_id);
  if (!id) return null;
  const order = await orderById(env, id);
  // Gehört die Session wirklich zu dieser Bestellung und stimmt der Betrag? Sonst nichts anfassen.
  if (!order || (order.stripe_session && order.stripe_session !== s.id)) return null;
  if (typeof s.amount_total === "number" && s.amount_total !== order.total) {
    await env.DB.prepare("UPDATE orders SET note = TRIM(note || ' ' || ?2) WHERE id = ?1").bind(id, `Achtung: Stripe meldet ${s.amount_total / 100} €, erwartet waren ${order.total / 100} €.`).run();
  }
  return order;
}

export async function applyStripeEvent(env, event) {
  const obj = event.data?.object || {};
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const order = await orderForSession(env, obj);
      if (!order) return;
      const customer = customerFromSession(obj);
      if (obj.payment_status === "paid" || obj.payment_status === "no_payment_required") {
        await markPaid(env, order.id, { paymentIntent: obj.payment_intent || null, customer });
      } else {
        // z. B. Lastschrift: Geld kommt erst in ein paar Tagen, Stücke so lange festhalten
        const hold = Date.now() + 10 * 24 * 3600 * 1000;
        await env.DB.batch([
          env.DB.prepare("UPDATE orders SET status = 'in_zahlung', customer = ?2, payment_intent = ?3, expires_at = ?4, updated_at = ?5 WHERE id = ?1 AND status = 'offen'")
            .bind(order.id, JSON.stringify(customer), obj.payment_intent || null, hold, nowIso()),
          env.DB.prepare("UPDATE reservations SET expires_at = ?2 WHERE order_id = ?1").bind(order.id, hold),
        ]);
      }
      return;
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const order = await orderForSession(env, obj);
      if (order) await cancelOrder(env, order.id);
      return;
    }
    case "charge.refunded": {
      if (obj.payment_intent && obj.refunded) {
        await env.DB.prepare("UPDATE orders SET status = 'erstattet', updated_at = ?2 WHERE payment_intent = ?1").bind(obj.payment_intent, nowIso()).run();
      }
      return;
    }
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed": {
      if (!obj.payment_intent) return;
      const dispute = { status: obj.status, reason: obj.reason, amount: obj.amount, dueBy: obj.evidence_details?.due_by || null, at: nowIso() };
      await env.DB.prepare("UPDATE orders SET dispute = ?2, updated_at = ?3 WHERE payment_intent = ?1").bind(obj.payment_intent, JSON.stringify(dispute), nowIso()).run();
      return;
    }
    default:
  }
}

// ---------- Verwaltung ----------
async function handleAdmin(request, env, url, path) {
  const method = request.method;
  if (path === "login" && method === "POST") {
    if (!authConfigured(env)) throw new HttpError(503, "Die Anmeldung ist noch nicht eingerichtet (ADMIN_PASSWORD und SESSION_SECRET fehlen).");
    if (await limited(env.LOGIN_LIMIT, "login:" + clientIp(request))) throw new HttpError(429, "Zu viele Versuche. Bitte warte eine Minute.");
    const body = await readJson(request, 2_000);
    if (!(await checkPassword(env, body.password))) throw new HttpError(401, "Das Passwort stimmt nicht.");
    return json({ ok: true }, 200, { "set-cookie": await sessionCookie(env) });
  }
  if (path === "logout" && method === "POST") return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  if (!(await isAdmin(request, env))) throw new HttpError(401, "Bitte melde dich an.");
  if (path === "me") return json({ ok: true });

  if (path === "content") {
    if (method === "GET") return json({ ok: true, content: await readContent(env) });
    if (method === "PUT") {
      const incoming = await readJson(request, MAX_CONTENT);
      if (!incoming || incoming.version !== CONTENT_VERSION) throw new HttpError(400, "Unbekanntes Format.");
      const server = await readContent(env);
      // Anprobe-Anfragen, die inzwischen über die Website kamen, nicht überschreiben
      incoming.fitting = incoming.fitting || {};
      const mine = Array.isArray(incoming.fitting.bookings) ? incoming.fitting.bookings : [];
      const ids = new Set(mine.map((b) => b.id));
      const deleted = new Set(incoming.fitting.deletedIds || []);
      const extra = (server?.fitting?.bookings || []).filter((b) => !ids.has(b.id) && !deleted.has(b.id));
      incoming.fitting.bookings = [...mine, ...extra];
      incoming.shop = { settings: normalizeShopSettings(incoming.shop?.settings) }; // Artikel/Bestellungen leben in eigenen Tabellen
      incoming.updatedAt = nowIso();
      await writeContent(env, incoming);
      return json({ ok: true, updatedAt: incoming.updatedAt, newBookings: extra.length, content: extra.length ? incoming : undefined });
    }
  }

  if (path === "products" && method === "GET") return json({ ok: true, products: await loadProducts(env) });
  if (path === "products/sort" && method === "POST") {
    const { ids } = await readJson(request, 16_000);
    if (!Array.isArray(ids)) throw new HttpError(400, "Ungültige Reihenfolge.");
    await env.DB.batch(ids.slice(0, 500).map((id, i) => env.DB.prepare("UPDATE products SET sort = ?2 WHERE id = ?1").bind(String(id), i)));
    return json({ ok: true });
  }
  const pm = path.match(/^products\/([\w-]{1,40})$/);
  if (pm) {
    const id = pm[1];
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM products WHERE id = ?1").bind(id).run();
      return json({ ok: true });
    }
    if (method === "PUT") {
      const { product, rev } = await readJson(request, 3_000_000);
      const p = cleanProduct({ ...product, id });
      const t = nowIso();
      const exists = await env.DB.prepare("SELECT rev FROM products WHERE id = ?1").bind(id).first();
      if (exists) {
        // Nur speichern, wenn sich seit dem Laden nichts geändert hat (z. B. ein Verkauf den Bestand gesenkt hat)
        const r = await env.DB.prepare("UPDATE products SET visible = ?2, price = ?3, stock = ?4, data = ?5, rev = rev + 1, updated_at = ?6 WHERE id = ?1 AND rev = ?7")
          .bind(id, p.visible ? 1 : 0, p.price, p.stock, JSON.stringify(productData(p)), t, Number(rev)).run();
        if (!r.meta.changes) {
          const current = (await loadProducts(env)).find((x) => x.id === id);
          throw new HttpError(409, "Der Artikel hat sich inzwischen geändert (zum Beispiel durch einen Verkauf). Ich habe den aktuellen Stand geladen, bitte prüf ihn und speichere nochmal.", { product: current });
        }
      } else {
        const max = await env.DB.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM products").first();
        await env.DB.prepare("INSERT INTO products (id, sort, visible, price, stock, data, rev, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)")
          .bind(id, max.s, p.visible ? 1 : 0, p.price, p.stock, JSON.stringify(productData(p)), t).run();
      }
      const saved = (await loadProducts(env)).find((x) => x.id === id);
      return json({ ok: true, product: saved });
    }
  }

  if (path === "orders" && method === "GET") {
    const since = Date.now() - 3 * 24 * 3600 * 1000;
    const { results } = await env.DB.prepare(
      "SELECT * FROM orders WHERE status NOT IN ('offen', 'abgebrochen') OR expires_at > ?1 ORDER BY id DESC LIMIT 300",
    ).bind(since).all();
    return json({ ok: true, orders: results.map(rowToOrder) });
  }
  const om = path.match(/^orders\/(\d{1,9})(\/refund)?$/);
  if (om) {
    const row = await orderById(env, om[1]);
    if (!row) throw new HttpError(404, "Bestellung nicht gefunden.");
    if (om[2] && method === "POST") return refundOrder(request, env, row);
    if (!om[2] && method === "PATCH") {
      const b = await readJson(request, 8_000);
      const allowed = { bezahlt: ["verschickt"], verschickt: ["bezahlt"], abholbereit: ["abgeholt"], abgeholt: ["abholbereit"], offen: ["abgebrochen"], in_zahlung: [] };
      const next = b.status && b.status !== row.status ? b.status : null;
      if (next && !(allowed[row.status] || []).includes(next)) throw new HttpError(409, "Dieser Schritt passt nicht zum Stand der Bestellung.");
      if (next === "abgebrochen") await cancelOrder(env, row.id, ["offen"]);
      const tracking = b.tracking !== undefined ? String(b.tracking).replace(/[^\w-]/g, "").slice(0, 40) : row.tracking;
      const carrier = ["dhl", "hermes", "dpd", "post"].includes(b.carrier) ? b.carrier : row.carrier;
      const note = b.note !== undefined ? String(b.note).slice(0, 1000) : row.note;
      await env.DB.prepare("UPDATE orders SET status = COALESCE(?2, status), tracking = ?3, carrier = ?4, note = ?5, updated_at = ?6 WHERE id = ?1")
        .bind(row.id, next && next !== "abgebrochen" ? next : null, tracking, carrier, note, nowIso()).run();
      return json({ ok: true, order: rowToOrder(await orderById(env, row.id)) });
    }
  }

  if (path === "images" && method === "POST") {
    if (!env.IMAGES) throw new HttpError(501, "Kein Bildspeicher eingerichtet.");
    const type = (request.headers.get("content-type") || "").split(";")[0];
    if (!["image/jpeg", "image/png", "image/webp"].includes(type)) throw new HttpError(415, "Bitte ein JPG-, PNG- oder WebP-Foto.");
    const buf = await request.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_IMAGE) throw new HttpError(413, "Das Foto ist zu groß.");
    const key = `u/${Date.now().toString(36)}-${randomHex(6)}.${type.split("/")[1].replace("jpeg", "jpg")}`;
    await env.IMAGES.put(key, buf, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
    return json({ ok: true, url: `/api/img/${key}` });
  }

  throw new HttpError(404, "Unbekannte Adresse.");
}

async function refundOrder(request, env, row) {
  const b = await readJson(request, 2_000);
  if (!isPaid(row)) throw new HttpError(409, "Nur bezahlte Bestellungen können erstattet werden.");
  const mode = paymentsMode(env);
  if (row.payment_intent && (mode === "live" || mode === "test")) {
    try {
      await stripeRequest(env, "refunds", { payment_intent: row.payment_intent, metadata: { order_id: String(row.id) } }, { idempotencyKey: `refund-${row.id}` });
    } catch (e) {
      throw new HttpError(502, `Stripe hat die Erstattung abgelehnt: ${e.message}`);
    }
  } else if (row.payment_intent) {
    throw new HttpError(503, "Für diese Bestellung fehlt die Verbindung zu Stripe.");
  }
  const stmts = [env.DB.prepare("UPDATE orders SET status = 'erstattet', updated_at = ?2 WHERE id = ?1").bind(row.id, nowIso())];
  if (b.restock) {
    for (const [pid, qty] of qtyByProduct(JSON.parse(row.items))) {
      stmts.push(env.DB.prepare("UPDATE products SET stock = stock + ?2, rev = rev + 1 WHERE id = ?1 AND stock IS NOT NULL").bind(pid, qty));
    }
  }
  await env.DB.batch(stmts);
  return json({ ok: true, order: rowToOrder(await orderById(env, row.id)) });
}

// ---------- Router ----------
async function handleApi(request, env, url, ctx) {
  const path = url.pathname.slice(5).replace(/\/+$/, "");
  const method = request.method;
  if (!["GET", "HEAD"].includes(method) && path !== "stripe/webhook" && !sameOrigin(request, url)) {
    throw new HttpError(403, "Anfrage von fremder Seite abgelehnt.");
  }
  if (path === "health") {
    return json({ ok: true, payments: paymentsMode(env), turnstileSiteKey: env.TURNSTILE_SECRET ? env.TURNSTILE_SITEKEY || "" : "", images: !!env.IMAGES, login: authConfigured(env) });
  }
  if (path === "checkout" && method === "POST") return handleCheckout(request, env, url);
  if (path === "order" && method === "GET") return handleOrderStatus(env, url);
  if (path === "fitting" && method === "POST") return handleFitting(request, env);
  if (path === "stripe/webhook" && method === "POST") return handleWebhook(request, env);
  if (path === "shop" && method === "GET") {
    const [products, content] = await Promise.all([loadProducts(env, { onlyVisible: true }), readContent(env)]);
    return json({ ok: true, products: products.map(({ rev, reserved, ...p }) => p), settings: shopSettings(content) });
  }
  if (path.startsWith("img/") && (method === "GET" || method === "HEAD")) {
    if (!env.IMAGES) return new Response("Nicht gefunden", { status: 404 });
    const key = path.slice(4);
    if (!/^[\w./-]{3,120}$/.test(key) || key.includes("..")) return new Response("Nicht gefunden", { status: 404 });
    const obj = await env.IMAGES.get(key);
    if (!obj) return new Response("Nicht gefunden", { status: 404 });
    const headers = new Headers(BASE_HEADERS);
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    return new Response(method === "HEAD" ? null : obj.body, { headers });
  }
  if (path.startsWith("admin/")) return handleAdmin(request, env, url, path.slice(6));
  throw new HttpError(404, "Unbekannte Adresse.");
}

// Startseite: statisches HTML + veröffentlichte Inhalte, damit Besucher sofort den aktuellen Stand sehen
async function renderHome(request, env, url) {
  const res = await env.ASSETS.fetch(new Request(url.origin + "/", { method: "GET" }));
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  let content = null;
  let products = null;
  try {
    [content, products] = await Promise.all([readContent(env), loadProducts(env, { onlyVisible: true })]);
  } catch (e) {
    console.error("Inhalte nicht geladen:", e.message);
    return res;
  }
  const safe = (v) => JSON.stringify(v).replace(/</g, "\\u003c"); // JSON im <script type="application/json">: nur "<" muss raus
  const pub = publicContent(content);
  const shop = { settings: shopSettings(content), products: products.map(({ rev, reserved, ...p }) => p) };
  const out = new HTMLRewriter().on("head", {
    element(el) {
      if (pub) el.append(`<script type="application/json" id="cms-data">${safe(pub)}</script>`, { html: true });
      el.append(`<script type="application/json" id="shop-data">${safe(shop)}</script>`, { html: true });
    },
  }).transform(res);
  const headers = new Headers(out.headers);
  headers.set("cache-control", "no-store");
  headers.delete("etag");
  for (const [k, v] of Object.entries(BASE_HEADERS)) headers.set(k, v);
  return new Response(request.method === "HEAD" ? null : out.body, { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url, ctx);
      } catch (e) {
        if (e instanceof HttpError) return fail(e.status, e.message, e.extra);
        console.error(e);
        return fail(500, "Da ist etwas schiefgelaufen. Bitte versuch es gleich nochmal.");
      }
    }
    if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
      try { return await renderHome(request, env, url); } catch (e) { console.error(e); }
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(expireOrders(env));
  },
};

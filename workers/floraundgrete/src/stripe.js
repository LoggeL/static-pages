// Stripe ohne SDK: zwei Funktionen über fetch, Signaturprüfung mit WebCrypto.
const enc = new TextEncoder();

/** 'live' | 'test' | 'demo' (nur wenn ausdrücklich erlaubt) | 'off' */
export function paymentsMode(env) {
  const k = env.STRIPE_SECRET_KEY || "";
  if (/^(sk|rk)_live_/.test(k)) return "live";
  if (/^(sk|rk)_test_/.test(k)) return "test";
  return env.ALLOW_DEMO_PAYMENTS === "1" ? "demo" : "off";
}

/** Verschachtelte Objekte in Stripes Formularschreibweise: line_items[0][price_data][currency]=eur */
export function toForm(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") toForm(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripeRequest(env, path, params, { method = "POST", idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (method !== "GET") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const qs = method === "GET" && params ? "?" + toForm(params) : "";
  const r = await fetch(`https://api.stripe.com/v1/${path}${qs}`, { method, headers, body: method === "GET" ? undefined : toForm(params || {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error?.message || `Stripe ${r.status}`);
    err.stripe = data.error;
    throw err;
  }
  return data;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

function sameHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Stripe-Signatur prüfen (Header "Stripe-Signature: t=…,v1=…").
 * Nur so signierte Ereignisse gelten: Wer die Danke-Seite direkt aufruft oder ein Ereignis fälscht, ändert nichts.
 */
export async function verifyStripeSignature(payload, header, secret, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false; // alte Ereignisse nicht erneut abspielen lassen
  const expected = await hmacHex(secret, `${t}.${payload}`);
  return sigs.some((s) => sameHex(s, expected));
}

/** Für Tests: gültigen Header erzeugen */
export async function signForTest(payload, secret, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${payload}`)}`;
}

/** Bezahlseite anlegen. Preise kommen ausschließlich aus der serverseitigen Berechnung (priceCart). */
export function checkoutParams({ origin, order, cart, settings, token, expiresAtSec }) {
  const imageUrl = (img) => {
    if (!img || !origin.startsWith("https://") || img.startsWith("data:")) return null;
    return img.startsWith("/") ? origin + img : /^https:/.test(img) ? img : `${origin}/img/${img}`;
  };
  const params = {
    mode: "payment",
    locale: "de",
    client_reference_id: String(order.id),
    success_url: `${origin}/?bestellung=danke&t=${token}`,
    cancel_url: `${origin}/?bestellung=abgebrochen#shop`,
    expires_at: expiresAtSec,
    submit_type: "pay",
    phone_number_collection: { enabled: "true" },
    metadata: { order_id: String(order.id), number: order.number },
    payment_intent_data: { description: `Bestellung ${order.number}`, metadata: { order_id: String(order.id), number: order.number } },
    custom_text: { submit: { message: `Mit dem Klick auf „Bezahlen“ bestellst du zahlungspflichtig. ${settings.legalNote || ""}`.trim().slice(0, 1200) } },
    line_items: cart.items.map((x) => {
      const img = imageUrl(x.image);
      return {
        quantity: x.qty,
        price_data: {
          currency: "eur",
          unit_amount: x.unit,
          product_data: {
            name: (x.name + (x.option ? ` – ${x.option}` : "")).slice(0, 250),
            ...(x.note ? { description: `Deine Angabe: ${x.note}`.slice(0, 500) } : {}),
            ...(img ? { images: [img] } : {}),
          },
        },
      };
    }),
  };
  if (cart.delivery === "versand") {
    params.shipping_address_collection = { allowed_countries: ["DE"] };
    params.shipping_options = [{
      shipping_rate_data: {
        type: "fixed_amount",
        fixed_amount: { amount: cart.shipping, currency: "eur" },
        display_name: (settings.shipping.label || "Versand").slice(0, 100),
      },
    }];
  }
  return params;
}

/** Kundendaten aus der Checkout-Session (Versandadresse je nach API-Version an anderer Stelle) */
export function customerFromSession(s) {
  const cd = s.customer_details || {};
  const ship = s.shipping_details || s.collected_information?.shipping_details || null;
  const a = (ship && ship.address) || null;
  const address = a ? [a.line1, a.line2, `${a.postal_code || ""} ${a.city || ""}`.trim(), a.country && a.country !== "DE" ? a.country : ""].filter(Boolean).join(", ") : "";
  return {
    name: (ship && ship.name) || cd.name || "",
    email: cd.email || "",
    phone: cd.phone || "",
    address,
  };
}

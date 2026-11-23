// Anmeldung für die Verwaltung: ein Passwort (Secret ADMIN_PASSWORD), signiertes Cookie, kein Session-Speicher nötig.
// Abmelden auf allen Geräten: SESSION_SECRET austauschen.
const enc = new TextEncoder();
const COOKIE = "fg_admin";
const MAX_AGE = 30 * 24 * 3600; // 30 Tage angemeldet bleiben

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

async function digest(s) { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(s)))); }

/** Gleich lange Hashes vergleichen, ohne früh abzubrechen (keine Rückschlüsse über die Laufzeit) */
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function authConfigured(env) {
  return !!(env.ADMIN_PASSWORD && env.SESSION_SECRET && env.SESSION_SECRET.length >= 16);
}

export async function checkPassword(env, password) {
  if (!authConfigured(env) || typeof password !== "string" || !password) return false;
  return sameSecret(password, env.ADMIN_PASSWORD);
}

export async function sessionCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const payload = `${exp}.${nonce}`;
  const value = `${payload}.${await sign(env.SESSION_SECRET, payload)}`;
  return `${COOKIE}=${value}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function isAdmin(request, env) {
  if (!authConfigured(env)) return false;
  const raw = (request.headers.get("cookie") || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return false;
  const [exp, nonce, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!exp || !nonce || !sig || Number(exp) < Date.now() / 1000) return false;
  return sameSecret(sig, await sign(env.SESSION_SECRET, `${exp}.${nonce}`));
}

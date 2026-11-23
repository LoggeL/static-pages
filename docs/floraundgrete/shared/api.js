// Verbindung zum Cloudflare Worker (/api/…).
// Läuft die Seite ohne Worker (GitHub Pages, lokaler Testserver), antwortet /api/health nicht mit JSON:
// Dann bleibt alles im Klick-Prototyp-Modus (localStorage, simulierte Kasse).
const BASE = new URL("../api/", import.meta.url).href;

let healthP = null;
/** -> {ok, payments:'demo'|'test'|'live', turnstileSiteKey, images} oder null (kein Worker) */
export function backend() {
  if (!healthP) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    healthP = fetch(BASE + "health", { headers: { accept: "application/json" }, signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : null))
      .then((h) => (h && h.ok ? h : null))
      .catch(() => null)
      .finally(() => clearTimeout(t));
  }
  return healthP;
}

export class ApiError extends Error {
  constructor(msg, status, data) { super(msg); this.status = status; this.data = data; }
}

export async function api(path, { method = "GET", body, raw, contentType } = {}) {
  const headers = { accept: "application/json" };
  let payload;
  if (raw !== undefined) { payload = raw; headers["content-type"] = contentType || "application/octet-stream"; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers["content-type"] = "application/json"; }
  let r;
  try {
    r = await fetch(BASE + path, { method, headers, body: payload, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError("Keine Verbindung. Bist du online?", 0, null);
  }
  let data = null;
  try { data = await r.json(); } catch { /* leer */ }
  if (!r.ok) throw new ApiError((data && data.error) || `Fehler ${r.status}`, r.status, data);
  return data;
}

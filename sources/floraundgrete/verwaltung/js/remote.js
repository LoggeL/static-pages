// Verwaltung ↔ Worker. Ohne Worker (GitHub Pages) ist alles hier ein No-op und die Verwaltung bleibt ein Klick-Prototyp.
import { backend, api } from "../../shared/api.js";
import { getContent, hydrate } from "../../shared/store.js";
import { normalizeProduct } from "../../shared/shop-core.js";

let health = null;
export async function detect() { health = await backend(); return health; }
export const isRemote = () => !!health;
export const remoteHealth = () => health;

export async function isLoggedIn() {
  if (!health) return false;
  try { await api("admin/me"); return true; } catch { return false; }
}
export async function login(password) { await api("admin/login", { method: "POST", body: { password } }); }
export async function logout() { try { await api("admin/logout", { method: "POST", body: {} }); } catch { /* egal */ } }

/** Alles vom Server holen und als Arbeitsstand übernehmen */
export async function loadRemote() {
  const [c, p, o] = await Promise.all([api("admin/content"), api("admin/products"), api("admin/orders")]);
  const local = getContent();
  const content = c.content && c.content.version === local.version ? c.content : local;
  content.shop = {
    settings: (c.content && c.content.shop && c.content.shop.settings) || local.shop.settings,
    products: p.products.map((x) => ({ ...normalizeProduct(x), rev: x.rev, reserved: x.reserved })),
    orders: o.orders,
  };
  hydrate(content);
}

// ---------- Veröffentlichen (automatisch nach jeder Änderung) ----------
let timer = 0;
let running = null;
let again = false;
export function schedulePublish(onState) {
  if (!health) return;
  clearTimeout(timer);
  onState("pending");
  timer = setTimeout(() => publish(onState), 600);
}
async function publish(onState) {
  if (running) { again = true; return; }
  const c = getContent();
  const payload = { ...c, shop: { settings: c.shop.settings } }; // Artikel/Bestellungen haben eigene Wege
  running = api("admin/content", { method: "PUT", body: payload });
  try {
    const out = await running;
    // Neue Anprobe-Anfragen, die inzwischen über die Website kamen, gleich mit anzeigen
    if (out.content) {
      const cur = getContent();
      hydrate({ ...out.content, shop: cur.shop });
    }
    onState("ok", out.updatedAt);
  } catch (e) {
    onState("error", e);
  } finally {
    running = null;
    if (again) { again = false; publish(onState); }
  }
}

// ---------- Shop ----------
export async function saveProduct(p) {
  const out = await api(`admin/products/${encodeURIComponent(p.id)}`, { method: "PUT", body: { product: p, rev: p.rev } });
  return { ...normalizeProduct(out.product), rev: out.product.rev, reserved: out.product.reserved };
}
export const deleteProduct = (id) => api(`admin/products/${encodeURIComponent(id)}`, { method: "DELETE", body: {} });
export const sortProducts = (ids) => api("admin/products/sort", { method: "POST", body: { ids } });
export const fetchOrders = async () => (await api("admin/orders")).orders;
export const patchOrder = async (id, patch) => (await api(`admin/orders/${id}`, { method: "PATCH", body: patch })).order;
export const refundOrder = async (id, restock) => (await api(`admin/orders/${id}/refund`, { method: "POST", body: { restock } })).order;

/** Foto aus der Verwaltung: mit Worker nach R2 (kleines JSON), sonst als data:-URL im Browser-Speicher */
export async function storeImage(dataUrl) {
  if (!health || !health.images || !/^data:image\//.test(dataUrl)) return dataUrl;
  const blob = await (await fetch(dataUrl)).blob();
  const out = await api("admin/images", { method: "POST", raw: blob, contentType: blob.type || "image/jpeg" });
  return out.url;
}

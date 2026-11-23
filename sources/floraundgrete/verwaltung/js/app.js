// Verwaltung · Cathrin Raasch Atelier – Hülle, Navigation, Anmeldung, Live-Abgleich.
import { getContent, update, subscribe } from "../../shared/store.js";
import { h, icon, toast, markSaved } from "./ui.js";
import renderStart from "./sections/start.js";
import renderHinweis from "./sections/hinweis.js";
import renderTermine from "./sections/termine.js";
import renderKurse from "./sections/kurse.js";
import renderLinks from "./sections/links.js";
import renderAnprobe from "./sections/anprobe.js";
import renderLookbook from "./sections/lookbook.js";
import renderUeber from "./sections/ueber.js";
import renderEinstellungen from "./sections/einstellungen.js";
import renderShop from "./sections/shop.js";
import { detect, isRemote, isLoggedIn as remoteLoggedIn, login as remoteLogin, logout as remoteLogout, loadRemote, schedulePublish } from "./remote.js";
import { isTodo } from "../../shared/shop-core.js";
import { SITES } from "./sections/common.js";


const ROUTES = [
  { id: "start", label: "Start", long: "Übersicht", icon: "home", render: renderStart },
  { id: "shop", label: "Shop", long: "Shop", icon: "bag", render: renderShop },
  { id: "hinweis", label: "Hinweis", long: "Hinweis oben", icon: "megaphone", render: renderHinweis },
  { id: "termine", label: "Termine", long: "Termine", icon: "calendar", render: renderTermine },
  { id: "kurse", label: "Kurse", long: "Feste Kurse", icon: "clock", render: renderKurse },
  { id: "anprobe", label: "Anprobe", long: "Anprobe", icon: "scissors", render: renderAnprobe },
  { id: "links", label: "Links", long: "Links", icon: "link", render: renderLinks },
  { id: "lookbook", label: "Galerie", long: "Galerie", icon: "photo", render: renderLookbook },
  { id: "ueber", label: "Über mich", long: "Über mich", icon: "heart", render: renderUeber },
  { id: "einstellungen", label: "Einstellungen", long: "Einstellungen", icon: "gear", render: renderEinstellungen },
  { id: "mehr", label: "Mehr", long: "Mehr", icon: "more", render: renderMehr, hidden: true },
];
const TAB_IDS = ["start", "shop", "termine", "anprobe"];
const SESSION_KEY = "floraundgrete-verwaltung-angemeldet";

const $ = (s) => document.querySelector(s);
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const main = $("#main");
let current = null; // {route, sub}
let ownWrites = 0;
let pendingRerender = false;

// ---------- Speichern ----------
function save(mutator) {
  ownWrites++;
  markSaved(new Date(), { pending: true, announce: false });
  let out;
  try { out = update(mutator); } finally { ownWrites--; }
  markSaved(new Date());
  schedulePublish(onPublish);
  return out;
}

// Mit Worker: jede Änderung wird kurz danach veröffentlicht
let lastPublishError = 0;
function onPublish(state, info) {
  if (state === "pending") markSaved(new Date(), { pending: true, announce: false });
  else if (state === "ok") markSaved(new Date(info || Date.now()));
  else if (state === "error") {
    if (info && info.status === 401) { toast("Du bist abgemeldet. Bitte melde dich neu an, deine letzte Änderung ist noch nicht online."); showWelcome(); return; }
    if (Date.now() - lastPublishError > 30000) toast(`Noch nicht online: ${info && info.message ? info.message : "keine Verbindung"}. Ich versuche es bei der nächsten Änderung erneut.`);
    lastPublishError = Date.now();
  }
}

/** Nur die Anzeige hier aktualisieren (Artikel/Bestellungen kommen schon vom Server) */
function mirror(mutator) {
  ownWrites++;
  try { update(mutator); } finally { ownWrites--; }
}

function replaceAll(snapshot) {
  return (draft) => { for (const k of Object.keys(draft)) delete draft[k]; Object.assign(draft, structuredClone(snapshot)); };
}

/** Store-Funktionen (setBookingStatus …) als eigene Änderung ausführen */
function run(fn) {
  ownWrites++;
  let out;
  try { out = fn(); } finally { ownWrites--; }
  markSaved(new Date());
  schedulePublish(onPublish);
  return out;
}

const ctx = {
  get content() { return getContent(); },
  save,
  run,
  mirror,
  get remote() { return isRemote(); },
  replaceAll,
  toast,
  go: (hash) => { if (location.hash === "#" + hash) route(); else location.hash = hash; },
  rerender: () => renderCurrent({ keepFocus: true }),
  get sub() { return current?.sub || ""; },
  /** Unteradresse (#termine/neu) nur einmal ausführen */
  consumeSub() { const s = current?.sub || ""; if (current) { current.sub = ""; history.replaceState(null, "", "#" + current.route.id); } return s; },
};

// ---------- Navigation ----------
function newCount(c = getContent()) {
  return c.fitting.bookings.filter((b) => b.status === "angefragt").length;
}
const shopCount = (c = getContent()) => (c.shop.orders || []).filter(isTodo).length;
const BADGES = {
  anprobe: { count: newCount, sr: (n) => `, ${n} neue Anfrage${n === 1 ? "" : "n"}` },
  shop: { count: shopCount, sr: (n) => `, ${n} Bestellung${n === 1 ? "" : "en"} zu erledigen` },
};

function navItem(r, { compact }) {
  const count = BADGES[r.id] ? BADGES[r.id].count() : 0;
  return h("a", { href: "#" + r.id, class: "nav-item", "data-route": r.id },
    h("span", { class: "nav-ico" }, icon(r.icon)),
    h("span", { class: "nav-label" }, compact ? r.label : r.long),
    count ? h("span", { class: "badge nav-count", "aria-hidden": "true" }, count) : null,
    count ? h("span", { class: "sr-only" }, BADGES[r.id].sr(count)) : null);
}

function buildNav() {
  const visible = ROUTES.filter((r) => !r.hidden);
  $("#side-nav").replaceChildren(...visible.map((r) => navItem(r, { compact: false })));
  const tabs = ROUTES.filter((r) => TAB_IDS.includes(r.id) || r.id === "mehr");
  $("#tabbar").replaceChildren(...tabs.map((r) => navItem(r, { compact: true })));
  $("#side-sites").replaceChildren(...SITES.map((s) => h("a", { href: s.href, target: "_blank", rel: "noopener", class: "site-link" },
    h("span", {}, s.label), icon("external", "ico-sm"), h("span", { class: "sr-only" }, " (öffnet neuen Tab)"))));
  markActive();
}

function markActive() {
  const id = current?.route.id;
  const inMore = id && !TAB_IDS.includes(id);
  document.querySelectorAll(".nav-item").forEach((a) => {
    const r = a.dataset.route;
    const isTabbar = a.closest(".tabbar");
    const active = r === id || (isTabbar && r === "mehr" && inMore);
    a.classList.toggle("is-active", active);
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

function parseHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, ""));
  const [id, sub = ""] = raw.split("/");
  const r = ROUTES.find((x) => x.id === id);
  return r ? { route: r, sub } : null;
}

function route() {
  const parsed = parseHash();
  // Unbekannte oder entfernte Bereiche (z. B. alte Lesezeichen #shop, #atelier) landen auf der Übersicht
  if (!parsed) { history.replaceState(null, "", "#start"); return route(); }
  const changed = !current || current.route.id !== parsed.route.id;
  current = parsed;
  renderCurrent({ focusTitle: changed });
  if (changed) window.scrollTo(0, 0);
  document.title = `${parsed.route.id === "start" ? "Verwaltung" : parsed.route.long} · Cathrin Raasch Atelier`;
}

function renderCurrent({ focusTitle = false, keepFocus = false } = {}) {
  if (!current) return;
  pendingRerender = false;
  const active = document.activeElement;
  const hadFocusInMain = !!(active && main.contains(active));
  const focusKey = keepFocus && hadFocusInMain ? (active.dataset.key || active.id) : null;
  const scrollY = window.scrollY;
  const sub = current.sub;
  let view;
  try {
    view = current.route.render(ctx);
  } catch (e) {
    console.error(e);
    view = h("div", { class: "card" }, h("h1", { tabindex: "-1" }, "Hier ist etwas schiefgelaufen"), h("p", {}, "Lade die Seite bitte einmal neu."));
  }
  main.replaceChildren(view);
  main.dataset.route = current.route.id;
  markActive();
  buildBadges();
  if (focusTitle) {
    const t = main.querySelector("h1");
    if (t) t.focus({ preventScroll: true });
  } else if (focusKey) {
    const el = main.querySelector(`[data-key="${CSS.escape(focusKey)}"]`) || document.getElementById(focusKey);
    if (el) el.focus({ preventScroll: true });
    window.scrollTo(0, scrollY);
  } else if (keepFocus) {
    window.scrollTo(0, scrollY);
  }
  // Fokus ging verloren (z. B. gelöschter Eintrag): zum „Rückgängig“-Knopf, sonst zur Überschrift
  if (keepFocus && hadFocusInMain && !main.contains(document.activeElement) && !document.querySelector("dialog[open]")) {
    const target = document.querySelector(".toast-undo") || main.querySelector("h1");
    if (target) target.focus({ preventScroll: true });
  }
  if (sub && focusTitle) {
    const target = document.getElementById(sub);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }), 60);
  }
}

function buildBadges() {
  for (const [route, def] of Object.entries(BADGES)) buildBadge(route, def);
}
function buildBadge(route, def) {
  const n = def.count();
  document.querySelectorAll(`.nav-item[data-route="${route}"]`).forEach((a) => {
    let b = a.querySelector(".nav-count");
    if (n && !b) { b = h("span", { class: "badge nav-count", "aria-hidden": "true" }); a.querySelector(".nav-label").after(b); }
    if (b) { if (n) b.textContent = n; else b.remove(); }
    let sr = a.querySelector(".sr-only");
    if (n) { if (!sr) { sr = h("span", { class: "sr-only" }); a.append(sr); } sr.textContent = def.sr(n); }
    else if (sr) sr.remove();
  });
}

// "Mehr" (nur Handy): große Kacheln für die übrigen Bereiche
function renderMehr() {
  const items = ROUTES.filter((r) => !r.hidden && !TAB_IDS.includes(r.id));
  const desc = {
    hinweis: "Hinweis oben auf der Seite",
    kurse: "Deine wöchentlichen Nähkurse",
    links: "Linkliste, z. B. für Instagram",
    lookbook: "Fotos deiner Projekte",
    ueber: "Dein kurzer Steckbrief-Text",
    einstellungen: "Demo zurücksetzen, abmelden",
  };
  return h("div", { class: "stack" },
    h("header", { class: "section-head" }, h("h1", { tabindex: "-1", class: "section-title" }, "Mehr"), h("p", { class: "lead" }, "Alle weiteren Bereiche deiner Website.")),
    h("div", { class: "more-grid" }, items.map((r) => h("a", { href: "#" + r.id, class: "more-tile" },
      h("span", { class: "more-ico" }, icon(r.icon)), h("span", { class: "more-text" }, h("strong", {}, r.long), h("span", {}, desc[r.id] || "")), icon("chevronRight", "ico-sm more-chev")))),
    h("section", { class: "card" }, h("h2", { class: "card-title" }, "Website ansehen"),
      h("div", { class: "site-list" }, SITES.map((s) => h("a", { href: s.href, target: "_blank", rel: "noopener", class: "btn btn-soft btn-block" },
        icon("external"), h("span", {}, s.label), h("span", { class: "sr-only" }, " (öffnet neuen Tab)"))))));
}

// ---------- Live-Abgleich mit anderen Tabs ----------
subscribe(() => {
  buildBadges();
  if (ownWrites > 0) return;
  markSaved(new Date(getContent().updatedAt), { announce: false });
  const a = document.activeElement;
  const typing = a && main.contains(a) && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && !["checkbox", "radio", "button"].includes(a.type)));
  if (document.querySelector("dialog[open]") || typing) { pendingRerender = true; return; }
  renderCurrent({ keepFocus: true });
});
main.addEventListener("focusout", () => setTimeout(() => {
  if (pendingRerender && !document.querySelector("dialog[open]") && !main.contains(document.activeElement)) renderCurrent({ keepFocus: true });
}, 50));
document.addEventListener("close", () => { if (pendingRerender) setTimeout(() => renderCurrent({ keepFocus: true }), 30); }, true);

// ---------- Anmeldung ----------
function isLoggedIn() { try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return window.__fgLoggedIn === true; } }
function setLoggedIn(v) {
  try { if (v) sessionStorage.setItem(SESSION_KEY, "1"); else sessionStorage.removeItem(SESSION_KEY); } catch { window.__fgLoggedIn = v; }
}
export async function logout() { setLoggedIn(false); if (isRemote()) await remoteLogout(); location.hash = ""; showWelcome(); }
ctx.logout = logout;

function showWelcome() {
  $("#app").hidden = true;
  $("#welcome").hidden = false;
  document.title = "Verwaltung · Cathrin Raasch Atelier";
  (isRemote() ? $("#login-pw") : $("#welcome-go")).focus();
}

function showApp() {
  $("#welcome").hidden = true;
  $("#app").hidden = false;
  buildNav();
  markSaved(new Date(getContent().updatedAt), { announce: false });
  current = null;
  route();
}

$("#welcome-go").addEventListener("click", () => { setLoggedIn(true); showApp(); });

// Mit Worker: echtes Passwort statt "Weiter"
function setupLogin(health) {
  $("#welcome-go").hidden = true;
  const form = $("#login-form");
  form.hidden = false;
  $(".welcome-note").textContent = health.login
    ? "Deine Änderungen gehen nach dem Speichern direkt online."
    : "Die Anmeldung ist noch nicht eingerichtet: Es fehlen ADMIN_PASSWORD und SESSION_SECRET im Worker.";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#login-err");
    const btnEl = form.querySelector("button[type=submit]");
    err.hidden = true;
    btnEl.disabled = true;
    try {
      await remoteLogin($("#login-pw").value);
      $("#login-pw").value = "";
      await loadRemote();
      showApp();
    } catch (ex) {
      err.textContent = ex.message || "Das hat nicht geklappt.";
      err.hidden = false;
      $("#login-pw").setAttribute("aria-invalid", "true");
      $("#login-pw").focus();
    } finally { btnEl.disabled = false; }
  });
  $("#login-pw").addEventListener("input", () => { $("#login-pw").removeAttribute("aria-invalid"); $("#login-err").hidden = true; });
}
$("#skip-link").addEventListener("click", (e) => { e.preventDefault(); const t = main.querySelector("h1"); (t || main).focus(); });
window.addEventListener("hashchange", () => { if (!$("#app").hidden) route(); });

(async () => {
  const health = await detect();
  if (!health) { if (isLoggedIn()) showApp(); else showWelcome(); return; }
  setupLogin(health);
  if (await remoteLoggedIn()) {
    try { await loadRemote(); showApp(); return; } catch (e) { console.warn(e); }
  }
  showWelcome();
})();

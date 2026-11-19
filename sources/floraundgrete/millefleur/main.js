// Flora & Grete – Entwurf 2 „Millefleur“
import { SHOP, ABOUT, CATEGORIES, PRODUCTS, REVIEWS, FAQ, fmtPrice, productById } from "../shared/data.js";
import { getContent, subscribe, activeBanner, upcomingEvents, formatDate } from "../shared/store.js";
import { esc, img, safeUrl, extAttrs, FOCUS, badgesOf, hasPockets, hash, ss, prefersReducedMotion } from "./util.js";
import { initProduct } from "./product.js";
import { initPlanner, renderPlanner, preselectProduct } from "./planner.js";

document.documentElement.classList.add("js");
const $ = (s, r = document) => r.querySelector(s);

/* ---------------- Banner ---------------- */
const BANNER_KEY = "fg-millefleur-banner-zu";
const TONE_ICON = { info: "✂", warn: "!", closed: "✕", sale: "♥" };

function renderBanner() {
  const slot = $("#banner-slot");
  const b = activeBanner();
  if (!b || ss.get(BANNER_KEY) === hash(b.tone + b.text)) { slot.innerHTML = ""; return; }
  const tone = TONE_ICON[b.tone] ? b.tone : "info";
  const link = b.linkUrl && b.linkLabel ? `<a href="${esc(safeUrl(b.linkUrl))}"${extAttrs(safeUrl(b.linkUrl))}>${esc(b.linkLabel)} →</a>` : "";
  slot.innerHTML = `<div class="banner banner--${tone}" role="region" aria-label="Hinweis">
    <div class="wrap banner-inner">
      <span class="banner-ico" aria-hidden="true">${TONE_ICON[tone]}</span>
      <p class="banner-text">${esc(b.text)} ${link}</p>
      <button class="banner-close" type="button" aria-label="Hinweis ausblenden">×</button>
    </div></div>`;
  slot.querySelector(".banner-close").addEventListener("click", () => {
    ss.set(BANNER_KEY, hash(b.tone + b.text));
    const el = slot.firstElementChild;
    if (prefersReducedMotion()) { slot.innerHTML = ""; return; }
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => (slot.innerHTML = ""), { once: true });
    $("#inhalt").focus({ preventScroll: true });
  });
}

/* ---------------- Lieblingsstücke ---------------- */
function renderFeatured(content) {
  const list = (content.featured || []).map(productById).filter(Boolean);
  const box = $("#featured-list");
  if (!list.length) { box.innerHTML = ""; return; }
  box.innerHTML = list.map((p, i) => {
    const stickers = [];
    if (hasPockets(p) && p.category === "roecke") stickers.push(`<span class="sticker sticker--mustard">hat TASCHEN! 🥳</span>`);
    badgesOf(p).forEach((b) => stickers.push(`<span class="sticker sticker--${b.sticker}">${esc(b.stickerLabel)}</span>`));
    return `<article class="feat rv" style="transition-delay:${(i % 3) * 90}ms">
      <div class="feat-media">
        <div class="feat-frame">${img(p.hero, `${p.name}: ${p.subtitle}`, { pos: FOCUS[p.hero] })}</div>
        ${stickers.length ? `<div class="feat-badges" aria-hidden="true">${stickers.slice(0, 2).join("")}</div>` : ""}
      </div>
      <div class="feat-body">
        <h3><button class="card-open" type="button" data-product="${esc(p.id)}">${esc(p.name)}</button></h3>
        <p class="feat-sub">${esc(p.subtitle)}</p>
        <div class="feat-row"><span class="price-tag">${esc(fmtPrice(p.price, p.priceFrom))}</span><span class="feat-more" aria-hidden="true">Ansehen <span>→</span></span></div>
      </div>
    </article>`;
  }).join("");
  observe(box.querySelectorAll(".rv"));
}

/* ---------------- Katalog ---------------- */
let activeCat = "alle";
function renderCatalog() {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, PRODUCTS.filter((p) => p.category === c.id).length]));
  const chips = [{ id: "alle", label: "Alle Stücke" }, ...CATEGORIES];
  $("#filter").innerHTML = chips.map((c) => `
    <button class="swatch" type="button" data-cat="${c.id}" aria-pressed="${c.id === activeCat}">
      <span class="swatch-fab fab-${c.id}" aria-hidden="true"></span>${esc(c.label)}
      <span class="swatch-count">${c.id === "alle" ? PRODUCTS.length : counts[c.id]}</span>
    </button>`).join("");

  $("#catalog-list").innerHTML = PRODUCTS.map((p) => {
    const badges = badgesOf(p).map((b) => `<span class="badge badge--${b.cls}">${esc(b.label)}</span>`).join("");
    return `<li data-cat="${p.category}">
      <article class="cat-card">
        <div class="cat-media">${img(p.hero, `${p.name}: ${p.subtitle}`, { pos: FOCUS[p.hero] })}${badges ? `<div class="cat-badges">${badges}</div>` : ""}</div>
        <div class="cat-body">
          <h3><button class="card-open" type="button" data-product="${esc(p.id)}">${esc(p.name)}</button></h3>
          <p class="cat-sub">${esc(p.subtitle)}</p>
          <p class="cat-price">${esc(fmtPrice(p.price, p.priceFrom))}</p>
        </div>
      </article></li>`;
  }).join("");

  $("#filter").addEventListener("click", (e) => {
    const b = e.target.closest(".swatch");
    if (!b) return;
    activeCat = b.dataset.cat;
    $("#filter").querySelectorAll(".swatch").forEach((s) => s.setAttribute("aria-pressed", String(s === b)));
    applyFilter(true);
  });
  applyFilter(false);
}
function applyFilter(animate) {
  let i = 0;
  $("#catalog-list").querySelectorAll("li").forEach((li) => {
    const show = activeCat === "alle" || li.dataset.cat === activeCat;
    li.classList.toggle("is-hidden", !show);
    li.classList.remove("is-enter");
    if (show && animate) { void li.offsetWidth; li.style.setProperty("--i", i++); li.classList.add("is-enter"); }
  });
  const n = PRODUCTS.filter((p) => activeCat === "alle" || p.category === activeCat).length;
  const cat = CATEGORIES.find((c) => c.id === activeCat);
  $("#catalog-count").textContent = cat ? `${n} ${n === 1 ? "Stück" : "Stücke"} in „${cat.label}“` : `${n} handgemachte Stücke – alle auf Etsy bestellbar`;
}

/* ---------------- Über mich ---------------- */
const VALUE_ICONS = [
  // Maßband
  `<svg viewBox="0 0 32 32" fill="none" stroke="#2b1b1f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="15" r="9"/><circle cx="13" cy="15" r="3"/><path d="M13 24h15v-5"/><path d="M17 24v-2M21 24v-2M25 24v-2"/></svg>`,
  // Blume
  `<svg viewBox="0 0 32 32" fill="none" stroke="#2b1b1f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="13" r="3"/><path d="M16 10c-2-5 4-6 3-1M19 12c5-2 6 4 1 3M18 16c3 4-2 7-2 2M14 16c-3 4-7-1-2-2M13 12c-5-2-2-7 2-3"/><path d="M16 16v12M16 23c-3-3-6-2-7-1M16 21c2-2 5-2 6-1"/></svg>`,
  // Päckchen
  `<svg viewBox="0 0 32 32" fill="none" stroke="#2b1b1f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l11-5 11 5v12l-11 5-11-5z"/><path d="M5 11l11 5 11-5M16 16v12"/><path d="M16 6c-3-4-7-1-4 1M16 6c3-4 7-1 4 1"/></svg>`,
];
function renderAbout(content) {
  $("#about-title").textContent = ABOUT.headline;
  $("#about-intro").textContent = (content.aboutIntro || "").trim() || ABOUT.intro;
  $("#facts").innerHTML = ABOUT.facts.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join("");
  $("#struppi-caption").textContent = ABOUT.dogCaption;
  $("#values").innerHTML = ABOUT.values.map((v, i) => `<li class="value rv"><span class="value-ico" aria-hidden="true">${VALUE_ICONS[i % 3]}</span><h3>${esc(v.title)}</h3><p>${esc(v.text)}</p></li>`).join("");
}

/* ---------------- Bewertungen ---------------- */
function renderReviews() {
  $("#reviews-list").innerHTML = REVIEWS.map((r) => {
    const p = productById(r.product);
    return `<li><article class="review">
      <span class="stars" role="img" aria-label="5 von 5 Sternen">★★★★★</span>
      <blockquote><p>${esc(r.text)}</p></blockquote>
      <p class="review-meta"><strong>${esc(r.name)}</strong><span>${esc(formatDate(r.date, { day: "numeric", month: "long", year: "numeric" }))}</span>${p ? `<span>zu <button class="review-prod" type="button" data-product="${esc(p.id)}">${esc(p.name)}</button></span>` : ""}</p>
      ${r.reply ? `<div class="review-reply"><img src="../img/cathrin-avatar.webp" alt="" width="32" height="32" loading="lazy"><p><b>Cathrin antwortet</b>${esc(r.reply)}</p></div>` : ""}
    </article></li>`;
  }).join("");
}

/* ---------------- Termine & Links ---------------- */
const ICO_CLOCK = `<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" style="vertical-align:-2px"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICO_PIN = `<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" style="vertical-align:-2px"><path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="6.5" r="1.8" fill="currentColor"/></svg>`;

function renderEvents(content) {
  const ev = upcomingEvents();
  $("#events-list").innerHTML = ev.length ? ev.map((e) => {
    const [y, m, d] = e.date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return `<li class="event rv">
      <time class="cal" datetime="${esc(e.date)}${e.time && /^\d\d:\d\d/.test(e.time) ? "T" + e.time.slice(0, 5) : ""}">
        <span class="cal-month">${dt.toLocaleDateString("de-DE", { month: "short" }).replace(".", "")}</span>
        <span class="cal-day">${d}</span>
        <span class="cal-wd">${dt.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "")}</span>
      </time>
      <div>
        <h4>${esc(e.title)}</h4>
        <p class="event-meta">${e.time ? `<span>${ICO_CLOCK} ${esc(e.time)} Uhr</span>` : `<span>${ICO_CLOCK} ganztags</span>`}${e.place ? `<span>${ICO_PIN} ${esc(e.place)}</span>` : ""}</p>
        ${e.note ? `<p class="event-note">${esc(e.note)}</p>` : ""}
      </div>
    </li>`;
  }).join("") : `<li class="empty"><span class="hand">Gerade ist nichts geplant.</span>Neue Märkte und Atelier-Tage kündige ich hier und auf Instagram an – schau bald wieder vorbei.</li>`;

  const links = (content.links || []).filter((l) => l.visible !== false && l.label);
  $("#links-list").innerHTML = links.length ? links.map((l) => {
    const url = safeUrl(l.url);
    return `<li class="${l.highlight ? "is-hl" : ""}"><a href="${esc(url)}"${extAttrs(url)}>
      <span><span class="l-label">${esc(l.label)}</span>${l.note ? `<span class="l-note">${esc(l.note)}</span>` : ""}</span>
      <span class="l-arrow" aria-hidden="true">${/^https?:/i.test(url) ? "↗" : "→"}</span></a></li>`;
  }).join("") : `<li class="empty">Hier stehen bald wieder aktuelle Links.</li>`;
  observe(document.querySelectorAll("#events-list .rv"));
}

/* ---------------- Status ---------------- */
const STATUS = {
  open: "Atelier ist geöffnet",
  appointment: "Besuch nur nach Termin",
  closed: "Atelier gerade geschlossen",
  vacation: "Ich bin im Urlaub",
};
function renderStatus(content) {
  const s = content.status || {};
  const mode = STATUS[s.mode] ? s.mode : "open";
  const hours = (s.hours || []).filter((h) => h.day || h.time);
  $("#status-card").className = `status-card status--${mode}`;
  $("#status-card").innerHTML = `
    <p class="status-top"><span class="status-dot" aria-hidden="true"></span><span class="status-label">${STATUS[mode]}</span></p>
    ${s.note ? `<p class="status-note">${esc(s.note)}</p>` : ""}
    ${hours.length && mode !== "vacation" && mode !== "closed" ? `<ul class="hours">${hours.map((h) => `<li><b>${esc(h.day)}</b><span>${esc(h.time)}</span></li>`).join("")}</ul>` : ""}`;
}

/* ---------------- FAQ ---------------- */
function renderFaq() {
  $("#faq-list").innerHTML = FAQ.map((f) => `<details class="rv"><summary><span>${esc(f.q)}</span><span class="faq-ico" aria-hidden="true"></span></summary><div class="faq-a"><p>${esc(f.a)}</p></div></details>`).join("");
}

/* ---------------- Karte (2-Klick) ---------------- */
function initMap() {
  $("#map-load").addEventListener("click", () => {
    const ph = $("#map-placeholder");
    const frame = document.createElement("div");
    frame.className = "map-frame";
    frame.tabIndex = -1;
    frame.innerHTML = `<iframe src="https://www.google.com/maps?q=Ramsen%2067305%20Pfalz&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Karte: Ramsen (Pfalz) bei Google Maps" allowfullscreen></iframe>`;
    ph.replaceWith(frame);
    frame.focus({ preventScroll: true });
  });
}

/* ---------------- Navigation ---------------- */
function initNav() {
  const toggle = $(".nav-toggle");
  const nav = $("#hauptnavigation");
  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") { setOpen(false); toggle.focus(); }
  });
  document.addEventListener("click", (e) => {
    if (toggle.getAttribute("aria-expanded") === "true" && !e.target.closest(".site-head")) setOpen(false);
  });

  // Schatten beim Scrollen
  const head = $(".site-head");
  const onScroll = () => head.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // aktueller Abschnitt
  const links = [...nav.querySelectorAll("a")];
  const map = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      let id = en.target.id;
      if (id === "alle-stuecke") id = "shop";
      if (id === "stimmen") id = "ueber-mich";
      links.forEach((a) => a.classList.toggle("is-current", a === map.get(id)));
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  document.querySelectorAll("main section[id]").forEach((s) => io.observe(s));
}

/* ---------------- Prototyp-Umschalter ---------------- */
function initProto() {
  const wrap = $("#proto");
  const btn = wrap.querySelector(".proto-toggle");
  const panel = $("#proto-panel");
  const set = (open) => { btn.setAttribute("aria-expanded", String(open)); panel.hidden = !open; };
  btn.addEventListener("click", () => set(panel.hidden));
  document.addEventListener("click", (e) => { if (!panel.hidden && !wrap.contains(e.target)) set(false); });
  wrap.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { set(false); btn.focus(); } });

  // Auf dem Handy beim Runterscrollen kurz wegducken, damit der Text frei bleibt.
  const small = window.matchMedia("(max-width: 700px)");
  let lastY = window.scrollY;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    const nearEnd = y + window.innerHeight > document.documentElement.scrollHeight - 160;
    const tuck = small.matches && panel.hidden && y > 240 && y > lastY + 4 && !nearEnd;
    if (tuck) wrap.classList.add("is-tucked");
    else if (y < lastY - 4 || nearEnd || y <= 240) wrap.classList.remove("is-tucked");
    lastY = y;
  }, { passive: true });
  wrap.addEventListener("focusin", () => wrap.classList.remove("is-tucked"));
}

/* ---------------- Einblenden beim Scrollen ---------------- */
let revealIO = null;
function observe(nodes) {
  if (!revealIO) {
    if (!("IntersectionObserver" in window) || prefersReducedMotion()) {
      nodes.forEach((n) => n.classList.add("is-in"));
      return;
    }
    revealIO = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("is-in"); revealIO.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  }
  nodes.forEach((n) => revealIO.observe(n));
}

/* ---------------- Start ---------------- */
function renderAll(content) {
  renderBanner();
  renderFeatured(content);
  renderAbout(content);
  renderEvents(content);
  renderStatus(content);
}

const content = getContent();
renderAll(content);
renderCatalog();
renderReviews();
renderFaq();
initMap();
initNav();
initProto();
initPlanner();
initProduct({ requestFitting: preselectProduct });

// Sektionen-Elemente sanft einblenden
document.querySelectorAll(".sec-head, .etsy-label, .steckbrief, .about-photos, .links-board, .envelope, .status-card, .map-card").forEach((n) => n.classList.add("rv"));
observe(document.querySelectorAll(".rv:not(.is-in), .seam"));

subscribe((c) => {
  renderAll(c);
  renderPlanner(c);
  // neu gerenderte Elemente direkt sichtbar machen, wenn sie schon im Bild sind
  document.querySelectorAll("#featured-list .rv, #values .rv").forEach((n) => n.classList.add("is-in"));
});

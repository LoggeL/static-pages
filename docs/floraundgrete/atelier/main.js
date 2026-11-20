// Entwurf 2 „Atelier“ – ruhige Karten-Oberfläche im Stil der Verwaltung.
import { SHOP, ABOUT, CATEGORIES, PRODUCTS, REVIEWS, FAQ, fmtPrice, productById } from "../shared/data.js";
import { getContent, subscribe, activeBanner, upcomingEvents, formatDate } from "../shared/store.js";
import { VARIANTS } from "../shared/variants.js";
import { esc, safeUrl, extAttrs, img, icon, badges, hash, ss, statusOf, reduceMotion } from "./util.js";
import { initProductSheet, openProduct } from "./product.js";
import { initPlanner, renderPlanner, preselectProduct } from "./planner.js";

const $ = (s, r = document) => r.querySelector(s);

/** Platzhalter <span data-icon="…"> mit Linien-Icons füllen. */
function hydrateIcons(scope = document) {
  scope.querySelectorAll("[data-icon]").forEach((el) => {
    if (el.dataset.iconDone) return;
    el.innerHTML = icon(el.dataset.icon);
    el.setAttribute("aria-hidden", "true");
    el.dataset.iconDone = "1";
  });
}

/* ---------- Hinweisbanner ---------- */
function renderBanner() {
  const slot = $("#banner-slot");
  const b = activeBanner();
  const key = b ? "fg-atelier-banner-" + hash(b.tone + b.text + (b.linkUrl || "")) : "";
  if (!b || ss.get(key) === "x") { slot.innerHTML = ""; return; }
  const tone = ["info", "warn", "closed", "sale"].includes(b.tone) ? b.tone : "info";
  const ic = { info: "info", warn: "clock", closed: "lock", sale: "sparkle" }[tone];
  const url = b.linkUrl ? safeUrl(b.linkUrl) : "";
  slot.innerHTML = `<aside class="bn bn-${tone}" aria-label="Hinweis">
    <div class="bn-in">
      ${icon(ic, "bn-ico")}
      <p class="bn-text">${esc(b.text)}${url && url !== "#" ? ` <a class="bn-link" href="${esc(url)}"${extAttrs(url)}>${esc(b.linkLabel || "Mehr erfahren")}</a>` : ""}</p>
      <button type="button" class="bn-x" aria-label="Hinweis ausblenden">${icon("x")}</button>
    </div>
  </aside>`;
  slot.querySelector(".bn-x").addEventListener("click", () => {
    ss.set(key, "x");
    slot.innerHTML = "";
    $("#main").focus({ preventScroll: true });
  });
}

/* ---------- Begrüßung: Chips ---------- */
function renderHeroChips(content) {
  const st = statusOf(content.status?.mode);
  const mode = content.status?.mode || "open";
  $("#hero-chips").innerHTML = `
    <li><a class="chip chip-status status-${esc(mode)}" href="#kontakt"><span class="dot" aria-hidden="true"></span>${esc(st.label)}</a></li>
    <li><span class="chip">${icon("pin", "ico-sm")}Mini-Atelier in Ramsen</span></li>
    <li><span class="chip">${icon("ruler", "ico-sm")}Röcke auf Maß</span></li>
    <li><span class="chip">${icon("box", "ico-sm")}Plastikfrei verpackt</span></li>`;
}

/* ---------- Lieblingsstücke ---------- */
function renderFeatured(content) {
  const ids = (content.featured || []).filter((id) => productById(id));
  const list = (ids.length ? ids : PRODUCTS.filter((p) => p.featured).map((p) => p.id)).map(productById);
  $("#featured").innerHTML = list.map((p, i) => `
    <li class="feat${i === 0 ? " feat-first" : ""}">
      <article class="card feat-card">
        <div class="feat-media">${img(p.hero, `${p.name} – ${p.subtitle}`, { sizes: "(min-width: 1100px) 400px, 85vw" })}</div>
        <div class="feat-body">
          ${badges(p, 2)}
          <h3 class="feat-name"><a href="#produkt-${esc(p.id)}" data-product="${esc(p.id)}" class="stretch">${esc(p.name)}</a></h3>
          <p class="feat-sub">${esc(p.subtitle)}</p>
          <p class="feat-foot"><span class="price">${esc(fmtPrice(p.price, p.priceFrom))}</span><span class="go" aria-hidden="true">${icon("chevronRight", "ico-sm")}</span></p>
        </div>
      </article>
    </li>`).join("");
}

/* ---------- Katalog mit Filter ---------- */
let currentCat = "alle";
function initCatalog() {
  const segs = [{ id: "alle", label: "Alle" }, ...CATEGORIES];
  $("#filter").innerHTML = segs.map((c) => {
    const n = c.id === "alle" ? PRODUCTS.length : PRODUCTS.filter((p) => p.category === c.id).length;
    return `<button type="button" class="seg" data-cat="${c.id}" aria-pressed="${c.id === currentCat}">${esc(c.label)}<span class="seg-n">${n}</span></button>`;
  }).join("");
  $("#filter").addEventListener("click", (e) => {
    const b = e.target.closest(".seg");
    if (!b) return;
    currentCat = b.dataset.cat;
    $("#filter").querySelectorAll(".seg").forEach((s) => s.setAttribute("aria-pressed", String(s === b)));
    b.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
    renderCatalog();
  });
  renderCatalog();
}
function renderCatalog() {
  const list = PRODUCTS.filter((p) => currentCat === "alle" || p.category === currentCat);
  const catLabel = CATEGORIES.find((c) => c.id === currentCat)?.label;
  $("#catalog-count").textContent = currentCat === "alle" ? `${list.length} Stücke` : `${list.length} ${list.length === 1 ? "Stück" : "Stücke"} in „${catLabel}“`;
  $("#catalog").innerHTML = list.map((p) => `
    <li>
      <article class="cat-card">
        <div class="cat-media">${img(p.hero, `${p.name} – ${p.subtitle}`, { sizes: "(min-width: 1100px) 280px, 45vw" })}</div>
        <div class="cat-body">
          <h4 class="cat-name"><a href="#produkt-${esc(p.id)}" data-product="${esc(p.id)}" class="stretch">${esc(p.name)}</a></h4>
          <p class="cat-sub">${esc(p.subtitle)}</p>
          <p class="price">${esc(fmtPrice(p.price, p.priceFrom))}</p>
          ${badges(p, 2)}
        </div>
      </article>
    </li>`).join("");
}

/* ---------- Über mich ---------- */
function renderAbout(content) {
  $("#about-intro").textContent = (content.aboutIntro || "").trim() || ABOUT.intro;
}
function renderAboutStatic() {
  $("#about-facts").innerHTML = ABOUT.facts.map((f) => `<div class="fact"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join("");
  const icons = ["ruler", "leaf", "box"];
  $("#about-values").innerHTML = ABOUT.values.map((v, i) => `
    <li class="card value">
      <span class="tile tile-sm">${icon(icons[i] || "heart")}</span>
      <h3 class="value-title">${esc(v.title)}</h3>
      <p class="muted">${esc(v.text)}</p>
    </li>`).join("") + `
    <li class="card dog-card">
      <img src="../img/${SHOP.dog}" alt="Struppi, ein schwarz-weißer Hund mit braunen Abzeichen, zwischen Pusteblumen" width="1120" height="1400" loading="lazy" decoding="async">
      <div><h3 class="value-title">Struppi</h3><p class="muted">${esc(ABOUT.dogCaption.replace(/^Struppi,\s*/, "").replace(/^Assistenz\b/, "Meine Assistenz"))}</p></div>
    </li>`;
}

/* ---------- Stimmen ---------- */
function renderReviews() {
  const pick = ["Janne", "Tanja", "S."].map((n) => REVIEWS.find((r) => r.name === n)).filter(Boolean);
  $("#reviews").innerHTML = pick.map((r) => {
    const p = productById(r.product);
    return `<li class="card review">
      ${p ? `<a class="review-product" href="#produkt-${esc(p.id)}" data-product="${esc(p.id)}">
        ${img(p.hero, "", { cls: "review-thumb" })}
        <span><strong>${esc(p.name)}</strong><span>Zum Produkt</span></span>${icon("chevronRight", "ico-sm")}</a>` : ""}
      <blockquote class="review-text"><p>${esc(r.text.trim())}</p></blockquote>
      <p class="review-meta"><strong>${esc(r.name)}</strong> · <time datetime="${esc(r.date)}">${esc(formatDate(r.date, { day: "numeric", month: "long", year: "numeric" }))}</time></p>
      ${r.reply ? `<div class="reply"><img src="../img/${SHOP.portraitSmall}" alt="" width="1400" height="1400" loading="lazy" decoding="async"><p><span class="reply-who">Cathrin antwortet</span>${esc(r.reply)}</p></div>` : ""}
    </li>`;
  }).join("");
}

/* ---------- Termine & Links ---------- */
function renderDates(content) {
  const evs = upcomingEvents(5);
  $("#events").innerHTML = evs.length ? evs.map((e) => {
    const [y, m, d] = e.date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return `<li class="ev">
      <span class="ev-date" aria-hidden="true"><span class="ev-wd">${esc(dt.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", ""))}</span><strong>${d}</strong><span>${esc(dt.toLocaleDateString("de-DE", { month: "short" }).replace(".", ""))}</span></span>
      <div class="ev-body">
        <h4 class="ev-title">${esc(e.title)}</h4>
        <p class="sr-only">${esc(formatDate(e.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</p>
        <p class="ev-meta">${e.time ? `<span>${icon("clock", "ico-xs")}${esc(e.time)} Uhr</span>` : ""}${e.place ? `<span>${icon("pin", "ico-xs")}${esc(e.place)}</span>` : ""}</p>
        ${e.note ? `<p class="ev-note">${esc(e.note)}</p>` : ""}
      </div>
    </li>`;
  }).join("") : `<li class="empty">${icon("calendar", "empty-ico")}<p class="empty-title">Gerade keine Termine geplant</p><p class="muted">Sobald ich wieder auf einem Markt bin, steht es hier. Auf Instagram erfährst du es meist zuerst.</p></li>`;

  const links = (content.links || []).filter((l) => l.visible !== false && l.label);
  $("#links").innerHTML = links.length ? links.map((l) => {
    const url = safeUrl(l.url);
    return `<li><a class="row${l.highlight ? " row-star" : ""}" href="${esc(url)}"${extAttrs(url)}>
      <span class="tile tile-xs">${icon(l.highlight ? "star" : /instagram/i.test(l.url) ? "instagram" : /etsy/i.test(l.url) ? "shop" : "link")}</span>
      <span class="row-text"><strong>${esc(l.label)}</strong>${l.highlight ? '<span class="row-tag">Tipp</span>' : ""}${l.note ? `<span>${esc(l.note)}</span>` : ""}</span>
      <span class="row-chev">${icon(/^https?:/i.test(url) ? "external" : "chevronRight")}</span>
    </a></li>`;
  }).join("") : `<li class="empty">${icon("link", "empty-ico")}<p class="empty-title">Gerade nichts Neues</p><p class="muted">Schau gern im Etsy-Shop vorbei.</p></li>`;
}

/* ---------- Atelier-Status ---------- */
function renderStatus(content) {
  const s = content.status || {};
  const mode = s.mode || "open";
  const st = statusOf(mode);
  $("#status-card").innerHTML = `
    <div class="card-head">
      <span class="tile tile-sm">${icon(st.icon)}</span>
      <div><h3 class="card-title" id="status-title">Mein Atelier</h3><p class="card-sub">Ramsen, Pfalz</p></div>
    </div>
    <p class="status-pill status-${esc(mode)}"><span class="dot" aria-hidden="true"></span>${esc(st.label)}</p>
    ${s.note ? `<p class="status-note">${esc(s.note)}</p>` : ""}
    ${(s.hours || []).length && mode !== "vacation" && mode !== "closed" ? `<dl class="hours">${s.hours.map((h) => `<div><dt>${esc(h.day)}</dt><dd>${esc(h.time)}</dd></div>`).join("")}</dl>` : ""}
    ${content.fitting?.enabled && mode !== "vacation" && mode !== "closed"
      ? `<a class="btn btn-soft btn-sm" href="#anprobe">${icon("calendar")}<span>Termin anfragen</span></a>`
      : `<a class="btn btn-soft btn-sm" href="${esc(SHOP.etsy)}" target="_blank" rel="noopener">${icon("chat")}<span>Nachricht über Etsy</span></a>`}`;
}

/* ---------- Karte (2 Klicks) ---------- */
function initMap() {
  $("#map-load").addEventListener("click", () => {
    const box = $("#map");
    box.innerHTML = `<iframe title="Karte: Ramsen in der Pfalz (Google Maps)" src="https://www.google.com/maps?q=Ramsen%2067305%20Pfalz&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`;
    box.classList.add("is-loaded");
    box.querySelector("iframe").focus();
  });
}

/* ---------- FAQ ---------- */
function renderFaq() {
  $("#faq-list").innerHTML = FAQ.map((f, i) => `
    <details class="faq-item"${i === 0 ? " open" : ""}>
      <summary><span>${esc(f.q)}</span>${icon("chevronDown", "faq-chev")}</summary>
      <p>${esc(f.a)}</p>
    </details>`).join("");
}

/* ---------- Navigation: aktiver Bereich ---------- */
function initNav() {
  const ids = ["shop", "ueber-mich", "termine", "anprobe", "kontakt"];
  const links = [...document.querySelectorAll("[data-nav]")];
  const set = (id) => links.forEach((a) => (a.dataset.nav === id ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
  const sections = ids.map((id) => document.getElementById(id));
  const onScroll = () => {
    const mid = window.innerHeight * 0.35;
    let cur = "";
    for (const s of sections) if (s.getBoundingClientRect().top <= mid) cur = s.id;
    // Stimmen gehört zu „Über mich“, FAQ zu „Kontakt“ – passt über die Reihenfolge
    set(cur);
  };
  let tick = false;
  window.addEventListener("scroll", () => { if (!tick) { tick = true; requestAnimationFrame(() => { tick = false; onScroll(); }); } }, { passive: true });
  onScroll();
  // Leiste beim Hochscrollen
  const bar = $("#topbar");
  const shadow = () => bar.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", shadow, { passive: true });
  shadow();
}

/* ---------- Prototyp-Umschalter ---------- */
function initProto() {
  const wrap = $(".proto");
  const btn = wrap.querySelector(".proto-toggle");
  const panel = $("#proto-panel");
  panel.innerHTML = `<p class="proto-title">Entwürfe für Flora &amp; Grete</p>
    <ul class="proto-list">${VARIANTS.map((v) => `<li><a href="../${esc(v.slug)}/"${v.slug === "atelier" ? ' aria-current="page"' : ""}>
      <span class="proto-n">${v.n}</span><span><strong>${esc(v.name)}</strong><span>${esc(v.short)}</span></span></a></li>`).join("")}</ul>
    <p class="proto-links"><a href="../verwaltung/">${icon("lock", "ico-xs")}Verwaltung</a><a href="../">${icon("chevronLeft", "ico-xs")}Übersicht</a></p>`;
  const set = (open) => { panel.hidden = !open; btn.setAttribute("aria-expanded", String(open)); wrap.classList.toggle("is-open", open); };
  btn.addEventListener("click", () => set(panel.hidden));
  document.addEventListener("click", (e) => { if (!panel.hidden && !wrap.contains(e.target)) set(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { set(false); btn.focus(); } });

  // Handy: beim Runterscrollen wegtauchen und nie über wichtigen Knöpfen liegen
  const small = window.matchMedia("(max-width: 899px)");
  const AVOID = ".hero-actions, .chips, .photo-tag, .planner, .faq, .segmented, .row-link";
  const covers = () => {
    // Ruheposition messen (ohne das Wegtauch-Transform), sonst flackert die Entscheidung hin und her
    const r0 = btn.getBoundingClientRect();
    const shift = wrap.classList.contains("is-tucked") ? 16 : 0;
    const top = r0.top - shift, bottom = r0.bottom - shift;
    const tabTop = document.getElementById("tabbar")?.getBoundingClientRect().top ?? window.innerHeight;
    return [...document.querySelectorAll(AVOID)].some((el) => {
      const r = el.getBoundingClientRect();
      const visBottom = Math.min(r.bottom, tabTop); // was hinter der Tab-Leiste liegt, ist eh nicht antippbar
      return r.height && visBottom > top - 8 && r.top < bottom + 8 && r.right > r0.left && r.left < r0.right;
    });
  };
  let lastY = window.scrollY, down = false;
  const sync = () => {
    const y = window.scrollY;
    if (Math.abs(y - lastY) > 4) { down = y > lastY; lastY = y; }
    const atEnd = y + window.innerHeight >= document.documentElement.scrollHeight - 60;
    wrap.classList.toggle("is-tucked", small.matches && panel.hidden && (covers() || (down && y > 200 && !atEnd)));
  };
  window.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("resize", sync, { passive: true });
  wrap.addEventListener("focusin", () => wrap.classList.remove("is-tucked"));
  sync();
}

/* ---------- Produkt-Links ---------- */
function initProductLinks() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-product]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    openProduct(a.dataset.product, a);
  });
}

/* ---------- Start ---------- */
function renderLive(content) {
  renderBanner();
  renderHeroChips(content);
  renderFeatured(content);
  renderAbout(content);
  renderDates(content);
  renderStatus(content);
  renderPlanner(content);
}

hydrateIcons();
renderAboutStatic();
renderReviews();
renderFaq();
initCatalog();
const first = getContent();
renderLive(first);
initPlanner();
initMap();
initNav();
initProto();
initProductLinks();
initProductSheet({ onFitting: preselectProduct });
subscribe(renderLive);

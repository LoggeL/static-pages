// Cathrin Raasch Atelier – Entwurf 3 · Lookbook
import { SHOP, ABOUT, CATEGORIES, PRODUCTS, REVIEWS, FAQ, fmtPrice, productById } from "../shared/data.js";
import { getContent, subscribe, activeBanner, upcomingEvents, formatDate } from "../shared/store.js";
import { $, $$, esc, img, pad2, productNo, catLabel, altImage, badgesHtml, reduceMotion } from "./util.js";
import { initProduct } from "./product.js";
import { initPlanner, render as renderPlanner, preselect } from "./planner.js";
import { VARIANTS } from "../shared/variants.js";

/* ------------------------------------------------------------------ Banner */
const BANNER_KEY = "fg-lookbook-banner-dismissed";
const TONE_TAG = { info: "Hinweis", warn: "Wichtig", closed: "Geschlossen", sale: "Angebot" };

function renderBanner() {
  const slot = $("#banner-slot");
  const b = activeBanner();
  let dismissed = "";
  try { dismissed = sessionStorage.getItem(BANNER_KEY) || ""; } catch { /* privat */ }
  const sig = b ? `${b.tone}|${b.text}` : "";
  if (!b || dismissed === sig) { slot.innerHTML = ""; setBannerHeight(); return; }
  const tone = ["info", "warn", "closed", "sale"].includes(b.tone) ? b.tone : "info";
  const ext = /^https?:/i.test(b.linkUrl || "");
  slot.innerHTML = `
    <div class="banner banner--${tone}" role="region" aria-label="Hinweis">
      <p><span class="banner-tag">${TONE_TAG[tone]}</span>${esc(b.text)}${b.linkUrl ? ` <a href="${esc(b.linkUrl)}"${ext ? ' target="_blank" rel="noopener"' : ""}>${esc(b.linkLabel || "Mehr erfahren")} <span aria-hidden="true">→</span></a>` : ""}</p>
      <button class="banner-x" type="button" aria-label="Hinweis für diese Sitzung ausblenden">✕</button>
    </div>`;
  $(".banner-x", slot).addEventListener("click", () => {
    try { sessionStorage.setItem(BANNER_KEY, sig); } catch { /* egal */ }
    slot.innerHTML = ""; setBannerHeight();
    $("#kopf .wordmark").focus({ preventScroll: true });
  });
  setBannerHeight();
}
function setBannerHeight() {
  const h = $("#banner-slot").offsetHeight || 0;
  document.documentElement.style.setProperty("--bh", `${h}px`);
}

/* ------------------------------------------------------------------ Header & Navigation */
function initHeader() {
  const hdr = $("#kopf");
  const hero = $(".hero");
  const io = new IntersectionObserver(([e]) => hdr.classList.toggle("is-solid", !e.isIntersecting), {
    rootMargin: `-${70}px 0px 0px 0px`, threshold: 0,
  });
  io.observe(hero);

  const btn = $(".menu-btn");
  const menu = $("#mobilmenu");
  const label = $(".menu-btn-label");
  const setOpen = (open) => {
    btn.setAttribute("aria-expanded", String(open));
    label.textContent = open ? "Schließen" : "Menü";
    menu.hidden = !open;
    document.documentElement.classList.toggle("menu-open", open);
    document.documentElement.style.overflow = open ? "hidden" : "";
    if (open) $("a", menu).focus();
  };
  btn.addEventListener("click", () => setOpen(menu.hidden));
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
  document.addEventListener("keydown", (e) => {
    if (menu.hidden) return;
    if (e.key === "Escape") { setOpen(false); btn.focus(); }
    else if (e.key === "Tab") {
      // Menü + Schließen-Knopf als gemeinsamer Fokusbereich
      const f = [btn, ...$$("a", menu)];
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === f.length - 1 || i === -1)) { e.preventDefault(); f[0].focus(); }
    }
  });
  matchMedia("(min-width: 1081px)").addEventListener("change", (e) => { if (e.matches && !menu.hidden) setOpen(false); });

  // aktiver Navigationspunkt
  const links = $$(".nav a");
  const map = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      const a = map.get(en.target.id);
      if (a && en.isIntersecting) { links.forEach((l) => l.removeAttribute("aria-current")); a.setAttribute("aria-current", "true"); }
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  map.forEach((_, id) => { const s = document.getElementById(id); s && spy.observe(s); });
}

/* ------------------------------------------------------------------ Status (Hero + Atelier) */
const MODES = {
  open: "Atelier geöffnet",
  appointment: "Nur nach Termin",
  closed: "Atelier geschlossen",
  vacation: "Gerade im Urlaub",
};
function renderStatus(c) {
  const s = c.status || {};
  const mode = MODES[s.mode] ? s.mode : "open";
  const el = $("#status");
  el.dataset.mode = mode;
  el.innerHTML = `<span class="dot" aria-hidden="true"></span>${MODES[mode]}`;
  $("#status-note").textContent = s.note || "";
  const hours = s.hours || [];
  $("#hours").innerHTML = hours.length
    ? hours.map((h) => `<div><dt>${esc(h.day)}</dt><dd>${esc(h.time)}</dd></div>`).join("")
    : `<div class="hours-empty">Termine gern nach Absprache.</div>`;
  $("#hero-status").innerHTML = `<span class="dot" aria-hidden="true"></span>${MODES[mode]}`;
}

/* ------------------------------------------------------------------ Lookbook-Strip */
const LOOKS = [
  ["millie-2.webp", "millie", "Weinroter Musselinrock Millie mit weißem T-Shirt vor grauer Wand"],
  ["viola-kleid-5.webp", "viola-kleid", "Kleid Viola aus mintfarbener Vintage-Bettwäsche mit Schleifenträgern"],
  ["tuch-uni-2.webp", "tuch-uni", "Schwarzes Musselin-Dreieckstuch zu grauem Strickpulli vor Fachwerk"],
  ["rosemary-6.webp", "rosemary", "Cathrin im grauen Leinenkleid Rosemary mit weißem Langarmshirt"],
  ["muetze-1.webp", "muetze", "Rosa Rippmütze vor leuchtend rotem Herbstlaub"],
  ["kragen-frucht-6.webp", "kragen-frucht", "Cathrin mit dunklem Liberty-Wendekragen Forbidden Fruit"],
  ["lene-1.webp", "lene", "Leinenrock Lene in Natur mit Rattantasche und dunklem Oberteil"],
  ["stirnband-7.webp", "stirnband", "Schwarzes Stirnband in Cordoptik vor roter Efeuwand"],
  ["viola-rock-1.webp", "viola-rock", "Rock Viola aus geblümtem Vintage-Stoff mit weißem T-Shirt"],
  ["tuch-blumen-1.webp", "tuch-blumen", "Hellblaues Musselintuch mit Blumen über dunklem Pulli"],
  ["kragen-karo-4.webp", "kragen-karo", "Cathrin mit rot-weiß kariertem Wendekragen Holiday"],
  ["stulpen-4.webp", "stulpen", "Graue Walk-Stulpen mit Daumenloch über buntem Herbstlaub"],
];
function renderLooks() {
  const track = $("#looks-track");
  track.innerHTML = LOOKS.map(([file, id, alt], i) => {
    const p = productById(id);
    return `<li class="look">
      <a href="#produkt-${id}" data-product="${id}" draggable="false">
        <div class="look-media"><img src="${img(file)}" alt="${esc(alt)}" width="1050" height="1400" loading="${i < 3 ? "eager" : "lazy"}" decoding="async" draggable="false"><span class="look-view" aria-hidden="true">Ansehen</span></div>
        <div class="look-cap"><span class="look-no">Look ${pad2(i + 1)}</span><span class="look-name">${esc(p.name)}</span><span class="look-price">${fmtPrice(p.price, p.priceFrom)}</span></div>
      </a></li>`;
  }).join("");
  $("#looks-total").textContent = pad2(LOOKS.length);

  const bar = $("#looks-bar"), now = $("#looks-now"), prev = $("#looks-prev"), next = $("#looks-next");
  const items = $$(".look", track);
  const step = () => (items[1]?.offsetLeft ?? 0) - (items[0]?.offsetLeft ?? 0) || track.clientWidth * 0.8;
  const sync = () => {
    const max = track.scrollWidth - track.clientWidth;
    const r = max > 0 ? track.scrollLeft / max : 0;
    const vis = Math.min(1, track.clientWidth / track.scrollWidth);
    bar.style.width = `${vis * 100}%`;
    bar.style.transform = `translateX(${(r * (1 - vis) / vis) * 100}%)`;
    const idx = Math.min(items.length - 1, Math.round(track.scrollLeft / step()));
    now.textContent = pad2(idx + 1);
    prev.disabled = track.scrollLeft < 4;
    next.disabled = track.scrollLeft > max - 4;
  };
  track.addEventListener("scroll", () => requestAnimationFrame(sync), { passive: true });
  window.addEventListener("resize", sync);
  sync();
  const go = (dir) => track.scrollBy({ left: dir * step(), behavior: reduceMotion() ? "auto" : "smooth" });
  prev.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => go(1));
  track.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
  });

  // Ziehen mit der Maus (Touch scrollt nativ)
  let down = null, moved = false;
  track.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    down = { x: e.clientX, left: track.scrollLeft }; moved = false;
  });
  window.addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    if (!moved && Math.abs(dx) > 6) { moved = true; track.classList.add("is-dragging"); }
    if (moved) track.scrollLeft = down.left - dx;
  });
  window.addEventListener("pointerup", () => {
    if (!down) return;
    down = null;
    if (moved) {
      // auf nächsten Look einrasten
      const s = step(); const target = Math.round(track.scrollLeft / s) * s;
      track.classList.remove("is-dragging");
      track.scrollTo({ left: target, behavior: reduceMotion() ? "auto" : "smooth" });
      const block = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
      track.addEventListener("click", block, { capture: true, once: true });
      setTimeout(() => track.removeEventListener("click", block, { capture: true }), 50);
    }
  });
}

/* ------------------------------------------------------------------ Featured */
let featuredSig = null;
function renderFeatured(c) {
  // nur neu aufbauen, wenn sich die Auswahl geändert hat (sonst laufen die Bild-Reveals bei jeder Store-Änderung neu)
  const sig = JSON.stringify(c.featured || []);
  if (sig === featuredSig) return;
  featuredSig = sig;
  const list = (c.featured || []).map(productById).filter(Boolean);
  const el = $("#featured-list");
  const total = pad2(list.length);
  el.innerHTML = list.map((p, i) => {
    const second = altImage(p);
    const extra = p.images.filter((f) => f !== p.hero).slice(0, 3);
    return `<article class="feat" aria-labelledby="feat-${p.id}">
      <a class="feat-media" href="#produkt-${p.id}" data-product="${p.id}" data-reveal aria-label="${esc(p.name)} – Details und alle Bilder">
        <img src="${img(p.hero)}" alt="${esc(p.name)} – ${esc(p.subtitle)}" width="1050" height="1400" loading="lazy" decoding="async">
        ${p.isNew ? '<span class="feat-tag">Neu</span>' : p.unique ? '<span class="feat-tag">Einzelstück</span>' : ""}
      </a>
      <div class="feat-info">
        <div class="feat-in" data-reveal="text">
          <p class="feat-meta"><span class="feat-no">${pad2(i + 1)}<small>/ ${total}</small></span><span>${esc(catLabel(p.category))}</span></p>
          <h3 class="feat-name" id="feat-${p.id}">${esc(p.name)}</h3>
          <p class="feat-sub">${esc(p.subtitle)}</p>
          <p class="feat-short">${esc(p.short)}</p>
          <dl class="feat-facts">
            <div><dt>Preis</dt><dd class="price">${fmtPrice(p.price, p.priceFrom)}${p.freeShipping ? " · versandkostenfrei" : ""}</dd></div>
            <div><dt>Material</dt><dd>${esc(p.material || "–")}</dd></div>
            ${p.colors?.length ? `<div><dt>Farben</dt><dd>${esc(p.colors.join(", "))}</dd></div>` : ""}
          </dl>
          ${badgesHtml(p)}
          <div class="feat-ctas">
            <a class="btn btn--solid" href="${esc(p.url)}" target="_blank" rel="noopener">Auf Etsy ansehen <span aria-hidden="true">↗</span></a>
            <a class="btn btn--line" href="#produkt-${p.id}" data-product="${p.id}">Alle ${p.images.length} Bilder</a>
          </div>
          <div class="feat-detail" aria-label="Weitere Ansichten">
            ${extra.map((f, k) => `<button type="button" data-product="${p.id}" data-img="${k + 1}" aria-label="${esc(p.name)}: weitere Ansicht ${k + 2} öffnen"><img src="${img(f)}" alt="" width="84" height="105" loading="lazy" decoding="async"></button>`).join("")}
          </div>
        </div>
      </div>
    </article>`;
  }).join("");
  observeReveal(el);
}

/* ------------------------------------------------------------------ Katalog */
let activeCat = "alle";
function renderFilters() {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, PRODUCTS.filter((p) => p.category === c.id).length]));
  const chips = [{ id: "alle", label: "Alle", n: PRODUCTS.length }, ...CATEGORIES.map((c) => ({ ...c, n: counts[c.id] }))];
  const el = $("#filters");
  el.innerHTML = chips.map((c) => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${c.id === activeCat}">${esc(c.label)}<sup>${c.n}</sup></button>`).join("");
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-cat]");
    if (!b || b.dataset.cat === activeCat) return;
    activeCat = b.dataset.cat;
    $$(".chip", el).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderGrid();
  });
}
// Für die Kragen zeigt der Katalog zuerst das Flatlay, beim Hover das getragene Bild
const CARD_IMG = { "kragen-betsy": "kragen-betsy-1.webp", "kragen-frucht": "kragen-frucht-1.webp", "kragen-karo": "kragen-karo-1.webp" };
function renderGrid() {
  const list = PRODUCTS.filter((p) => activeCat === "alle" || p.category === activeCat);
  $("#cat-count").textContent = list.length;
  $("#catalog-grid").innerHTML = list.map((p, i) => `
    <li class="card" style="--i:${i}">
      <a href="#produkt-${p.id}" data-product="${p.id}">
        <div class="card-media">
          <img class="card-img" src="${img(CARD_IMG[p.id] || p.hero)}" alt="${esc(p.name)} – ${esc(p.subtitle)}" width="600" height="750" loading="lazy" decoding="async">
          <img class="card-img card-img--alt" src="${img(CARD_IMG[p.id] ? p.hero : altImage(p))}" alt="" width="600" height="750" loading="lazy" decoding="async">
          ${badgesHtml(p)}
        </div>
        <div class="card-head"><span class="card-no">${productNo(p.id)}</span><h3 class="card-name">${esc(p.name)}</h3><span class="card-price">${fmtPrice(p.price, p.priceFrom)}</span></div>
        <p class="card-sub">${esc(p.subtitle)}</p>
      </a>
    </li>`).join("") + (list.length ? NOTE_TILE : "") || `<li class="grid-empty">In dieser Kategorie ist gerade nichts da.</li>`;
  fitNoteTile();
}
// Abschluss-Kachel: füllt die letzte Rasterzeile, damit keine Lücke im Raster bleibt
const NOTE_TILE = `
    <li class="card-note">
      <p class="card-note-tag">Auf Maß &amp; nach Wunsch</p>
      <p class="card-note-title">Dein Stück ist <i>nicht</i> dabei?</p>
      <p class="card-note-text">Erzähl mir, welchen Stoff, welche Farbe oder Länge du dir wünschst. Vieles nähe ich dir gern auf Maß.</p>
      <p class="card-note-links">
        <a class="link-arrow" href="${SHOP.etsy}" target="_blank" rel="noopener">Nachricht über Etsy <span aria-hidden="true">↗</span></a>
        <a class="link-arrow" href="#anprobe">Anprobe anfragen <span aria-hidden="true">→</span></a>
      </p>
    </li>`;
function fitNoteTile() {
  const grid = $("#catalog-grid");
  const tile = $(".card-note", grid);
  if (!tile) return;
  const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
  const rest = (cols - ($$(".card", grid).length % cols)) % cols;
  const span = rest || cols;
  tile.style.gridColumn = `span ${span}`;
  tile.classList.toggle("is-wide", span > 1);
}

/* ------------------------------------------------------------------ Über mich */
function renderAbout(c) {
  $("#about-title").textContent = ABOUT.headline;
  $("#about-intro").textContent = (c.aboutIntro || "").trim() || ABOUT.intro;
  $("#about-facts").innerHTML = ABOUT.facts.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join("");
  $("#about-values").innerHTML = ABOUT.values.map((v, i) => `<li><span class="v-no">${pad2(i + 1)}</span><h3>${esc(v.title)}</h3><p>${esc(v.text)}</p></li>`).join("");
  $("#struppi-cap").innerHTML = `<small>Und das ist Struppi</small>${esc(ABOUT.dogCaption)}`;
}

/* ------------------------------------------------------------------ Bewertungen */
function renderReviews() {
  const list = [...REVIEWS].sort((a, b) => b.date.localeCompare(a.date));
  $("#review-list").innerHTML = list.map((r) => {
    const p = productById(r.product);
    return `<li class="review">
      <blockquote><p>${esc(r.text)}</p></blockquote>
      <p class="review-meta"><strong>${esc(r.name)}</strong><span>${formatDate(r.date, { day: "numeric", month: "long", year: "numeric" })}</span>${p ? `<a href="#produkt-${p.id}" data-product="${p.id}">${esc(p.name)}</a>` : ""}</p>
      ${r.reply ? `<p class="review-reply"><span>Antwort von Cathrin</span>${esc(r.reply)}</p>` : ""}
    </li>`;
  }).join("");
}

/* ------------------------------------------------------------------ Termine & Links */
function renderEvents(c) {
  const evs = upcomingEvents(8);
  $("#event-list").innerHTML = evs.length
    ? evs.map((e) => {
        const [y, m, d] = e.date.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        const mon = dt.toLocaleDateString("de-DE", { month: "short" }).replace(".", "");
        const wd = dt.toLocaleDateString("de-DE", { weekday: "long" });
        return `<li class="event">
          <time class="ev-date" datetime="${e.date}"><span class="ev-day">${pad2(d)}</span><span class="ev-mon">${esc(mon)} ${y}<span class="ev-wd">${esc(wd)}</span></span></time>
          <div class="ev-body">
            <h4>${esc(e.title)}</h4>
            <p class="ev-when">${[e.time ? `${esc(e.time)} Uhr` : "", esc(e.place || "")].filter(Boolean).join(" · ")}</p>
            ${e.note ? `<p class="ev-note">${esc(e.note)}</p>` : ""}
          </div></li>`;
      }).join("")
    : `<li class="empty">Gerade stehen keine Termine an. Neue Märkte und Atelier-Tage kündige ich hier und auf Instagram an.</li>`;

  const links = (c.links || []).filter((l) => l.visible !== false && l.url);
  $("#link-list").innerHTML = links.length
    ? links.map((l) => {
        const ext = /^https?:/i.test(l.url);
        return `<li class="${l.highlight ? "is-hl" : ""}"><a href="${esc(l.url)}"${ext ? ' target="_blank" rel="noopener"' : ""}>
          <span class="l-label">${esc(l.label)}</span>${l.note ? `<span class="l-note">${esc(l.note)}</span>` : ""}<span class="l-arrow" aria-hidden="true">${ext ? "↗" : "→"}</span></a></li>`;
      }).join("")
    : `<li class="empty">Hier erscheinen bald aktuelle Links.</li>`;
}

/* ------------------------------------------------------------------ FAQ */
function renderFaq() {
  $("#faq-list").innerHTML = FAQ.map((f, i) => `
    <details${i === 0 ? " open" : ""}>
      <summary><span class="q-no">${pad2(i + 1)}</span><span>${esc(f.q)}</span><span class="q-ic" aria-hidden="true"></span></summary>
      <p class="a">${esc(f.a)}</p>
    </details>`).join("");
}

/* ------------------------------------------------------------------ Karte (Zwei-Klick) */
function initMap() {
  $("#map-load").addEventListener("click", () => {
    const map = $("#map");
    map.innerHTML = `
      <iframe src="https://www.google.com/maps?q=Ramsen%2067305%20Pfalz&output=embed" title="Google-Karte: Ramsen, Pfalz" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
      <a class="map-open" href="https://www.google.com/maps/search/?api=1&query=Ramsen%2067305%20Pfalz" target="_blank" rel="noopener">In Google Maps öffnen ↗</a>`;
    $("iframe", map).focus();
  });
}

/* ------------------------------------------------------------------ Prototyp-Umschalter */
function initProto() {
  const t = $("#proto-toggle"), panel = $("#proto-panel");
  const SELF = "lookbook";
  $("#proto-list").innerHTML = VARIANTS.map((v) => v.slug === SELF
    ? `<li><a href="./" aria-current="page"><span>${pad2(v.n)}</span>${esc(v.name)} <em>· hier</em></a></li>`
    : `<li><a href="../${v.slug}/"><span>${pad2(v.n)}</span>${esc(v.name)}</a></li>`).join("");
  const set = (open) => { t.setAttribute("aria-expanded", String(open)); panel.hidden = !open; };
  t.addEventListener("click", () => set(panel.hidden));
  document.addEventListener("click", (e) => { if (!panel.hidden && !e.target.closest("#proto")) set(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { set(false); t.focus(); } });

  // Auf schmalen Bildschirmen beim Runterscrollen ausblenden, damit die Pille keine Inhalte verdeckt
  const proto = $("#proto");
  const small = matchMedia("(max-width: 760px)");
  let lastY = scrollY, ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY, dy = y - lastY;
      const atEnd = innerHeight + y >= document.documentElement.scrollHeight - 40;
      if (!small.matches || !panel.hidden || y < 80 || atEnd) proto.classList.remove("is-away");
      else if (Math.abs(dy) > 6) proto.classList.toggle("is-away", dy > 0);
      lastY = y; ticking = false;
    });
  }, { passive: true });
  proto.addEventListener("focusin", () => proto.classList.remove("is-away"));
}

/* ------------------------------------------------------------------ Reveal */
let revealIO = null;
function observeReveal(root = document) {
  const els = $$("[data-reveal]:not(.is-in)", root);
  if (reduceMotion() || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("is-in")); return; }
  revealIO ||= new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("is-in"); revealIO.unobserve(en.target); } });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
  els.forEach((e) => revealIO.observe(e));
}

/* ------------------------------------------------------------------ Start */
function renderLive(c) {
  renderBanner();
  renderStatus(c);
  renderFeatured(c);
  renderAbout(c);
  renderEvents(c);
  renderPlanner(c);
}

const content = getContent();
renderBanner();
initHeader();
renderStatus(content);
renderLooks();
renderFeatured(content);
renderFilters();
renderGrid();
renderAbout(content);
renderReviews();
renderEvents(content);
renderFaq();
initMap();
initProto();
initPlanner();
initProduct({ requestFitting: preselect });
observeReveal();
subscribe(renderLive);
window.addEventListener("resize", () => { setBannerHeight(); fitNoteTile(); });

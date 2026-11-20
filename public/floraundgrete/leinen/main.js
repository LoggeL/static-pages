// Flora & Grete · Entwurf 1 „Leinen & Licht“
import { SHOP, ABOUT, REVIEWS, FAQ, fmtPrice, productById, CATEGORIES } from "../shared/data.js";
import { getContent, subscribe, activeBanner, upcomingEvents, formatDate } from "../shared/store.js";
import { esc, img, badges, ICON, reduceMotion } from "./util.js";
import { initCatalog, initProductDialog } from "./product.js";
import { initPlanner, preselectProduct } from "./planner.js";
import { VARIANTS } from "../shared/variants.js";

document.documentElement.classList.add("js");

/* ---------- Banner ---------- */
const BANNER_KEY = "fg-leinen-banner-weg";
const bannerSig = (b) => `${b.tone}|${b.text}|${b.linkUrl || ""}`;
const TONE_TAG = { info: "Hinweis", warn: "Bitte beachten", closed: "Geschlossen", sale: "Aktion" };

function renderBanner() {
  const slot = document.getElementById("banner");
  const b = activeBanner();
  let dismissed = "";
  try { dismissed = sessionStorage.getItem(BANNER_KEY) || ""; } catch { /* privat */ }
  if (!b || dismissed === bannerSig(b)) { slot.innerHTML = ""; return; }
  const tone = TONE_TAG[b.tone] ? b.tone : "info";
  const link = b.linkUrl && b.linkLabel
    ? ` <a class="banner__link" href="${esc(b.linkUrl)}"${/^https?:/.test(b.linkUrl) ? ' target="_blank" rel="noopener"' : ""}>${esc(b.linkLabel)}${/^https?:/.test(b.linkUrl) ? ' <span aria-hidden="true">↗</span>' : ""}</a>`
    : "";
  slot.innerHTML = `
    <div class="banner banner--${tone}" role="region" aria-label="Hinweis">
      <div class="banner__inner wrap">
        <p class="banner__text"><span class="banner__tag">${TONE_TAG[tone]}</span>${esc(b.text)}${link}</p>
      </div>
      <button type="button" class="banner__close" aria-label="Hinweis ausblenden">${ICON.close}</button>
    </div>`;
  slot.querySelector(".banner__close").addEventListener("click", () => {
    try { sessionStorage.setItem(BANNER_KEY, bannerSig(b)); } catch { /* privat */ }
    slot.innerHTML = "";
    document.querySelector(".wordmark")?.focus();
  });
}

/* ---------- Kopf & Navigation ---------- */
function initHeader() {
  const head = document.getElementById("kopf");
  const nav = document.getElementById("hauptnavigation");
  const toggle = head.querySelector(".menu-toggle");
  const label = toggle.querySelector(".menu-toggle__label");
  const links = [...nav.querySelectorAll(".nav__list a")];

  const onScroll = () => head.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const setOpen = (open) => {
    if (open) nav.style.setProperty("--nav-top", `${Math.round(head.getBoundingClientRect().bottom)}px`);
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    label.textContent = open ? "Schließen" : "Menü";
    document.documentElement.style.overflow = open ? "hidden" : "";
    if (open) links[0].focus();
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  nav.addEventListener("click", (e) => { if (e.target.closest("a") && nav.classList.contains("is-open")) setOpen(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("is-open")) { setOpen(false); toggle.focus(); }
    if (e.key === "Tab" && nav.classList.contains("is-open")) {
      // Fokus im offenen Menü halten (Menü-Knopf + Links)
      const items = [toggle, ...nav.querySelectorAll("a")];
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); items.at(-1).focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    }
  });
  window.matchMedia("(min-width: 961px)").addEventListener("change", (m) => { if (m.matches) setOpen(false); });

  // Aktiven Abschnitt markieren
  const map = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      links.forEach((a) => a.removeAttribute("aria-current"));
      map.get(en.target.id)?.setAttribute("aria-current", "true");
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  ["kollektion", "katalog", "atelier", "stimmen", "termine", "anprobe", "besuch", "fragen"].forEach((id) => {
    const s = document.getElementById(id);
    if (s) io.observe(s);
  });
  // Katalog/Stimmen/Fragen: am Desktop (ohne diese Menüpunkte) zählen sie zum vorherigen Punkt
  const full = new Map(map);
  const wide = window.matchMedia("(min-width: 961px)");
  const syncMap = () => {
    map.clear(); full.forEach((v, k) => map.set(k, v));
    if (wide.matches) { map.set("katalog", full.get("kollektion")); map.set("stimmen", full.get("atelier")); map.set("fragen", full.get("besuch")); }
  };
  syncMap();
  wide.addEventListener("change", syncMap);
}

/* ---------- Kollektion: redaktionelle Doppelseiten ---------- */
const EDIT = {
  lene: {
    main: "lene-4.webp", pos: "50% 55%", alt: "Rock Lene aus naturfarbenem Karo-Leinen mit Blümchen-Top und Korbtasche",
    inset: "lene-2.webp", insetPos: "40% 50%", insetAlt: "Hand in der großen Seitentasche eines rosa karierten Lene-Rocks",
  },
  "viola-kleid": {
    main: "viola-kleid-4.webp", pos: "50% 30%", alt: "Kleid Viola aus mintgrüner Vintage-Bettwäsche mit Rüschensaum, vor grauer Wand",
    inset: "viola-kleid-6.webp", insetPos: "40% 50%", insetAlt: "Detail von Kleid Viola: Hand in der Seitentasche, Blumenmuster in Mint und Lila",
  },
  millie: {
    main: "millie-1.webp", pos: "50% 60%", alt: "Weinroter Musselinrock Millie mit Zierknopfleiste, kombiniert mit weißem T-Shirt",
    inset: "millie-3.webp", insetPos: "50% 50%", insetAlt: "Nahaufnahme: Gummibund und Seitentasche des weinroten Millie-Rocks",
  },
  rosemary: {
    main: "rosemary-6.webp", pos: "50% 35%", alt: "Cathrin trägt das graue Leinenkleid Rosemary über einem weißen Langarmshirt",
    inset: "rosemary-4.webp", insetPos: "50% 50%", insetAlt: "Detail von Kleid Rosemary: Saum mit Blümchen-Schrägband innen",
    note: "Hier trage ich Rosemary selbst.",
  },
  stulpen: {
    main: "stulpen-13.webp", pos: "50% 50%", alt: "Hände in dunkelgrauen Walk-Stulpen mit Daumenloch über buntem Herbstlaub",
    inset: "stulpen-11.webp", insetPos: "50% 50%", insetAlt: "Gestapelte Walk-Stulpen in Blau- und Brauntönen, mit Garn gebunden",
  },
  "kragen-frucht": {
    main: "kragen-frucht-2.webp", pos: "50% 60%", alt: "Wendekragen Forbidden Fruit mit dunklem Liberty-Blütendruck, flach gelegt neben einem Kiefernzweig",
    inset: "kragen-frucht-6.webp", insetPos: "70% 40%", insetAlt: "Cathrin trägt den Wendekragen Forbidden Fruit zu einem schwarzen Pulli",
  },
};
const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || "";
let lastFeatured = "";

function renderFeatured(content) {
  const ids = (content.featured || []).filter((id) => productById(id));
  const sig = ids.join(",");
  if (sig === lastFeatured) return;
  lastFeatured = sig;
  const el = document.getElementById("featured");
  if (!ids.length) { el.innerHTML = ""; return; }
  el.innerHTML = ids.map((id, i) => {
    const p = productById(id);
    const e = EDIT[id] || {};
    const main = e.main || p.hero;
    const inset = e.inset || p.images.find((f) => f !== main);
    const colors = p.colors?.length ? `<dt>Farben</dt><dd>${p.colors.map(esc).join(" · ")}</dd>` : "";
    const story = p.story ? `<blockquote class="spread__story"><p>${esc(p.story)}</p><footer>Cathrin</footer></blockquote>` : "";
    return `
    <article class="spread${i % 2 ? " spread--flip" : ""}" data-reveal aria-labelledby="sp-${p.id}">
      <div class="spread__media">
        <a class="spread__main frame" href="#produkt-${p.id}" data-product="${p.id}" aria-label="${esc(p.name)}: alle Fotos und Details">
          ${img(main, e.alt || `${p.name}, ${p.subtitle}`, { pos: e.pos })}
        </a>
        ${inset ? `<figure class="spread__inset frame frame--paper" data-parallax="-0.05">${img(inset, e.insetAlt || `${p.name}, Detail`, { pos: e.insetPos })}</figure>` : ""}
      </div>
      <div class="spread__text">
        <p class="spread__no"><b>Nº ${String(i + 1).padStart(2, "0")}</b><span class="eyebrow">${esc(catLabel(p.category))}</span></p>
        <h3 id="sp-${p.id}">${esc(p.name)}</h3>
        <p class="spread__sub">${esc(p.subtitle)}</p>
        <p class="spread__short">${esc(p.short)}${e.note ? ` ${esc(e.note)}` : ""}</p>
        ${story}
        <dl class="spread__meta"><dt>Material</dt><dd>${esc(p.material)}</dd>${colors}</dl>
        <div class="spread__buy"><span class="price">${esc(fmtPrice(p.price, p.priceFrom))}</span>${badges(p)}</div>
        <div class="spread__actions">
          <a class="btn btn--primary" href="${esc(p.url)}" target="_blank" rel="noopener">Auf Etsy ansehen <span aria-hidden="true">↗</span></a>
          <a class="btn btn--ghost" href="#produkt-${p.id}" data-product="${p.id}">Alle Fotos</a>
        </div>
      </div>
    </article>`;
  }).join("");
  observeReveal(el);
  collectParallax();
}

/* ---------- Über mich ---------- */
function renderAbout(content) {
  document.getElementById("about-intro").textContent = content.aboutIntro?.trim() || ABOUT.intro;
}
function renderAboutStatic() {
  document.getElementById("facts").innerHTML = ABOUT.facts.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join("");
  document.getElementById("values").innerHTML = ABOUT.values.map((v) => `<li><h3>${esc(v.title)}</h3><p>${esc(v.text)}</p></li>`).join("");
  const cap = ABOUT.dogCaption.replace(/^Struppi/, "");
  document.getElementById("dog-caption").innerHTML = `<b>Struppi</b>${esc(cap)}`;
}

/* ---------- Stimmen ---------- */
function renderReviews() {
  const sorted = [...REVIEWS];
  const leadIdx = sorted.reduce((best, r, i) => (r.text.length > sorted[best].text.length ? i : best), 0);
  const [lead] = sorted.splice(leadIdx, 1);
  const item = (r, isLead) => {
    const p = productById(r.product);
    const date = formatDate(r.date, { day: "numeric", month: "long", year: "numeric" });
    const reply = r.reply ? `<p class="review__reply"><span>Antwort von Cathrin</span>${esc(r.reply)}</p>` : "";
    const meta = `<figcaption class="review__meta">
        <b>${esc(r.name)}</b>
        <span><time datetime="${r.date}">${esc(date)}</time></span>
        ${p ? `<span>zu <button type="button" class="review__product" data-product="${p.id}">${esc(p.name)}</button></span>` : ""}
      </figcaption>`;
    if (isLead) return `<figure class="review review--lead" data-reveal>
        <p class="review__mark" aria-hidden="true">“</p>
        <div><blockquote><p>${esc(r.text)}</p></blockquote>${reply ? `<div class="review__lead-reply">${reply}</div>` : ""}</div>
        ${meta}
      </figure>`;
    return `<figure class="review" data-reveal><blockquote><p>${esc(r.text)}</p></blockquote>${meta}${reply}</figure>`;
  };
  document.getElementById("reviews").innerHTML = item(lead, true)
    + `<p class="reviews__hint" aria-hidden="true">Wisch zur Seite für mehr Stimmen →</p>`
    + `<div class="reviews__grid" role="region" aria-label="Weitere Bewertungen" tabindex="0">${sorted.map((r) => item(r, false)).join("")}</div>`;
}

/* ---------- Termine & Links ---------- */
function renderDates(content) {
  const events = upcomingEvents();
  const evEl = document.getElementById("events");
  evEl.innerHTML = events.length
    ? events.map((e) => {
        const [, , d] = e.date.split("-");
        const wd = formatDate(e.date, { weekday: "short" });
        const mon = formatDate(e.date, { month: "long" });
        const when = [formatDate(e.date, { weekday: "long", day: "numeric", month: "long" }), e.time ? `${e.time} Uhr` : ""].filter(Boolean).join(", ");
        return `<li class="event">
          <time class="event__date" datetime="${e.date}" aria-hidden="true"><span class="event__wd">${esc(wd)}</span><span class="event__day">${Number(d)}</span><span class="event__mon">${esc(mon)}</span></time>
          <div>
            <h4>${esc(e.title)}</h4>
            <p class="event__when">${esc(when)}${e.place ? ` · ${esc(e.place)}` : ""}</p>
            ${e.note ? `<p class="event__note">${esc(e.note)}</p>` : ""}
          </div>
        </li>`;
      }).join("")
    : `<li class="empty">Gerade stehen keine Termine an. Schau gern bald wieder vorbei oder folg mir auf Instagram.</li>`;

  const links = (content.links || []).filter((l) => l.visible !== false && l.url && l.label);
  document.getElementById("links").innerHTML = links.length
    ? links.map((l) => {
        const ext = /^https?:/.test(l.url);
        return `<li class="${l.highlight ? "is-highlight" : ""}"><a href="${esc(l.url)}"${ext ? ' target="_blank" rel="noopener"' : ""}>
          <span class="links__label">${esc(l.label)}</span>
          ${l.note ? `<span class="links__note">${esc(l.note)}</span>` : ""}
          <span class="links__arrow" aria-hidden="true">${ext ? "↗" : "→"}</span></a></li>`;
      }).join("")
    : `<li class="empty">Hier erscheinen bald aktuelle Links.</li>`;
}

/* ---------- Besuch ---------- */
const STATUS = {
  open: "Atelier geöffnet",
  appointment: "Besuch nach Termin",
  closed: "Atelier gerade geschlossen",
  vacation: "Ich bin im Urlaub",
};
function renderVisit(content) {
  const s = content.status || {};
  const mode = STATUS[s.mode] ? s.mode : "open";
  const hours = (s.hours || []).filter((h) => h.day || h.time);
  document.getElementById("visit-info").innerHTML = `
    <p class="eyebrow" style="margin-bottom:14px">Gerade</p>
    <p class="status status--${mode}"><span class="status__dot" aria-hidden="true"></span>${STATUS[mode]}</p>
    ${s.note ? `<p class="status__note">${esc(s.note)}</p>` : ""}
    ${hours.length ? `<dl class="hours">${hours.map((h) => `<div><dt>${esc(h.day)}</dt><dd>${esc(h.time)}</dd></div>`).join("")}</dl>` : ""}
    <div class="visit__contact">
      <address class="visit__address">Flora &amp; Grete · Atelier<br>67305 Ramsen, Pfalz<span>Die genaue Adresse bekommst du mit deiner Terminbestätigung.</span></address>
      <div class="visit__btns">
        <a class="btn btn--primary btn--small" href="${SHOP.etsy}" target="_blank" rel="noopener">Nachricht über Etsy <span aria-hidden="true">↗</span></a>
        <a class="btn btn--ghost btn--small" href="${SHOP.instagram}" target="_blank" rel="noopener">Instagram ${esc(SHOP.instagramHandle)}</a>
      </div>
    </div>`;
}

function initMap() {
  const btn = document.getElementById("map-load");
  btn.addEventListener("click", () => {
    const map = document.getElementById("map");
    map.innerHTML = `<iframe title="Karte: Ramsen (Pfalz) bei Google Maps" src="https://www.google.com/maps?q=Ramsen%2067305%20Pfalz&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`;
    map.querySelector("iframe").focus();
  });
}

/* ---------- FAQ ---------- */
function renderFaq() {
  document.getElementById("faq").innerHTML = FAQ.map((f) => `
    <details>
      <summary><span>${esc(f.q)}</span><span class="faq__icon" aria-hidden="true"></span></summary>
      <p class="faq__a">${esc(f.a)}</p>
    </details>`).join("");
}

/* ---------- Prototyp-Umschalter ---------- */
function initProto() {
  const wrap = document.querySelector(".proto");
  const btn = wrap.querySelector(".proto__toggle");
  const panel = document.getElementById("proto-panel");
  const SELF = "leinen";
  document.getElementById("proto-list").innerHTML = VARIANTS.map((v) =>
    `<li><a href="../${v.slug}/"${v.slug === SELF ? ' aria-current="page"' : ""}><span>${v.n}</span> ${esc(v.name)}</a></li>`).join("");
  const set = (open) => { panel.hidden = !open; btn.setAttribute("aria-expanded", String(open)); };
  btn.addEventListener("click", () => set(panel.hidden));
  document.addEventListener("click", (e) => { if (!panel.hidden && !wrap.contains(e.target)) set(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { set(false); btn.focus(); } });
  // Auf dem Handy beim Runterscrollen wegtauchen, beim Hochscrollen wieder zeigen
  // und nie über wichtigen Knöpfen liegen (Hero-Knöpfe, Absenden im Planer)
  const small = window.matchMedia("(max-width: 600px)");
  const AVOID = ".hero__actions, .form__submit, .success [data-again]";
  const coversButtons = () => {
    const band = window.innerHeight - 80;
    return [...document.querySelectorAll(AVOID)].some((el) => {
      const r = el.getBoundingClientRect();
      return r.height && r.bottom > band && r.top < window.innerHeight;
    });
  };
  let lastY = window.scrollY;
  let down = false;
  const sync = () => {
    const y = window.scrollY;
    if (Math.abs(y - lastY) > 4) { down = y > lastY; lastY = y; }
    const atEnd = y + window.innerHeight >= document.documentElement.scrollHeight - 40;
    const tuck = small.matches && panel.hidden && (coversButtons() || (down && y > 300 && !atEnd));
    wrap.classList.toggle("is-tucked", tuck);
  };
  window.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("resize", sync, { passive: true });
  small.addEventListener("change", sync);
  sync();
  document.fonts?.ready.then(sync);
  window.addEventListener("load", sync);
  wrap.addEventListener("focusin", () => wrap.classList.remove("is-tucked"));
}

/* ---------- Bewegung ---------- */
let revealIO = null;
function observeReveal(scope = document) {
  const els = scope.querySelectorAll("[data-reveal]:not(.is-in)");
  if (!revealIO) { els.forEach((el) => el.classList.add("is-in")); return; }
  els.forEach((el) => revealIO.observe(el));
}
function initReveal() {
  if (reduceMotion() || !("IntersectionObserver" in window)) return;
  revealIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("is-in"); revealIO.unobserve(en.target); }
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
}

let parallaxEls = [];
function collectParallax() { parallaxEls = [...document.querySelectorAll("[data-parallax]")]; }
function initParallax() {
  const mq = window.matchMedia("(min-width: 761px) and (prefers-reduced-motion: no-preference)");
  collectParallax();
  let ticking = false;
  const run = () => {
    ticking = false;
    const vh = window.innerHeight;
    for (const el of parallaxEls) {
      if (!mq.matches) { el.style.transform = ""; continue; }
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) continue;
      const delta = (r.top + r.height / 2 - vh / 2) * Number(el.dataset.parallax);
      el.style.transform = `translate3d(0, ${delta.toFixed(1)}px, 0)`;
    }
  };
  const req = () => { if (!ticking) { ticking = true; requestAnimationFrame(run); } };
  window.addEventListener("scroll", req, { passive: true });
  window.addEventListener("resize", req);
  mq.addEventListener("change", req);
  req();
}

/* ---------- Start ---------- */
function renderLive(content) {
  renderBanner();
  renderFeatured(content);
  renderAbout(content);
  renderDates(content);
  renderVisit(content);
}

initReveal();
initHeader();
renderAboutStatic();
renderReviews();
renderFaq();
initCatalog();
renderLive(getContent());
initPlanner();
initProductDialog({ onFittingRequest: preselectProduct });
initMap();
initProto();
observeReveal();
initParallax();
subscribe(renderLive);

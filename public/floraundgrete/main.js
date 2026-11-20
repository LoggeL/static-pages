// Cathrin Raasch Atelier – Website
import { ABOUT, CATEGORIES, PRODUCTS, REVIEWS, FAQ, fmtPrice, productById } from "./shared/data.js";
import { getContent, subscribe, activeBanner, upcomingEvents, formatDate } from "./shared/store.js";
import { $, $$, esc, pad2, src, imgTag, focus, catLabel, productNo, badgesHtml, reduceMotion, smooth } from "./util.js";
import { initProduct } from "./product.js";
import { initPlanner, renderPlanner, preselectProduct } from "./planner.js";

let content = getContent();
let filter = "alle";

/* ---------- Banner ---------- */
const BANNER_KEY = "fg-nacht-banner-weg";
function renderBanner() {
  const slot = $("#banner-slot");
  const b = activeBanner();
  let dismissed = "";
  try { dismissed = sessionStorage.getItem(BANNER_KEY) || ""; } catch { /* privat */ }
  if (!b || dismissed === b.text) { slot.innerHTML = ""; syncBannerH(); return; }
  const tone = ["info", "warn", "closed", "sale"].includes(b.tone) ? b.tone : "info";
  const label = { info: "Hinweis", warn: "Wichtig", closed: "Pause", sale: "Angebot" }[tone];
  const link = b.linkUrl && b.linkLabel
    ? ` <a href="${esc(b.linkUrl)}"${/^https?:/.test(b.linkUrl) ? ' target="_blank" rel="noopener"' : ""}>${esc(b.linkLabel)}${/^https?:/.test(b.linkUrl) ? ' <span class="ext" aria-hidden="true"></span>' : ""}</a>` : "";
  slot.innerHTML = `
    <div class="banner banner--${tone}" role="region" aria-label="${label}">
      <div class="banner__in">
        <span class="banner__tag">${label}</span>
        <p class="banner__text">${esc(b.text)}${link}</p>
        <button class="banner__x" type="button" aria-label="Hinweis ausblenden"><span aria-hidden="true">×</span></button>
      </div>
    </div>`;
  $(".banner__x", slot).addEventListener("click", () => {
    try { sessionStorage.setItem(BANNER_KEY, b.text); } catch { /* privat */ }
    slot.innerHTML = "";
    syncBannerH();
    $(".brand").focus();
  });
  syncBannerH();
}
// Hero füllt genau den Bildschirm unter dem Banner
function syncBannerH() {
  document.documentElement.style.setProperty("--banner-h", `${$("#banner-slot").offsetHeight}px`);
}
addEventListener("resize", syncBannerH, { passive: true });

/* ---------- Kopf, Menü ---------- */
function initHead() {
  const head = $("#head");
  const hero = $(".hero");
  let ticking = false;
  const solid = () => {
    ticking = false;
    head.classList.toggle("is-solid", scrollY > 12 || hero.getBoundingClientRect().bottom < head.offsetHeight + 24);
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(solid); } }, { passive: true });
  addEventListener("resize", solid, { passive: true });
  solid();

  const btn = $("#menu-btn");
  const menu = $("#menu");
  const set = (open) => {
    if (open) document.documentElement.style.setProperty("--menu-top", `${Math.max(0, head.getBoundingClientRect().bottom)}px`);
    btn.setAttribute("aria-expanded", String(open));
    menu.hidden = !open;
    document.documentElement.classList.toggle("menu-open", open);
    if (open) $("a", menu).focus();
  };
  btn.addEventListener("click", () => set(menu.hidden));
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
  document.addEventListener("keydown", (e) => {
    if (menu.hidden) return;
    if (e.key === "Escape") { set(false); btn.focus(); return; }
    // Fokus bleibt bei offenem Menü zwischen Menü-Knopf und Menüpunkten
    if (e.key === "Tab") {
      const f = [btn, ...$$("a[href], button", menu)];
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === f.length - 1 || i === -1)) { e.preventDefault(); f[0].focus(); }
    }
  });
  matchMedia("(min-width: 1080px)").addEventListener("change", (m) => { if (m.matches) set(false); });

  // aktiver Menüpunkt
  const links = $$(".nav a");
  const map = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const a = map.get(e.target.id);
      if (!e.isIntersecting) return;
      links.forEach((l) => l.removeAttribute("aria-current"));
      if (a) a.setAttribute("aria-current", "true");
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  [...map.keys(), "stimmen", "fragen"].forEach((id) => { const s = document.getElementById(id); s && spy.observe(s); });
  // über dem Hero ist noch kein Punkt aktiv
  new IntersectionObserver(([e]) => { if (e.isIntersecting) links.forEach((l) => l.removeAttribute("aria-current")); }, { rootMargin: "-45% 0px -50% 0px" }).observe(hero);
}

/* ---------- Entstehung: Scrollytelling ---------- */
function initStory() {
  const steps = $$(".story .step");
  const imgs = $$(".story__frame img");
  const now = $("#story-now");
  const set = (i) => {
    steps.forEach((s, k) => s.classList.toggle("is-on", k === i));
    imgs.forEach((im, k) => im.classList.toggle("is-on", k === i));
    now.textContent = pad2(i + 1);
    $(".story").style.setProperty("--progress", ((i + 1) / steps.length).toFixed(3));
  };
  // Bilder sofort laden, damit das Überblenden nicht flackert
  const warm = new IntersectionObserver(([e]) => { if (e.isIntersecting) { imgs.forEach((im) => (im.loading = "eager")); warm.disconnect(); } }, { rootMargin: "600px" });
  warm.observe($(".story"));
  // aktiver Schritt = letzter, dessen Oberkante die Lesezeile passiert hat (robust auch bei schnellem Scrollen)
  const narrow = matchMedia("(max-width: 760px)");
  let cur = -1, ticking = false;
  const pick = () => {
    ticking = false;
    const line = innerHeight * (narrow.matches ? 0.78 : 0.5);
    let i = 0;
    steps.forEach((s, k) => { if (s.getBoundingClientRect().top < line) i = k; });
    if (i !== cur) { cur = i; set(i); }
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(pick); } };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  pick();
}

/* ---------- Kollektion ---------- */
function renderFeatured() {
  const ids = (content.featured || []).filter((id) => productById(id)).slice(0, 3);
  const el = $("#featured");
  if (!ids.length) { el.innerHTML = ""; return; }
  const [first, ...rest] = ids.map(productById);
  const price = (p) => fmtPrice(p.price, p.priceFrom);
  el.innerHTML = `
    <article class="stage">
      <a class="stage__link" href="#produkt-${esc(first.id)}" data-product="${esc(first.id)}">
        <div class="stage__img glow">${imgTag(first.hero, `${first.name}: ${first.subtitle}`, { style: `object-position:${focus(first.hero)}` })}</div>
        <div class="stage__copy">
          <p class="kicker">Lieblingsstück <span aria-hidden="true">·</span> ${esc(catLabel(first.category))}</p>
          <h3 class="stage__name">${esc(first.name)}</h3>
          <p class="stage__sub">${esc(first.short)}</p>
          ${badgesHtml(first)}
          <p class="stage__foot"><span class="price">${price(first)}</span><span class="link-arrow">Ansehen</span></p>
        </div>
      </a>
    </article>
    ${rest.length ? `<div class="stills">${rest.map((p) => `
      <article class="still">
        <a class="still__link" href="#produkt-${esc(p.id)}" data-product="${esc(p.id)}">
          <div class="still__img glow">${imgTag(p.hero, `${p.name}: ${p.subtitle}`, { style: `object-position:${focus(p.hero)}` })}</div>
          <div class="still__copy">
            <p class="kicker">${esc(catLabel(p.category))}</p>
            <h3 class="still__name">${esc(p.name)}</h3>
            <p class="still__foot"><span class="price">${price(p)}</span><span class="still__sub">${esc(p.subtitle)}</span></p>
          </div>
        </a>
      </article>`).join("")}</div>` : ""}`;
}

function renderFilters() {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, PRODUCTS.filter((p) => p.category === c.id).length]));
  const all = [{ id: "alle", label: "Alle", n: PRODUCTS.length }, ...CATEGORIES.map((c) => ({ ...c, n: counts[c.id] }))];
  $("#filters").innerHTML = all.map((c) =>
    `<button type="button" class="filter" data-cat="${c.id}" aria-pressed="${c.id === filter}">${esc(c.label)}<sup>${c.n}</sup></button>`).join("");
}

function renderIndex() {
  const featured = new Set(content.featured || []);
  $("#index-list").innerHTML = PRODUCTS.map((p) => `
    <li class="row" data-cat="${p.category}">
      <a class="row__link" href="#produkt-${esc(p.id)}" data-product="${esc(p.id)}" data-peek="${esc(p.hero)}" data-pos="${focus(p.hero)}">
        <span class="row__no" aria-hidden="true">${productNo(p.id)}</span>
        ${imgTag(p.hero, "", { cls: "row__thumb", style: `object-position:${focus(p.hero)}` })}
        <span class="row__main">
          <span class="row__name">${esc(p.name)}</span>
          <span class="row__sub">${esc(p.subtitle)}${featured.has(p.id) ? '<span class="row__fav">Empfehlung</span>' : ""}</span>
          ${badgesHtml(p, "row__tags")}
        </span>
        <span class="row__cat">${esc(catLabel(p.category))}</span>
        <span class="row__price">${fmtPrice(p.price, p.priceFrom)}</span>
      </a>
    </li>`).join("");
  applyFilter(false);
}

function applyFilter(announce = true) {
  let n = 0;
  $$("#index-list .row").forEach((r) => {
    const show = filter === "alle" || r.dataset.cat === filter;
    r.hidden = !show;
    if (show) n++;
  });
  $$("#filters .filter").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cat === filter)));
  if (announce) {
    const label = filter === "alle" ? "insgesamt" : `in ${catLabel(filter)}`;
    $("#index-live").textContent = `${n} ${n === 1 ? "Stück" : "Stücke"} ${label}`;
  }
}

function initIndex() {
  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest(".filter");
    if (!b) return;
    filter = b.dataset.cat;
    applyFilter();
  });

  // Vorschaubild, das dem Mauszeiger folgt (nur Desktop mit Maus)
  const peek = $("#peek");
  const pimg = document.createElement("img");
  pimg.alt = ""; pimg.width = 420; pimg.height = 525; pimg.decoding = "async";
  const list = $("#index-list");
  const fine = matchMedia("(hover: hover) and (pointer: fine) and (min-width: 900px)");
  let x = 0, y = 0, tx = 0, ty = 0, raf = 0, active = null;
  const loop = () => {
    x += (tx - x) * (reduceMotion() ? 1 : 0.18);
    y += (ty - y) * (reduceMotion() ? 1 : 0.18);
    peek.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (Math.abs(tx - x) > 0.5 || Math.abs(ty - y) > 0.5) raf = requestAnimationFrame(loop); else raf = 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  const show = (a) => {
    if (active === a) return;
    active = a;
    const [w, h] = [a.dataset.peek, a.dataset.pos];
    pimg.src = src(w);
    if (!pimg.isConnected) peek.append(pimg);
    pimg.style.objectPosition = h;
    peek.classList.add("is-on");
    list.classList.add("is-peeking");
    $$(".row__link", list).forEach((l) => l.classList.toggle("is-hot", l === a));
  };
  const hide = () => {
    active = null;
    peek.classList.remove("is-on");
    list.classList.remove("is-peeking");
    $$(".row__link.is-hot", list).forEach((l) => l.classList.remove("is-hot"));
  };
  // Vorschau rechts neben dem Namen der Zeile, nie über Name oder Preis; folgt dem Zeiger nur senkrecht
  const place = (a, cy) => {
    const pw = peek.offsetWidth, ph = peek.offsetHeight;
    const name = $(".row__name", a).getBoundingClientRect();
    const price = $(".row__price", a).getBoundingClientRect();
    tx = Math.min(name.right + 48, price.left - pw - 32);
    ty = Math.max(84, Math.min(innerHeight - ph - 24, cy - ph / 2));
  };
  list.addEventListener("pointermove", (e) => {
    if (!fine.matches || e.pointerType !== "mouse") return;
    const a = e.target.closest(".row__link");
    if (!a) { hide(); return; }
    const first = !active;
    show(a);
    place(a, e.clientY);
    if (first) { x = tx; y = ty; }
    kick();
  });
  list.addEventListener("pointerleave", hide);
  list.addEventListener("focusin", (e) => {
    const a = e.target.closest(".row__link");
    if (!a || !fine.matches || !a.matches(":focus-visible")) return;
    const r = a.getBoundingClientRect();
    show(a);
    place(a, r.top + r.height / 2);
    x = tx; y = ty; kick();
  });
  list.addEventListener("focusout", (e) => { if (!list.contains(e.relatedTarget)) hide(); });
  addEventListener("scroll", () => { if (active && !active.matches(":focus-visible")) hide(); }, { passive: true });
}

/* ---------- Über mich ---------- */
function renderAbout() {
  $('[data-about="headline"]').textContent = ABOUT.headline;
  $('[data-about="intro"]').textContent = (content.aboutIntro || "").trim() || ABOUT.intro;
  $("#facts").innerHTML = ABOUT.facts.map((f) => `<div class="fact"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join("");
  $("#values").innerHTML = `<h3 class="visually-hidden">Was mir wichtig ist</h3><ul class="values__list">${ABOUT.values.map((v, i) => `
    <li class="value"><span class="value__no" aria-hidden="true">${pad2(i + 1)}</span><h4 class="value__title">${esc(v.title)}</h4><p>${esc(v.text)}</p></li>`).join("")}</ul>`;
  $("#dog-caption").textContent = ABOUT.dogCaption;
}

/* ---------- Stimmen ---------- */
function renderVoices() {
  const pick = ["Janne", "S.", "Daria", "Tanja"].map((n) => REVIEWS.find((r) => r.name === n)).filter(Boolean);
  const meta = (r) => {
    const p = productById(r.product);
    return `<footer class="voice__meta"><span class="voice__name">${esc(r.name)}</span> <span aria-hidden="true">·</span> <time datetime="${r.date}">${esc(formatDate(r.date, { day: "numeric", month: "long", year: "numeric" }))}</time>${p ? ` <span aria-hidden="true">·</span> <a href="#produkt-${esc(p.id)}" data-product="${esc(p.id)}">${esc(p.name)}</a>` : ""}</footer>`;
  };
  const reply = (r) => r.reply ? `<p class="voice__reply"><span>Cathrin antwortet</span> ${esc(r.reply)}</p>` : "";
  const [big, ...more] = pick;
  $("#voices").innerHTML = `
    <figure class="voice voice--big">
      <blockquote><p>${esc(big.text.trim())}</p></blockquote>
      <figcaption>${meta(big)}${reply(big)}</figcaption>
    </figure>
    <div class="voice__col">${more.map((r) => `
      <figure class="voice">
        <blockquote><p>${esc(r.text.trim())}</p></blockquote>
        <figcaption>${meta(r)}${reply(r)}</figcaption>
      </figure>`).join("")}</div>`;
}

/* ---------- Termine & Links ---------- */
function renderDates() {
  const ev = upcomingEvents(6);
  $("#events").innerHTML = ev.length ? ev.map((e) => {
    const [y, m, d] = e.date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return `<li class="event">
      <time class="event__date" datetime="${e.date}">
        <span class="event__day">${d}</span>
        <span class="event__mon">${esc(dt.toLocaleDateString("de-DE", { month: "short" }).replace(".", ""))}</span>
        <span class="event__wd">${esc(dt.toLocaleDateString("de-DE", { weekday: "long" }))}</span>
      </time>
      <div class="event__body">
        <h4 class="event__title">${esc(e.title)}</h4>
        <p class="event__where">${[e.time ? `${esc(e.time)} Uhr` : "", esc(e.place || "")].filter(Boolean).join(' <span aria-hidden="true">·</span> ')}</p>
        ${e.note ? `<p class="event__note">${esc(e.note)}</p>` : ""}
      </div>
    </li>`;
  }).join("") : `<li class="empty">Gerade stehen keine Termine an. Auf Instagram erfährst du als Erste, wenn ich wieder auf einem Markt bin.</li>`;

  const links = (content.links || []).filter((l) => l.visible !== false && l.url);
  $("#links").innerHTML = links.length ? links.map((l) => {
    const ext = /^https?:/.test(l.url);
    return `<li><a class="lnk${l.highlight ? " lnk--hi" : ""}" href="${esc(l.url)}"${ext ? ' target="_blank" rel="noopener"' : ""}>
      <span class="lnk__label">${esc(l.label)}</span>${l.note ? `<span class="lnk__note">${esc(l.note)}</span>` : ""}
      <span class="lnk__arrow" aria-hidden="true">${ext ? '<span class="ext"></span>' : "→"}</span></a></li>`;
  }).join("") : `<li class="empty">Gerade gibt es keine besonderen Links. Alles Neue findest du im Etsy-Shop.</li>`;
}

/* ---------- Atelier ---------- */
const MODES = {
  open: { label: "Atelier geöffnet", cls: "open" },
  appointment: { label: "Nur nach Termin", cls: "appointment" },
  closed: { label: "Gerade geschlossen", cls: "closed" },
  vacation: { label: "Im Urlaub", cls: "vacation" },
};
function renderStudio() {
  const s = content.status || {};
  const m = MODES[s.mode] || MODES.open;
  $("#status").innerHTML = `
    <p class="status__pill status__pill--${m.cls}"><span class="status__dot" aria-hidden="true"></span>${m.label}</p>
    ${s.note ? `<p class="status__note">${esc(s.note)}</p>` : ""}`;
  const hours = s.hours || [];
  $("#hours").innerHTML = hours.length
    ? hours.map((h) => `<div class="hours__row"><dt>${esc(h.day)}</dt><dd>${esc(h.time)}</dd></div>`).join("")
    : `<div class="hours__row"><dt>Zeiten</dt><dd>Nach Absprache</dd></div>`;
}

function initMap() {
  $("#map-load").addEventListener("click", () => {
    const ph = $("#map-ph");
    const frame = document.createElement("iframe");
    frame.src = "https://www.google.com/maps?q=Ramsen%2067305%20Pfalz&output=embed";
    frame.loading = "lazy";
    frame.referrerPolicy = "no-referrer-when-downgrade";
    frame.title = "Karte: Ramsen, 67305 Pfalz (Google Maps)";
    frame.className = "map__frame";
    frame.setAttribute("allowfullscreen", "");
    ph.replaceWith(frame);
    frame.focus();
  });
}

/* ---------- FAQ ---------- */
function renderFaq() {
  $("#faq").innerHTML = FAQ.map((f, i) => `
    <details class="qa" name="faq"${i === 0 ? " open" : ""}>
      <summary><span class="qa__q">${esc(f.q)}</span><span class="qa__icon" aria-hidden="true"></span></summary>
      <div class="qa__a"><p>${esc(f.a)}</p></div>
    </details>`).join("");
}

/* ---------- Anprobe-Fakten ---------- */
function renderFitFacts() {
  const f = content.fitting;
  const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const days = [...(f.weekdays || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WD[d]).join(", ");
  $("#fit-facts").innerHTML = `
    <div><dt>Wo</dt><dd>${esc(f.place || "Atelier in Ramsen")}</dd></div>
    <div><dt>Dauer</dt><dd>etwa ${esc(f.duration)} Minuten</dd></div>
    <div><dt>Wann</dt><dd>${f.enabled ? `meist ${esc(days)}, ab ${esc(f.leadDays)} Tagen im Voraus` : "gerade keine Termine"}</dd></div>`;
}

/* ---------- Sanftes Einblenden ---------- */
function initReveal() {
  if (reduceMotion() || !("IntersectionObserver" in window)) return;
  const els = $$(".h2, .lede, .stage, .still, .values, .dog, .voice, .events, .links, .fit__intro, .planner, .studio__grid, .faq__list, .about__portrait");
  els.forEach((el) => el.classList.add("rv"));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("rv-in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
  els.forEach((el) => io.observe(el));
}

/* ---------- Start ---------- */
function renderAll() {
  renderBanner();
  renderFeatured();
  renderIndex();
  renderAbout();
  renderDates();
  renderStudio();
  renderFitFacts();
}

renderAll();
renderFilters();
renderVoices();
renderFaq();
initHead();
initStory();
initIndex();
initMap();
initPlanner();
initProduct({
  onFitting(id) { preselectProduct(id); },
});
initReveal();

subscribe((c) => {
  content = c;
  renderAll();
  renderPlanner(c);
  // neu gerenderte Elemente sofort sichtbar
  $$(".stage, .still").forEach((el) => el.classList.add("rv-in"));
});

// In-Page-Links weich scrollen (respektiert reduzierte Bewegung)
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || a.matches("[data-product]") || a.getAttribute("href").startsWith("#produkt-")) return;
  const id = a.getAttribute("href").slice(1);
  const t = id ? document.getElementById(id) : null;
  if (!t) return;
  e.preventDefault();
  t.scrollIntoView({ behavior: smooth(), block: "start" });
  history.replaceState(null, "", `#${id}`);
  if (!t.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) t.setAttribute("tabindex", "-1");
  t.focus({ preventScroll: true });
});


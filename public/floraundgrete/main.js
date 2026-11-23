// Cathrin Raasch Atelier – Website
import { SHOP, ABOUT, REVIEWS, FAQ, productById } from "./shared/data.js";
import { getContent, subscribe, activeBanner, activePause, upcomingEvents, eventTypeLabel, eventRange, formatDate, courseItems, courseRule, courseSessions, TODAY } from "./shared/store.js";
import { $, $$, esc, pad2, reduceMotion, smooth } from "./util.js";
import { initPlanner, renderPlanner } from "./planner.js";
import { initLookbook, renderLookbook } from "./lookbook.js";

let content = getContent();

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
    const brand = $(".brand");
    brand.focus();
    if (document.activeElement !== brand) $("#hero-h").focus();
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
    const logo = $(".hero__logo");
    head.classList.toggle("show-brand", !logo || logo.getBoundingClientRect().top < head.offsetHeight);
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
  [...map.keys(), "feedback", "fragen"].forEach((id) => { const s = document.getElementById(id); s && spy.observe(s); });
  // über dem Hero ist noch kein Punkt aktiv
  new IntersectionObserver(([e]) => { if (e.isIntersecting) links.forEach((l) => l.removeAttribute("aria-current")); }, { rootMargin: "-45% 0px -50% 0px" }).observe(hero);
}

/* ---------- Über mich ---------- */
function renderAbout() {
  $('[data-about="headline"]').textContent = ABOUT.headline;
  $('[data-about="intro"]').textContent = (content.aboutIntro || "").trim() || ABOUT.intro;
  $("#facts").innerHTML = ABOUT.facts.map((f) => `<div class="fact"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join("");
  $("#dog-caption").textContent = ABOUT.dogCaption;
}

/* ---------- Kundenfeedback ---------- */
function renderVoices() {
  const pick = ["Janne", "S.", "Daria", "Tanja"].map((n) => REVIEWS.find((r) => r.name === n)).filter(Boolean);
  const meta = (r) => {
    const p = productById(r.product);
    return `<footer class="voice__meta"><span class="voice__name">${esc(r.name)}</span> <span aria-hidden="true">·</span> <time datetime="${r.date}">${esc(formatDate(r.date, { day: "numeric", month: "long", year: "numeric" }))}</time>${p ? ` <span aria-hidden="true">·</span> ${esc(p.name)}` : ""}</footer>`;
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
const MON = ["Jan", "Feb", "März", "Apr", "Mai", "Juni", "Juli", "Aug", "Sep", "Okt", "Nov", "Dez"];
const WD_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const parts = (isoStr) => {
  const [y, m, d] = isoStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return { y, m, d, wd: dt.getDay(), dt };
};
const longDate = (isoStr, year = true) =>
  formatDate(isoStr, year ? { weekday: "long", day: "numeric", month: "long", year: "numeric" } : { weekday: "long", day: "numeric", month: "long" });

function eventDateHtml(e) {
  const { from, to } = eventRange(e);
  const a = parts(from);
  if (from === to) {
    return `<div class="event__date">
        <span class="event__day" aria-hidden="true">${a.d}</span>
        <span class="event__mon" aria-hidden="true">${MON[a.m - 1]}</span>
        <span class="event__wd" aria-hidden="true">${esc(a.dt.toLocaleDateString("de-DE", { weekday: "long" }))}</span>
        <time class="visually-hidden" datetime="${from}">${esc(longDate(from))}</time>
      </div>`;
  }
  // mehrtägig: "27.–29. Nov" / "Fr – So", über den Monatswechsel "30.–2. Dez – Jan"
  const b = parts(to);
  const sameMonth = a.m === b.m && a.y === b.y;
  return `<div class="event__date event__date--range">
        <span class="event__day" aria-hidden="true">${a.d}.–${b.d}.</span>
        <span class="event__mon" aria-hidden="true">${sameMonth ? MON[a.m - 1] : `${MON[a.m - 1]} – ${MON[b.m - 1]}`}</span>
        <span class="event__wd" aria-hidden="true">${WD_SHORT[a.wd]} – ${WD_SHORT[b.wd]}</span>
        <span class="visually-hidden"><time datetime="${from}">${esc(longDate(from, a.y !== b.y))}</time> bis <time datetime="${to}">${esc(longDate(to))}</time></span>
      </div>`;
}

function renderDates() {
  const ev = upcomingEvents();
  $("#events").innerHTML = ev.length ? ev.map((e) => {
    const ext = /^https?:/.test(e.link || "");
    const where = [e.time ? (/\d\s*$/.test(e.time) && !/uhr/i.test(e.time) ? `${esc(e.time.trim())} Uhr` : esc(e.time.trim())) : "", esc(e.place || "")].filter(Boolean).join(' <span aria-hidden="true">·</span> ');
    return `<li class="event event--${esc(e.type || "sonstiges")}">
      ${eventDateHtml(e)}
      <div class="event__body">
        <p class="event__type">${esc(eventTypeLabel(e.type))}</p>
        <h4 class="event__title">${esc(e.title)}</h4>
        ${where ? `<p class="event__where">${where}</p>` : ""}
        ${e.note ? `<p class="event__note">${esc(e.note)}</p>` : ""}
        ${e.link ? `<p class="event__more"><a class="link-arrow" href="${esc(e.link)}"${ext ? ' target="_blank" rel="noopener"' : ""}>Mehr erfahren<span class="visually-hidden"> zu ${esc(e.title)}</span></a></p>` : ""}
      </div>
    </li>`;
  }).join("") : `<li class="empty">${courseItems().length
    ? "Gerade stehen keine Märkte oder besonderen Termine an – die festen Nähkurse findest du weiter unten."
    : "Gerade stehen keine Termine an."} Auf Instagram erfährst du als Erste, wenn ich wieder auf einem Markt bin.</li>`;

  const links = (content.links || []).filter((l) => l.visible !== false && l.url);
  $("#links").innerHTML = links.length ? links.map((l) => {
    const ext = /^https?:/.test(l.url);
    return `<li><a class="lnk${l.highlight ? " lnk--hi" : ""}" href="${esc(l.url)}"${ext ? ' target="_blank" rel="noopener"' : ""}>
      <span class="lnk__label">${esc(l.label)}</span>${l.note ? `<span class="lnk__note">${esc(l.note)}</span>` : ""}
      <span class="lnk__arrow" aria-hidden="true">${ext ? '<span class="ext"></span>' : "→"}</span></a></li>`;
  }).join("") : `<li class="empty">Gerade gibt es keine besonderen Links. Alles Neue findest du im Etsy-Shop.</li>`;
}

/* ---------- Feste Nähkurse ---------- */
// Uhrzeit wie bei den Terminen: "18–20" -> "18–20 Uhr"
const withUhr = (t = "") => {
  t = t.trim();
  return t && /\d\s*$/.test(t) && !/uhr/i.test(t) ? `${t}\u00a0Uhr` : t;
};
function renderCourses() {
  const box = $("#kurse");
  const list = courseItems();
  box.hidden = !list.length;
  if (!list.length) { $("#course-list").innerHTML = ""; $("#course-foot").innerHTML = ""; return; }
  $("#course-list").innerHTML = list.map((k) => {
    const time = withUhr(k.time);
    const rule = `${esc(courseRule(k))}${time ? ` <span aria-hidden="true">·</span> <span class="course__time">${esc(time)}</span>` : ""}`;
    // Ein Kurs kann aus mehreren Terminen bestehen (z. B. Führerschein: 2 Termine) – die gehören in ein Feld
    const groups = courseSessions(k, 2);
    const multi = (k.sessions || 1) > 1;
    const hid = `course-next-${esc(k.id)}`;
    const chip = (d) => { const p = parts(d); return `<time datetime="${d}"><span aria-hidden="true">${WD_SHORT[p.wd]}, ${p.d}. ${MON[p.m - 1]}</span><span class="visually-hidden">${esc(longDate(d, p.y !== parts(TODAY).y))}</span></time>`; };
    return `<li class="course">
      <h4 class="course__title">${esc(k.title)}</h4>
      ${k.subtitle ? `<p class="course__sub">${esc(k.subtitle)}</p>` : ""}
      <p class="course__rule">${rule}</p>
      ${k.price ? `<p class="course__price price">${esc(k.price)}</p>` : ""}
      ${k.audience ? `<p class="course__aud">${esc(k.audience)}</p>` : ""}
      ${k.note ? `<p class="course__note">${esc(k.note)}</p>` : ""}
      <div class="course__next">
        <p class="course__next-h" id="${hid}">${multi ? `Nächste Kurse <span class="course__next-sub">je ${k.sessions} Termine</span>` : "Nächste Termine"}</p>
        ${groups.length ? `<ul class="course__dates${multi ? " course__dates--multi" : ""}" aria-labelledby="${hid}">${groups.map((g) =>
          `<li>${g.map(chip).join('<span class="course__plus" aria-hidden="true">+</span><span class="visually-hidden"> und </span>')}</li>`).join("")}</ul>` : `<p class="course__none">Neue Termine folgen bald.</p>`}
      </div>
    </li>`;
  }).join("");
  const note = (content.courseNote || "").trim();
  $("#course-foot").innerHTML = `
    ${note ? `<p class="courses__note">${esc(note)}</p>` : ""}
    <div class="courses__signup">
      <p>Anmelden kannst du dich per Nachricht.</p>
      <a class="btn btn--brass" href="${esc(SHOP.instagram)}" target="_blank" rel="noopener">Nachricht auf Instagram <span class="ext" aria-hidden="true"></span><span class="visually-hidden"> (öffnet in neuem Tab)</span></a>
    </div>`;
}

/* ---------- Kontakt ---------- */
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

/* ---------- Auftragspause (Hero + Anprobe) ---------- */
function renderPause() {
  const p = activePause();
  const text = p ? p.text.trim() : "";
  // Oben im Hero nur der erste Satz, bei der Anprobe der ganze Text
  const first = (text.match(/^.+?[.!?](?=\s|$)/) || [text])[0];
  const hero = $("#hero-pause"), fit = $("#fit-pause");
  hero.hidden = fit.hidden = !p;
  hero.innerHTML = p ? `<span class="pause__tag">Auftragspause</span> ${esc(first)}${first.length < text.length ? ` <a href="#anprobe">Mehr</a>` : ""}` : "";
  fit.innerHTML = p ? `<span class="pause__tag">Auftragspause</span> ${esc(text)}` : "";
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
  const els = $$(".h2, .lede, .dog, .voice, .lb, .events, .links, .courses, .fit__intro, .planner, .studio__grid, .faq__list, .about__portrait");
  els.forEach((el) => el.classList.add("rv"));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("rv-in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
  els.forEach((el) => io.observe(el));
}

/* ---------- Kapitelnummern ---------- */
// Nummern laufen ohne Lücke, auch wenn eine Sektion (z. B. ein leeres Lookbook) ausgeblendet ist
function renumber() {
  let n = 0;
  $$("main > section").forEach((sec) => {
    const chap = $(".eyebrow .chap", sec);
    if (chap && !sec.hidden) chap.textContent = pad2(++n);
  });
  n = 0;
  $$("#menu li").forEach((li) => {
    const no = $("a > span", li);
    if (no && !li.hidden) no.textContent = pad2(++n);
  });
}

/* ---------- Start ---------- */
function renderAll() {
  renderBanner();
  renderLookbook();
  renumber();
  renderAbout();
  renderDates();
  renderCourses();
  renderFitFacts();
  renderPause();
}

renderAll();
renderVoices();
renderFaq();
initHead();
initMap();
initPlanner();
initLookbook();
initReveal();

subscribe((c) => {
  content = c;
  renderAll();
  renderPlanner(c);
});

// Alte Sprungmarken (Lesezeichen, Instagram-Bio, Suchmaschinen) auf die neuen Abschnitte umlenken
const OLD_HASH = { lookbook: "galerie", atelier: "kontakt", stimmen: "feedback", kollektion: "top", entstehung: "top" };
function redirectOldHash() {
  const id = location.hash.slice(1);
  const to = OLD_HASH[id] || (id.startsWith("produkt-") ? "top" : "");
  if (!to) return;
  history.replaceState(null, "", to === "top" ? location.pathname + location.search : `#${to}`);
  requestAnimationFrame(() => (to === "top" ? scrollTo(0, 0) : document.getElementById(to)?.scrollIntoView({ block: "start" })));
}
redirectOldHash();
addEventListener("hashchange", redirectOldHash);

// In-Page-Links weich scrollen (respektiert reduzierte Bewegung)
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const id = a.getAttribute("href").slice(1);
  const t = id ? document.getElementById(id) : null;
  if (!t) return;
  e.preventDefault();
  t.scrollIntoView({ behavior: smooth(), block: "start" });
  history.replaceState(null, "", `#${id}`);
  if (!t.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) t.setAttribute("tabindex", "-1");
  t.focus({ preventScroll: true });
});


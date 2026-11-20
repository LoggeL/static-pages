// Flora & Grete · Entwurf 4 „Schnittmuster“
import { SHOP, ABOUT, REVIEWS, FAQ, productById } from "../shared/data.js";
import { getContent, subscribe, activeBanner, upcomingEvents, formatDate } from "../shared/store.js";
import { VARIANTS } from "../shared/variants.js";
import { esc, ICON } from "./util.js";
import { renderFeatured, initCatalog, initProductDialog } from "./catalog.js";
import { initPlanner, preselectProduct, applyMeasurements } from "./planner.js";
import { initMeasure } from "./measure.js";

document.documentElement.classList.add("js");
const THIS = "schnittmuster";

/* ---------- Banner ---------- */
const BANNER_KEY = "fg-schnittmuster-banner-weg";
const bannerSig = (b) => `${b.tone}|${b.text}|${b.linkUrl || ""}`;
const TONE = { info: "Hinweis", warn: "Bitte beachten", closed: "Geschlossen", sale: "Aktion" };
const isExt = (u) => /^https?:/.test(u || "");
const EXT = '<svg class="i-ext" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 9 9 3M4.5 3H9v4.5"/></svg>';

function renderBanner() {
  const slot = document.getElementById("banner");
  const b = activeBanner();
  let dismissed = "";
  try { dismissed = sessionStorage.getItem(BANNER_KEY) || ""; } catch { /* privat */ }
  if (!b || dismissed === bannerSig(b)) { slot.innerHTML = ""; return; }
  const tone = TONE[b.tone] ? b.tone : "info";
  const link = b.linkUrl && b.linkLabel
    ? `<a class="banner__link" href="${esc(b.linkUrl)}"${isExt(b.linkUrl) ? ' target="_blank" rel="noopener"' : ""}>${esc(b.linkLabel)}${isExt(b.linkUrl) ? '<svg class="i-ext" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 9 9 3M4.5 3H9v4.5"/></svg>' : ""}</a>`
    : "";
  slot.innerHTML = `
    <div class="banner banner--${tone}" role="region" aria-label="Hinweis">
      <div class="banner__inner wrap">
        <p class="banner__tag mono">${TONE[tone]}</p>
        <p class="banner__text">${esc(b.text)} ${link}</p>
        <button type="button" class="banner__close" aria-label="Hinweis ausblenden">${ICON.close}</button>
      </div>
    </div>`;
  slot.querySelector(".banner__close").addEventListener("click", () => {
    try { sessionStorage.setItem(BANNER_KEY, bannerSig(b)); } catch { /* privat */ }
    slot.innerHTML = "";
    document.querySelector(".brand")?.focus();
  });
}

/* ---------- Kopf, Navigation, Maßband-Fortschritt ---------- */
function initHeader() {
  const head = document.getElementById("kopf");
  const nav = document.getElementById("hauptnavigation");
  const toggle = head.querySelector(".menu-toggle");
  const label = toggle.querySelector(".menu-toggle__label");
  const links = [...nav.querySelectorAll(".nav__list a")];
  const fill = head.querySelector(".tape__fill");

  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    fill.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    head.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  onScroll();

  const setOpen = (open) => {
    if (open) nav.style.setProperty("--nav-top", `${Math.round(head.getBoundingClientRect().bottom)}px`);
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    label.textContent = open ? "Schließen" : "Menü";
    document.documentElement.classList.toggle("is-locked", open);
    if (open) links[0].focus();
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  nav.addEventListener("click", (e) => { if (e.target.closest("a") && nav.classList.contains("is-open")) setOpen(false); });
  document.addEventListener("keydown", (e) => {
    if (!nav.classList.contains("is-open")) return;
    if (e.key === "Escape") { setOpen(false); toggle.focus(); }
    if (e.key === "Tab") {
      const items = [toggle, ...nav.querySelectorAll("a")];
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); items.at(-1).focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    }
  });
  window.matchMedia("(min-width: 1081px)").addEventListener("change", (m) => { if (m.matches) setOpen(false); });

  // Aktiven Abschnitt markieren (Abschnitte ohne eigenen Menüpunkt zählen zum vorherigen)
  const owner = { kollektion: "kollektion", katalog: "katalog", "ueber-mich": "ueber-mich", stimmen: "ueber-mich", termine: "termine", masse: "anprobe", anprobe: "anprobe", atelier: "atelier", fragen: "atelier" };
  const map = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      links.forEach((a) => a.removeAttribute("aria-current"));
      map.get(owner[en.target.id])?.setAttribute("aria-current", "true");
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  Object.keys(owner).forEach((id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  const top = document.getElementById("top");
  new IntersectionObserver(([en]) => { if (en.isIntersecting) links.forEach((a) => a.removeAttribute("aria-current")); }, { rootMargin: "-45% 0px -50% 0px" }).observe(top);
}

/* ---------- Über mich ---------- */
function renderAbout(content) {
  document.getElementById("about-intro").textContent = content.aboutIntro?.trim() || ABOUT.intro;
}
function renderAboutStatic() {
  document.getElementById("about-title").textContent = ABOUT.headline;
  document.getElementById("facts").innerHTML = ABOUT.facts.map((f, i) =>
    `<div><dt><span class="mono">${String(i + 1).padStart(2, "0")}</span>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join("");
  document.getElementById("values").innerHTML = ABOUT.values.map((v, i) =>
    `<li><p class="mono values__no">Merkmal ${String.fromCharCode(65 + i)}</p><h3>${esc(v.title)}</h3><p>${esc(v.text)}</p></li>`).join("");
  const [name, ...rest] = ABOUT.dogCaption.split(/,\s*/);
  document.getElementById("dog-caption").innerHTML = `<b>${esc(name)}</b>${esc(rest.join(", "))}`;
}

/* ---------- Stimmen ---------- */
function renderReviews() {
  const pick = ["janne", "s.", "daria", "tanja", "monika", "lisa"];
  const list = pick.map((n) => REVIEWS.find((r) => r.name.toLowerCase() === n)).filter(Boolean);
  document.getElementById("reviews").innerHTML = list.map((r, i) => {
    const p = productById(r.product);
    const date = formatDate(r.date, { day: "numeric", month: "long", year: "numeric" });
    return `<figure class="review">
      <p class="review__head mono"><span>Nr. ${String(i + 1).padStart(2, "0")}</span>${p ? `<button type="button" class="review__product" data-product="${p.id}">${esc(p.name)}</button>` : ""}</p>
      <blockquote><p>${esc(r.text.trim())}</p></blockquote>
      <figcaption><b>${esc(r.name)}</b><time datetime="${r.date}">${esc(date)}</time></figcaption>
      ${r.reply ? `<p class="review__reply"><span class="mono">Antwort von Cathrin</span>${esc(r.reply)}</p>` : ""}
    </figure>`;
  }).join("");
}

/* ---------- Termine & Links ---------- */
function renderDates(content) {
  const events = upcomingEvents();
  document.getElementById("events").innerHTML = events.length
    ? events.map((e) => {
        const [, m, d] = e.date.split("-");
        const wd = formatDate(e.date, { weekday: "short" }).replace(".", "");
        const when = [formatDate(e.date, { weekday: "long", day: "numeric", month: "long" }), e.time ? `${e.time} Uhr` : ""].filter(Boolean).join(", ");
        return `<li class="event">
          <time class="event__date" datetime="${e.date}"><span class="mono">${esc(wd)}</span><b>${d}.${m}.</b></time>
          <div class="event__body">
            <h4>${esc(e.title)}</h4>
            <p class="event__when mono">${esc(when)}${e.place ? ` · ${esc(e.place)}` : ""}</p>
            ${e.note ? `<p class="event__note">${esc(e.note)}</p>` : ""}
          </div>
        </li>`;
      }).join("")
    : `<li class="empty">Gerade stehen keine Termine an. Schau gern bald wieder vorbei oder folg mir auf Instagram.</li>`;

  const links = (content.links || []).filter((l) => l.visible !== false && l.url && l.label);
  document.getElementById("links").innerHTML = links.length
    ? links.map((l) => `<li class="${l.highlight ? "is-highlight" : ""}"><a href="${esc(l.url)}"${isExt(l.url) ? ' target="_blank" rel="noopener"' : ""}>
          ${l.highlight ? '<span class="links__flag mono">Aktuell</span>' : ""}
          <span class="links__label">${esc(l.label)}</span>
          ${l.note ? `<span class="links__note">${esc(l.note)}</span>` : ""}
          <span class="links__arrow" aria-hidden="true">${isExt(l.url) ? EXT : "→"}</span></a></li>`).join("")
    : `<li class="empty">Hier erscheinen bald aktuelle Links.</li>`;
}

/* ---------- Atelier ---------- */
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
    <div class="status status--${mode}">
      <p class="mono status__k">Gerade</p>
      <p class="status__label"><span class="status__dot" aria-hidden="true"></span>${STATUS[mode]}</p>
      ${s.note ? `<p class="status__note">${esc(s.note)}</p>` : ""}
    </div>
    ${hours.length ? `<table class="hours"><caption class="mono">Zeiten</caption><tbody>${hours.map((h) => `<tr><th scope="row">${esc(h.day)}</th><td>${esc(h.time)}</td></tr>`).join("")}</tbody></table>` : ""}
    <address class="addr">
      <span class="mono">Anschrift</span>
      Flora &amp; Grete · Atelier<br>67305 Ramsen, Pfalz
      <small>Die genaue Adresse bekommst du mit deiner Terminbestätigung.</small>
    </address>
    <div class="row">
      <a class="btn btn--ink btn--small" href="${SHOP.etsy}" target="_blank" rel="noopener">Nachricht über Etsy<svg class="i-ext" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 9 9 3M4.5 3H9v4.5"/></svg></a>
      <a class="btn btn--line btn--small" href="${SHOP.instagram}" target="_blank" rel="noopener">Instagram ${esc(SHOP.instagramHandle)}</a>
    </div>`;
}

function initMap() {
  document.getElementById("map-load").addEventListener("click", () => {
    const map = document.getElementById("map");
    map.innerHTML = `<iframe title="Karte: Ramsen (Pfalz) bei Google Maps" src="https://www.google.com/maps?q=Ramsen%2067305%20Pfalz&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`;
    map.classList.add("is-loaded");
    map.querySelector("iframe").focus();
  });
}

/* ---------- FAQ ---------- */
function renderFaq() {
  document.getElementById("faq").innerHTML = FAQ.map((f, i) => `
    <details>
      <summary><span class="mono faq__no">F.${String(i + 1).padStart(2, "0")}</span><span class="faq__q">${esc(f.q)}</span><span class="faq__icon" aria-hidden="true"></span></summary>
      <p class="faq__a">${esc(f.a)}</p>
    </details>`).join("");
}

/* ---------- Prototyp-Umschalter ---------- */
function initProto() {
  const wrap = document.querySelector(".proto");
  const btn = wrap.querySelector(".proto__toggle");
  const panel = document.getElementById("proto-panel");
  document.getElementById("proto-list").innerHTML = VARIANTS.map((v) =>
    `<li><a href="../${v.slug}/"${v.slug === THIS ? ' aria-current="page"' : ""}><span class="mono">${v.n}</span><b>${esc(v.name)}</b><small>${esc(v.short)}</small></a></li>`).join("");
  const set = (open) => { panel.hidden = !open; btn.setAttribute("aria-expanded", String(open)); wrap.classList.remove("is-tucked"); };
  btn.addEventListener("click", () => set(panel.hidden));
  document.addEventListener("click", (e) => { if (!panel.hidden && !wrap.contains(e.target)) set(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { set(false); btn.focus(); } });

  // Auf dem Handy beim Runterscrollen wegtauchen und nie über wichtigen Knöpfen liegen
  const small = window.matchMedia("(max-width: 1080px)");
  const AVOID = ".hero__actions, .form__submit, .receipt [data-again], .slip [data-apply], .piece__actions";
  const coversButtons = () => {
    const band = window.innerHeight - 76;
    return [...document.querySelectorAll(AVOID)].some((el) => {
      const r = el.getBoundingClientRect();
      return r.height && r.bottom > band && r.top < window.innerHeight;
    });
  };
  let lastY = window.scrollY, down = false;
  const sync = () => {
    const y = window.scrollY;
    if (Math.abs(y - lastY) > 4) { down = y > lastY; lastY = y; }
    const atEnd = y + window.innerHeight >= document.documentElement.scrollHeight - 40;
    wrap.classList.toggle("is-tucked", small.matches && panel.hidden && (coversButtons() || (down && y > 300 && !atEnd)));
  };
  window.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("resize", sync, { passive: true });
  window.addEventListener("load", sync);
  wrap.addEventListener("focusin", () => wrap.classList.remove("is-tucked"));
  sync();
}

/* ---------- Start ---------- */
function renderLive(content) {
  renderBanner();
  renderFeatured(content);
  renderAbout(content);
  renderDates(content);
  renderVisit(content);
}

initHeader();
renderAboutStatic();
renderReviews();
renderFaq();
initCatalog();
renderLive(getContent());
initMeasure({ apply: applyMeasurements });
initPlanner();
initProductDialog({ onFittingRequest: preselectProduct });
initMap();
initProto();
subscribe(renderLive);

// Anprobe: Anfragen beantworten + Planer einstellen
import { TODAY, formatDate, openSlots, setBookingStatus, deleteBooking, requestFitting, WEEKDAYS } from "../../../shared/store.js";
import { PRODUCTS, productById, SHOP } from "../../../shared/data.js";
import { h, icon, btn, iconBtn, card, toggle, field, sectionHeader, emptyState, firstName, plural, fid } from "../ui.js";
import { pad, isoOf, addDays, dayMonth, relDay } from "./common.js";

let tab = "anfragen"; // 'anfragen' | 'planer'
let calMonth = null; // 'YYYY-MM'

const addMin = (hhmm, min) => { const [hh, mm] = hhmm.split(":").map(Number); const t = hh * 60 + mm + min; return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`; };
const longDate = (d) => formatDate(d, { weekday: "long", day: "numeric", month: "long" });

// ---------- E-Mail-Vorlagen ----------
function mailto(b, kind, c) {
  const name = firstName(b.name);
  const end = addMin(b.start, c.fitting.duration);
  const product = productById(b.product);
  let subject, body;
  if (kind === "confirm") {
    subject = `Deine Anprobe bei Cathrin Raasch am ${formatDate(b.date)}`;
    body = `Hallo ${name},\n\nwie schön, dass du zur Anprobe kommst! Hiermit bestätige ich dir deinen Termin:\n\n${longDate(b.date)}, ${b.start}–${end} Uhr\n${c.fitting.place}\n${product ? `\nWir schauen uns ${product.name} gemeinsam an.\n` : ""}\nFalls dir etwas dazwischenkommt, sag mir einfach kurz Bescheid.\n\nIch freu mich auf dich!\nHerzliche Grüße\nCathrin Raasch\nAtelier in Ramsen`;
  } else {
    const alt = openSlots().flatMap((d) => d.slots.filter((s) => s.free).map((s) => ({ date: d.date, start: s.start })))
      .filter((s) => !(s.date === b.date && s.start === b.start)).slice(0, 3);
    subject = "Deine Anprobe-Anfrage bei Cathrin Raasch";
    body = `Hallo ${name},\n\ndanke für deine Anfrage! Am ${longDate(b.date)} um ${b.start} Uhr klappt es bei mir leider nicht.\n\n` +
      (alt.length ? `Wie wäre es mit einem dieser Termine?\n\n${alt.map((s) => `– ${longDate(s.date)}, ${s.start} Uhr`).join("\n")}\n\nSag mir einfach, welcher dir passt, dann trage ich dich ein.` : "Schreib mir gern, wann es dir sonst passt – wir finden bestimmt etwas.") +
      `\n\nHerzliche Grüße\nCathrin Raasch\nAtelier in Ramsen`;
  }
  return `mailto:${encodeURIComponent(b.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ---------- Anfragen ----------
function renderRequests(ctx) {
  const c = ctx.content;
  const all = c.fitting.bookings.slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const groups = [
    { id: "angefragt", title: "Neu", sub: "Warten auf deine Antwort", items: all.filter((b) => b.status === "angefragt") },
    { id: "bestaetigt", title: "Bestätigt", sub: "Diese Termine stehen", items: all.filter((b) => b.status === "bestaetigt") },
    { id: "abgelehnt", title: "Abgelehnt", sub: "Werden im Kalender wieder frei", items: all.filter((b) => b.status === "abgelehnt") },
  ];

  const setStatus = (b, status, msg) => {
    const before = b.status;
    ctx.run(() => setBookingStatus(b.id, status));
    ctx.toast(msg, { undo: () => { ctx.run(() => setBookingStatus(b.id, before)); ctx.rerender(); } });
    ctx.rerender();
    document.querySelector(`[data-key="bk-mail-${b.id}"]`)?.focus();
  };
  const remove = (b) => {
    const idx = ctx.content.fitting.bookings.findIndex((x) => x.id === b.id);
    ctx.run(() => deleteBooking(b.id));
    ctx.toast(`Anfrage von ${firstName(b.name)} gelöscht`, { undo: () => { ctx.save((d) => { d.fitting.bookings.splice(Math.max(0, idx), 0, b); }); ctx.rerender(); } });
    ctx.rerender();
  };

  const bookingCard = (b) => {
    const p = productById(b.product);
    const past = b.date < TODAY;
    const rel = relDay(b.date);
    const end = addMin(b.start, c.fitting.duration);
    const actions = [];
    if (b.status === "angefragt") {
      actions.push(btn("Bestätigen", { icon: "check", variant: "primary", attrs: { "data-key": `bk-ok-${b.id}`, "aria-label": `Anfrage von ${b.name} bestätigen` }, onClick: () => setStatus(b, "bestaetigt", `Termin mit ${firstName(b.name)} bestätigt – schick ihr jetzt noch die E-Mail.`) }));
      actions.push(btn("Ablehnen", { icon: "x", attrs: { "aria-label": `Anfrage von ${b.name} ablehnen` }, onClick: () => setStatus(b, "abgelehnt", `Anfrage von ${firstName(b.name)} abgelehnt – schlag ihr gern einen anderen Termin vor.`) }));
    } else if (b.status === "bestaetigt") {
      actions.push(b.email ? h("a", { class: "btn btn-primary", href: mailto(b, "confirm", c), "data-key": `bk-mail-${b.id}` }, icon("mail"), h("span", {}, "Bestätigung per E-Mail")) : null);
      actions.push(btn("Absagen", { icon: "x", attrs: { "aria-label": `Termin mit ${b.name} absagen` }, onClick: () => setStatus(b, "abgelehnt", `Termin mit ${firstName(b.name)} abgesagt.`) }));
    } else {
      actions.push(b.email ? h("a", { class: "btn btn-primary", href: mailto(b, "alt", c), "data-key": `bk-mail-${b.id}` }, icon("mail"), h("span", {}, "Anderen Termin vorschlagen")) : null);
      actions.push(btn("Doch bestätigen", { icon: "check", onClick: () => setStatus(b, "bestaetigt", `Termin mit ${firstName(b.name)} doch bestätigt.`) }));
    }
    const mails = b.status === "angefragt" && b.email ? h("div", { class: "bk-mails" },
      h("p", { class: "bk-mails-label" }, `Antworten per E-Mail an ${firstName(b.name) || "sie"}:`),
      h("div", { class: "row" },
        h("a", { class: "btn btn-sm", href: mailto(b, "confirm", c), "data-key": `bk-mail-${b.id}` }, icon("mail"), h("span", {}, "Zusage schreiben")),
        h("a", { class: "btn btn-sm", href: mailto(b, "alt", c) }, icon("mail"), h("span", {}, "Anderen Termin vorschlagen")))) : null;

    return h("li", { class: `bk bk-${b.status}` + (past ? " is-past" : "") },
      h("div", { class: "bk-head" },
        h("h3", { class: "bk-name" }, b.name || "Ohne Namen"),
        past ? h("span", { class: "tag tag-muted" }, "vorbei") : rel ? h("span", { class: "tag tag-rose" }, rel) : null),
      h("p", { class: "bk-when" }, icon("calendar", "ico-sm"), h("span", {}, h("strong", {}, longDate(b.date)), " · ", h("span", { class: "nowrap" }, `${b.start}–${end} Uhr`))),
      p ? h("a", { class: "bk-product", href: p.url, target: "_blank", rel: "noopener" },
        h("img", { src: `../img/${p.hero}`, alt: "", width: 56, height: 56, loading: "lazy" }),
        h("span", {}, h("span", { class: "muted small" }, "Möchte anprobieren"), h("strong", {}, p.name)), h("span", { class: "sr-only" }, " (Etsy, neuer Tab)")) : null,
      b.note ? h("blockquote", { class: "bk-note" }, b.note) : null,
      h("p", { class: "bk-contact" },
        b.email ? h("a", { href: `mailto:${b.email}` }, icon("mail", "ico-xs"), b.email) : null,
        b.phone ? h("a", { href: `tel:${b.phone.replace(/[^\d+]/g, "")}` }, icon("phone", "ico-xs"), b.phone) : null),
      mails,
      h("div", { class: "ev-actions" }, actions, iconBtn("trash", `Anfrage von ${b.name} löschen`, () => remove(b), { cls: "icon-btn-danger push" })));
  };

  const groupEl = (g) => {
    const list = h("ul", { class: "bk-list" }, g.items.map(bookingCard));
    if (g.id === "abgelehnt") {
      if (!g.items.length) return null;
      return h("details", { class: "past" }, h("summary", {}, icon("chevronRight", "ico-sm summary-chev"), h("span", {}, `${g.title} (${g.items.length})`)), list);
    }
    return h("section", { class: "bk-group", "aria-labelledby": "grp-" + g.id },
      h("h2", { id: "grp-" + g.id, class: "list-title" }, g.title, " ", h("span", { class: "count" + (g.id === "angefragt" && g.items.length ? " count-rose" : "") }, g.items.length), h("span", { class: "list-sub" }, g.sub)),
      g.items.length ? list : h("p", { class: "muted empty-line" }, g.id === "angefragt" ? "Alles beantwortet. Schön!" : "Noch keine bestätigten Termine."));
  };

  const demo = card("Ausprobieren", { icon: "sparkle", cls: "card-soft", sub: "So kommt eine Anfrage an, wenn jemand auf deiner Website einen Termin anfragt." },
    btn("Test-Anfrage erzeugen", { icon: "plus", onClick: () => {
      const free = openSlots().flatMap((d) => d.slots.filter((s) => s.free).map((s) => ({ date: d.date, start: s.start })));
      if (!free.length) { ctx.toast("Gerade ist kein Termin frei – schau in den Planer-Einstellungen."); return; }
      const names = [["Mia S.", "mia"], ["Hanna W.", "hanna"], ["Paula R.", "paula"], ["Ida F.", "ida"], ["Greta L.", "greta"]];
      const [name, mail] = names[Math.floor(Math.random() * names.length)];
      const prod = ["lene", "millie", "rosemary", "viola-kleid"][Math.floor(Math.random() * 4)];
      const slot = free[Math.floor(Math.random() * Math.min(free.length, 6))];
      ctx.run(() => requestFitting({ ...slot, name, email: `${mail}@example.de`, product: prod, note: "Ich würde gern die Länge besprechen." }));
      ctx.toast(`Neue Test-Anfrage von ${name}`);
      ctx.rerender();
    } }));

  return h("div", { class: "stack" }, ...groups.map(groupEl), demo);
}

// ---------- Planer ----------
function renderPlanner(ctx) {
  const c = ctx.content;
  const f = c.fitting;
  const save = (fn, rerender = true) => { ctx.save((d) => fn(d.fitting)); if (rerender) ctx.rerender(); };

  const onCard = card("", { cls: "card-switch" },
    toggle({ label: "Anprobe-Termine auf der Website anbieten", key: "fit-enabled", checked: f.enabled,
      hint: f.enabled ? "Kundinnen können freie Zeiten sehen und anfragen. Du bestätigst jede Anfrage selbst." : "Ausgeschaltet: Auf der Website steht dann nur „Schreib mir für einen Termin“.",
      onChange: (v) => save((x) => { x.enabled = v; }) }));

  // Wochentage
  const order = [1, 2, 3, 4, 5, 6, 0];
  const dayRow = (wd) => {
    const on = f.weekdays.includes(wd);
    const times = (f.times[wd] || []).slice().sort();
    const last = times[times.length - 1];
    const tId = fid("time");
    const timeInput = h("input", { type: "time", id: tId, value: last ? addMin(last, f.duration) : "16:00", step: 300, "data-key": `fit-newtime-${wd}` });
    const add = () => {
      const v = timeInput.value;
      if (!/^\d\d:\d\d$/.test(v)) { timeInput.focus(); return; }
      if (times.includes(v)) { ctx.toast(`${v} Uhr gibt es am ${WEEKDAYS[wd]} schon.`); return; }
      save((x) => { x.times[wd] = [...(x.times[wd] || []), v].sort(); if (!x.weekdays.includes(wd)) x.weekdays.push(wd); });
      document.querySelector(`[data-key="fit-newtime-${wd}"]`)?.focus();
    };
    timeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    return h("li", { class: "wd-row" + (on ? " is-on" : "") },
      toggle({ label: WEEKDAYS[wd], key: `fit-wd-${wd}`, checked: on, hint: on ? plural(times.length, "Uhrzeit", "Uhrzeiten") : "keine Anprobe",
        onChange: (v) => save((x) => { x.weekdays = v ? [...new Set([...x.weekdays, wd])] : x.weekdays.filter((d) => d !== wd); if (v && !(x.times[wd] || []).length) x.times[wd] = ["16:00"]; }) }),
      on ? h("div", { class: "wd-times" },
        h("ul", { class: "time-chips", "aria-label": `Startzeiten am ${WEEKDAYS[wd]}` }, times.length ? times.map((t) => h("li", { class: "time-chip" },
          h("span", {}, t), iconBtn("x", `${t} Uhr am ${WEEKDAYS[wd]} entfernen`, () => {
            save((x) => { x.times[wd] = (x.times[wd] || []).filter((y) => y !== t); });
            ctx.toast(`${t} Uhr entfernt`, { undo: () => { save((x) => { x.times[wd] = [...(x.times[wd] || []), t].sort(); }); } });
          }, { cls: "chip-x", attrs: { "data-key": `fit-rm-${wd}-${t}` } }))) : h("li", { class: "muted small" }, "Noch keine Uhrzeit – füg eine hinzu.")),
        h("div", { class: "time-add" },
          h("label", { for: tId, class: "sr-only" }, `Neue Startzeit am ${WEEKDAYS[wd]}`),
          timeInput, btn("Uhrzeit dazu", { icon: "plus", small: true, onClick: add, attrs: { "aria-label": `Startzeit am ${WEEKDAYS[wd]} hinzufügen` } }))) : null);
  };
  const daysCard = card("Wochentage & Uhrzeiten", { icon: "clock", sub: "An welchen Tagen und um wie viel Uhr kann man zu dir kommen? Die Uhrzeit ist jeweils der Beginn." },
    h("ul", { class: "wd-list" }, order.map(dayRow)));

  // Dauer, Vorlauf, Zeitraum
  const stepper = (label, value, min, max, unit, keyName, hint) => {
    const id = fid("step");
    return h("div", { class: "field" },
      h("div", { class: "field-head" }, h("label", { for: id }, label)),
      hint ? h("p", { class: "field-hint" }, hint) : null,
      h("div", { class: "stepper" },
        iconBtn("minus", `${label}: weniger`, () => save((x) => { x[keyName] = Math.max(min, x[keyName] - 1); }), { disabled: value <= min, cls: "step-minus", attrs: { "data-key": `fit-${keyName}-minus` } }),
        h("output", { id, class: "step-val", "aria-live": "polite" }, h("strong", {}, value), " ", value === 1 ? unit[0] : unit[1]),
        iconBtn("plus", `${label}: mehr`, () => save((x) => { x[keyName] = Math.min(max, x[keyName] + 1); }), { disabled: value >= max, cls: "step-plus", attrs: { "data-key": `fit-${keyName}-plus` } })));
  };
  const durSel = field({ label: "Wie lange dauert eine Anprobe?", type: "select", value: f.duration, key: "fit-duration",
    options: [30, 45, 60, 75, 90].map((m) => ({ value: m, label: `${m} Minuten` })), onChange: (v) => save((x) => { x.duration = Number(v); }) });
  const horSel = field({ label: "Wie weit im Voraus buchbar?", type: "select", value: f.horizonDays, key: "fit-horizon",
    options: [7, 14, 21, 28, 42, 56, 84].map((d) => ({ value: d, label: d === 7 ? "1 Woche" : `${d / 7} Wochen` })), onChange: (v) => save((x) => { x.horizonDays = Number(v); }) });
  const rulesCard = card("Dauer & Vorlauf", { icon: "calendar" },
    h("div", { class: "form-grid" }, durSel, horSel),
    stepper("Frühestens buchbar in", f.leadDays, 0, 14, ["Tag", "Tagen"], "leadDays", "So hast du Zeit, dich auf die Anprobe vorzubereiten. 0 = schon heute."));

  const placeField = field({ label: "Wo findet die Anprobe statt?", type: "text", value: f.place, key: "fit-place", hint: "Steht auf der Website und in deiner Bestätigungs-E-Mail.",
    onInput: (v) => ctx.save((d) => { d.fitting.place = v; }) });
  const placeCard = card("Ort", { icon: "pin" }, placeField);

  // Kalender: gesperrte Tage
  if (!calMonth) calMonth = TODAY.slice(0, 7);
  const [cy, cm] = calMonth.split("-").map(Number);
  const first = new Date(cy, cm - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // Montag zuerst
  const daysIn = new Date(cy, cm, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(h("span", { class: "cal-empty", "aria-hidden": "true" }));
  for (let d = 1; d <= daysIn; d++) {
    const iso = isoOf(new Date(cy, cm - 1, d));
    const wd = new Date(cy, cm - 1, d).getDay();
    const blocked = f.blocked.includes(iso);
    const isPast = iso < TODAY;
    const fitDay = f.weekdays.includes(wd) && (f.times[wd] || []).length;
    const booked = f.bookings.filter((b) => b.date === iso && b.status !== "abgelehnt").length;
    const state = blocked ? "gesperrt" : fitDay ? "Anprobe möglich" : "kein Anprobetag";
    cells.push(h("button", { type: "button", class: "cal-day" + (blocked ? " is-blocked" : "") + (fitDay ? " is-fit" : "") + (iso === TODAY ? " is-today" : "") + (booked ? " has-booking" : ""),
      disabled: isPast, "aria-pressed": String(blocked), "data-key": `cal-${iso}`,
      "aria-label": `${formatDate(iso, { weekday: "long", day: "numeric", month: "long" })}: ${state}${booked ? `, ${booked} Termin${booked > 1 ? "e" : ""}` : ""}`,
      onClick: () => {
        save((x) => { x.blocked = blocked ? x.blocked.filter((y) => y !== iso) : [...x.blocked, iso].sort(); });
        if (!blocked && booked) ctx.toast(`Achtung: Am ${dayMonth(iso)} hast du schon ${booked === 1 ? "einen Termin" : booked + " Termine"}.`);
      } }, h("span", {}, d)));
  }
  const monthName = first.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const shift = (n) => { const dt = new Date(cy, cm - 1 + n, 1); calMonth = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`; ctx.rerender(); document.querySelector(`[data-key="cal-${n < 0 ? "prev" : "next"}"]`)?.focus(); };
  const futureBlocked = f.blocked.filter((d) => d >= TODAY).sort();
  const calCard = card("Freie Tage sperren", { icon: "lock", sub: "Urlaub, Markt oder einfach mal frei? Tipp auf einen Tag, um ihn zu sperren. Nochmal tippen gibt ihn wieder frei." },
    h("div", { class: "cal" },
      h("div", { class: "cal-head" },
        iconBtn("chevronLeft", "Vorheriger Monat", () => shift(-1), { disabled: calMonth <= TODAY.slice(0, 7), attrs: { "data-key": "cal-prev" } }),
        h("h3", { class: "cal-title", "aria-live": "polite" }, monthName),
        iconBtn("chevronRight", "Nächster Monat", () => shift(1), { attrs: { "data-key": "cal-next" } })),
      h("div", { class: "cal-grid cal-wds", "aria-hidden": "true" }, ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((x) => h("span", {}, x))),
      h("div", { class: "cal-grid", role: "group", "aria-label": `Tage im ${monthName}` }, cells),
      h("ul", { class: "cal-legend", "aria-label": "Legende" },
        h("li", {}, h("i", { class: "lg lg-fit" }), "Anprobe möglich"),
        h("li", {}, h("i", { class: "lg lg-blocked" }), "gesperrt"),
        h("li", {}, h("i", { class: "lg lg-booked" }), "schon ein Termin"))),
    futureBlocked.length ? h("div", { class: "blocked-list" }, h("p", { class: "small strong" }, "Gesperrt:"),
      h("ul", { class: "time-chips" }, futureBlocked.map((d) => h("li", { class: "time-chip chip-rose" }, h("span", {}, formatDate(d)),
        iconBtn("x", `${formatDate(d, { weekday: "long", day: "numeric", month: "long" })} wieder freigeben`, () => save((x) => { x.blocked = x.blocked.filter((y) => y !== d); }), { cls: "chip-x" }))))) : null);

  // Vorschau
  const slots = openSlots().filter((d) => d.slots.some((s) => s.free)).slice(0, 5);
  const preview = card("Nächste freie Termine", { icon: "eye", sub: "So sehen Kundinnen es auf deiner Website." },
    !f.enabled ? emptyState("eyeOff", "Planer ist ausgeschaltet", "Schalte ihn oben ein, damit Termine angezeigt werden.")
      : slots.length ? h("ul", { class: "slot-days" }, slots.map((d) => h("li", {},
        h("p", { class: "slot-date" }, formatDate(d.date, { weekday: "long", day: "numeric", month: "long" })),
        h("ul", { class: "slot-chips" }, d.slots.map((s) => h("li", { class: "slot" + (s.free ? "" : " is-taken") }, s.start, s.free ? null : h("span", { class: "sr-only" }, " (vergeben)")))))))
        : emptyState("calendar", "Gerade keine freien Termine", "Füge Wochentage oder Uhrzeiten hinzu oder gib gesperrte Tage frei."));

  return h("div", { class: "split" },
    h("div", { class: "split-main stack" }, onCard, daysCard, rulesCard, calCard, placeCard),
    h("aside", { class: "split-side" }, h("div", { class: "sticky" }, preview)));
}

export default function renderAnprobe(ctx) {
  const sub = ctx.sub;
  if (sub === "planer" || sub === "anfragen") { tab = sub; ctx.consumeSub(); }
  const c = ctx.content;
  const n = c.fitting.bookings.filter((b) => b.status === "angefragt").length;
  const tabBtn = (id, label, ic, badge) => h("button", { type: "button", role: "tab", id: "tab-" + id, "aria-selected": String(tab === id), "aria-controls": "anprobe-panel", class: "seg" + (tab === id ? " is-active" : ""), tabindex: tab === id ? "0" : "-1", "data-key": "tab-" + id,
    onClick: () => { tab = id; ctx.rerender(); document.getElementById("tab-" + id)?.focus(); },
    onKeydown: (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { tab = tab === "anfragen" ? "planer" : "anfragen"; ctx.rerender(); document.getElementById("tab-" + tab)?.focus(); } } },
    icon(ic), h("span", {}, label), badge ? h("span", { class: "badge badge-inline" }, badge) : null);
  return h("div", { class: "stack" },
    sectionHeader("Anprobe", "Kundinnen fragen auf deiner Website einen Termin an – du bestätigst oder schlägst einen anderen vor."),
    h("div", { class: "segmented", role: "tablist", "aria-label": "Anprobe-Bereich" },
      tabBtn("anfragen", "Anfragen", "mail", n), tabBtn("planer", "Planer", "gear")),
    h("div", { id: "anprobe-panel", role: "tabpanel", "aria-labelledby": "tab-" + tab }, tab === "anfragen" ? renderRequests(ctx) : renderPlanner(ctx)));
}

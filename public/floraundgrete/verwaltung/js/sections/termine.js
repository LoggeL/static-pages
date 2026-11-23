// Termine: Märkte, Nähkurse, offenes Atelier und Sonstiges
import { TODAY, formatDate, uid, EVENT_TYPES, eventRange } from "../../../shared/store.js";
import { h, icon, btn, iconBtn, sectionHeader, emptyState, openForm } from "../ui.js";
import { relDay, addDays, typeName, typeTag, TYPE_ICONS, eventDateText, dateParts, isRunning } from "./common.js";

const FIELDS = [
  { name: "type", label: "Was für ein Termin?", type: "choice", default: "markt",
    options: EVENT_TYPES.map((t) => ({ value: t.id, label: typeName(t.id), icon: TYPE_ICONS[t.id] })),
    hint: "An Markt- und Nähkurstagen gibt es automatisch keine Anproben und keine festen Kurse." },
  { name: "title", label: "Name", type: "text", required: true, placeholder: "z. B. Blaues Wunder", requiredMsg: "Bitte gib dem Termin einen Namen." },
  { name: "date", label: "Datum (erster Tag)", type: "date", required: true, requiredMsg: "Bitte wähle ein Datum." },
  { name: "until", label: "Bis einschließlich", type: "date", hint: "Nur bei mehreren Tagen, z. B. Freitag bis Sonntag. Sonst leer lassen." },
  { name: "place", label: "Ort", type: "text", placeholder: "z. B. Lorsch" },
  { name: "time", label: "Uhrzeit", type: "text", placeholder: "z. B. 11:00–18:00", hint: "Darf leer bleiben, z. B. wenn du die Zeiten noch nicht weißt." },
  { name: "note", label: "Kurze Notiz", type: "textarea", rows: 2, placeholder: "z. B. Weihnachtsmarkt" },
  { name: "link", label: "Link zu mehr Infos", type: "url", placeholder: "https://…", hint: "z. B. die Seite des Markts oder die Anmeldung zum Nähkurs." },
  { name: "visible", label: "Auf der Website zeigen", type: "switch", default: true, hint: "Ausgeschaltet bleibt der Termin nur hier in deiner Liste." },
];

const FILTERS = [
  { id: "alle", label: "Alle" },
  { id: "markt", label: "Märkte" },
  { id: "kurs", label: "Nähkurse" },
];
let filter = "alle";

const dayDiff = (a, b) => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
};

export default function renderTermine(ctx) {
  const all = ctx.content.events.slice().sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const shown = filter === "alle" ? all : all.filter((e) => e.type === filter);
  const upcoming = shown.filter((e) => eventRange(e).to >= TODAY);
  const past = shown.filter((e) => eventRange(e).to < TODAY).reverse();

  const openEditor = (ev, mode) => {
    const dlg = openForm({
      title: mode === "new" ? "Neuer Termin" : mode === "copy" ? "Termin kopieren" : "Termin bearbeiten",
      intro: mode === "copy" ? "Alles ist schon ausgefüllt – ändere einfach das Datum." : null,
      fields: FIELDS, values: ev || { type: filter === "alle" ? "markt" : filter, date: "", visible: true },
      submitLabel: mode === "edit" ? "Änderungen speichern" : "Termin speichern",
      validate: (v) => ({ until: v.until && v.date && v.until < v.date ? "Der letzte Tag liegt vor dem ersten. Bitte prüf die beiden Daten." : "" }),
      onSave: (v) => {
        if (!v.until || v.until <= v.date) v.until = "";
        if (mode === "edit") ctx.save((d) => { const e = d.events.find((x) => x.id === ev.id); if (e) Object.assign(e, v); });
        else { const id = uid(); ctx.save((d) => { d.events.push({ id, ...v }); }); }
        ctx.toast(mode === "edit" ? "Termin gespeichert" : `${typeName(v.type)} am ${eventDateText(v)} eingetragen`);
        ctx.rerender();
      },
    });
    // „Bis“ kann nicht vor dem ersten Tag liegen
    const from = dlg.querySelector('input[name="date"]');
    const until = dlg.querySelector('input[name="until"]');
    const sync = () => { until.min = from.value || ""; };
    from.addEventListener("change", sync);
    sync();
  };

  const remove = (ev) => {
    const idx = ctx.content.events.findIndex((x) => x.id === ev.id);
    ctx.save((d) => { d.events = d.events.filter((x) => x.id !== ev.id); });
    ctx.toast(`„${ev.title}“ gelöscht`, { undo: () => { ctx.save((d) => { d.events.splice(Math.max(0, idx), 0, ev); }); ctx.rerender(); } });
    ctx.rerender();
  };

  const toggleVisible = (ev) => {
    ctx.save((d) => { const e = d.events.find((x) => x.id === ev.id); if (e) e.visible = e.visible === false; });
    ctx.rerender();
  };

  // Kopie eine Woche später, Dauer bleibt gleich
  const copyOf = (ev) => {
    const date = addDays(ev.date < TODAY ? TODAY : ev.date, 7);
    const len = ev.until && ev.until > ev.date ? dayDiff(ev.date, ev.until) : 0;
    return { ...ev, date, until: len ? addDays(date, len) : "" };
  };

  const item = (ev, isPast) => {
    const hidden = ev.visible === false;
    const p = dateParts(ev);
    const running = !isPast && p.multi && isRunning(ev);
    const rel = running ? "läuft gerade" : isPast ? "" : relDay(ev.date);
    return h("li", { class: "ev" + (hidden ? " is-hidden" : "") + (isPast ? " is-past" : "") + (running ? " is-running" : "") },
      h("div", { class: "ev-date" + (p.multi ? " is-range" : ""), "aria-hidden": "true" },
        h("span", { class: "ev-wd" }, p.wd),
        h("strong", {}, p.day),
        h("span", {}, p.month)),
      h("div", { class: "ev-body" },
        h("p", { class: "ev-tags" }, typeTag(ev.type),
          rel ? h("span", { class: "tag tag-rose" }, rel) : null,
          hidden ? h("span", { class: "tag tag-muted" }, icon("eyeOff", "ico-xs"), "versteckt") : null),
        h("h3", { class: "ev-title" }, ev.title),
        h("p", { class: "ev-meta" },
          h("span", { class: "sr-only" }, eventDateText(ev, { long: true }) + ". "),
          p.multi ? h("span", { "aria-hidden": "true" }, icon("calendar", "ico-xs"), eventDateText(ev)) : null,
          ev.time ? h("span", {}, icon("clock", "ico-xs"), ev.time) : null,
          ev.place ? h("span", {}, icon("pin", "ico-xs"), ev.place) : null),
        ev.note ? h("p", { class: "ev-note" }, ev.note) : null,
        ev.link ? h("a", { class: "lk-url", href: ev.link.startsWith("#") ? "../" + ev.link : ev.link, target: "_blank", rel: "noopener" }, icon("link", "ico-xs"), "Link zu mehr Infos", h("span", { class: "sr-only" }, ` (${ev.title}, öffnet neuen Tab)`)) : null),
      h("div", { class: "ev-actions" },
        btn("Bearbeiten", { icon: "edit", small: true, attrs: { "data-key": "ev-edit-" + ev.id, "aria-label": `${ev.title} bearbeiten` }, onClick: () => openEditor(ev, "edit") }),
        btn("Kopieren", { icon: "copy", small: true, variant: "ghost", attrs: { "data-key": "ev-copy-" + ev.id, "aria-label": `${ev.title} kopieren` }, onClick: () => openEditor(copyOf(ev), "copy") }),
        hidden ? btn("Wieder zeigen", { icon: "eye", small: true, variant: "ghost", attrs: { "data-key": "ev-vis-" + ev.id, "aria-label": `${ev.title} wieder auf der Website zeigen` }, onClick: () => toggleVisible(ev) }) : null,
        iconBtn("trash", `${ev.title} löschen`, () => remove(ev), { cls: "icon-btn-danger push" })));
  };

  const addBtn = btn("Neuer Termin", { icon: "plus", variant: "primary", attrs: { "data-key": "ev-add" }, onClick: () => openEditor(null, "new") });

  // Schnellfilter
  const countOf = (id) => all.filter((e) => (id === "alle" || e.type === id) && eventRange(e).to >= TODAY).length;
  const filterBar = h("div", { class: "filter-chips", role: "group", "aria-label": "Termine filtern" },
    FILTERS.map((f) => h("button", { type: "button", class: "filter-chip" + (filter === f.id ? " is-active" : ""), "aria-pressed": String(filter === f.id), "data-key": "ev-filter-" + f.id,
      onClick: () => { filter = f.id; ctx.rerender(); } },
      h("span", {}, f.label), h("span", { class: "filter-count" }, h("span", { class: "sr-only" }, ", "), countOf(f.id), h("span", { class: "sr-only" }, " kommende")))));

  const which = FILTERS.find((f) => f.id === filter);
  const emptyTitle = filter === "alle" ? "Noch keine kommenden Termine" : `Keine kommenden ${which.label}`;

  const view = h("div", { class: "stack" },
    sectionHeader("Termine", "Märkte, Nähkurse und offenes Atelier. Kommende Termine erscheinen auf deiner Website.", addBtn),
    h("p", { class: "note note-info" }, icon("info"), h("span", {},
      "An Markt- und Nähkurstagen sperrt die Website automatisch die Anprobe und lässt die festen Kurse ausfallen.")),
    h("a", { href: "#kurse", class: "text-link small self-start" }, icon("clock", "ico-sm"), "Deine festen Kurse bearbeitest du unter „Feste Kurse“"),
    filterBar,
    upcoming.length
      ? h("section", { "aria-labelledby": "ev-up" }, h("h2", { id: "ev-up", class: "list-title" }, filter === "alle" ? "Kommende Termine " : `Kommende ${which.label} `, h("span", { class: "count" }, upcoming.length)),
        h("ul", { class: "ev-list" }, upcoming.map((e) => item(e, false))))
      : h("div", { class: "card" }, emptyState("calendar", emptyTitle, "Trag deinen nächsten Markt oder Nähkurs ein – er erscheint dann gleich auf deiner Website.", btn("Termin anlegen", { icon: "plus", variant: "primary", attrs: { "data-key": "ev-add-empty" }, onClick: () => openEditor(null, "new") }))),
    past.length
      ? h("details", { class: "past" },
        h("summary", {}, icon("chevronRight", "ico-sm summary-chev"), h("span", {}, `Vergangene Termine (${past.length})`)),
        h("p", { class: "muted small" }, "Werden auf der Website nicht mehr gezeigt. Du kannst sie kopieren, um sie zu wiederholen."),
        h("ul", { class: "ev-list" }, past.map((e) => item(e, true))))
      : null);

  if (ctx.sub === "neu") {
    ctx.consumeSub();
    setTimeout(() => { document.querySelector('#main [data-key="ev-add"], #main [data-key="ev-add-empty"]')?.focus({ preventScroll: true }); openEditor(null, "new"); }, 50);
  }
  return view;
}

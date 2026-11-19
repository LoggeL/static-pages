// Termine: Märkte, offenes Atelier, Kurse, Pausen
import { TODAY, formatDate, uid } from "../../../shared/store.js";
import { h, icon, btn, iconBtn, sectionHeader, emptyState, openForm, plural } from "../ui.js";
import { relDay, addDays } from "./common.js";

const FIELDS = [
  { name: "date", label: "Datum", type: "date", required: true, requiredMsg: "Bitte wähle ein Datum." },
  { name: "time", label: "Uhrzeit", type: "text", placeholder: "z. B. 11:00–18:00", hint: "Darf auch leer bleiben, z. B. bei einem ganzen Tag." },
  { name: "title", label: "Was ist los?", type: "text", required: true, placeholder: "z. B. Adventsmarkt Ramsen", requiredMsg: "Bitte gib dem Termin einen Namen." },
  { name: "place", label: "Ort", type: "text", placeholder: "z. B. Ramsen, Ortsmitte" },
  { name: "note", label: "Kurze Notiz", type: "textarea", rows: 3, placeholder: "z. B. Mit Stulpen und Tüchern zum Anprobieren." },
  { name: "visible", label: "Auf der Website zeigen", type: "switch", default: true, hint: "Ausgeschaltet bleibt der Termin nur hier in deiner Liste." },
];

export default function renderTermine(ctx) {
  const events = ctx.content.events.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const upcoming = events.filter((e) => e.date >= TODAY);
  const past = events.filter((e) => e.date < TODAY).reverse();

  const openEditor = (ev, mode) => openForm({
    title: mode === "new" ? "Neuer Termin" : mode === "copy" ? "Termin kopieren" : "Termin bearbeiten",
    intro: mode === "copy" ? "Alles ist schon ausgefüllt – ändere einfach das Datum." : null,
    fields: FIELDS, values: ev || { date: "", visible: true },
    submitLabel: mode === "edit" ? "Änderungen speichern" : "Termin speichern",
    onSave: (v) => {
      if (mode === "edit") ctx.save((d) => { const e = d.events.find((x) => x.id === ev.id); if (e) Object.assign(e, v); });
      else { const id = uid(); ctx.save((d) => { d.events.push({ id, ...v }); }); }
      ctx.toast(mode === "edit" ? "Termin gespeichert" : `Termin am ${formatDate(v.date)} eingetragen`);
      ctx.rerender();
    },
  });

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

  const item = (ev, isPast) => {
    const hidden = ev.visible === false;
    const rel = relDay(ev.date);
    return h("li", { class: "ev" + (hidden ? " is-hidden" : "") + (isPast ? " is-past" : "") },
      h("div", { class: "ev-date", "aria-hidden": "true" },
        h("span", { class: "ev-wd" }, formatDate(ev.date, { weekday: "short" })),
        h("strong", {}, formatDate(ev.date, { day: "numeric" })),
        h("span", {}, formatDate(ev.date, { month: "short" }))),
      h("div", { class: "ev-body" },
        h("h3", { class: "ev-title" }, ev.title,
          hidden ? h("span", { class: "tag tag-muted" }, icon("eyeOff", "ico-xs"), "versteckt") : null,
          rel && !isPast ? h("span", { class: "tag tag-rose" }, rel) : null),
        h("p", { class: "ev-meta" },
          h("span", { class: "sr-only" }, formatDate(ev.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + ". "),
          ev.time ? h("span", {}, icon("clock", "ico-xs"), ev.time) : null,
          ev.place ? h("span", {}, icon("pin", "ico-xs"), ev.place) : null),
        ev.note ? h("p", { class: "ev-note" }, ev.note) : null),
      h("div", { class: "ev-actions" },
          btn("Bearbeiten", { icon: "edit", small: true, attrs: { "data-key": "ev-edit-" + ev.id, "aria-label": `${ev.title} bearbeiten` }, onClick: () => openEditor(ev, "edit") }),
          btn("Kopieren", { icon: "copy", small: true, variant: "ghost", attrs: { "aria-label": `${ev.title} kopieren` }, onClick: () => openEditor({ ...ev, date: addDays(ev.date < TODAY ? TODAY : ev.date, 7) }, "copy") }),
          hidden ? btn("Wieder zeigen", { icon: "eye", small: true, variant: "ghost", attrs: { "data-key": "ev-vis-" + ev.id, "aria-label": `${ev.title} wieder auf der Website zeigen` }, onClick: () => toggleVisible(ev) }) : null,
          iconBtn("trash", `${ev.title} löschen`, () => remove(ev), { cls: "icon-btn-danger push" })));
  };

  const addBtn = btn("Neuer Termin", { icon: "plus", variant: "primary", attrs: { "data-key": "ev-add" }, onClick: () => openEditor(null, "new") });

  const view = h("div", { class: "stack" },
    sectionHeader("Termine", "Märkte, offenes Atelier, Kurse oder Pausen. Kommende Termine erscheinen auf deiner Website.", addBtn),
    upcoming.length
      ? h("section", { "aria-labelledby": "ev-up" }, h("h2", { id: "ev-up", class: "list-title" }, "Kommende Termine ", h("span", { class: "count" }, upcoming.length)),
        h("ul", { class: "ev-list" }, upcoming.map((e) => item(e, false))))
      : h("div", { class: "card" }, emptyState("calendar", "Noch keine kommenden Termine", "Leg deinen ersten an – z. B. einen Markt oder ein offenes Atelier.", btn("Ersten Termin anlegen", { icon: "plus", variant: "primary", onClick: () => openEditor(null, "new") }))),
    past.length
      ? h("details", { class: "past" },
        h("summary", {}, icon("chevronRight", "ico-sm summary-chev"), h("span", {}, `Vergangene Termine (${past.length})`)),
        h("p", { class: "muted small" }, "Werden auf der Website nicht mehr gezeigt. Du kannst sie kopieren, um sie zu wiederholen."),
        h("ul", { class: "ev-list" }, past.map((e) => item(e, true))))
      : null);

  if (ctx.sub === "neu") {
    ctx.consumeSub();
    setTimeout(() => openEditor(null, "new"), 50);
  }
  return view;
}

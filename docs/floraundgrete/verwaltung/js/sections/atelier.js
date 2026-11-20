// Atelier-Status & Öffnungszeiten (+ Hilfe zu Google)
import { WEEKDAYS } from "../../../shared/store.js";
import { h, icon, btn, iconBtn, card, field, sectionHeader, fid, linkBtn } from "../ui.js";
import { STATUS_MODES } from "./common.js";

const NOTE_IDEAS = {
  open: ["Anprobe & Abholung nur nach Termin", "Komm gern vorbei – klingel einfach!"],
  appointment: ["Besuch & Anprobe nur nach kurzer Nachricht", "Schreib mir, dann finden wir einen Termin."],
  closed: ["Heute bleibt das Atelier geschlossen. Der Etsy-Shop ist trotzdem für dich da.", "Gerade nehme ich mir eine kleine Auszeit."],
  vacation: ["Im Urlaub – Bestellungen nähe ich danach als Erstes.", "Kleine Pause – ab nächster Woche bin ich wieder da."],
};

export default function renderAtelier(ctx) {
  const s = ctx.content.status;

  // Status als große Auswahlkarten
  const gid = fid("mode");
  const modeSet = h("fieldset", { class: "mode-cards" },
    h("legend", { class: "card-title" }, "Wie ist das Atelier gerade?"),
    h("div", { class: "mode-grid" }, STATUS_MODES.map((m) => {
      const id = `${gid}-${m.id}`;
      return h("label", { class: `mode-card mode-${m.id}`, for: id },
        h("input", { type: "radio", name: gid, id, value: m.id, checked: s.mode === m.id, "data-key": "mode-" + m.id,
          onChange: () => {
            const before = ctx.content.status.mode;
            ctx.save((d) => { d.status.mode = m.id; });
            ctx.toast(`Status: ${m.label}`, { undo: () => { ctx.save((d) => { d.status.mode = before; }); ctx.rerender(); } });
            ctx.rerender();
          } }),
        h("span", { class: "mode-ico" }, icon(m.icon)),
        h("span", { class: "mode-text" }, h("strong", {}, m.label), h("span", {}, m.text)),
        h("span", { class: "mode-check", "aria-hidden": "true" }, icon("check")));
    })));

  const noteField = field({ label: "Kurzer Satz dazu", value: s.note, key: "status-note", counter: 100,
    hint: "Erscheint neben dem Status auf deiner Website.", onInput: (v) => ctx.save((d) => { d.status.note = v; }) });
  const ideas = h("div", { class: "chips-row" }, h("span", { class: "small muted" }, "Ideen:"),
    (NOTE_IDEAS[s.mode] || []).map((t) => h("button", { type: "button", class: "btn btn-chip btn-sm", onClick: () => {
      noteField.control.value = t; noteField.control.dispatchEvent(new Event("input")); noteField.control.focus();
    } }, t)));

  // Öffnungszeiten-Zeilen
  const listId = fid("days");
  const hours = s.hours || [];
  const setHours = (fn, rerender = true) => { ctx.save((d) => { d.status.hours = fn(d.status.hours || []); }); if (rerender) ctx.rerender(); };
  const rows = hours.map((row, i) => {
    const dayId = fid("day"), timeId = fid("tm");
    return h("li", { class: "hours-row" },
      h("div", { class: "field" }, h("label", { for: dayId }, "Tag"),
        h("input", { id: dayId, type: "text", list: listId, value: row.day, "data-key": `hr-day-${i}`, placeholder: "z. B. Dienstag",
          onInput: (e) => setHours((hs) => { hs[i].day = e.target.value; return hs; }, false) })),
      h("div", { class: "field" }, h("label", { for: timeId }, "Zeit"),
        h("input", { id: timeId, type: "text", value: row.time, "data-key": `hr-time-${i}`, placeholder: "z. B. 16:00–19:00",
          onInput: (e) => setHours((hs) => { hs[i].time = e.target.value; return hs; }, false) })),
      iconBtn("trash", `Zeile ${row.day || i + 1} löschen`, () => {
        setHours((hs) => hs.filter((_, j) => j !== i));
        ctx.toast(`Zeile „${row.day || "ohne Tag"}“ gelöscht`, { undo: () => setHours((hs) => { hs.splice(i, 0, row); return hs; }) });
      }, { cls: "icon-btn-danger hours-del" }));
  });
  const hoursCard = card("Öffnungszeiten auf deiner Website", { icon: "clock", sub: "Freie Zeilen – schreib es so, wie du es sagen würdest." },
    h("datalist", { id: listId }, [...WEEKDAYS.slice(1), WEEKDAYS[0], "Montag–Freitag", "Wochenende", "Nach Absprache"].map((d) => h("option", { value: d }))),
    hours.length ? h("ul", { class: "hours-list" }, rows) : h("p", { class: "muted" }, "Noch keine Zeiten eingetragen."),
    btn("Zeile hinzufügen", { icon: "plus", attrs: { "data-key": "hr-add" }, onClick: () => {
      setHours((hs) => [...hs, { day: "", time: "" }]);
      document.querySelector(`[data-key="hr-day-${hours.length}"]`)?.focus();
    } }));

  // Google-Hilfe
  const google = h("section", { class: "card card-google", id: "google", "aria-labelledby": "google-title" },
    h("div", { class: "card-head" }, h("span", { class: "card-ico ico-google" }, icon("google")),
      h("div", { class: "card-titles" }, h("h2", { class: "card-title", id: "google-title" }, "Öffnungszeiten bei Google"),
        h("p", { class: "card-sub" }, "Wichtig zu wissen: Was Google in der Suche und bei Google Maps anzeigt, kann diese Website nicht ändern."))),
    h("ol", { class: "steps" },
      h("li", {}, h("strong", {}, "Öffne dein Google-Unternehmensprofil. "), "Es ist kostenlos. Geh auf google.com/business und melde dich mit deinem Google-Konto an."),
      h("li", {}, h("strong", {}, "Tipp auf „Profil bearbeiten“. "), "Du kannst auch einfach bei Google nach „Cathrin Raasch Atelier“ suchen – als Inhaberin siehst du dann die Bearbeiten-Knöpfe."),
      h("li", {}, h("strong", {}, "Wähle „Öffnungszeiten“. "), "Für Urlaub, Feiertage oder einen einzelnen geschlossenen Tag gibt es „Sonderöffnungszeiten“ – so bleiben deine normalen Zeiten erhalten."),
      h("li", {}, h("strong", {}, "Hier und dort ändern. "), "Wenn du schließt oder in den Urlaub gehst: oben den Status umstellen und bei Google die Sonderöffnungszeiten eintragen. Dann stimmt es überall.")),
    h("div", { class: "row" },
      linkBtn("Google-Unternehmensprofil öffnen", "https://www.google.com/business/", { icon: "external", variant: "primary", newTab: true }),
      h("p", { class: "small muted" }, "Änderungen bei Google brauchen manchmal ein paar Stunden, bis sie überall zu sehen sind.")));

  return h("div", { class: "stack" },
    sectionHeader("Atelier & Öffnungszeiten", "Zeig deinen Besucherinnen, ob und wann sie zu dir ins Atelier kommen können."),
    h("a", { class: "note note-info google-jump", href: "#google", onClick: (e) => { e.preventDefault(); const g = document.getElementById("google"); g.scrollIntoView({ behavior: "smooth", block: "start" }); g.setAttribute("tabindex", "-1"); g.focus({ preventScroll: true }); } },
      icon("google"), h("span", {}, h("strong", {}, "Bei Google stehen deine Zeiten extra. "), "So änderst du sie dort ↓")),
    h("div", { class: "split" },
      h("div", { class: "split-main stack" },
        h("section", { class: "card" }, modeSet, noteField, ideas),
        hoursCard),
      h("aside", { class: "split-side" }, google)));
}

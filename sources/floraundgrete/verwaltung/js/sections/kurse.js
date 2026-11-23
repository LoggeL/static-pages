// Feste Kurse: wiederkehrende Nähkurse (n-ter Wochentag im Monat), Hinweis darunter, Kurspausen
import { TODAY, WEEKDAYS, formatDate, uid, courseRule, courseDates, courseSessions, isHoliday, eventsOn } from "../../../shared/store.js";
import { h, icon, btn, iconBtn, sectionHeader, emptyState, openForm, card, field, fid } from "../ui.js";
import { addDays, typeName } from "./common.js";

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Montag zuerst
const SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const PREVIEW = 3; // so viele nächste Termine zeigt jede Kurskarte
const HORIZON = 240; // Tage, die die Website vorausschaut (courseSessions im Store)

const dateShort = (d) => formatDate(d, { weekday: "short", day: "numeric", month: "short" });
const dateLong = (d) => formatDate(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const nthOf = (d) => Math.ceil(Number(d.slice(8, 10)) / 7);
const weekdayOf = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd).getDay(); };
/** Fällt dieser Tag nach der Regel auf den Kurs (ohne Ausnahmen)? */
const matchesRule = (k, d) => weekdayOf(d) === Number(k.weekday) && (k.weeks || []).includes(nthOf(d));

/** Warum fällt ein Regel-Termin aus? (gleiche Reihenfolge wie courseDates im Store) */
function skipReason(d, breaks) {
  if (isHoliday(d)) return "Feiertag";
  if (breaks.includes(d)) return "Kurspause";
  const ev = eventsOn(d);
  if (ev.length) return `${typeName(ev[0].type)}: ${ev[0].title}`;
  return "";
}

/** Nächste Termine plus die ausfallenden Regel-Tage dazwischen (zur Erklärung) */
function preview(k, breaks) {
  const dates = courseDates(k, PREVIEW, HORIZON);
  const until = dates.length === PREVIEW ? dates[dates.length - 1] : addDays(TODAY, HORIZON);
  const out = [];
  for (let d = TODAY; d <= until; d = addDays(d, 1)) {
    if (!matchesRule(k, d)) continue;
    if (dates.includes(d)) out.push({ date: d });
    else out.push({ date: d, skip: skipReason(d, breaks) || "fällt aus" });
  }
  return { dates, items: out };
}

/** Passen „Termine pro Kurs“ und die gewählten Wochen zusammen? */
function sessionsProblem(weeks, sessions) {
  const n = Number(sessions) || 1;
  if (n <= 1 || !weeks.length) return "";
  if (weeks.length < n) return `Für ${n} Termine pro Kurs brauchst du mindestens ${n} Wochen im Monat.`;
  if (weeks.length % n) return `Bei ${n} Terminen pro Kurs muss die Zahl der Wochen durch ${n} teilbar sein (z. B. ${n === 2 ? "2. und 4." : `${n} Wochen`}).`;
  return "";
}

/** Formularfelder (Wochentags-Knöpfe werden je Dialog neu gebaut) */
function buildFields(state, previewEl) {
  const refresh = () => {
    if (!state.weeks.length) {
      previewEl.replaceChildren(icon("info", "ico-sm"), h("span", {}, "Wähle mindestens eine Woche."));
      return;
    }
    const k = { weekday: state.weekday, weeks: state.weeks, sessions: state.sessions };
    const bad = sessionsProblem(state.weeks, state.sessions);
    if (bad) { previewEl.replaceChildren(icon("info", "ico-sm"), h("span", {}, bad)); return; }
    const next = courseSessions(k, 2);
    const multi = state.sessions > 1;
    previewEl.replaceChildren(icon("calendar", "ico-sm"), h("span", {},
      h("strong", {}, courseRule(k)),
      next.length ? h("span", { class: "kc-rule-next" }, ` · ${multi ? "nächste Kurse" : "nächste Termine"}: ${next.map((g) => g.map(dateShort).join(" + ")).join(multi ? " / " : ", ")}`) : null));
  };
  refresh();
  return [
    { name: "title", label: "Titel", type: "text", required: true, placeholder: "z. B. Offenes Nähen", requiredMsg: "Bitte gib dem Kurs einen Namen.", attrs: { maxlength: 60 } },
    { name: "subtitle", label: "Untertitel", type: "text", placeholder: "z. B. Freie Projekte nach Wunsch", attrs: { maxlength: 80 } },
    { name: "weekday", label: "Wochentag", type: "choice", chipsClass: "chips-days",
      options: DAY_ORDER.map((wd) => ({ value: wd, label: [h("span", { "aria-hidden": "true" }, SHORT[wd]), h("span", { class: "sr-only" }, WEEKDAYS[wd])] })),
      onChange: (v) => { state.weekday = Number(v); refresh(); } },
    { name: "weeks", label: "In welchen Wochen im Monat?", type: "multi", chipsClass: "chips-weeks", required: true,
      requiredMsg: "Bitte wähle mindestens eine Woche aus.",
      hint: "Zum Beispiel 1. und 3. für den ersten und dritten Donnerstag. Einen 5. gibt es nur in manchen Monaten.",
      options: [1, 2, 3, 4, 5].map((w) => ({ value: w, label: [h("strong", {}, `${w}.`), h("span", { class: "chip-sub" }, "Woche")] })),
      extra: previewEl,
      onChange: (v) => { state.weeks = v.map(Number); refresh(); } },
    { name: "sessions", label: "Termine pro Kurs", type: "choice",
      hint: "Bei 2 gehören die Termine eines Monats zusammen, z. B. 2. und 4. Samstag. Auf der Website stehen sie dann in einem Feld.",
      options: [1, 2, 3, 4].map((n) => ({ value: n, label: n === 1 ? "1 Termin" : `${n} Termine` })),
      onChange: (v) => { state.sessions = Number(v); refresh(); } },
    { name: "time", label: "Uhrzeit", type: "text", placeholder: "z. B. 18–20 Uhr", attrs: { maxlength: 40 } },
    { name: "price", label: "Preis", type: "text", placeholder: "z. B. 24 € pro Termin", attrs: { maxlength: 60 } },
    { name: "audience", label: "Für wen", type: "text", placeholder: "z. B. Für alle, auch absolute Einsteiger", attrs: { maxlength: 80 } },
    { name: "note", label: "Hinweis", type: "textarea", rows: 2, placeholder: "z. B. Material inklusive.", attrs: { maxlength: 200 } },
    { name: "visible", label: "Auf der Website zeigen", type: "switch", default: true, hint: "Ausgeschaltet bleibt der Kurs nur hier in deiner Liste." },
  ];
}

export default function renderKurse(ctx) {
  const c = ctx.content;
  const courses = c.courses || [];
  const breaks = c.courseBreaks || [];

  // ---------- Bearbeiten / Neu ----------
  const openEditor = (k) => {
    const state = { weekday: k ? Number(k.weekday) : 4, weeks: k ? [...k.weeks] : [], sessions: k ? Number(k.sessions) || 1 : 1 };
    const previewEl = h("p", { class: "kc-rule-pv", "aria-live": "polite" });
    openForm({
      title: k ? "Kurs bearbeiten" : "Neuer Kurs",
      intro: k ? null : "Trag den Kurs so ein, wie er auf deiner Tafel steht. Die Website rechnet die Termine selbst aus.",
      fields: buildFields(state, previewEl),
      values: k ? { ...k, sessions: Number(k.sessions) || 1 } : { weekday: 4, weeks: [], sessions: 1, visible: true },
      submitLabel: k ? "Änderungen speichern" : "Kurs speichern",
      validate: (v) => { const msg = sessionsProblem((v.weeks || []).map(Number), v.sessions); return msg ? { sessions: msg } : {}; },
      onSave: (v) => {
        const data = { ...v, weekday: Number(v.weekday), weeks: v.weeks.map(Number).sort((a, b) => a - b), sessions: Math.min(4, Math.max(1, Number(v.sessions) || 1)) };
        if (k) ctx.save((d) => { const x = d.courses.find((y) => y.id === k.id); if (x) Object.assign(x, data); });
        else ctx.save((d) => { d.courses.push({ id: uid(), ...data }); });
        ctx.toast(k ? "Kurs gespeichert" : `„${data.title}“ hinzugefügt`);
        ctx.rerender();
      },
    });
  };

  // ---------- Liste: Reihenfolge, Sichtbarkeit, Löschen ----------
  const move = (i, dir) => {
    const id = courses[i].id;
    ctx.save((d) => { const [x] = d.courses.splice(i, 1); d.courses.splice(i + dir, 0, x); });
    ctx.rerender();
    // Fokus folgt dem verschobenen Kurs
    const target = document.querySelector(`[data-key="kc-${dir < 0 ? "up" : "down"}-${id}"]`);
    if (target && !target.disabled) target.focus(); else document.querySelector(`[data-key="kc-${dir < 0 ? "down" : "up"}-${id}"]`)?.focus();
  };
  const toggleVisible = (k) => {
    ctx.save((d) => { const x = d.courses.find((y) => y.id === k.id); if (x) x.visible = x.visible === false; });
    ctx.rerender();
  };
  const remove = (k, i) => {
    ctx.save((d) => { d.courses = d.courses.filter((x) => x.id !== k.id); });
    ctx.toast(`Kurs „${k.title}“ gelöscht`, { undo: () => { ctx.save((d) => { d.courses.splice(Math.min(i, d.courses.length), 0, k); }); ctx.rerender(); } });
    ctx.rerender();
  };

  const item = (k, i) => {
    const hidden = k.visible === false;
    const name = k.title || "Kurs ohne Titel";
    const pv = preview(k, breaks);
    const listId = `kc-next-${k.id}`;
    const skips = pv.items.filter((x) => x.skip);
    const multi = (Number(k.sessions) || 1) > 1;
    const groups = multi ? courseSessions(k, 2) : [];
    return h("li", { class: "lk kc" + (hidden ? " is-hidden" : "") },
      h("div", { class: "lk-order" },
        iconBtn("up", `„${name}“ nach oben`, () => move(i, -1), { disabled: i === 0, attrs: { "data-key": `kc-up-${k.id}` } }),
        h("span", { class: "lk-pos", "aria-hidden": "true" }, i + 1),
        iconBtn("down", `„${name}“ nach unten`, () => move(i, 1), { disabled: i === courses.length - 1, attrs: { "data-key": `kc-down-${k.id}` } })),
      h("div", { class: "lk-body" },
        h("p", { class: "ev-tags" },
          h("span", { class: "tag tag-kurs" }, courseRule(k)),
          hidden ? h("span", { class: "tag tag-muted" }, icon("eyeOff", "ico-xs"), "versteckt") : null),
        h("h3", { class: "lk-title" }, name),
        k.subtitle ? h("p", { class: "kc-sub" }, k.subtitle) : null,
        h("p", { class: "ev-meta" },
          k.time ? h("span", {}, icon("clock", "ico-xs"), k.time) : null,
          k.price ? h("span", { class: "kc-price" }, k.price) : null),
        k.audience ? h("p", { class: "kc-line" }, icon("heart", "ico-xs"), k.audience) : null,
        k.note ? h("p", { class: "ev-note" }, k.note) : null,
        h("div", { class: "kc-next" },
          h("p", { class: "small strong", id: listId }, multi ? `Nächste Kurse (je ${k.sessions} Termine)` : "Nächste Termine"),
          multi
            ? (groups.length
              ? h("ul", { class: "kc-dates", "aria-labelledby": listId }, groups.map((g) => h("li", { class: "kc-date" }, g.map(dateShort).join(" + "))))
              : h("p", { class: "muted small" }, "In den nächsten Monaten findet kein vollständiger Kurs statt."))
            : pv.dates.length
              ? h("ul", { class: "kc-dates", "aria-labelledby": listId }, pv.dates.map((d) => h("li", { class: "kc-date" }, dateShort(d))))
              : h("p", { class: "muted small" }, "In den nächsten Monaten findet kein Termin statt."),
          multi && skips.length ? h("p", { class: "muted small" }, "Fällt ein Termin aus, findet der Kurs in diesem Monat nicht statt.") : null,
          skips.length
            ? h("ul", { class: "kc-skips", "aria-label": "Fällt aus" }, skips.map((x) => h("li", {},
              h("span", { class: "kc-skip-date" }, dateShort(x.date)), ` fällt aus: ${x.skip}`)))
            : null)),
      h("div", { class: "ev-actions" },
        btn("Bearbeiten", { icon: "edit", small: true, attrs: { "data-key": `kc-edit-${k.id}`, "aria-label": `${name} bearbeiten` }, onClick: () => openEditor(k) }),
        iconBtn(hidden ? "eye" : "eyeOff", hidden ? `${name} wieder auf der Website zeigen` : `${name} auf der Website verstecken`, () => toggleVisible(k), { attrs: { "data-key": `kc-vis-${k.id}` } }),
        iconBtn("trash", `${name} löschen`, () => remove(k, i), { cls: "icon-btn-danger push" })));
  };

  // ---------- Hinweis unter den Kursen ----------
  const noteField = field({ label: "Dein Hinweis", type: "textarea", rows: 2, value: c.courseNote || "", key: "course-note", counter: 160,
    placeholder: "z. B. Bring nach Möglichkeit deine eigene Nähmaschine mit.",
    hint: "Steht auf der Website unter allen Kursen. Darf leer bleiben.",
    onInput: (v) => ctx.save((d) => { d.courseNote = v; }) });
  const noteCard = card("Hinweis unter den Kursen", { icon: "info", sub: "Gilt für alle Kurse, z. B. was man mitbringen soll." }, noteField);

  // ---------- Kurspausen ----------
  const futureBreaks = breaks.filter((d) => d >= TODAY).sort();
  const coursesOn = (d) => courses.filter((k) => k.visible !== false && matchesRule(k, d)).map((k) => k.title);
  const dateId = fid("pause");
  const dateField = field({ label: "Tag ohne Kurse", type: "date", id: dateId, key: "break-date",
    attrs: { min: TODAY }, hint: "Zum Beispiel Urlaub oder ein freier Abend." });
  const addBreak = () => {
    const v = dateField.control.value;
    if (!v) { dateField.setError("Bitte wähle zuerst ein Datum."); dateField.control.focus(); return; }
    if (v < TODAY) { dateField.setError("Dieser Tag liegt schon in der Vergangenheit."); dateField.control.focus(); return; }
    if (breaks.includes(v)) { dateField.setError(`Am ${dateShort(v)} ist schon eine Pause eingetragen.`); dateField.control.focus(); return; }
    ctx.save((d) => { d.courseBreaks = [...(d.courseBreaks || []), v].sort(); });
    const hit = coursesOn(v);
    ctx.toast(hit.length ? `Pause am ${dateShort(v)}: ${hit.join(" und ")} ${hit.length > 1 ? "fallen" : "fällt"} aus` : `Pause am ${dateShort(v)} eingetragen. An diesem Tag ist sowieso kein fester Kurs.`);
    ctx.rerender();
    document.querySelector('[data-key="break-add"]')?.focus();
  };
  dateField.control.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addBreak(); } });
  dateField.control.addEventListener("input", () => dateField.setError(""));
  // Knopf direkt neben das Datumsfeld (Fehlermeldung bleibt darunter)
  const breakRow = h("div", { class: "kc-break-row" });
  dateField.control.replaceWith(breakRow);
  breakRow.append(dateField.control, btn("Pause eintragen", { icon: "plus", attrs: { "data-key": "break-add" }, onClick: addBreak }));
  const removeBreak = (d) => {
    ctx.save((x) => { x.courseBreaks = (x.courseBreaks || []).filter((y) => y !== d); });
    ctx.toast(`Pause am ${dateShort(d)} entfernt`, { undo: () => { ctx.save((x) => { x.courseBreaks = [...new Set([...(x.courseBreaks || []), d])].sort(); }); ctx.rerender(); } });
    ctx.rerender();
  };
  const breakList = futureBreaks.length
    ? h("div", { class: "blocked-list" }, h("p", { class: "small strong", id: "kc-breaks-title" }, "Eingetragene Pausen"),
      h("ul", { class: "time-chips", "aria-labelledby": "kc-breaks-title" }, futureBreaks.map((d) => h("li", { class: "time-chip chip-rose" },
        h("span", {}, dateShort(d)),
        iconBtn("x", `Pause am ${dateLong(d)} entfernen`, () => removeBreak(d), { cls: "chip-x", attrs: { "data-key": `break-x-${d}` } })))))
    : h("p", { class: "muted small" }, "Noch keine Pausen eingetragen.");
  const breakCard = card("Kurspausen", { icon: "calendar", sub: "An diesen Tagen fallen alle festen Kurse aus." },
    h("p", { class: "note note-info" }, icon("info"), h("span", {},
      "Feiertage (auch Heiligabend und Silvester), Markttage und Nähkurs-Termine aus ", h("a", { href: "#termine" }, "Termine"),
      " werden automatisch übersprungen. Hier trägst du nur zusätzliche Pausen ein.")),
    dateField,
    breakList);

  const addBtn = btn("Kurs hinzufügen", { icon: "plus", variant: "primary", attrs: { "data-key": "kc-add" }, onClick: () => openEditor(null) });

  return h("div", { class: "stack" },
    sectionHeader("Feste Kurse", "Deine Kurse, die jeden Monat wiederkommen – wie auf deiner Kreidetafel. Die nächsten Termine rechnet die Website selbst aus.", addBtn),
    courses.length
      ? h("section", { "aria-labelledby": "kc-list-title" },
        h("h2", { id: "kc-list-title", class: "list-title" }, "Deine Kurse ", h("span", { class: "count" }, courses.length),
          h("span", { class: "list-sub" }, "In dieser Reihenfolge stehen sie auf der Website. Mit den Pfeilen änderst du sie.")),
        h("ol", { class: "lk-list" }, courses.map(item)))
      : h("div", { class: "card" }, emptyState("clock", "Noch keine festen Kurse", "Leg deinen ersten Kurs an, z. B. einen Nähabend jeden 1. und 3. Donnerstag.",
        btn("Ersten Kurs anlegen", { icon: "plus", variant: "primary", attrs: { "data-key": "kc-add-empty" }, onClick: () => openEditor(null) }))),
    h("div", { class: "grid-2" }, noteCard, breakCard));
}

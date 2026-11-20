// Atelier & Zeiten: Status, Grundregel (Öffnungstage + Zeilen), automatisch geschlossene Tage, Google-Link (+ Hilfe zu Google)
import { WEEKDAYS, closedDays, formatDate } from "../../../shared/store.js";
import { h, icon, btn, iconBtn, card, field, toggle, sectionHeader, fid, linkBtn, checkUrl } from "../ui.js";
import { STATUS_MODES, typeName } from "./common.js";

const NOTE_IDEAS = {
  open: ["Die aktuellen Öffnungszeiten stehen immer bei Google Maps – die halte ich aktuell.", "Komm gern vorbei – klingel einfach!"],
  appointment: ["Besuch & Anprobe nur nach kurzer Nachricht", "Schreib mir, dann finden wir einen Termin."],
  closed: ["Heute bleibt das Atelier geschlossen. Der Etsy-Shop ist trotzdem für dich da.", "Gerade nehme ich mir eine kleine Auszeit."],
  vacation: ["Im Urlaub – Bestellungen nähe ich danach als Erstes.", "Kleine Pause – ab nächster Woche bin ich wieder da."],
};

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Montag zuerst
const SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const PREVIEW_DAYS = 70;

export default function renderAtelier(ctx) {
  const s = ctx.content.status;
  const setStatus = (fn, rerender = true) => { ctx.save((d) => fn(d.status)); if (rerender) ctx.rerender(); };

  // ---------- Status als große Auswahlkarten ----------
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

  // ---------- Grundregel: Öffnungstage ----------
  const open = s.openWeekdays || [];
  const dgid = fid("wd");
  const daySet = h("fieldset", { class: "day-set", "aria-describedby": dgid + "-hint" },
    h("legend", { class: "field-label" }, "An welchen Tagen ist das Atelier normalerweise offen?"),
    h("div", { class: "day-chips" }, DAY_ORDER.map((wd) => {
      const id = `${dgid}-${wd}`;
      return h("label", { class: "day-chip", for: id },
        h("input", { type: "checkbox", id, checked: open.includes(wd), "data-key": "open-wd-" + wd,
          onChange: (e) => setStatus((st) => {
            const set = new Set(st.openWeekdays || []);
            if (e.target.checked) set.add(wd); else set.delete(wd);
            st.openWeekdays = DAY_ORDER.filter((x) => set.has(x));
          }) }),
        h("span", { "aria-hidden": "true" }, SHORT[wd]), h("span", { class: "sr-only" }, WEEKDAYS[wd]));
    })),
    h("p", { class: "field-hint", id: dgid + "-hint" }, "Daran erkennt die Website, welche Öffnungstage wegen Markt oder Nähkurs ausfallen."));

  // ---------- Grundregel: Zeilen (Tag / Zeit) ----------
  const listId = fid("days");
  const hours = s.hours || [];
  const setHours = (fn, rerender = true) => setStatus((st) => { st.hours = fn(st.hours || []); }, rerender);
  const move = (i, dir) => {
    setHours((hs) => { const [x] = hs.splice(i, 1); hs.splice(i + dir, 0, x); return hs; });
    // Fokus folgt der verschobenen Zeile
    const t = document.querySelector(`[data-key="hr-${dir < 0 ? "up" : "down"}-${i + dir}"]`);
    if (t && !t.disabled) t.focus(); else document.querySelector(`[data-key="hr-${dir < 0 ? "down" : "up"}-${i + dir}"]`)?.focus();
  };
  const rows = hours.map((row, i) => {
    const dayId = fid("day"), timeId = fid("tm");
    const name = row.day || `Zeile ${i + 1}`;
    return h("li", { class: "hours-row" },
      h("div", { class: "field" }, h("label", { for: dayId }, "Tag"),
        h("input", { id: dayId, type: "text", list: listId, value: row.day, "data-key": `hr-day-${i}`, placeholder: "z. B. Mittwoch",
          onInput: (e) => setHours((hs) => { hs[i].day = e.target.value; return hs; }, false) })),
      h("div", { class: "field" }, h("label", { for: timeId }, "Zeit"),
        h("input", { id: timeId, type: "text", value: row.time, "data-key": `hr-time-${i}`, placeholder: "z. B. geöffnet",
          onInput: (e) => setHours((hs) => { hs[i].time = e.target.value; return hs; }, false) })),
      h("div", { class: "hours-btns" },
        iconBtn("up", `${name} nach oben`, () => move(i, -1), { disabled: i === 0, attrs: { "data-key": `hr-up-${i}` } }),
        iconBtn("down", `${name} nach unten`, () => move(i, 1), { disabled: i === hours.length - 1, attrs: { "data-key": `hr-down-${i}` } }),
        iconBtn("trash", `${name} löschen`, () => {
          setHours((hs) => hs.filter((_, j) => j !== i), false);
          ctx.toast(`Zeile „${row.day || "ohne Tag"}“ gelöscht`, { undo: () => setHours((hs) => { hs.splice(Math.min(i, hs.length), 0, row); return hs; }) });
          ctx.rerender();
        }, { cls: "icon-btn-danger" })));
  });
  const ruleCard = card("Grundregel", { icon: "clock", sub: "So stehen deine Öffnungszeiten auf der Website. Schreib es so, wie du es sagen würdest." },
    daySet,
    h("datalist", { id: listId }, [...WEEKDAYS.slice(1), WEEKDAYS[0], "Montag–Freitag", "Wochenende", "Nach Absprache"].map((d) => h("option", { value: d }))),
    h("div", { class: "hours-block" },
      h("p", { class: "field-label" }, "Text auf der Website"),
      hours.length ? h("ul", { class: "hours-list" }, rows) : h("p", { class: "muted" }, "Noch keine Zeilen eingetragen.")),
    btn("Zeile hinzufügen", { icon: "plus", attrs: { "data-key": "hr-add" }, onClick: () => {
      setHours((hs) => [...hs, { day: "", time: "" }]);
      document.querySelector(`[data-key="hr-day-${hours.length}"]`)?.focus();
    } }));

  // ---------- Markt- und Kurstage: automatisch geschlossen ----------
  const auto = s.autoClosed !== false;
  const closed = closedDays(PREVIEW_DAYS);
  let preview;
  if (!auto) preview = h("p", { class: "muted small" }, "Ausgeschaltet: Die Website zeigt nur die Grundregel und den Link zu Google Maps.");
  else if (!open.length) preview = h("p", { class: "note note-warn" }, icon("info"), h("span", {}, "Wähle oben deine Öffnungstage – dann erkennt die Website, welche davon ausfallen."));
  else if (!closed.length) preview = h("p", { class: "muted small" }, "In den nächsten 10 Wochen fällt kein Öffnungstag wegen Markt oder Nähkurs aus.");
  else preview = h("div", { class: "closed-pv" },
    h("p", { class: "small strong", id: "closed-pv-title" }, "Diese Tage zeigt die Website als geschlossen:"),
    h("ul", { class: "closed-list", "aria-labelledby": "closed-pv-title" }, closed.map((c) => h("li", {},
      h("span", { class: "closed-date" }, formatDate(c.date, { weekday: "short", day: "numeric", month: "long" })),
      h("span", { class: "closed-why" }, c.events.map((e) => `${e.title} (${typeName(e.type)})`).join(", "))))));
  const autoCard = card("Markt- und Nähkurstage", { icon: "calendar", sub: "Deine Termine kommen aus dem Bereich „Termine“." },
    toggle({ label: "An Markt- und Nähkurstagen automatisch geschlossen anzeigen", key: "auto-closed", checked: auto,
      hint: "Fällt ein Markt oder Nähkurs auf einen Öffnungstag, steht dieser Tag auf der Website als geschlossen.",
      onChange: (v) => setStatus((st) => { st.autoClosed = v; }) }),
    preview,
    h("a", { href: "#termine", class: "text-link small self-start" }, icon("calendar", "ico-sm"), "Termine ansehen"));

  // ---------- Link zu Google Maps ----------
  const urlField = field({ label: "Link zu deinem Google-Eintrag", type: "url", value: s.googleUrl, key: "google-url", placeholder: "https://…",
    attrs: { inputmode: "url", spellcheck: "false", autocomplete: "url" },
    hint: "So findest du ihn: Such dein Atelier in Google Maps, tipp auf „Teilen“ und kopier den Link.",
    onInput: (v) => { urlField.setError(""); const r = checkUrl(v, { allowHash: false }); if (r.ok) setStatus((st) => { st.googleUrl = r.url; }, false); },
    onChange: (v) => {
      const r = checkUrl(v, { allowHash: false });
      urlField.setError(r.ok ? "" : r.msg);
      if (r.ok && r.url !== v) urlField.control.value = r.url;
      if (r.ok) { setStatus((st) => { st.googleUrl = r.url; }, false); testSlot.replaceChildren(...[testLink(r.url)].filter(Boolean)); }
    } });
  const noteFieldG = field({ label: "Beschriftung des Links", value: s.googleNote, key: "google-note", counter: 60, placeholder: "z. B. Aktuelle Öffnungszeiten bei Google Maps",
    hint: "So heißt der Knopf auf deiner Website.", onInput: (v) => setStatus((st) => { st.googleNote = v; }, false) });
  const testLink = (url) => (url ? linkBtn("Link testen", url, { icon: "external", small: true, variant: "ghost", newTab: true }) : null);
  const testSlot = h("div", { class: "row" }, testLink(s.googleUrl));
  const googleLinkCard = card("Aktuelle Zeiten bei Google Maps", { icon: "google", sub: "Deine tagesaktuellen Öffnungszeiten pflegst du in deinem Google-Unternehmensprofil. Die Website zeigt die Grundregel und verlinkt für alles Weitere dorthin." },
    urlField, noteFieldG, testSlot);

  // ---------- Google-Hilfe ----------
  const google = h("section", { class: "card card-google", id: "google", "aria-labelledby": "google-title" },
    h("div", { class: "card-head" }, h("span", { class: "card-ico ico-google" }, icon("google")),
      h("div", { class: "card-titles" }, h("h2", { class: "card-title", id: "google-title" }, "Öffnungszeiten bei Google ändern"),
        h("p", { class: "card-sub" }, "Was Google in der Suche und bei Google Maps anzeigt, kann diese Website nicht ändern. Das machst du direkt dort."))),
    h("ol", { class: "steps" },
      h("li", {}, h("strong", {}, "Öffne dein Google-Unternehmensprofil. "), "Es ist kostenlos. Geh auf google.com/business und melde dich mit deinem Google-Konto an."),
      h("li", {}, h("strong", {}, "Tipp auf „Profil bearbeiten“. "), "Du kannst auch einfach bei Google nach deinem Atelier suchen – als Inhaberin siehst du dann die Bearbeiten-Knöpfe."),
      h("li", {}, h("strong", {}, "Wähle „Öffnungszeiten“. "), "Für einen Markt, einen Nähkurs oder Urlaub gibt es „Sonderöffnungszeiten“ – so bleiben deine normalen Zeiten erhalten."),
      h("li", {}, h("strong", {}, "Fertig. "), "Markt- und Kurstage markiert deine Website von allein. Für alles andere schauen Besucherinnen über deinen Link bei Google nach.")),
    h("div", { class: "row" },
      linkBtn("Google-Unternehmensprofil öffnen", "https://www.google.com/business/", { icon: "external", variant: "primary", newTab: true }),
      h("p", { class: "small muted" }, "Änderungen bei Google brauchen manchmal ein paar Stunden, bis sie überall zu sehen sind.")));

  return h("div", { class: "stack" },
    sectionHeader("Atelier & Öffnungszeiten", "Die Grundregel steht auf deiner Website. Markt- und Nähkurstage werden automatisch als geschlossen markiert, und für alles Aktuelle verlinkst du auf Google Maps."),
    h("a", { class: "note note-info google-jump", href: "#google", onClick: (e) => { e.preventDefault(); const g = document.getElementById("google"); g.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); g.setAttribute("tabindex", "-1"); g.focus({ preventScroll: true }); } },
      icon("google"), h("span", {}, h("strong", {}, "Bei Google stehen deine Zeiten extra. "), "So änderst du sie dort ↓")),
    h("div", { class: "split" },
      h("div", { class: "split-main stack" },
        ruleCard,
        autoCard,
        googleLinkCard,
        h("section", { class: "card" }, modeSet, noteField, ideas)),
      h("aside", { class: "split-side" }, google)));
}

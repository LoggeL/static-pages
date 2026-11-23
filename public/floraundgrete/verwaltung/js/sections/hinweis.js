// Hinweis oben auf der Seite (Banner)
import { TODAY, upcomingEvents } from "../../../shared/store.js";
import { SHOP } from "../../../shared/data.js";
import { h, icon, btn, card, toggle, field, sectionHeader, checkUrl, fid } from "../ui.js";
import { TONES, bannerPreview, addDays, dayMonth } from "./common.js";

function nextWeekday(wd) { // 0=So … 6=Sa
  for (let i = 0; i < 8; i++) { const d = addDays(TODAY, i); const [y, m, dd] = d.split("-").map(Number); if (new Date(y, m - 1, dd).getDay() === wd) return d; }
  return TODAY;
}

const TEMPLATES = [
  { id: "urlaub", label: "Urlaub", icon: "sun", make: (b) => {
    const until = b.until && b.until > TODAY ? b.until : addDays(TODAY, 14);
    return { tone: "closed", from: "", until, text: `Kleine Urlaubspause bis ${dayMonth(until)}. Danach bin ich wieder für dich da.`, linkLabel: "Nachricht auf Instagram", linkUrl: SHOP.instagram };
  } },
  { id: "weihnachten", label: "Weihnachtsfrist", icon: "sparkle", make: () => {
    const y = TODAY.slice(0, 4);
    return { tone: "warn", from: "", until: `${y}-12-10`, text: "Weihnachtsbestellungen bitte bis 10. Dezember – dann kommt alles rechtzeitig unter den Baum.", linkLabel: "Zum Etsy-Shop", linkUrl: SHOP.etsy };
  } },
  { id: "markt", label: "Markt am Wochenende", icon: "pin", make: () => {
    const sat = nextWeekday(6);
    const ev = upcomingEvents(10).find((e) => e.date <= addDays(sat, 1)) || null;
    const where = ev ? ev.title : "auf dem Markt";
    return { tone: "info", from: "", until: addDays(sat, 1), text: `Am Wochenende findest du mich ${ev ? "beim " + where : where} – komm vorbei, fühl die Stoffe und probier an!`, linkLabel: "Zu den Terminen", linkUrl: "#termine" };
  } },
  { id: "rabatt", label: "Rabatt", icon: "heart", make: () => ({ tone: "sale", from: TODAY, until: addDays(nextWeekday(0), 0), text: "Nur bis Sonntag: 10 % auf alle Tücher und Stulpen im Etsy-Shop.", linkLabel: "Jetzt stöbern", linkUrl: SHOP.etsy }) },
];

function visibilityText(b) {
  if (!b.active) return { tone: "off", text: "Ausgeschaltet – Besucherinnen sehen ihn nicht." };
  if (!b.text.trim()) return { tone: "warn", text: "Eingeschaltet, aber es fehlt noch ein Text." };
  if (b.from && TODAY < b.from) return { tone: "wait", text: `Eingeschaltet – erscheint ab ${dayMonth(b.from)}.` };
  if (b.until && TODAY > b.until) return { tone: "warn", text: `Der Zeitraum ist am ${dayMonth(b.until)} abgelaufen – der Hinweis wird nicht mehr gezeigt.` };
  return { tone: "on", text: b.until ? `Wird gerade angezeigt – bis einschließlich ${dayMonth(b.until)}.` : "Wird gerade auf deiner Website angezeigt." };
}

export default function renderHinweis(ctx) {
  const b = ctx.content.banner;
  const state = { ...b };

  const previewSlot = h("div", { class: "preview-slot" });
  const visSlot = h("p", { class: "vis-state", "aria-live": "polite" });
  const refresh = () => {
    const linkOk = checkUrl(state.linkUrl).ok;
    previewSlot.replaceChildren(bannerPreview(state, { validLink: linkOk }));
    const v = visibilityText(state);
    visSlot.className = "vis-state vis-" + v.tone;
    visSlot.replaceChildren(icon(v.tone === "on" ? "eye" : v.tone === "off" ? "eyeOff" : "info"), h("span", {}, v.text));
  };
  const commit = (patch) => { Object.assign(state, patch); ctx.save((d) => { d.banner = { ...d.banner, ...patch }; }); refresh(); };

  // --- An/aus
  const onCard = card("", { cls: "card-switch" },
    toggle({ label: "Hinweis auf der Website zeigen", checked: b.active, key: "banner-active", onChange: (v) => commit({ active: v }) }),
    visSlot);

  // --- Vorlagen
  const tplCard = card("Schnell-Vorlagen", { icon: "wand", sub: "Ein Tipp füllt alles aus. Danach kannst du den Text noch anpassen." },
    h("div", { class: "chips-row" }, TEMPLATES.map((t) => btn(t.label, { icon: t.icon, variant: "chip", onClick: () => {
      const before = ctx.content.banner;
      const patch = { ...t.make(before), active: true };
      ctx.save((d) => { d.banner = { ...d.banner, ...patch }; });
      ctx.toast(`Vorlage „${t.label}“ eingesetzt`, { undo: () => { ctx.save((d) => { d.banner = before; }); ctx.rerender(); } });
      ctx.rerender();
      setTimeout(() => document.querySelector('[data-key="banner-text"]')?.focus(), 30);
    } }))));

  // --- Text
  const textField = field({ label: "Text des Hinweises", type: "textarea", rows: 3, value: b.text, key: "banner-text", counter: 140,
    hint: "Kurz und herzlich – ein, zwei Sätze. Bis etwa 140 Zeichen passt er am Handy in zwei Zeilen.",
    onInput: (v) => commit({ text: v }) });

  // --- Farbe
  const groupId = fid("tone");
  const toneGroup = h("fieldset", { class: "tone-group" },
    h("legend", {}, "Farbe"),
    h("div", { class: "tone-chips" }, TONES.map((t) => {
      const id = `${groupId}-${t.id}`;
      return h("label", { class: "tone-chip", for: id },
        h("input", { type: "radio", name: groupId, id, value: t.id, checked: b.tone === t.id, "data-key": "tone-" + t.id, onChange: () => commit({ tone: t.id }) }),
        h("span", { class: `tone-sample bn-${t.id}`, "aria-hidden": "true" }, "Aa"),
        h("span", { class: "tone-text" }, h("strong", {}, t.label), h("span", {}, t.desc)));
    })));

  // --- Link
  const linkLabel = field({ label: "Beschriftung", value: b.linkLabel, key: "banner-linklabel", placeholder: "z. B. Zum Etsy-Shop", onInput: (v) => commit({ linkLabel: v }) });
  const linkUrl = field({ label: "Adresse (Link)", type: "url", value: b.linkUrl, key: "banner-linkurl", placeholder: "https://…", attrs: { inputmode: "url", spellcheck: "false" },
    hint: "Kopiere die Adresse aus deinem Browser. „#termine“ springt zu deinen Terminen.",
    onInput: (v) => { const r = checkUrl(v); linkUrl.setError(""); commit({ linkUrl: v.trim() }); if (!r.ok) state.linkUrl = v; },
    onChange: (v) => { const r = checkUrl(v); linkUrl.setError(r.ok ? "" : r.msg); if (r.ok && r.url !== v) { linkUrl.control.value = r.url; commit({ linkUrl: r.url }); } } });
  if (b.linkUrl && !checkUrl(b.linkUrl).ok) linkUrl.setError(checkUrl(b.linkUrl).msg);
  const linkCard = card("Link (freiwillig)", { icon: "link", sub: "Ein Knopf im Hinweis, z. B. zu deinem Etsy-Shop. Leer lassen, wenn du keinen brauchst." },
    h("div", { class: "form-grid" }, linkLabel, linkUrl),
    btn("Etsy-Shop eintragen", { variant: "ghost", small: true, icon: "bag", onClick: () => { linkLabel.control.value = "Zum Etsy-Shop"; linkUrl.control.value = SHOP.etsy; linkUrl.setError(""); commit({ linkLabel: "Zum Etsy-Shop", linkUrl: SHOP.etsy }); } }));

  // --- Zeitraum
  const dateField = (label, keyName) => {
    const f = field({ label, type: "date", value: b[keyName], key: "banner-" + keyName, onChange: (v) => commit({ [keyName]: v }), onInput: (v) => commit({ [keyName]: v }) });
    f.append(btn("Leeren", { variant: "ghost", small: true, icon: "x", attrs: { "aria-label": `${label} leeren` }, onClick: () => { f.control.value = ""; commit({ [keyName]: "" }); f.control.focus(); } }));
    return f;
  };
  const timeCard = card("Zeitraum (freiwillig)", { icon: "calendar", sub: "Leer lassen = der Hinweis bleibt, bis du ihn ausschaltest. Mit Datum verschwindet er von allein." },
    h("div", { class: "form-grid" }, dateField("Zeigen ab", "from"), dateField("Zeigen bis einschließlich", "until")));

  refresh();

  return h("div", { class: "stack" },
    sectionHeader("Hinweis oben auf der Seite", "Ein schmaler Streifen ganz oben auf deiner Website – für Urlaub, Fristen oder ein kleines Angebot."),
    h("div", { class: "split" },
      h("div", { class: "split-main stack" }, onCard, tplCard,
        card("Text & Farbe", { icon: "edit" }, textField, toneGroup), linkCard, timeCard),
      h("aside", { class: "split-side" },
        h("div", { class: "sticky" }, h("h2", { class: "side-title" }, icon("eye"), h("span", {}, "So sieht es aus")), previewSlot))));
}

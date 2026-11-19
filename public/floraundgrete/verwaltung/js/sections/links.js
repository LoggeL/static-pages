// Links: aktuelle Linkliste (z. B. für die Instagram-Bio)
import { uid } from "../../../shared/store.js";
import { h, icon, btn, iconBtn, sectionHeader, emptyState, openForm, card } from "../ui.js";

const FIELDS = [
  { name: "label", label: "Beschriftung", type: "text", required: true, placeholder: "z. B. Neu: Walk-Stulpen", requiredMsg: "Bitte gib dem Link eine Beschriftung." },
  { name: "url", label: "Adresse (Link)", type: "url", required: true, placeholder: "https://…", hint: "Öffne die Seite im Browser und kopiere die Adresse oben aus der Adresszeile." },
  { name: "note", label: "Kleine Notiz darunter", type: "text", placeholder: "z. B. Für kalte Hände" },
  { name: "highlight", label: "Hervorheben", type: "switch", hint: "Wird als großer, farbiger Knopf gezeigt – gut für dein Wichtigstes." },
  { name: "visible", label: "Auf der Website zeigen", type: "switch", default: true },
];

const host = (url) => { try { return url.startsWith("#") ? "auf deiner Website" : new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

export default function renderLinks(ctx) {
  const links = ctx.content.links;

  const openEditor = (link) => openForm({
    title: link ? "Link bearbeiten" : "Neuer Link",
    fields: FIELDS, values: link || { visible: true, highlight: false },
    submitLabel: link ? "Änderungen speichern" : "Link speichern",
    onSave: (v) => {
      if (link) ctx.save((d) => { const l = d.links.find((x) => x.id === link.id); if (l) Object.assign(l, v); });
      else ctx.save((d) => { d.links.unshift({ id: uid(), ...v }); });
      ctx.toast(link ? "Link gespeichert" : "Link oben in die Liste eingefügt");
      ctx.rerender();
    },
  });

  const move = (i, dir) => {
    const id = links[i].id;
    ctx.save((d) => { const [x] = d.links.splice(i, 1); d.links.splice(i + dir, 0, x); });
    ctx.rerender();
    // Fokus folgt dem verschobenen Eintrag
    const target = document.querySelector(`[data-key="lk-${dir < 0 ? "up" : "down"}-${id}"]`);
    if (target && !target.disabled) target.focus(); else document.querySelector(`[data-key="lk-${dir < 0 ? "down" : "up"}-${id}"]`)?.focus();
  };
  const patch = (id, fn) => { ctx.save((d) => { const l = d.links.find((x) => x.id === id); if (l) fn(l); }); ctx.rerender(); };
  const remove = (link, i) => {
    ctx.save((d) => { d.links = d.links.filter((x) => x.id !== link.id); });
    ctx.toast(`Link „${link.label}“ gelöscht`, { undo: () => { ctx.save((d) => { d.links.splice(i, 0, link); }); ctx.rerender(); } });
    ctx.rerender();
  };

  const item = (l, i) => {
    const hidden = l.visible === false;
    return h("li", { class: "lk" + (l.highlight ? " is-star" : "") + (hidden ? " is-hidden" : "") },
      h("div", { class: "lk-order" },
        iconBtn("up", `„${l.label}“ nach oben`, () => move(i, -1), { disabled: i === 0, attrs: { "data-key": `lk-up-${l.id}` } }),
        h("span", { class: "lk-pos", "aria-hidden": "true" }, i + 1),
        iconBtn("down", `„${l.label}“ nach unten`, () => move(i, 1), { disabled: i === links.length - 1, attrs: { "data-key": `lk-down-${l.id}` } })),
      h("div", { class: "lk-body" },
        h("h3", { class: "lk-title" }, l.highlight ? icon("star", "ico-sm star-on") : null, l.label,
          hidden ? h("span", { class: "tag tag-muted" }, icon("eyeOff", "ico-xs"), "versteckt") : null),
        h("a", { class: "lk-url", href: l.url, target: l.url.startsWith("#") ? null : "_blank", rel: "noopener" }, host(l.url), icon("external", "ico-xs"), h("span", { class: "sr-only" }, " (Link testen, öffnet neuen Tab)")),
        l.note ? h("p", { class: "lk-note" }, l.note) : null),
      h("div", { class: "ev-actions" },
          btn("Bearbeiten", { icon: "edit", small: true, attrs: { "aria-label": `${l.label} bearbeiten`, "data-key": `lk-edit-${l.id}` }, onClick: () => openEditor(l) }),
          iconBtn("star", l.highlight ? `Hervorhebung für ${l.label} entfernen` : `${l.label} hervorheben`, () => patch(l.id, (x) => { x.highlight = !x.highlight; }), { cls: l.highlight ? "is-on" : "", attrs: { "aria-pressed": String(!!l.highlight), "data-key": `lk-star-${l.id}` } }),
          iconBtn(hidden ? "eye" : "eyeOff", hidden ? `${l.label} wieder zeigen` : `${l.label} verstecken`, () => patch(l.id, (x) => { x.visible = x.visible === false; }), { attrs: { "data-key": `lk-vis-${l.id}` } }),
          iconBtn("trash", `${l.label} löschen`, () => remove(l, i), { cls: "icon-btn-danger push" })));
  };

  return h("div", { class: "stack" },
    sectionHeader("Links", "Deine aktuellen Links – praktisch auch für die Instagram-Bio. Mit den Pfeilen änderst du die Reihenfolge.",
      btn("Neuer Link", { icon: "plus", variant: "primary", attrs: { "data-key": "lk-add" }, onClick: () => openEditor(null) })),
    links.length
      ? h("ol", { class: "lk-list" }, links.map(item))
      : h("div", { class: "card" }, emptyState("link", "Noch keine Links", "Füge z. B. deinen Etsy-Shop oder ein neues Lieblingsstück hinzu.", btn("Ersten Link anlegen", { icon: "plus", variant: "primary", onClick: () => openEditor(null) }))),
    card("", { cls: "card-soft" }, h("p", { class: "note" }, icon("star"), h("span", {}, "Tipp: Hebe nur einen Link hervor, dann fällt er richtig auf."))));
}

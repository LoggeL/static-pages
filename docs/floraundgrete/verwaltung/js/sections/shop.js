// Shop: Bestellungen abarbeiten, Artikel pflegen, Versand und Kasse einstellen.
// Klick-Prototyp: alles im Browser. Mit Worker: Artikel und Bestellungen über die API (Bestand und Zahlungen kennt nur der Server).
import { imageSrc, uid } from "../../../shared/store.js";
import { PRODUCTS } from "../../../shared/data.js";
import {
  euro, parseEuro, centsToInput, statusLabel, isTodo, isPaid, availabilityText, normalizeProduct, normalizeShopSettings, trackingUrl,
} from "../../../shared/shop-core.js";
import { h, icon, btn, iconBtn, card, sectionHeader, emptyState, openForm, field, toggle, fid, plural, firstName } from "../ui.js";
import { shrinkPhoto } from "./lookbook.js";
import * as remote from "../remote.js";
import { relDay } from "./common.js";

let tab = "bestellungen"; // 'bestellungen' | 'artikel' | 'kasse'
let orderFilter = "todo";
let loadedOnce = false;

const CARRIERS = [
  { value: "dhl", label: "DHL" },
  { value: "hermes", label: "Hermes" },
  { value: "dpd", label: "DPD" },
  { value: "post", label: "Deutsche Post" },
];
const TONE = { offen: "muted", in_zahlung: "muted", bezahlt: "rose", abholbereit: "rose", verschickt: "sage", abgeholt: "sage", erstattet: "muted", abgebrochen: "muted" };

const isoDay = (iso) => (iso || "").slice(0, 10);
const timeOf = (iso) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const productImg = (p) => (p && p.images && p.images[0] ? imageSrc(p.images[0], "../") : "");

export default function renderShop(ctx) {
  const sub = ctx.sub;
  if (["bestellungen", "artikel", "kasse"].includes(sub)) { tab = sub; ctx.consumeSub(); }
  const c = ctx.content;
  if (ctx.remote && !loadedOnce) { loadedOnce = true; refreshOrders(ctx, { quiet: true }); }
  const todo = c.shop.orders.filter(isTodo).length;

  const tabBtn = (id, label, ic, badge) => h("button", {
    type: "button", role: "tab", id: "shop-tab-" + id, "aria-selected": String(tab === id), "aria-controls": "shop-panel",
    class: "seg" + (tab === id ? " is-active" : ""), tabindex: tab === id ? "0" : "-1", "data-key": "shop-tab-" + id,
    onClick: () => { tab = id; ctx.rerender(); document.getElementById("shop-tab-" + id)?.focus(); },
    onKeydown: (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const ids = ["bestellungen", "artikel", "kasse"];
      tab = ids[(ids.indexOf(tab) + (e.key === "ArrowRight" ? 1 : 2)) % 3];
      ctx.rerender();
      document.getElementById("shop-tab-" + tab)?.focus();
    },
  }, icon(ic), h("span", {}, label), badge ? h("span", { class: "badge badge-inline", "aria-label": `${badge} zu erledigen` }, badge) : null);

  return h("div", { class: "stack" },
    sectionHeader("Shop", "Bestellungen verschicken, Artikel pflegen, Versand einstellen."),
    modeNote(c),
    h("div", { class: "segmented", role: "tablist", "aria-label": "Shop-Bereich" },
      tabBtn("bestellungen", "Bestellungen", "mail", todo), tabBtn("artikel", "Artikel", "bag"), tabBtn("kasse", "Versand & Kasse", "gear")),
    h("div", { id: "shop-panel", role: "tabpanel", "aria-labelledby": "shop-tab-" + tab, class: "stack shop-panel" },
      tab === "bestellungen" ? renderOrders(ctx) : tab === "artikel" ? renderProducts(ctx) : renderSettings(ctx)));
}

function modeNote(c) {
  const hlt = remote.remoteHealth();
  if (!hlt) return h("p", { class: "note note-info" }, icon("info"), h("span", {}, h("strong", {}, "Klick-Prototyp: "), "Bestellungen auf der Website werden nur simuliert und landen hier. Im echten Shop bezahlen Kundinnen über Stripe (Karte, PayPal, Apple Pay)."));
  const text = {
    live: ["Stripe ist live. ", "Bestellungen werden echt bezahlt."],
    test: ["Stripe-Testmodus. ", "Bezahlt wird mit Testkarten, es fließt kein echtes Geld."],
    demo: ["Testbetrieb ohne Stripe. ", "Bestellungen gelten sofort als bezahlt. Nie so online stellen!"],
    off: ["Bezahlung noch nicht eingerichtet. ", "Die Kasse ist gesperrt, bis der Stripe-Schlüssel hinterlegt ist."],
  }[hlt.payments] || ["", ""];
  return h("p", { class: "note " + (hlt.payments === "live" ? "note-info" : "note-warn") }, icon(hlt.payments === "live" ? "lock" : "info"), h("span", {}, h("strong", {}, text[0]), text[1]));
}

// ---------- Bestellungen ----------
async function refreshOrders(ctx, { quiet = false } = {}) {
  try {
    const orders = await remote.fetchOrders();
    ctx.mirror((d) => { d.shop.orders = orders; });
    if (!quiet) ctx.toast("Bestellungen sind aktuell.");
  } catch (e) {
    ctx.toast(`Bestellungen konnten nicht geladen werden: ${e.message}`);
  }
}

function renderOrders(ctx) {
  const c = ctx.content;
  const all = c.shop.orders.filter((o) => o.status !== "abgebrochen" || isoDay(o.createdAt) >= new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10));
  const todo = all.filter(isTodo);
  const list = orderFilter === "todo" ? todo : all;
  const chip = (id, label, n) => h("button", {
    type: "button", class: "filter-chip" + (orderFilter === id ? " is-active" : ""), "aria-pressed": String(orderFilter === id), "data-key": "of-" + id,
    onClick: () => { orderFilter = id; ctx.rerender(); },
  }, h("span", {}, label), h("span", { class: "filter-count" }, n));

  return h("div", { class: "stack" },
    h("div", { class: "row od-bar" },
      h("div", { class: "filter-chips" }, chip("todo", "Zu erledigen", todo.length), chip("alle", "Alle", all.length)),
      ctx.remote ? btn("Neu laden", { icon: "refresh", variant: "ghost", small: true, attrs: { "data-key": "od-reload" }, onClick: () => refreshOrders(ctx) }) : null),
    list.length
      ? h("ul", { class: "od-list" }, list.map((o) => orderCard(ctx, o)))
      : emptyState("bag", orderFilter === "todo" ? "Alles erledigt" : "Noch keine Bestellungen", orderFilter === "todo" ? "Neue bezahlte Bestellungen erscheinen hier – mit allem, was du zum Verschicken brauchst." : "Sobald jemand im Shop bestellt, steht es hier."));
}

function mailto(o, kind) {
  const name = firstName(o.customer.name);
  const items = o.items.map((x) => `– ${x.qty} × ${x.name}${x.option ? ` (${x.option})` : ""}`).join("\n");
  let subject, body;
  if (kind === "versand") {
    const url = trackingUrl(o.carrier, o.tracking);
    subject = `Deine Bestellung ${o.number} ist unterwegs`;
    body = `Hallo ${name},\n\ndeine Bestellung ist gerade auf die Reise gegangen:\n${items}\n\n${o.tracking ? `Sendungsnummer: ${o.tracking}\n${url}\n\n` : ""}Ich wünsche dir ganz viel Freude damit!\n\nLiebe Grüße\nCathrin`;
  } else if (kind === "abholung") {
    subject = `Deine Bestellung ${o.number} liegt bereit`;
    body = `Hallo ${name},\n\ndeine Bestellung liegt im Atelier in Ramsen für dich bereit:\n${items}\n\nWann passt es dir zum Abholen? Schlag mir gern ein, zwei Zeiten vor.\n\nLiebe Grüße\nCathrin`;
  } else {
    subject = `Deine Bestellung ${o.number}`;
    body = `Hallo ${name},\n\n`;
  }
  return `mailto:${encodeURIComponent(o.customer.email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function orderCard(ctx, o) {
  const products = new Map(ctx.content.shop.products.map((p) => [p.id, p]));
  const paid = isPaid(o);
  const when = o.paidAt || o.createdAt;
  const actions = [];
  if (o.status === "bezahlt") actions.push(btn("Als verschickt markieren", { icon: "check", variant: "primary", attrs: { "data-key": `od-ship-${o.id}` }, onClick: () => shipForm(ctx, o) }));
  if (o.status === "abholbereit") {
    actions.push(btn("Als abgeholt markieren", { icon: "check", variant: "primary", attrs: { "data-key": `od-pick-${o.id}` }, onClick: () => setStatus(ctx, o, { status: "abgeholt" }, `${o.number} ist abgeholt.`) }));
    if (o.customer.email) actions.push(h("a", { class: "btn", href: mailto(o, "abholung") }, icon("mail"), h("span", {}, "Abholtermin vorschlagen")));
  }
  if (o.status === "verschickt" && o.customer.email) actions.push(h("a", { class: "btn btn-primary", href: mailto(o, "versand"), "data-key": `od-mail-${o.id}` }, icon("mail"), h("span", {}, "Versand-Mail schreiben")));
  if (o.status === "offen") actions.push(btn("Abbrechen", { icon: "x", variant: "ghost", small: true, onClick: () => setStatus(ctx, o, { status: "abgebrochen" }, `${o.number} abgebrochen, die Stücke sind wieder frei.`) }));
  if (paid) actions.push(btn("Geld erstatten", { icon: "undo", variant: "ghost", small: true, attrs: { "data-key": `od-refund-${o.id}` }, onClick: () => refundForm(ctx, o) }));

  const tracking = o.tracking ? h("p", { class: "od-track" }, icon("pin"),
    h("span", {}, `${(CARRIERS.find((x) => x.value === o.carrier) || CARRIERS[0]).label}: `),
    h("a", { href: trackingUrl(o.carrier, o.tracking), target: "_blank", rel: "noopener" }, o.tracking, h("span", { class: "sr-only" }, " (Sendungsverfolgung, neuer Tab)"))) : null;

  return h("li", { class: `card od od-${o.status}${o.dispute ? " od-dispute" : ""}` },
    h("div", { class: "od-head" },
      h("span", { class: "od-no" }, o.number),
      h("span", { class: `tag tag-${TONE[o.status] || "muted"}` }, statusLabel(o.status)),
      o.sample ? h("span", { class: "tag tag-sample" }, "Beispiel") : null,
      o.demo ? h("span", { class: "tag tag-sample" }, "Testbestellung") : null,
      h("span", { class: "od-when muted small" }, `${relDay(isoDay(when))}, ${timeOf(when)} Uhr`)),
    o.dispute ? h("p", { class: "note note-warn" }, icon("info"), h("span", {}, h("strong", {}, "Rückbuchung: "),
      `Die Kundin hat die Zahlung bei ihrer Bank angefochten (${o.dispute.reason || "ohne Grund"}). Antworte im Stripe-Dashboard mit Fotos, Sendungsnummer und Nachrichten`,
      o.dispute.dueBy ? `, bis spätestens ${new Date(o.dispute.dueBy * 1000).toLocaleDateString("de-DE")}.` : ".")) : null,
    o.note ? h("p", { class: "note note-warn" }, icon("info"), h("span", {}, o.note)) : null,
    h("ul", { class: "od-items" }, o.items.map((x) => {
      const p = products.get(x.productId);
      return h("li", { class: "od-item" },
        productImg(p) ? h("img", { src: productImg(p), alt: "", width: 56, height: 70, loading: "lazy" }) : h("span", { class: "od-noimg", "aria-hidden": "true" }, icon("bag")),
        h("span", { class: "od-item-t" },
          h("strong", {}, `${x.qty > 1 ? `${x.qty} × ` : ""}${x.name}`),
          x.option ? h("span", { class: "muted small" }, x.option) : null,
          x.note ? h("span", { class: "od-itemnote" }, `„${x.note}“`) : null),
        h("span", { class: "od-price" }, euro(x.amount)));
    })),
    h("div", { class: "od-sum" },
      h("span", { class: "muted" }, o.delivery === "abholung" ? "Abholung in Ramsen" : `Versand ${o.shipping ? euro(o.shipping) : "kostenlos"}`),
      h("strong", {}, euro(o.total))),
    h("div", { class: "od-cust" },
      h("p", { class: "od-name" }, o.customer.name || "Ohne Namen"),
      o.delivery === "versand" && o.customer.address ? h("p", { class: "od-addr" }, o.customer.address) : null,
      h("p", { class: "od-contact" },
        o.customer.email ? h("a", { href: mailto(o, "frei") }, icon("mail", "ico-sm"), o.customer.email) : null,
        o.customer.phone ? h("a", { href: `tel:${o.customer.phone.replace(/[^\d+]/g, "")}` }, icon("phone", "ico-sm"), o.customer.phone) : null)),
    tracking,
    actions.length ? h("div", { class: "row od-actions" }, actions) : null);
}

async function applyOrder(ctx, o, patch) {
  if (ctx.remote) {
    const updated = await remote.patchOrder(o.id, patch);
    ctx.mirror((d) => { const i = d.shop.orders.findIndex((x) => x.id === o.id); if (i >= 0) d.shop.orders[i] = updated; });
  } else {
    ctx.save((d) => { const x = d.shop.orders.find((y) => y.id === o.id); if (x) Object.assign(x, patch); });
  }
}

async function setStatus(ctx, o, patch, msg) {
  const before = { status: o.status, tracking: o.tracking, carrier: o.carrier };
  try {
    await applyOrder(ctx, o, patch);
    ctx.rerender();
    const undoable = patch.status !== "abgebrochen";
    ctx.toast(msg, undoable ? { undo: async () => { try { await applyOrder(ctx, { ...o, ...patch }, before); ctx.rerender(); } catch (e) { ctx.toast(e.message); } } } : {});
  } catch (e) { ctx.toast(e.message); }
}

function shipForm(ctx, o) {
  openForm({
    title: `${o.number} verschicken`,
    intro: "Trag die Sendungsnummer ein, dann kannst du sie der Kundin gleich per E-Mail schicken.",
    submitLabel: "Als verschickt markieren",
    values: { carrier: o.carrier || "dhl", tracking: o.tracking || "" },
    fields: [
      { name: "carrier", label: "Versanddienst", type: "choice", options: CARRIERS },
      { name: "tracking", label: "Sendungsnummer", type: "text", placeholder: "z. B. 00340434161234567890", attrs: { maxlength: 40, autocomplete: "off", spellcheck: "false" } },
    ],
    validate: (v) => ({ tracking: v.tracking && !/^[\w-]{6,40}$/.test(v.tracking.replace(/\s/g, "")) ? "Die Nummer sieht ungewöhnlich aus: nur Buchstaben, Ziffern und Bindestriche." : "" }),
    onSave: async (v) => {
      await setStatus(ctx, o, { status: "verschickt", carrier: v.carrier, tracking: v.tracking.replace(/\s/g, "") }, `${o.number} ist verschickt. Schick ihr jetzt noch die Versand-Mail.`);
      setTimeout(() => document.querySelector(`[data-key="od-mail-${o.id}"]`)?.focus(), 60);
    },
  });
}

function refundForm(ctx, o) {
  const hasStock = o.items.some((x) => { const p = ctx.content.shop.products.find((y) => y.id === x.productId); return p && p.stock !== null; });
  openForm({
    title: `${euro(o.total)} erstatten?`,
    intro: ctx.remote && remote.remoteHealth()?.payments !== "demo"
      ? `Das Geld geht über Stripe zurück an ${o.customer.name || "die Kundin"}. Das lässt sich nicht rückgängig machen. Die Stripe-Gebühr bekommst du dabei nicht zurück.`
      : `Im Prototyp wird nur der Status geändert. Im echten Shop geht das Geld über Stripe zurück.`,
    submitLabel: "Jetzt erstatten",
    fields: hasStock ? [{ name: "restock", label: "Stücke wieder in den Shop", type: "switch", default: true, hint: "Wenn du die Ware zurückbekommen hast oder sie nie verschickt wurde." }] : [],
    onSave: async (v) => {
      try {
        if (ctx.remote) {
          const updated = await remote.refundOrder(o.id, !!v.restock);
          ctx.mirror((d) => {
            const i = d.shop.orders.findIndex((x) => x.id === o.id);
            if (i >= 0) d.shop.orders[i] = updated;
          });
          if (v.restock) await reloadProducts(ctx);
        } else {
          ctx.save((d) => {
            const x = d.shop.orders.find((y) => y.id === o.id);
            if (x) x.status = "erstattet";
            if (v.restock) o.items.forEach((it) => { const p = d.shop.products.find((y) => y.id === it.productId); if (p && p.stock !== null) p.stock += it.qty; });
          });
        }
        ctx.rerender();
        ctx.toast(`${o.number} ist erstattet.`);
      } catch (e) { ctx.toast(e.message); }
    },
  });
}

// ---------- Artikel ----------
async function reloadProducts(ctx) {
  const { api } = await import("../../../shared/api.js");
  const out = await api("admin/products");
  ctx.mirror((d) => { d.shop.products = out.products.map((x) => ({ ...normalizeProduct(x), rev: x.rev, reserved: x.reserved })); });
}

const kindOf = (p) => (p.stock === null ? "mass" : p.stock === 1 && !p.multi ? "einzel" : "stueck");

function renderProducts(ctx) {
  const list = [...ctx.content.shop.products].sort((a, b) => a.sort - b.sort);
  return h("div", { class: "stack" },
    h("div", { class: "row" },
      btn("Neuer Artikel", { icon: "plus", variant: "primary", attrs: { "data-key": "ar-new" }, onClick: () => productForm(ctx, null) }),
      h("p", { class: "muted small" }, `${plural(list.filter((p) => p.visible).length, "Artikel", "Artikel")} im Shop sichtbar`)),
    list.length ? h("ul", { class: "ar-list" }, list.map((p, i) => productRow(ctx, p, i, list))) : emptyState("bag", "Noch keine Artikel", "Leg deinen ersten Artikel an. Fotos kannst du danach hinzufügen."));
}

function productRow(ctx, p, i, list) {
  const img = productImg(p);
  const stockText = p.stock === null ? (p.leadTime ? `Auf Maß · ${p.leadTime}` : "Auf Maß genäht") : p.stock === 0 ? "Ausverkauft" : availabilityText({ ...p, available: p.stock - (p.reserved || 0) });
  return h("li", { class: "card ar" + (p.visible ? "" : " is-hidden") },
    h("button", { type: "button", class: "ar-img", "aria-label": `Fotos von ${p.name} bearbeiten`, "data-key": `ar-photos-${p.id}`, onClick: () => photosSheet(ctx, p) },
      img ? h("img", { src: img, alt: "", width: 72, height: 90, loading: "lazy" }) : icon("photo"),
      h("span", { class: "ar-imgcount" }, p.images.length)),
    h("div", { class: "ar-body" },
      h("p", { class: "ar-name" }, p.name, p.visible ? null : h("span", { class: "tag tag-muted" }, "versteckt")),
      h("p", { class: "ar-meta" }, h("strong", {}, euro(p.price)), " · ", stockText, p.reserved ? ` · ${p.reserved} gerade an der Kasse` : ""),
      p.optionValues.length ? h("p", { class: "muted small" }, `${p.optionLabel || "Variante"}: ${p.optionValues.join(", ")}`) : null),
    h("div", { class: "ar-btns" },
      iconBtn("up", `${p.name} nach vorne`, () => move(ctx, list, i, -1), { disabled: i === 0, attrs: { "data-key": `ar-up-${p.id}` } }),
      iconBtn("down", `${p.name} nach hinten`, () => move(ctx, list, i, 1), { disabled: i === list.length - 1, attrs: { "data-key": `ar-down-${p.id}` } }),
      iconBtn(p.visible ? "eye" : "eyeOff", p.visible ? `${p.name} verstecken` : `${p.name} zeigen`, () => saveProduct(ctx, { ...p, visible: !p.visible }, p.visible ? `${p.name} ist jetzt versteckt.` : `${p.name} ist wieder im Shop.`), { attrs: { "data-key": `ar-vis-${p.id}` } }),
      iconBtn("edit", `${p.name} bearbeiten`, () => productForm(ctx, p), { attrs: { "data-key": `ar-edit-${p.id}` } }),
      iconBtn("trash", `${p.name} löschen`, () => removeProduct(ctx, p), { cls: "icon-btn-danger" })));
}

async function saveProduct(ctx, p, msg) {
  try {
    if (ctx.remote) {
      const saved = await remote.saveProduct(p);
      ctx.mirror((d) => { const i = d.shop.products.findIndex((x) => x.id === p.id); if (i >= 0) d.shop.products[i] = saved; else d.shop.products.push(saved); });
    } else {
      ctx.save((d) => {
        const i = d.shop.products.findIndex((x) => x.id === p.id);
        const clean = normalizeProduct(p);
        if (i >= 0) d.shop.products[i] = clean;
        else d.shop.products.push({ ...clean, sort: Math.max(-1, ...d.shop.products.map((x) => x.sort)) + 1 });
      });
    }
    ctx.rerender();
    if (msg) ctx.toast(msg);
    return true;
  } catch (e) {
    // Konflikt: jemand hat inzwischen gekauft – aktuellen Stand übernehmen
    if (e.status === 409 && e.data && e.data.product) {
      const cur = e.data.product;
      ctx.mirror((d) => { const i = d.shop.products.findIndex((x) => x.id === cur.id); if (i >= 0) d.shop.products[i] = { ...normalizeProduct(cur), rev: cur.rev, reserved: cur.reserved }; });
      ctx.rerender();
    }
    ctx.toast(e.message);
    return false;
  }
}

async function move(ctx, list, i, dir) {
  const ids = list.map((p) => p.id);
  const [x] = ids.splice(i, 1);
  ids.splice(i + dir, 0, x);
  const apply = (d) => { ids.forEach((id, n) => { const p = d.shop.products.find((y) => y.id === id); if (p) p.sort = n; }); };
  try {
    if (ctx.remote) { await remote.sortProducts(ids); ctx.mirror(apply); } else ctx.save(apply);
  } catch (e) { ctx.toast(e.message); return; }
  ctx.rerender();
  const t = document.querySelector(`[data-key="ar-${dir < 0 ? "up" : "down"}-${x}"]`);
  if (t && !t.disabled) t.focus(); else document.querySelector(`[data-key="ar-${dir < 0 ? "down" : "up"}-${x}"]`)?.focus();
}

async function removeProduct(ctx, p) {
  const idx = ctx.content.shop.products.findIndex((x) => x.id === p.id);
  try {
    if (ctx.remote) { await remote.deleteProduct(p.id); ctx.mirror((d) => { d.shop.products = d.shop.products.filter((x) => x.id !== p.id); }); }
    else ctx.save((d) => { d.shop.products = d.shop.products.filter((x) => x.id !== p.id); });
  } catch (e) { ctx.toast(e.message); return; }
  ctx.rerender();
  ctx.toast(`${p.name} gelöscht. Alte Bestellungen bleiben erhalten.`, {
    undo: async () => {
      const { rev, reserved, ...rest } = p;
      if (ctx.remote) await saveProduct(ctx, rest);
      else ctx.save((d) => { d.shop.products.splice(Math.max(0, idx), 0, p); });
      ctx.rerender();
    },
  });
}

function productForm(ctx, p) {
  const isNew = !p;
  const v = p || { name: "", subtitle: "", price: 0, stock: 1, optionLabel: "Farbe", optionValues: [], noteLabel: "", leadTime: "", description: "", details: [], visible: true, images: [] };
  openForm({
    title: isNew ? "Neuer Artikel" : `${p.name} bearbeiten`,
    submitLabel: isNew ? "Anlegen" : "Speichern",
    values: {
      name: v.name, subtitle: v.subtitle, price: v.price ? centsToInput(v.price) : "", kind: kindOf(v), stock: v.stock === null ? "" : String(v.stock),
      optionLabel: v.optionLabel, optionValues: v.optionValues.join(", "), noteLabel: v.noteLabel, leadTime: v.leadTime,
      description: v.description, details: v.details.join("\n"), visible: v.visible,
    },
    fields: [
      { name: "name", label: "Name", type: "text", required: true, placeholder: "z. B. Rock Lene", requiredMsg: "Bitte gib dem Artikel einen Namen.", attrs: { maxlength: 80 } },
      { name: "subtitle", label: "Kurz dazu", type: "text", placeholder: "z. B. Leinenrock im Vintage-Stil", attrs: { maxlength: 120 } },
      { name: "price", label: "Preis in €", type: "text", required: true, placeholder: "z. B. 65,00", requiredMsg: "Bitte gib einen Preis an.", attrs: { inputmode: "decimal", maxlength: 10 } },
      { name: "kind", label: "Wie viele gibt es?", type: "choice", options: [
        { value: "einzel", label: "Einzelstück" }, { value: "stueck", label: "Mehrere fertig" }, { value: "mass", label: "Nähe ich auf Bestellung" }] },
      { name: "stock", label: "Anzahl fertig", type: "text", hint: "Nur bei „Mehrere fertig“. Sinkt bei jedem Verkauf von selbst.", attrs: { inputmode: "numeric", maxlength: 3 } },
      { name: "leadTime", label: "Nähzeit", type: "text", hint: "Bei Stücken auf Bestellung, z. B. „Nähzeit 1–2 Wochen“.", attrs: { maxlength: 60 } },
      { name: "optionLabel", label: "Auswahl heißt", type: "text", placeholder: "z. B. Farbe oder Größe", attrs: { maxlength: 40 } },
      { name: "optionValues", label: "Auswahlmöglichkeiten", type: "textarea", rows: 2, hint: "Mit Komma getrennt. Leer lassen, wenn es nichts auszuwählen gibt.", placeholder: "Grün, Flieder, Senfgelb", attrs: { maxlength: 600 } },
      { name: "noteLabel", label: "Pflichtangabe der Kundin", type: "text", hint: "Zum Beispiel „Taillenumfang und Wunschlänge“. Leer lassen, wenn nichts nötig ist.", attrs: { maxlength: 80 } },
      { name: "description", label: "Beschreibung", type: "textarea", rows: 3, attrs: { maxlength: 1200 } },
      { name: "details", label: "Details, eins pro Zeile", type: "textarea", rows: 3, placeholder: "Länge ca. 68 cm\nWaschbar bis 40 °C", attrs: { maxlength: 1200 } },
      { name: "visible", label: "Im Shop zeigen", type: "switch", default: true },
    ],
    validate: (x) => {
      const cents = parseEuro(x.price);
      const stock = Number(x.stock);
      return {
        price: !Number.isFinite(cents) ? "Bitte als Betrag eingeben, z. B. 65 oder 49,90." : cents <= 0 || cents > 500000 ? "Bitte einen Preis zwischen 0,01 € und 5.000 €." : "",
        stock: x.kind === "stueck" && !(Number.isInteger(stock) && stock >= 0 && stock <= 999) ? "Bitte eine ganze Zahl von 0 bis 999." : "",
      };
    },
    onSave: async (x) => {
      const next = {
        ...(p || {}),
        id: p ? p.id : (x.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "artikel") + "-" + uid().slice(0, 4),
        name: x.name, subtitle: x.subtitle, price: parseEuro(x.price),
        stock: x.kind === "mass" ? null : x.kind === "einzel" ? 1 : Number(x.stock),
        leadTime: x.leadTime, optionLabel: x.optionLabel, optionValues: x.optionValues.split(/,|\n/).map((s) => s.trim()).filter(Boolean),
        noteLabel: x.noteLabel, description: x.description, details: x.details.split("\n").map((s) => s.trim()).filter(Boolean), visible: x.visible,
        images: p ? p.images : [],
      };
      const ok = await saveProduct(ctx, next, isNew ? `${next.name} angelegt. Jetzt noch Fotos dazu?` : `${next.name} gespeichert.`);
      if (ok && isNew) setTimeout(() => photosSheet(ctx, ctx.content.shop.products.find((y) => y.id === next.id) || next), 120);
    },
  });
}

// ---------- Fotos eines Artikels ----------
function photosSheet(ctx, product) {
  let p = structuredClone(product);
  const tid = fid("ph");
  const statusEl = h("p", { class: "pick-status", role: "status", "aria-live": "polite" });
  const listEl = h("ul", { class: "ph-list" });
  const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, class: "sr-only", tabindex: "-1", "aria-hidden": "true" });
  const uploadBtn = btn("Fotos hochladen", { icon: "upload", variant: "primary", onClick: () => fileInput.click() });

  const commit = async (images, msg) => {
    const ok = await saveProduct(ctx, { ...p, images }, null);
    if (ok) { p = structuredClone(ctx.content.shop.products.find((x) => x.id === p.id) || { ...p, images }); draw(); statusEl.textContent = msg; }
  };
  const draw = () => {
    listEl.replaceChildren(...(p.images.length ? p.images.map((img, i) => h("li", { class: "ph" + (i === 0 ? " is-cover" : "") },
      h("img", { src: imageSrc(img, "../"), alt: `Foto ${i + 1}`, width: 120, height: 150, loading: "lazy" }),
      i === 0 ? h("span", { class: "ph-cover" }, "Titelbild") : null,
      h("span", { class: "ph-btns" },
        i > 0 ? iconBtn("star", "Als Titelbild", () => { const a = [...p.images]; a.unshift(a.splice(i, 1)[0]); commit(a, "Titelbild geändert."); }) : null,
        iconBtn("trash", `Foto ${i + 1} entfernen`, () => commit(p.images.filter((_, n) => n !== i), "Foto entfernt."), { cls: "icon-btn-danger" }))))
      : [h("li", { class: "ph-empty muted" }, "Noch keine Fotos. Das erste wird das Titelbild.")]));
  };
  fileInput.addEventListener("change", async () => {
    const files = [...(fileInput.files || [])].slice(0, 8);
    fileInput.value = "";
    if (!files.length) return;
    uploadBtn.disabled = true;
    const added = [];
    for (const [n, f] of files.entries()) {
      statusEl.textContent = `Foto ${n + 1} von ${files.length} wird vorbereitet …`;
      try { added.push(await remote.storeImage(await shrinkPhoto(f))); } catch { statusEl.textContent = "Ein Foto ließ sich nicht öffnen. Probier es mit JPG oder PNG."; }
    }
    uploadBtn.disabled = false;
    if (added.length) await commit([...p.images, ...added].slice(0, 12), `${plural(added.length, "Foto", "Fotos")} hinzugefügt.`);
  });

  const existing = PRODUCTS.flatMap((x) => x.images);
  const pickGrid = h("ul", { class: "pick-grid" }, existing.map((file) => h("li", {}, h("button", { type: "button", class: "pick", "aria-label": `Foto ${file} hinzufügen`,
    onClick: () => { if (!p.images.includes(file)) commit([...p.images, file].slice(0, 12), "Foto hinzugefügt."); } },
  h("img", { src: `../img/${file}`, alt: "", loading: "lazy", width: 120, height: 150 })))));

  const dlg = h("dialog", { class: "sheet sheet-wide", "aria-labelledby": tid },
    h("div", { class: "sheet-form" },
      h("div", { class: "sheet-head" }, h("h2", { id: tid }, `Fotos: ${p.name}`), iconBtn("x", "Schließen", () => dlg.close(), { cls: "sheet-x" })),
      h("div", { class: "sheet-body" },
        listEl,
        h("div", { class: "row" }, uploadBtn, fileInput), statusEl,
        h("details", { class: "ph-more" }, h("summary", {}, "Oder ein Foto aus deinen bisherigen Shop-Fotos"), pickGrid)),
      h("div", { class: "sheet-actions" }, btn("Fertig", { variant: "primary", icon: "check", onClick: () => dlg.close() }))));
  dlg.addEventListener("close", () => { const opener = dlg._opener; dlg.remove(); ctx.rerender(); if (opener && opener.isConnected) opener.focus(); else document.querySelector(`[data-key="ar-photos-${p.id}"]`)?.focus(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg._opener = document.activeElement;
  document.body.append(dlg);
  draw();
  dlg.showModal();
}

// ---------- Versand & Kasse ----------
function renderSettings(ctx) {
  const s = normalizeShopSettings(ctx.content.shop.settings);
  const set = (fn, msg) => { ctx.save((d) => { d.shop.settings = normalizeShopSettings(d.shop.settings); fn(d.shop.settings); }); if (msg) ctx.toast(msg); };
  const euroField = (label, cents, key, onOk, hint, allowEmpty) => {
    const f = field({
      label, hint, value: cents ? centsToInput(cents) : allowEmpty ? "" : "0,00", key, attrs: { inputmode: "decimal", maxlength: 9 },
      onChange: (raw) => {
        if (allowEmpty && !raw.trim()) { f.setError(""); onOk(0); return; }
        const c = parseEuro(raw);
        if (!Number.isFinite(c) || c > 100000) { f.setError("Bitte als Betrag eingeben, z. B. 5,90."); return; }
        f.setError("");
        onOk(c);
      },
    });
    return f;
  };
  const hlt = remote.remoteHealth();
  return h("div", { class: "stack" },
    card("Shop auf der Website", { icon: "bag", cls: "card-switch" },
      toggle({ label: "Shop zeigen", checked: s.enabled, key: "set-enabled", hint: "Ausgeschaltet verschwindet der Shop samt Warenkorb von der Seite.", onChange: (on) => { set((x) => { x.enabled = on; }, on ? "Der Shop ist wieder sichtbar." : "Der Shop ist ausgeblendet."); ctx.rerender(); } })),
    card("Versand", { icon: "stall" },
      toggle({ label: "Versand anbieten", checked: s.shipping.enabled, key: "set-ship", onChange: (on) => { if (!on && !s.pickup.enabled) { ctx.toast("Mindestens Versand oder Abholung muss an sein."); ctx.rerender(); return; } set((x) => { x.shipping.enabled = on; }); ctx.rerender(); } }),
      h("div", { class: "grid-2" },
        euroField("Versandkosten", s.shipping.flat, "set-flat", (c) => set((x) => { x.shipping.flat = c; })),
        euroField("Kostenlos ab (freiwillig)", s.shipping.freeFrom, "set-free", (c) => set((x) => { x.shipping.freeFrom = c; }), "Leer lassen für immer Versandkosten.", true)),
      field({ label: "Versandart", value: s.shipping.label, key: "set-shiplabel", attrs: { maxlength: 100 }, onChange: (t) => set((x) => { x.shipping.label = t.trim() || x.shipping.label; }) }),
      field({ label: "Lieferzeit", value: s.shipping.days, key: "set-days", attrs: { maxlength: 40 }, onChange: (t) => set((x) => { x.shipping.days = t.trim(); }) })),
    card("Abholung", { icon: "door" },
      toggle({ label: "Abholung im Atelier anbieten", checked: s.pickup.enabled, key: "set-pickup", onChange: (on) => { if (!on && !s.shipping.enabled) { ctx.toast("Mindestens Versand oder Abholung muss an sein."); ctx.rerender(); return; } set((x) => { x.pickup.enabled = on; }); ctx.rerender(); } }),
      field({ label: "Hinweis zur Abholung", value: s.pickup.note, key: "set-pickupnote", attrs: { maxlength: 160 }, onChange: (t) => set((x) => { x.pickup.note = t.trim(); }) })),
    card("Preise und Rechtliches", { icon: "info" },
      toggle({ label: "Kleinunternehmerin (§ 19 UStG)", checked: s.smallBusiness, key: "set-ku", hint: "Dann steht bei den Preisen „keine Umsatzsteuer nach § 19 UStG“ statt „inkl. MwSt.“. Kläre das mit deiner Steuerberatung.", onChange: (on) => set((x) => { x.smallBusiness = on; }) }),
      field({ label: "Hinweis an der Kasse", type: "textarea", rows: 3, value: s.legalNote, key: "set-legal", counter: 400, attrs: { maxlength: 400 }, hint: "Steht bei Maßanfertigungen und auf der Bezahlseite.", onChange: (t) => set((x) => { x.legalNote = t.trim(); }) })),
    card("Bezahlung", { icon: "lock", sub: hlt ? `Stand: ${{ live: "Stripe live", test: "Stripe-Testmodus", demo: "Test ohne Stripe", off: "nicht eingerichtet" }[hlt.payments]}` : "Klick-Prototyp" },
      h("p", {}, "Kundinnen bezahlen auf der sicheren Seite von Stripe: Karte, PayPal, Apple Pay, Google Pay. Kartendaten landen nie auf deiner Website."),
      h("ul", { class: "mini-list" },
        h("li", {}, "Gebühren pro Zahlung, keine Grundgebühr (Karte etwa 1,5 % + 0,25 €)."),
        h("li", {}, "Das Geld kommt automatisch auf dein Konto, meist nach wenigen Tagen."),
        h("li", {}, "Rückbuchungen siehst du hier bei der Bestellung und beantwortest sie im Stripe-Dashboard.")),
      h("a", { class: "btn btn-ghost btn-sm self-start", href: "https://dashboard.stripe.com/", target: "_blank", rel: "noopener" }, icon("external"), h("span", {}, "Stripe-Dashboard"), h("span", { class: "sr-only" }, " (neuer Tab)"))));
}

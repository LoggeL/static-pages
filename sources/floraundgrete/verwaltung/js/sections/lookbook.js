// Lookbook: Fotos von Stücken, die Cathrin schon genäht hat (nicht nachbestellbar)
import { uid, imageSrc } from "../../../shared/store.js";
import { PRODUCTS } from "../../../shared/data.js";
import { h, icon, btn, iconBtn, sectionHeader, emptyState, openForm, card, fid } from "../ui.js";

const STORE_KEY = "cathrin-raasch-cms-v3"; // wie in shared/store.js – zum Prüfen, ob ein Foto wirklich gespeichert wurde
const MAX_EDGE = 1400;
const QUALITY = 0.82;
const WARN_ONE = 1.5e6; // ein Foto größer als ~1,5 MB
const WARN_ALL = 3.5e6; // alle hochgeladenen Fotos zusammen größer als ~3,5 MB

const FIELDS = [
  { name: "title", label: "Titel", type: "text", required: true, placeholder: "z. B. Kleid aus alter Bettwäsche", requiredMsg: "Bitte gib dem Foto einen kurzen Titel.", attrs: { maxlength: 80 } },
  { name: "year", label: "Jahr", type: "text", placeholder: "z. B. 2024", attrs: { inputmode: "numeric", maxlength: 20 } },
  { name: "note", label: "Ein Satz dazu", type: "textarea", rows: 2, placeholder: "z. B. Aus einer alten Tischdecke genäht", attrs: { maxlength: 200 } },
  { name: "visible", label: "Auf der Website zeigen", type: "switch", default: true, hint: "Ausgeschaltet bleibt das Foto nur hier in deiner Liste." },
];

let storageProblem = false; // zuletzt passte ein Foto nicht mehr in den Speicher

const isUpload = (img) => /^data:image\//.test(img || "");
const mb = (n) => (n / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + " MB";
const uploadBytes = (items) => items.reduce((sum, x) => sum + (isUpload(x.image) ? x.image.length : 0), 0);
const productOf = (file) => PRODUCTS.find((p) => p.images.includes(file));

/** Steht das Bild nach dem Speichern wirklich im Browser-Speicher? */
function storedImage(id) {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const item = (JSON.parse(raw).lookbook || []).find((x) => x.id === id);
    return item ? item.image : null;
  } catch { return null; }
}

// ---------- Foto vom Gerät verkleinern ----------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
    img.src = url;
  });
}

/** Datei -> verkleinerte JPEG-data:-URL (längste Seite max. 1400 px) */
export async function shrinkPhoto(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error("type");
  let src;
  try { src = await createImageBitmap(file); } catch { src = await loadImage(file); }
  const w0 = src.width || src.naturalWidth;
  const h0 = src.height || src.naturalHeight;
  if (!w0 || !h0) throw new Error("decode");
  const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w0 * scale);
  canvas.height = Math.round(h0 * scale);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff"; // durchsichtige PNGs bekommen weißen statt schwarzen Hintergrund
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(src, 0, 0, canvas.width, canvas.height);
  if (src.close) src.close();
  let url = canvas.toDataURL("image/jpeg", QUALITY);
  if (url.length > WARN_ONE) url = canvas.toDataURL("image/jpeg", 0.7); // sehr detailreiche Fotos etwas stärker packen
  return url;
}

// ---------- Foto auswählen (Gerät oder Shop) ----------
function openPicker({ title, used, onPick }) {
  const tid = fid("pick");
  const statusEl = h("p", { class: "pick-status", role: "status", "aria-live": "polite" });
  let busy = false;
  const fileInput = h("input", { type: "file", accept: "image/*", class: "sr-only", tabindex: "-1", "aria-hidden": "true", "data-key": "lb-file" });
  const uploadBtn = btn("Foto vom Gerät hochladen", { icon: "upload", variant: "primary", attrs: { "data-key": "lb-upload" }, onClick: () => fileInput.click() });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file || busy) return;
    busy = true;
    uploadBtn.disabled = true;
    statusEl.className = "pick-status";
    statusEl.textContent = "Foto wird vorbereitet …";
    try {
      const image = await shrinkPhoto(file);
      dlg.close();
      onPick(image, null);
    } catch {
      statusEl.className = "pick-status field-error";
      statusEl.textContent = "Diese Datei konnte ich nicht als Foto öffnen. Probier es mit einem JPG- oder PNG-Foto.";
      uploadBtn.disabled = false;
      uploadBtn.focus();
    } finally { busy = false; }
  });

  const groups = PRODUCTS.map((p) => h("section", { class: "pick-group", "aria-labelledby": `${tid}-${p.id}` },
    h("h4", { class: "pick-title", id: `${tid}-${p.id}` }, p.name),
    h("ul", { class: "pick-grid" }, p.images.map((file, i) => {
      const isUsed = used.includes(file);
      return h("li", {}, h("button", { type: "button", class: "pick" + (isUsed ? " is-used" : ""), "data-key": "pick-" + file,
        "aria-label": `${p.name}, Foto ${i + 1}${isUsed ? " (schon im Lookbook)" : ""}`,
        onClick: () => { dlg.close(); onPick(file, p); } },
        h("img", { src: `../img/${file}`, alt: "", loading: "lazy", decoding: "async", width: 120, height: 150 }),
        isUsed ? h("span", { class: "pick-used", "aria-hidden": "true" }, icon("check")) : null));
    }))));

  const dlg = h("dialog", { class: "sheet sheet-wide", "aria-labelledby": tid },
    h("div", { class: "sheet-form" },
      h("div", { class: "sheet-head" }, h("h2", { id: tid }, title), iconBtn("x", "Schließen", () => dlg.close(), { cls: "sheet-x" })),
      h("div", { class: "sheet-body" },
        h("section", { class: "pick-upload" },
          h("h3", { class: "pick-h" }, "Eigenes Foto"),
          h("p", { class: "muted small" }, "Von deinem Handy oder Computer. Es wird automatisch verkleinert."),
          uploadBtn, fileInput, statusEl),
        h("section", { class: "pick-shop" },
          h("h3", { class: "pick-h" }, "Oder ein Foto aus deinem Shop"),
          groups)),
      h("div", { class: "sheet-actions" }, btn("Abbrechen", { variant: "ghost", onClick: () => dlg.close() }))));
  dlg.addEventListener("close", () => { const opener = dlg._opener; dlg.remove(); if (opener && opener.isConnected) opener.focus(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("cancel", (e) => { if (busy) e.preventDefault(); });
  dlg._opener = document.activeElement;
  document.body.append(dlg);
  dlg.showModal();
  uploadBtn.focus();
  return dlg;
}

export default function renderLookbook(ctx) {
  const items = ctx.content.lookbook || [];
  const used = items.map((x) => x.image);
  const total = uploadBytes(items);
  const samples = items.filter((x) => x.sample).length;

  /** Speichern; bei hochgeladenen Fotos prüfen, ob sie wirklich im Speicher stehen. Sonst zurück und freundlicher Hinweis. */
  const saveChecked = (mutate, id, image) => {
    const before = ctx.content.lookbook;
    ctx.save(mutate);
    if (!isUpload(image) || storedImage(id) === image) { storageProblem = false; return true; }
    ctx.save((d) => { d.lookbook = before; });
    storageProblem = true;
    ctx.toast("Das Foto passt nicht mehr in den Speicher. Lösch ein anderes hochgeladenes Foto und versuch es noch einmal.", { duration: 9000 });
    ctx.rerender();
    return false;
  };

  const sizeWarning = (image) => {
    if (!isUpload(image)) return "";
    if (image.length > WARN_ONE) return `Dieses Foto ist recht groß (${mb(image.length)}). Wenn es nicht klappt, nimm am besten ein kleineres Foto.`;
    if (total + image.length > WARN_ALL) return `Der Speicher für deine Fotos ist fast voll (${mb(total + image.length)}). Vielleicht magst du alte Fotos löschen.`;
    return "";
  };

  const preview = (image, text) => h("span", { class: "lb-form-pv" }, h("img", { src: imageSrc(image, "../"), alt: "", width: 72, height: 90 }), h("span", {}, text));

  // Neuer Eintrag: Foto wählen, dann Titel & Co.
  const addNew = () => {
    const opener = document.activeElement;
    openPicker({ title: "Foto fürs Lookbook", used, onPick: (image, product) => {
      const warn = sizeWarning(image);
      const form = openForm({
        title: "Neues Foto im Lookbook",
        intro: preview(image, warn || "Schön! Gib dem Foto noch einen kurzen Titel."),
        fields: FIELDS, values: { title: product ? product.name : "", year: "", note: "", visible: true },
        submitLabel: "Ins Lookbook",
        onSave: (v) => {
          const id = uid();
          const ok = saveChecked((d) => { d.lookbook = [{ id, image, ...v }, ...(d.lookbook || [])]; }, id, image);
          if (ok) {
            ctx.toast("Foto oben ins Lookbook eingefügt");
            ctx.rerender();
            setTimeout(() => document.querySelector(`[data-key="lb-edit-${id}"]`)?.focus(), 0);
          }
        },
      });
      // Abbrechen: zurück zum Knopf, mit dem alles anfing
      form._opener = opener;
    } });
  };

  // Foto tauschen: Beispielbild wird damit zum eigenen Eintrag
  const replace = (item) => openPicker({ title: `Foto tauschen: ${item.title || "Lookbook"}`, used, onPick: (image) => {
    const prev = { image: item.image, sample: !!item.sample };
    const ok = saveChecked((d) => { const x = d.lookbook.find((y) => y.id === item.id); if (x) { x.image = image; delete x.sample; } }, item.id, image);
    if (!ok) return;
    const warn = sizeWarning(image);
    ctx.toast(warn || "Foto getauscht", { undo: () => { ctx.save((d) => { const x = d.lookbook.find((y) => y.id === item.id); if (x) { x.image = prev.image; if (prev.sample) x.sample = true; } }); ctx.rerender(); } });
    ctx.rerender();
    document.querySelector(`[data-key="lb-photo-${item.id}"]`)?.focus();
  } });

  const edit = (item) => openForm({
    title: "Foto bearbeiten",
    intro: preview(item.image, item.sample ? "Das ist noch ein Beispielbild aus deinem Shop. Über „Foto tauschen“ ersetzt du es durch ein eigenes." : ""),
    fields: FIELDS, values: item,
    submitLabel: "Änderungen speichern",
    onSave: (v) => {
      ctx.save((d) => { const x = d.lookbook.find((y) => y.id === item.id); if (x) Object.assign(x, v); });
      ctx.toast("Gespeichert");
      ctx.rerender();
    },
  });

  const move = (i, dir) => {
    const id = items[i].id;
    ctx.save((d) => { const [x] = d.lookbook.splice(i, 1); d.lookbook.splice(i + dir, 0, x); });
    ctx.rerender();
    const t = document.querySelector(`[data-key="lb-${dir < 0 ? "up" : "down"}-${id}"]`);
    if (t && !t.disabled) t.focus(); else document.querySelector(`[data-key="lb-${dir < 0 ? "down" : "up"}-${id}"]`)?.focus();
  };
  const toggleVisible = (item) => { ctx.save((d) => { const x = d.lookbook.find((y) => y.id === item.id); if (x) x.visible = x.visible === false; }); ctx.rerender(); };
  const remove = (item, i) => {
    ctx.save((d) => { d.lookbook = d.lookbook.filter((x) => x.id !== item.id); });
    storageProblem = false;
    ctx.toast(`„${item.title || "Foto"}“ gelöscht`, { undo: () => { ctx.save((d) => { d.lookbook.splice(Math.min(i, d.lookbook.length), 0, item); }); ctx.rerender(); } });
    ctx.rerender();
  };

  const row = (item, i) => {
    const hidden = item.visible === false;
    const label = item.title || "Foto ohne Titel";
    const product = item.sample ? productOf(item.image) : null;
    return h("li", { class: "lb" + (hidden ? " is-hidden" : "") + (item.sample ? " is-sample" : "") },
      h("div", { class: "lk-order" },
        iconBtn("up", `„${label}“ nach vorne`, () => move(i, -1), { disabled: i === 0, attrs: { "data-key": `lb-up-${item.id}` } }),
        h("span", { class: "lk-pos", "aria-hidden": "true" }, i + 1),
        iconBtn("down", `„${label}“ nach hinten`, () => move(i, 1), { disabled: i === items.length - 1, attrs: { "data-key": `lb-down-${item.id}` } })),
      h("img", { class: "lb-thumb", src: imageSrc(item.image, "../"), alt: "", width: 80, height: 100, loading: "lazy", decoding: "async" }),
      h("div", { class: "lb-body" },
        item.sample || hidden ? h("p", { class: "ev-tags" },
          item.sample ? h("span", { class: "tag tag-sample" }, "Beispielbild") : null,
          hidden ? h("span", { class: "tag tag-muted" }, icon("eyeOff", "ico-xs"), "versteckt") : null) : null,
        h("h3", { class: "lb-title" }, label),
        item.year || item.note ? h("p", { class: "lb-meta" }, [item.year, item.note].filter(Boolean).join(" · ")) : null,
        product ? h("p", { class: "lb-src small muted" }, `Aus dem Shop: ${product.name}`) : null),
      h("div", { class: "ev-actions" },
        btn("Bearbeiten", { icon: "edit", small: true, attrs: { "data-key": `lb-edit-${item.id}`, "aria-label": `${label} bearbeiten` }, onClick: () => edit(item) }),
        btn("Foto tauschen", { icon: "photo", small: true, variant: item.sample ? "soft" : "ghost", attrs: { "data-key": `lb-photo-${item.id}`, "aria-label": `Foto für ${label} tauschen` }, onClick: () => replace(item) }),
        iconBtn(hidden ? "eye" : "eyeOff", hidden ? `${label} wieder zeigen` : `${label} verstecken`, () => toggleVisible(item), { attrs: { "data-key": `lb-vis-${item.id}` } }),
        iconBtn("trash", `${label} löschen`, () => remove(item, i), { cls: "icon-btn-danger push", attrs: { "data-key": `lb-del-${item.id}` } })));
  };

  const addBtn = btn("Foto hinzufügen", { icon: "plus", variant: "primary", attrs: { "data-key": "lb-add" }, onClick: addNew });

  return h("div", { class: "stack" },
    sectionHeader("Lookbook", "Stücke, die du schon genäht hast – zum Anschauen, nicht zum Nachbestellen. Mit den Pfeilen änderst du die Reihenfolge.", addBtn),
    storageProblem ? h("p", { class: "note note-warn", role: "alert" }, icon("info"), h("span", {},
      h("strong", {}, "Das letzte Foto ließ sich nicht speichern. "), "Der Speicher dieses Browsers ist voll. Lösch ein hochgeladenes Foto, das du nicht mehr brauchst, oder nimm ein Foto aus deinem Shop.")) : null,
    samples ? h("p", { class: "note note-info" }, icon("photo"), h("span", {},
      h("strong", {}, "Beispielbilder: "), "Diese Fotos sind Platzhalter aus deinem Shop. Tausch sie nach und nach gegen Fotos deiner bisherigen Projekte.")) : null,
    items.length
      ? h("ol", { class: "lb-list" }, items.map(row))
      : h("div", { class: "card" }, emptyState("photo", "Noch keine Fotos im Lookbook", "Zeig hier, was du schon genäht hast – ein Foto vom Handy reicht.", btn("Erstes Foto hinzufügen", { icon: "plus", variant: "primary", attrs: { "data-key": "lb-add-empty" }, onClick: addNew }))),
    total ? h("p", { class: total > WARN_ALL ? "note note-warn" : "small muted" }, total > WARN_ALL ? icon("info") : null, h("span", {},
      total > WARN_ALL ? `Deine hochgeladenen Fotos belegen ${mb(total)} – der Speicher ist fast voll. Lösch alte Fotos, bevor du neue hinzufügst.` : `Hochgeladene Fotos belegen ${mb(total)} Speicher.`)) : null,
    card("", { cls: "card-soft" }, h("p", { class: "note" }, icon("info"), h("span", {}, "Tipp: Fotos bei Tageslicht vor einer ruhigen Wand wirken im Lookbook am schönsten."))));
}

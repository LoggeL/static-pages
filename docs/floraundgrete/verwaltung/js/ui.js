// Kleine UI-Helfer für die Verwaltung: DOM-Bau, Icons, Toasts, Speicheranzeige, Formular-Dialog.

/** h('div', {class:'x', onClick: fn}, 'Text', child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// ---------- Icons (inline SVG, 24er Raster, Strich) ----------
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15 8.5a5 5 0 0 1 0 7"/><path d="M18 6a8.5 8.5 0 0 1 0 12"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  scissors: '<circle cx="6" cy="6.5" r="2.8"/><circle cx="6" cy="17.5" r="2.8"/><path d="M8.3 8.2 20 18M8.3 15.8 20 6"/>',
  bag: '<path d="M5 8h14l-1 12.5H6L5 8Z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/>',
  door: '<path d="M4 21h16"/><path d="M6 21V4h12v17"/><circle cx="14.5" cy="12.5" r=".9" fill="currentColor"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10C19.5 15.6 12 20 12 20Z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8L12 3.5Z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.6 6.6A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  phone: '<path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1.5 1.5 0 0 1-1.5 1.5A16.5 16.5 0 0 1 3.5 5.5 1.5 1.5 0 0 1 5 4Z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  doorOpen: '<path d="M3 21h18"/><path d="M6 21V4h9"/><path d="M15 4l4 1.5V21"/><path d="M15 4v17"/><circle cx="12.5" cy="12.5" r=".9" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6L20 8.7"/><path d="M20 4v4.7h-4.7"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  sparkle: '<path d="M12 3.5c.6 4.4 2.6 6.9 7 8.5-4.4 1.6-6.4 4.1-7 8.5-.6-4.4-2.6-6.9-7-8.5 4.4-1.6 6.4-4.1 7-8.5Z"/>',
  google: '<path d="M20.5 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.6-3.9 2.6-6.5Z"/><path d="M12 21c2.4 0 4.4-.8 5.9-2.2L15 16.6c-.8.5-1.8.9-3 .9-2.3 0-4.3-1.6-5-3.7H4v2.3A9 9 0 0 0 12 21Z"/><path d="M7 13.8a5.4 5.4 0 0 1 0-3.5V8H4a9 9 0 0 0 0 8.1l3-2.3Z"/><path d="M12 6.6c1.3 0 2.5.5 3.4 1.3L18 5.4A9 9 0 0 0 4 8l3 2.3c.7-2.1 2.7-3.7 5-3.7Z"/>',
  dog: '<path d="M6 9.5 4 4l4.5 2.5"/><path d="M18 9.5 20 4l-4.5 2.5"/><path d="M8.5 6.5h7A3.5 3.5 0 0 1 19 10v3a7 7 0 0 1-14 0v-3a3.5 3.5 0 0 1 3.5-3.5Z"/><circle cx="9.5" cy="11.5" r=".8" fill="currentColor"/><circle cx="14.5" cy="11.5" r=".8" fill="currentColor"/><path d="M11 15h2l-1 1.2-1-1.2Z" fill="currentColor"/>',
  wand: '<path d="M4 20 15 9"/><path d="m14 5 1-2 1 2 2 1-2 1-1 2-1-2-2-1 2-1ZM19 12l.6-1.4L21 10l-1.4-.6L19 8l-.6 1.4L17 10l1.4.6L19 12Z"/>',
  photo: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17.5 5-4.5 3.5 3 3-2.5 4.5 4"/>',
  upload: '<path d="M12 15V4M7 8.5 12 4l5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  stall: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0"/><path d="M5.5 12v8h13v-8M10 20v-4.5h4V20"/>',
};

export function icon(name, cls = "") {
  const span = document.createElement("span");
  span.className = "ico " + cls;
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ""}</svg>`;
  return span;
}

/** Knopf mit Icon + Text. variant: 'primary' | 'ghost' | 'soft' | 'danger' */
export function btn(label, { icon: ic, variant = "soft", onClick, small, title, type = "button", attrs = {} } = {}) {
  return h("button", { type, class: `btn btn-${variant}${small ? " btn-sm" : ""}`, onClick, title, ...attrs }, ic ? icon(ic) : null, h("span", {}, label));
}
export function linkBtn(label, href, { icon: ic, variant = "soft", newTab, small, attrs = {} } = {}) {
  return h("a", { class: `btn btn-${variant}${small ? " btn-sm" : ""}`, href, target: newTab ? "_blank" : null, rel: newTab ? "noopener" : null, ...attrs },
    ic ? icon(ic) : null, h("span", {}, label), newTab ? h("span", { class: "sr-only" }, " (öffnet neuen Tab)") : null);
}
/** Nur-Icon-Knopf mit unsichtbarem Text */
export function iconBtn(ic, label, onClick, { disabled, cls = "", attrs = {} } = {}) {
  return h("button", { type: "button", class: "icon-btn " + cls, "aria-label": label, title: label, onClick, disabled, ...attrs }, icon(ic));
}

let fieldSeq = 0;
export const fid = (p = "f") => `${p}-${++fieldSeq}`;

/** Ein-/Aus-Schalter mit Beschriftung */
export function toggle({ label, checked, onChange, hint, id = fid("sw"), key }) {
  const input = h("input", { type: "checkbox", role: "switch", id, checked, "data-key": key, onChange: (e) => onChange(e.target.checked) });
  return h("label", { class: "switch", for: id },
    input, h("span", { class: "switch-track", "aria-hidden": "true" }, h("span", { class: "switch-thumb" })),
    h("span", { class: "switch-text" }, h("span", { class: "switch-label" }, label), hint ? h("span", { class: "switch-hint" }, hint) : null));
}

/** Beschriftetes Feld (input/textarea/select) */
export function field({ label, hint, type = "text", value = "", onInput, onChange, placeholder, id = fid(), key, rows = 3, options, maxlength, attrs = {}, counter, error }) {
  let control;
  const hintId = hint ? id + "-hint" : null;
  const errId = id + "-err";
  const described = [hintId, errId].filter(Boolean).join(" ");
  if (type === "textarea") control = h("textarea", { id, rows, placeholder, "data-key": key || id, maxlength, "aria-describedby": described, ...attrs });
  else if (type === "select") control = h("select", { id, "data-key": key || id, "aria-describedby": described, ...attrs },
    options.map((o) => h("option", { value: o.value, selected: String(o.value) === String(value) }, o.label)));
  else control = h("input", { id, type, placeholder, "data-key": key || id, maxlength, "aria-describedby": described, ...attrs });
  if (type !== "select") control.value = value ?? "";
  const countEl = counter ? h("span", { class: "counter", "aria-live": "off" }) : null;
  const errEl = h("p", { class: "field-error", id: errId, hidden: true });
  const updateCount = () => {
    if (!countEl) return;
    const n = control.value.length;
    countEl.textContent = `${n} / ${counter} Zeichen`;
    countEl.classList.toggle("over", n > counter);
  };
  updateCount();
  if (onInput) control.addEventListener("input", (e) => { updateCount(); onInput(e.target.value, e); });
  else control.addEventListener("input", updateCount);
  if (onChange) control.addEventListener("change", (e) => onChange(e.target.value, e));
  const wrap = h("div", { class: "field" },
    h("div", { class: "field-head" }, h("label", { for: id }, label), countEl),
    hint ? h("p", { class: "field-hint", id: hintId }, hint) : null,
    control, errEl);
  wrap.control = control;
  wrap.setError = (msg) => {
    errEl.hidden = !msg; errEl.textContent = msg || "";
    control.setAttribute("aria-invalid", msg ? "true" : "false");
    wrap.classList.toggle("has-error", !!msg);
  };
  if (error) wrap.setError(error);
  return wrap;
}

export function card(title, { icon: ic, cls = "", actions, sub } = {}, ...body) {
  return h("section", { class: "card " + cls },
    title ? h("div", { class: "card-head" },
      ic ? h("span", { class: "card-ico" }, icon(ic)) : null,
      h("div", { class: "card-titles" }, h("h2", { class: "card-title" }, title), sub ? h("p", { class: "card-sub" }, sub) : null),
      actions || null) : null,
    ...body);
}

export function emptyState(ic, title, text, action) {
  return h("div", { class: "empty" }, h("span", { class: "empty-ico" }, icon(ic)), h("p", { class: "empty-title" }, title), text ? h("p", { class: "empty-text" }, text) : null, action || null);
}

export function sectionHeader(title, lead, extra) {
  return h("header", { class: "section-head" },
    h("h1", { tabindex: "-1", class: "section-title" }, title),
    lead ? h("p", { class: "lead" }, lead) : null, extra || null);
}

// ---------- Links prüfen ----------
/** Gibt {ok, url, msg} zurück; ergänzt https:// bei "instagram.com/…" */
export function checkUrl(raw, { allowEmpty = true, allowHash = true } = {}) {
  const v = (raw || "").trim();
  if (!v) return allowEmpty ? { ok: true, url: "" } : { ok: false, url: "", msg: "Bitte gib eine Adresse ein." };
  if (allowHash && v.startsWith("#")) return { ok: true, url: v };
  if (/^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v) || /^tel:[+\d\s/-]{5,}$/i.test(v)) return { ok: true, url: v };
  let u = v;
  if (!/^https?:\/\//i.test(u)) {
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(u) && !u.includes(" ")) u = "https://" + u;
    else return { ok: false, url: v, msg: "Das sieht noch nicht wie eine Internetadresse aus. Beispiel: https://www.etsy.com/de/shop/FloraundGrete" };
  }
  try {
    const parsed = new URL(u);
    if (!parsed.hostname.includes(".") || /\s/.test(u)) throw new Error();
    return { ok: true, url: u };
  } catch {
    return { ok: false, url: v, msg: "Diese Adresse stimmt so nicht ganz. Kopier sie am besten direkt aus der Adresszeile deines Browsers." };
  }
}

// ---------- Toasts mit Rückgängig ----------
let toastTimer = null;
export function toast(message, { undo, undoLabel = "Rückgängig", duration } = {}) {
  const region = document.getElementById("toasts");
  region.replaceChildren();
  clearTimeout(toastTimer);
  const close = () => { el.classList.add("leaving"); setTimeout(() => el.remove(), 200); };
  const el = h("div", { class: "toast" },
    h("span", { class: "toast-msg" }, icon(undo ? "check" : "check"), h("span", {}, message)),
    undo ? h("button", { type: "button", class: "toast-undo", onClick: () => {
      close(); undo();
      requestAnimationFrame(() => {
        const a = document.activeElement;
        if (a && a !== document.body && !el.contains(a)) return;
        const t = document.querySelector("#main h1") || document.getElementById("main");
        if (t) { if (!t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: true }); }
      });
    } }, icon("undo"), h("span", {}, undoLabel)) : null,
    h("button", { type: "button", class: "toast-close", "aria-label": "Hinweis schließen", onClick: close }, icon("x")));
  region.append(el);
  toastTimer = setTimeout(close, duration || (undo ? 9000 : 3500));
}

// ---------- Speicheranzeige ----------
let liveTimer = null;
export function markSaved(date = new Date(), { pending = false, announce = true } = {}) {
  const time = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  document.querySelectorAll("[data-savestate]").forEach((el) => {
    el.classList.toggle("is-pending", pending);
    el.querySelector(".save-text").textContent = pending ? "Speichert …" : `Alles gespeichert · ${time}`;
    if (!pending) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
  });
  // Ansage für Screenreader erst, wenn kurz Ruhe ist (sonst bei jedem Tastendruck)
  clearTimeout(liveTimer);
  if (announce && !pending) liveTimer = setTimeout(() => {
    const live = document.getElementById("save-live");
    if (live) live.textContent = `Gespeichert um ${time} Uhr`;
  }, 1200);
}

// ---------- Formular-Dialog (Bottom-Sheet auf dem Handy) ----------
/**
 * openForm({ title, intro, fields:[{name,label,type,hint,required,placeholder,rows,url:true}], values, submitLabel, onSave(values), validate(values) })
 * type: text | date | textarea | url | switch | choice (große Auswahlknöpfe, options:[{value,label,icon}])
 * validate(values) -> { feldname: "Fehlermeldung" } für Prüfungen über mehrere Felder (z. B. „bis“ nicht vor „von“)
 */
export function openForm({ title, intro, fields, values = {}, submitLabel = "Speichern", onSave, onClose, validate }) {
  const dlg = h("dialog", { class: "sheet", "aria-labelledby": "sheet-title" });
  const controls = {};
  const body = fields.map((f) => {
    if (f.type === "choice") {
      const gid = fid("choice");
      const val = values[f.name] ?? f.default ?? f.options[0].value;
      const hintId = f.hint ? gid + "-hint" : null;
      const set = h("fieldset", { class: "choice-group", "aria-describedby": hintId },
        h("legend", { class: "field-label" }, f.label),
        h("div", { class: "choice-chips" }, f.options.map((o) => {
          const id = `${gid}-${o.value}`;
          return h("label", { class: "choice-chip", for: id },
            h("input", { type: "radio", name: f.name, id, value: o.value, checked: String(o.value) === String(val),
              onChange: () => { controls[f.name].value = o.value; if (f.onChange) f.onChange(o.value, dlg); } }),
            o.icon ? icon(o.icon) : null, h("span", {}, o.label));
        })),
        f.hint ? h("p", { class: "field-hint", id: hintId }, f.hint) : null);
      controls[f.name] = { value: val, el: set };
      return set;
    }
    if (f.type === "switch") {
      let val = values[f.name] !== undefined ? !!values[f.name] : !!f.default;
      const t = toggle({ label: f.label, hint: f.hint, checked: val, onChange: (v) => { controls[f.name].value = v; } });
      controls[f.name] = { value: val, el: t };
      return t;
    }
    const fl = field({ label: f.label + (f.required ? "" : " (freiwillig)"), hint: f.hint, type: f.type === "url" ? "url" : f.type, value: values[f.name] ?? "", placeholder: f.placeholder, rows: f.rows, attrs: { name: f.name, ...(f.required ? { required: true, "aria-required": "true" } : {}), ...(f.type === "url" ? { inputmode: "url", autocomplete: "url", spellcheck: "false" } : {}), ...(f.attrs || {}) } });
    controls[f.name] = { el: fl, get value() { return fl.control.value; } };
    if (f.type === "url") fl.control.addEventListener("blur", () => { const r = checkUrl(fl.control.value, { allowEmpty: !f.required }); fl.setError(r.ok ? "" : r.msg); if (r.ok) fl.control.value = r.url; });
    fl.control.addEventListener("input", () => fl.classList.contains("has-error") && fl.setError(""));
    return fl;
  });
  const form = h("form", { class: "sheet-form", novalidate: true, onSubmit: (e) => {
    e.preventDefault();
    const out = {};
    let firstBad = null;
    for (const f of fields) {
      const c = controls[f.name];
      if (f.type === "switch") { out[f.name] = !!c.value; continue; }
      if (f.type === "choice") { out[f.name] = c.value; continue; }
      let v = String(c.value).trim();
      let msg = "";
      if (f.required && !v) msg = f.requiredMsg || `Bitte fülle „${f.label}“ aus.`;
      if (!msg && f.type === "url") { const r = checkUrl(v, { allowEmpty: !f.required }); if (!r.ok) msg = r.msg; else v = r.url; }
      c.el.setError(msg);
      if (msg && !firstBad) firstBad = c.el.control;
      out[f.name] = v;
    }
    if (!firstBad && validate) {
      for (const [name, msg] of Object.entries(validate(out) || {})) {
        if (!msg || !controls[name]?.el.setError) continue;
        controls[name].el.setError(msg);
        if (!firstBad) firstBad = controls[name].el.control;
      }
    }
    if (firstBad) { firstBad.focus(); return; }
    onSave(out);
    dlg.close();
  } },
    h("div", { class: "sheet-head" }, h("h2", { id: "sheet-title" }, title), iconBtn("x", "Schließen ohne zu speichern", () => dlg.close(), { cls: "sheet-x" })),
    intro ? h("p", { class: "sheet-intro" }, intro) : null,
    h("div", { class: "sheet-body" }, body),
    h("div", { class: "sheet-actions" },
      btn("Abbrechen", { variant: "ghost", onClick: () => dlg.close() }),
      btn(submitLabel, { variant: "primary", icon: "check", type: "submit" })));
  dlg.append(form);
  dlg.addEventListener("close", () => {
    const opener = dlg._opener;
    const key = opener && opener.dataset ? opener.dataset.key : null;
    dlg.remove();
    onClose && onClose();
    const target = opener && opener.isConnected ? opener
      : key ? document.querySelector(`#main [data-key="${CSS.escape(key)}"]`) : null;
    if (target) target.focus();
  });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg._opener = document.activeElement;
  document.body.append(dlg);
  dlg.showModal();
  const first = dlg.querySelector(".sheet-body input[type=radio]:checked, .sheet-body input:not([type=checkbox]):not([type=radio]), .sheet-body textarea");
  if (first) first.focus();
  return dlg;
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const firstName = (name) => (name || "").trim().split(/\s+/)[0] || "";

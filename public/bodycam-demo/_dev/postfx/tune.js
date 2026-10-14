// Ein gemeinsamer Editor für verschachtelte Parameter, ohne Zahlenlimits im Eingabefeld.
export function createTunePanel(params, { onChange = () => {}, title = 'PostFX-Parameter' } = {}) {
  const defaults = JSON.parse(JSON.stringify(params));
  const element = document.createElement('section');
  const heading = document.createElement('h1');
  heading.className = 'tune-heading';
  heading.textContent = title;
  const note = document.createElement('p');
  note.className = 'tune-note';
  note.textContent = 'Alle Werte wirken sofort. Zahlenfelder haben keine festen Grenzen; der Reglerbereich wächst bei Bedarf.';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'tune-search';
  search.placeholder = 'Parameter suchen …';
  search.setAttribute('aria-label', 'Parameter suchen');
  const fields = document.createElement('div');
  const actions = document.createElement('div');
  actions.className = 'tune-actions';
  const json = document.createElement('textarea');
  json.className = 'tune-json';
  json.spellcheck = false;
  json.hidden = true;
  json.setAttribute('aria-label', 'Parameter als JSON');
  const message = document.createElement('p');
  message.className = 'tune-message';
  message.setAttribute('role', 'status');
  element.append(heading, note, search, fields, actions, json, message);
  const bindings = [];
  const groups = [];
  let controlId = 0;

  const tell = (text, error = false) => {
    message.textContent = text;
    message.dataset.error = String(error);
  };

  function sliderRange(slider, value) {
    const magnitude = Math.max(Math.abs(value), 0.000001);
    const span = value === 0 ? 1 : magnitude * 2;
    slider.min = String(value < 0 ? value - span : 0);
    slider.max = String(value > 0 ? value + span : span);
    slider.step = 'any';
  }

  function addFields(parent, object, path = '') {
    for (const key of Object.keys(object)) {
      const value = object[key];
      const fullPath = path ? `${path}.${key}` : key;
      if (value && typeof value === 'object') {
        const group = document.createElement('details');
        group.className = 'tune-group';
        group.dataset.path = fullPath;
        const summary = document.createElement('summary');
        summary.textContent = Array.isArray(value) ? `${key} [${value.length}]` : key;
        const children = document.createElement('div');
        children.className = 'tune-children';
        group.append(summary, children);
        parent.append(group);
        groups.push(group);
        addFields(children, value, fullPath);
        continue;
      }
      if (!['number', 'boolean', 'string'].includes(typeof value)) continue;
      const row = document.createElement('div');
      row.className = 'tune-field';
      row.dataset.path = fullPath;
      const label = document.createElement('label');
      const id = `postfx-tune-${controlId++}`;
      label.htmlFor = id;
      label.textContent = key;
      label.title = fullPath;
      const input = document.createElement('input');
      input.id = id;
      input.name = fullPath;
      input.setAttribute('aria-label', fullPath);
      row.append(label);
      let slider = null;
      if (typeof value === 'number') {
        input.type = 'number';
        input.step = 'any';
        input.value = String(value);
        slider = document.createElement('input');
        slider.type = 'range';
        slider.setAttribute('aria-label', `${fullPath} Regler`);
        sliderRange(slider, value);
        slider.value = String(value);
        row.append(slider);
        slider.addEventListener('input', () => {
          object[key] = Number(slider.value);
          input.value = slider.value;
          onChange(fullPath, object[key]);
        });
      } else if (typeof value === 'boolean') {
        input.type = 'checkbox';
        input.checked = value;
      } else {
        input.type = 'text';
        input.value = value;
      }
      input.addEventListener('input', () => {
        if (typeof value === 'number') {
          const number = input.valueAsNumber;
          if (!Number.isFinite(number)) return;
          object[key] = number;
          if (number < Number(slider.min) || number > Number(slider.max)) sliderRange(slider, number);
          slider.value = String(number);
        } else {
          object[key] = typeof value === 'boolean' ? input.checked : input.value;
        }
        onChange(fullPath, object[key]);
      });
      row.append(input);
      parent.append(row);
      bindings.push({ object, key, input, slider, row, path: fullPath.toLowerCase() });
    }
  }

  function filter() {
    const query = search.value.trim().toLowerCase();
    for (const binding of bindings) binding.row.hidden = !binding.path.includes(query);
    for (let i = groups.length - 1; i >= 0; --i) {
      const group = groups[i];
      group.hidden = !Array.from(group.querySelectorAll('.tune-field')).some((row) => !row.hidden);
      if (query && !group.hidden) group.open = true;
    }
  }

  function rebuild() {
    const open = new Set(groups.filter((group) => group.open).map((group) => group.dataset.path));
    fields.replaceChildren();
    bindings.length = 0;
    groups.length = 0;
    addFields(fields, params);
    for (const group of groups) group.open = open.has(group.dataset.path);
    filter();
  }

  function refresh() {
    for (const { object, key, input, slider } of bindings) {
      if (document.activeElement === input || document.activeElement === slider) continue;
      const value = object[key];
      if (input.type === 'checkbox') input.checked = value;
      else input.value = String(value);
      if (slider && Number.isFinite(value)) {
        if (value < Number(slider.min) || value > Number(slider.max)) sliderRange(slider, value);
        slider.value = String(value);
      }
    }
  }

  function importJSON(source) {
    const incoming = typeof source === 'string' ? JSON.parse(source) : source;
    const changes = [];
    function validate(target, patch, path = '') {
      if (!patch || typeof patch !== 'object' || Array.isArray(target) !== Array.isArray(patch)) throw new Error(`${path || 'Parameter'}: Objekt erwartet.`);
      if (Array.isArray(target) && patch.length !== target.length) throw new Error(`${path}: ${target.length} Einträge erwartet.`);
      for (const key of Object.keys(patch)) {
        const fullPath = path ? `${path}.${key}` : key;
        if (['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(target, key)) throw new Error(`Unbekannter Parameter: ${fullPath}`);
        const value = patch[key];
        if (target[key] && typeof target[key] === 'object') validate(target[key], value, fullPath);
        else {
          if (typeof value !== typeof target[key] || (typeof value === 'number' && !Number.isFinite(value))) throw new Error(`Ungültiger Wert: ${fullPath}`);
          changes.push([target, key, value]);
        }
      }
    }
    validate(params, incoming);
    for (const [target, key, value] of changes) target[key] = value;
    rebuild();
    onChange('*', params);
    tell(`${changes.length} Werte übernommen.`);
    return changes.length;
  }

  const exportJSON = () => JSON.stringify(params, null, 2);
  const reset = () => importJSON(defaults);
  function button(label, action) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.addEventListener('click', () => {
      try { action(); } catch (error) { tell(error.message, true); }
    });
    actions.append(node);
  }
  button('JSON exportieren', () => {
    json.value = exportJSON();
    json.hidden = false;
    tell('JSON steht im Textfeld. Es kann hier auch bearbeitet und importiert werden.');
  });
  button('JSON importieren', () => {
    if (json.hidden) {
      json.hidden = false;
      json.placeholder = 'Parameter-JSON hier einfügen, dann erneut importieren.';
      json.focus();
    } else importJSON(json.value);
  });
  button('JSON herunterladen', () => {
    const url = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'bodycam-postfx.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  button('Zurücksetzen', reset);
  search.addEventListener('input', filter);
  rebuild();
  return { element, refresh, rebuild, exportJSON, importJSON, reset, dispose: () => element.remove() };
}

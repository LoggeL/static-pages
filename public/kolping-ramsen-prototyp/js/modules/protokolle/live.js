// =========================================================
// protokolle/live.js – Simulierte Live-Zusammenarbeit
// Ein zweiter (erfundener) Schreiber tippt sichtbar mit:
// farbiger Cursor mit Namensfähnchen, markierter Absatz,
// Zahlen in Abstimmungsfeldern. Alles abbrechbar (AbortSignal).
// Im echten System: Yjs/Hocuspocus über WebSocket.
// =========================================================

export class Aborted extends Error {}

/** Warten, abbrechbar */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new Aborted());
    const t = setTimeout(() => { signal && signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Aborted()); };
    signal && signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Farbiger Cursor mit Namensfähnchen (nicht editierbar, verschwindet beim Speichern durch sanitizeHTML) */
export function caretEl(person) {
  const c = document.createElement('span');
  c.className = 'protokolle-caret';
  c.setAttribute('contenteditable', 'false');
  c.setAttribute('aria-hidden', 'true');
  c.dataset.name = person.firstName;
  c.style.setProperty('--pc', person.color);
  return c;
}
export function removeCarets(root = document) {
  for (const c of root.querySelectorAll('.protokolle-caret')) {
    const parent = c.parentNode; c.remove(); parent && parent.normalize && parent.normalize();
  }
  for (const s of root.querySelectorAll('.protokolle-remote-sel')) {
    const parent = s.parentNode; s.replaceWith(...s.childNodes); parent && parent.normalize && parent.normalize();
  }
  for (const p of root.querySelectorAll('.protokolle-remote-p')) p.classList.remove('protokolle-remote-p');
}

/** Cursor ans Ende des letzten Absatzes setzen („liest gerade hier“). → Element des Cursors */
export function placeCaretAtEnd(area, person) {
  removeCarets(area);
  let target = area.querySelector('p:last-of-type, li:last-of-type') || area;
  const c = caretEl(person);
  target.append(c);
  return c;
}

/** Ein Wort im Text farbig markieren (wie eine fremde Auswahl). → Aufräumfunktion */
export function markWord(area, word, person) {
  const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const i = n.data.indexOf(word);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i); r.setEnd(n, i + word.length);
    const s = document.createElement('span');
    s.className = 'protokolle-remote-sel';
    s.style.setProperty('--pc', person.color);
    try { r.surroundContents(s); } catch { return () => {}; }
    s.after(caretEl(person));
    return () => removeCarets(area);
  }
  return () => {};
}

/**
 * Text sichtbar in einen Editor-Bereich tippen (neuer Absatz am Ende).
 * Ändert nur den eigenen Absatz – die Auswahl der echten Person bleibt erhalten.
 * onTick() wird gelegentlich aufgerufen (z. B. Wort fertig → speichern).
 */
export async function typeInto(area, text, person, { signal, onTick, speed = 55 } = {}) {
  removeCarets(area);
  const p = document.createElement('p');
  p.className = 'protokolle-remote-p';
  p.style.setProperty('--pc', person.color);
  const tn = document.createTextNode('');
  const caret = caretEl(person);
  p.append(tn, caret);
  // leere Absätze am Ende ersetzen, statt einen weiteren anzuhängen
  const last = area.lastElementChild;
  if (last && last.tagName === 'P' && !last.textContent.trim() && !last.querySelector('img')) last.replaceWith(p);
  else area.append(p);
  try {
    for (let i = 0; i < text.length; i++) {
      if (!area.isConnected) throw new Aborted();
      tn.appendData(text[i]);
      const ch = text[i];
      let wait = speed + Math.random() * speed * 0.9;
      if (ch === ' ') { wait += 30; onTick && onTick(); }
      if (/[.,:!?]/.test(ch)) wait += 260;
      await sleep(wait, signal);
    }
    onTick && onTick();
    await sleep(1600, signal);
  } finally {
    caret.remove();
    setTimeout(() => p.classList.remove('protokolle-remote-p'), 5000);
  }
  return p;
}

/** Zahlen nacheinander in Eingabefelder „tippen“ (löst input-Events aus, damit der Zustand mitkommt) */
export async function typeIntoInputs(pairs, person, { signal } = {}) {
  for (const { input, value } of pairs) {
    if (!input.isConnected) throw new Aborted();
    input.classList.add('protokolle-remote-input');
    input.style.setProperty('--pc', person.color);
    input.value = '';
    try {
      for (const ch of String(value)) {
        await sleep(260 + Math.random() * 200, signal);
        if (!input.isConnected) throw new Aborted();
        input.value += ch;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await sleep(500, signal);
    } finally {
      input.classList.remove('protokolle-remote-input');
    }
  }
}

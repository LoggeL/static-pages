// Crownward – winzige DOM-Helfer für das UI-Overlay (kein Framework).

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

/** Erzeugt ein Element: el('div.klasse.zwei', { title: '…' }, kinder…) */
export function el<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag as K);
  if (classes.length) node.className = classes.join(' ');
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = String(v);
      else if (k === 'html') node.innerHTML = String(v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Setzt Text nur bei Änderung (vermeidet unnötige Layout-Arbeit pro Frame). */
export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Schaltet eine Klasse nur bei Änderung. */
export function toggleClass(node: Element, cls: string, on: boolean): void {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
}

/** Sichtbarkeit über das hidden-Attribut. */
export function show(node: HTMLElement, visible: boolean): void {
  if (node.hidden === visible) node.hidden = !visible;
}

/** Fokussierbare Bedienelemente innerhalb eines Containers (sichtbar und aktiv). */
export function focusables(root: HTMLElement): HTMLElement[] {
  const list = root.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]');
  return Array.from(list).filter((n) => {
    if ((n as HTMLButtonElement).disabled) return false;
    if (n.closest('[hidden]')) return false;
    return n.offsetParent !== null || n === document.activeElement;
  });
}

// Qualitätsstufen für 3D: Geräteprobe (ohne three), automatische Vorwahl, Merken der Wahl.

const SOFT = /SwiftShader|llvmpipe|softpipe|Software|Basic Render|Microsoft Basic/i;
const WEAK = /Mali-(4|T)|Adreno \(TM\) [3-5]\d\d|PowerVR|Intel.*(HD|UHD) Graphics|Intel\(R\) (HD|UHD)|GMA|Mesa Intel/i;
const STRONG = /Apple M\d|RTX|GeForce (GTX|RTX)|Radeon (RX|Pro)|Arc\b|Adreno \(TM\) [7-9]\d\d|Apple GPU/i;

export const CLASS_LABEL = {
  software: 'Software-Rendering', phone_weak: 'einfaches Handy', phone: 'Handy',
  laptop_weak: 'einfacher Rechner', laptop: 'Laptop', desktop_strong: 'starker Rechner',
};

// Angaben ohne WebGL (Hauptthread, kostet nichts)
function hostInfo() {
  return {
    coarse: matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches,
    ios: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    mem: navigator.deviceMemory, // undefined in Safari/Firefox: Kriterium entfällt
    cores: navigator.hardwareConcurrency,
    screenPx: screen.width * screen.height * devicePixelRatio ** 2,
  };
}

// WebGL-Teil der Probe; läuft im Hauptthread und (als Quelltext) im Probe-Worker.
// Der Kontext wird sofort wieder freigegeben.
function glProbe(make) {
  const strict = make().getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  const gl = strict ?? make().getContext('webgl2');
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  const d = {
    webgl2: !!gl,
    // Chrome liefert bei Software-Rendering nur ohne failIfMajorPerformanceCaveat einen Kontext
    software: !!gl && !strict,
    renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : null, // null: Grafikchip unbekannt (maskiert)
    maxTex: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0,
  };
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return d;
}

// Volle Probe im Hauptthread (bei Bedarf: Qualitätsmenü, „3D laden“). Das Anlegen des Kontexts
// blockiert bei Software-Rendering (SwiftShader) den Hauptthread um eine Sekunde und mehr.
export function probe() {
  return { ...glProbe(() => document.createElement('canvas')), ...hostInfo() };
}

// Frühe Probe nach dem ersten Kartenbild in einem Worker (OffscreenCanvas): blockiert die Karte nicht.
// Ergebnis null, wenn der Browser WebGL 2 in Workern nicht kann – dann folgt probe() bei Bedarf.
const WORKER_SRC = `const glProbe = ${glProbe.toString()};
onmessage = () => {
  if (typeof OffscreenCanvas === 'undefined') { postMessage({ unsupported: 'OffscreenCanvas fehlt' }); return; }
  const d = glProbe(() => new OffscreenCanvas(1, 1));
  postMessage(d.webgl2 ? d : { unsupported: 'kein WebGL 2 in OffscreenCanvas' });
};`;
export function probeInWorker() {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    const w = new Worker(url);
    const done = () => { w.terminate(); URL.revokeObjectURL(url); };
    w.onmessage = (e) => {
      done();
      if (e.data.unsupported) { console.info(`Geräteprobe im Worker nicht möglich (${e.data.unsupported}) – Probe erst bei Bedarf.`); resolve(null); }
      else resolve({ ...e.data, ...hostInfo() });
    };
    w.onerror = (e) => { e.preventDefault?.(); done(); reject(new Error(`Probe-Worker ausgefallen: ${e.message || 'unbekannter Fehler'}`)); };
    w.postMessage(0);
  });
}

// Geräteklasse nach der ersten zutreffenden Regel samt Gründen für den Grundtext
export function classify(d) {
  const why = [];
  const r = d.renderer ?? '';
  if (d.software || SOFT.test(r)) return { cls: 'software', why: ['kein Grafikprozessor erkannt'] };
  const mem = d.mem, cores = d.cores;
  const weak = WEAK.test(r), strong = STRONG.test(r);
  if (d.coarse || d.ios) {
    why.push(d.ios ? 'iPhone/iPad' : 'Touch-Gerät');
    if (mem !== undefined && mem <= 3) why.push(`${mem} GB Speicher`);
    if (cores <= 4) why.push(`${cores} Kerne`);
    if (weak) why.push('einfacher Grafikchip');
    if (d.maxTex < 4096) why.push(`Texturen bis ${d.maxTex} px`);
    const cls = (mem !== undefined && mem <= 3) || cores <= 4 || weak || d.maxTex < 4096 ? 'phone_weak' : 'phone';
    if (cls === 'phone') why.push(`${cores} Kerne`);
    if (!d.renderer) why.push('Grafikchip unbekannt');
    return { cls, why };
  }
  if (weak || (mem !== undefined && mem <= 4) || cores <= 4) {
    if (weak) why.push('einfacher Grafikchip');
    if (mem !== undefined && mem <= 4) why.push(`${mem} GB Speicher`);
    if (cores <= 4) why.push(`${cores} Kerne`);
    return { cls: 'laptop_weak', why };
  }
  if (strong && (mem === undefined || mem >= 8) && cores >= 8) {
    return { cls: 'desktop_strong', why: [`${cores} Kerne`, 'starker Grafikchip', ...(mem === undefined ? ['Speicher unbekannt'] : [])] };
  }
  why.push(`${cores} Kerne`);
  if (!d.renderer) why.push('Grafikchip unbekannt');
  if (mem === undefined) why.push('Speicher unbekannt');
  return { cls: 'laptop', why };
}

export class Quality {
  constructor(cfg, pathname) {
    this.cfg = cfg;
    this.tiers = cfg.splats.tiers;
    this.key = `grundstueck-viewer:quality:v1:${pathname}`;
    // Die Geräteprobe legt einen WebGL-Kontext an; das kostet bei Software-Rendering
    // Hunderte Millisekunden. Sie läuft deshalb erst nach dem ersten Kartenbild (detect()),
    // spätestens beim ersten Zugriff auf die Stufe.
    this.device = null;
    this.cls = null;
    this.autoTier = null;
    this.autoReason = null;
    this.choice = 'auto';
    this.forced = null;
    this.storageError = null;
    this.warning = null;
  }

  get detected() { return this.device !== null; }
  // Frühe Probe im Worker (nach dem ersten Kartenbild). Liefert sie nichts, bleibt die Erkennung
  // offen (Anzeige „Auto“) bis detect() beim Öffnen des Qualitätsmenüs oder bei „3D laden“.
  async detectEarly() {
    if (this.device) return;
    const d = await probeInWorker();
    if (d && !this.device) this.apply(d);
  }
  detect() {
    if (this.device) return;
    this.apply(probe());
  }
  apply(d) {
    const c = classify(d);
    this.autoTier = this.byId(this.cfg.splats.auto[c.cls]);
    this.autoReason = `${CLASS_LABEL[c.cls]}${c.why.length ? `, ${c.why.join(', ')}` : ''}`;
    this.cls = c.cls;
    this.device = d;
  }

  byId(id) {
    const t = this.tiers.find((x) => x.id === id);
    if (!t) throw new Error(`Qualitätsstufe "${id}" gibt es nicht`);
    return t;
  }

  // Gespeicherte Wahl lesen; Fehler werden zurückgegeben (die App zeigt sie an)
  restore() {
    let raw;
    try {
      raw = localStorage.getItem(this.key);
    } catch (err) {
      this.storageError = err;
      return;
    }
    if (raw === null) return;
    let v;
    try { v = JSON.parse(raw); } catch (err) {
      console.error(`Gespeicherte Qualitätswahl unlesbar: ${raw}`, err);
      this.warning = 'Gespeicherte Qualitätswahl war unlesbar – automatisch gewählt.';
      return;
    }
    const ch = v?.choice;
    if (ch === 'auto') { this.choice = 'auto'; return; }
    if (typeof ch === 'string' && this.tiers.some((t) => t.id === ch)) { this.choice = ch; return; }
    console.warn(`Gespeicherte Qualitätsstufe ${JSON.stringify(ch)} gibt es nicht mehr`);
    this.warning = `Gespeicherte Qualität „${ch}“ gibt es nicht mehr – es gilt „Automatisch“.`;
  }

  set(choice) {
    if (choice !== 'auto') this.byId(choice);
    this.choice = choice;
    try {
      localStorage.setItem(this.key, JSON.stringify({ choice }));
    } catch (err) {
      this.storageError = err;
      return err;
    }
    return null;
  }

  get tier() {
    if (this.forced) return this.forced;
    if (this.choice !== 'auto') return this.byId(this.choice);
    this.detect();
    return this.autoTier;
  }
}

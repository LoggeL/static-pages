// Crownward – kleine Hilfen für den Renderer: Interpolation, Farben, Hash, Zeitleisten, Canvas-Erzeugung.

export type RGB = [number, number, number];

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);

/** '#rrggbb' → [r, g, b] */
export function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixRGB(a: RGB, b: RGB, t: number, out: RGB): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/** Farbstring (erzeugt einen String – nur außerhalb enger Schleifen benutzen). */
export function rgbStr(c: RGB, a = 1): string {
  const r = Math.round(c[0]);
  const g = Math.round(c[1]);
  const b = Math.round(c[2]);
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/** Deterministischer Hash 0..1 für eine Zahl (Variation je Objekt ohne Zufall im Zustand). */
export function hash01(n: number): number {
  let t = (Math.imul(n | 0, 0x9e3779b1) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Kleiner deterministischer Zufallsgenerator (für prozedurale Grafik beim Start). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D nicht verfügbar');
  g.imageSmoothingEnabled = false;
  return g;
}

/**
 * Zyklische Zeitleiste über Schlüsselzeiten (z. B. Tageszyklus). sample() schreibt Index und
 * Mischfaktor in Felder, damit im Hot-Path nichts allokiert wird.
 */
export class Timeline {
  /** Index des Schlüssels vor der Zeit */
  a = 0;
  /** Index des Schlüssels nach der Zeit */
  b = 0;
  /** Mischfaktor 0..1 zwischen a und b (geglättet) */
  f = 0;
  constructor(
    readonly times: number[],
    readonly length: number,
  ) {}
  sample(t: number): this {
    const ts = this.times;
    const n = ts.length;
    const L = this.length;
    t = ((t % L) + L) % L;
    let i = n - 1;
    for (let k = 0; k < n; k++) {
      if (ts[k] > t) {
        i = k - 1;
        break;
      }
    }
    if (i < 0) i = n - 1;
    const j = (i + 1) % n;
    const t0 = ts[i];
    let t1 = ts[j];
    let tt = t;
    if (t1 <= t0) t1 += L;
    if (tt < t0) tt += L;
    const span = t1 - t0;
    this.a = i;
    this.b = j;
    this.f = span > 0 ? smooth(clamp01((tt - t0) / span)) : 0;
    return this;
  }
}

// Crownward – Laden des Sprite-Atlas und Verwaltung der Sprites (inkl. gespiegelter/eingefärbter Varianten).
// Fehlende Dateien führen nie zum Absturz: es gibt Platzhalter und genau eine Warnung je ID.

import {
  ATLAS_URL,
  LAYER_SPECS,
  SPRITE_SPECS,
  type Atlas,
  type AtlasFrame,
  type LayerId,
  type SpriteId,
} from '../shared/sprites';
import type { AssetReport, LoadedAssets } from './types';
import { makePlaceholderLayer, makePlaceholderSprite } from './placeholders';
import { ctx2d, makeCanvas } from './util';

const SPRITE_DIR = ATLAS_URL.slice(0, ATLAS_URL.lastIndexOf('/') + 1);

function baseUrl(): string {
  const b = (import.meta.env && import.meta.env.BASE_URL) || './';
  return b.endsWith('/') ? b : b + '/';
}

function isAtlas(v: unknown): v is Atlas {
  if (!v || typeof v !== 'object') return false;
  const a = v as Partial<Atlas>;
  return a.version === 1 && !!a.sprites && typeof a.sprites === 'object' && !!a.layers && typeof a.layers === 'object';
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      // decode() sorgt dafür, dass das erste Zeichnen nicht ruckelt
      img.decode().then(
        () => resolve(img),
        () => resolve(img),
      );
    };
    img.onerror = () => reject(new Error('Bild fehlt: ' + url));
    img.src = url;
  });
}

/** Lädt public/assets/sprites/atlas.json und alle referenzierten Bilder. Fehlende Bilder landen in `missing`. */
export async function loadAssets(onProgress?: (loaded: number, total: number) => void): Promise<LoadedAssets> {
  const base = baseUrl();
  const missing: string[] = [];
  const images = new Map<string, HTMLImageElement>();
  let atlas: Atlas | null = null;
  onProgress?.(0, 1);
  try {
    const res = await fetch(base + ATLAS_URL, { cache: 'no-cache' });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && !type.includes('text/html')) {
      const json: unknown = await res.json();
      if (isAtlas(json)) atlas = json;
      else missing.push(ATLAS_URL);
    } else missing.push(ATLAS_URL);
  } catch {
    missing.push(ATLAS_URL);
  }
  if (!atlas) {
    console.warn('[assets] fehlt: ' + ATLAS_URL + ' – Platzhalter-Grafik aktiv');
    onProgress?.(1, 1);
    return { atlas: null, images, missing };
  }
  const files = new Set<string>();
  for (const s of Object.values(atlas.sprites)) if (s) files.add(s.image);
  for (const l of Object.values(atlas.layers)) if (l) files.add(l.image);
  const total = files.size + 1;
  let done = 1;
  onProgress?.(done, total);
  await Promise.all(
    [...files].map((file) =>
      loadImage(base + SPRITE_DIR + file)
        .then((img) => {
          images.set(file, img);
        })
        .catch(() => {
          missing.push(file);
          console.warn('[assets] fehlt: ' + SPRITE_DIR + file);
        })
        .finally(() => {
          done++;
          onProgress?.(done, total);
        }),
    ),
  );
  return { atlas, images, missing };
}

// ---------------------------------------------------------------------------------------------

/** Varianten eines Quellbilds (lazy erzeugt): gespiegelt, weiß (Treffer-Blitz), Schatten, Kontur. */
interface ImageVariants {
  flip?: HTMLCanvasElement;
  white?: HTMLCanvasElement;
  whiteFlip?: HTMLCanvasElement;
  dark?: HTMLCanvasElement;
  darkFlip?: HTMLCanvasElement;
  rim?: HTMLCanvasElement;
  rimFlip?: HTMLCanvasElement;
}

/**
 * Bildvariante: normal, weiß (Treffer-Blitz), dunkle Silhouette (Vordergrund, Beschädigung, Tiefe),
 * Rim = 1-px-Kontur außerhalb der Figur (lavendel; nachts additiv für lesbare Silhouetten der Nebelbrut).
 * Rim ragt 1 px über den Frame hinaus – zeichnen mit SpriteDrawer.drawRim().
 */
export const Variant = { Normal: 0, White: 1, Dark: 2, Rim: 3 } as const;
export type Variant = (typeof Variant)[keyof typeof Variant];

export interface SpriteDef {
  id: SpriteId;
  src: CanvasImageSource;
  srcW: number;
  srcH: number;
  frames: AtlasFrame[];
  /** Ankerversatz relativ zur Mitte-unten des jeweiligen Frames (Atlas-Pixel) */
  offX: number;
  offY: number;
  fps: number;
  /** Zeichenmaßstab (1 = Atlasgröße) */
  scale: number;
  /** Größe von Frame 0 in logischen Pixeln */
  w: number;
  h: number;
  placeholder: boolean;
  variants: ImageVariants;
}

export interface LayerDef {
  id: LayerId;
  src: CanvasImageSource;
  /** Zeichengröße in logischen Pixeln (Höhe = Spezifikation) */
  w: number;
  h: number;
  srcW: number;
  srcH: number;
  placeholder: boolean;
}

export class SpriteBank {
  private sprites = new Map<SpriteId, SpriteDef>();
  private layers = new Map<LayerId, LayerDef>();
  private variantCache = new Map<CanvasImageSource, ImageVariants>();
  private warned = new Set<string>();
  readonly loaded: string[] = [];
  readonly missing: string[] = [];

  constructor(private assets: LoadedAssets) {
    for (const id of Object.keys(SPRITE_SPECS) as SpriteId[]) this.sprites.set(id, this.build(id));
    for (const id of Object.keys(LAYER_SPECS) as LayerId[]) this.layers.set(id, this.buildLayer(id));
  }

  private warnOnce(id: string) {
    if (this.warned.has(id)) return;
    this.warned.add(id);
    console.warn('[assets] fehlt: ' + id);
  }

  private variantsOf(src: CanvasImageSource): ImageVariants {
    let v = this.variantCache.get(src);
    if (!v) {
      v = {};
      this.variantCache.set(src, v);
    }
    return v;
  }

  private build(id: SpriteId): SpriteDef {
    const spec = SPRITE_SPECS[id];
    const a = this.assets.atlas?.sprites[id];
    const img = a ? this.assets.images.get(a.image) : undefined;
    if (a && img && a.frames.length > 0) {
      const f0 = a.frames[0];
      // Atlas liefert Zielgröße; nur bei grober Abweichung auf Spezifikationshöhe skalieren
      let scale = 1;
      if (f0.h > 0 && Math.abs(f0.h - spec.height) / spec.height > 0.3) {
        scale = spec.height / f0.h;
        console.warn(`[assets] ${id}: Höhe ${f0.h} statt ${spec.height} – wird skaliert`);
      }
      this.loaded.push(id);
      return {
        id,
        src: img,
        srcW: img.naturalWidth,
        srcH: img.naturalHeight,
        frames: a.frames,
        offX: a.anchorX - f0.w / 2,
        offY: a.anchorY - f0.h,
        fps: a.fps ?? 6,
        scale,
        w: Math.round(f0.w * scale),
        h: Math.round(f0.h * scale),
        placeholder: false,
        variants: this.variantsOf(img),
      };
    }
    this.missing.push(id);
    const p = makePlaceholderSprite(id);
    const f0 = p.frames[0];
    return {
      id,
      src: p.canvas,
      srcW: p.canvas.width,
      srcH: p.canvas.height,
      frames: p.frames,
      offX: p.anchorX - f0.w / 2,
      offY: p.anchorY - f0.h,
      fps: p.fps,
      scale: 1,
      w: f0.w,
      h: f0.h,
      placeholder: true,
      variants: this.variantsOf(p.canvas),
    };
  }

  private buildLayer(id: LayerId): LayerDef {
    const spec = LAYER_SPECS[id];
    const a = this.assets.atlas?.layers[id];
    const img = a ? this.assets.images.get(a.image) : undefined;
    if (a && img) {
      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;
      const h = spec.height;
      const w = Math.max(1, Math.round((srcW * h) / srcH));
      this.loaded.push(id);
      return { id, src: img, w, h, srcW, srcH, placeholder: false };
    }
    this.missing.push(id);
    const c = makePlaceholderLayer(id);
    return { id, src: c, w: c.width, h: c.height, srcW: c.width, srcH: c.height, placeholder: true };
  }

  sprite(id: SpriteId): SpriteDef {
    const d = this.sprites.get(id);
    if (!d) {
      // unbekannte ID (z. B. neue Deko-Art): nie abstürzen
      this.warnOnce(String(id));
      return this.sprites.get('rock')!;
    }
    if (d.placeholder) this.warnOnce(id);
    return d;
  }

  has(id: SpriteId): boolean {
    const d = this.sprites.get(id);
    return !!d && !d.placeholder;
  }

  layer(id: LayerId): LayerDef {
    const d = this.layers.get(id)!;
    if (d.placeholder) this.warnOnce(id);
    return d;
  }

  /** Quellbild in gewünschter Variante (gespiegelt / weiß / dunkel), lazy erzeugt und gecacht. */
  image(def: SpriteDef, flip: boolean, variant: Variant): CanvasImageSource {
    const v = def.variants;
    if (variant === Variant.Normal) {
      if (!flip) return def.src;
      return (v.flip ??= mirror(def.src, def.srcW, def.srcH));
    }
    if (variant === Variant.White) {
      const base = (v.white ??= silhouette(def.src, def.srcW, def.srcH, '#ffffff'));
      if (!flip) return base;
      return (v.whiteFlip ??= mirror(base, def.srcW, def.srcH));
    }
    if (variant === Variant.Rim) {
      const base = (v.rim ??= outline(def.src, def.srcW, def.srcH));
      if (!flip) return base;
      return (v.rimFlip ??= mirror(base, def.srcW, def.srcH));
    }
    const base = (v.dark ??= silhouette(def.src, def.srcW, def.srcH, '#0a0d14'));
    if (!flip) return base;
    return (v.darkFlip ??= mirror(base, def.srcW, def.srcH));
  }

  /**
   * Kopie eines Sprites mit bearbeitetem Quellbild (z. B. Herrscher ohne Krone). `edit` erhält die Pixel des
   * ganzen Quellbilds und darf sie ändern; Ergebnis wird je Schlüssel gecacht. Platzhalter bleiben unverändert.
   */
  edited(id: SpriteId, key: string, edit: (data: ImageData) => void): SpriteDef {
    const base = this.sprite(id);
    if (base.placeholder) return base;
    const ck = id + '|' + key;
    let d = this.editedCache.get(ck);
    if (d) return d;
    let src = this.editedSrc.get(key + '|' + this.srcKey(base.src));
    if (!src) {
      src = makeCanvas(base.srcW, base.srcH);
      const g = ctx2d(src);
      g.drawImage(base.src, 0, 0);
      try {
        const img = g.getImageData(0, 0, base.srcW, base.srcH);
        edit(img);
        g.putImageData(img, 0, 0);
      } catch (err) {
        console.warn('[assets] Bearbeitung nicht möglich: ' + id, err);
      }
      this.editedSrc.set(key + '|' + this.srcKey(base.src), src);
    }
    d = { ...base, src, variants: this.variantsOf(src) };
    this.editedCache.set(ck, d);
    return d;
  }

  private srcIds = new Map<CanvasImageSource, number>();
  private editedSrc = new Map<string, HTMLCanvasElement>();
  private editedCache = new Map<string, SpriteDef>();
  private srcKey(src: CanvasImageSource): number {
    let k = this.srcIds.get(src);
    if (k === undefined) {
      k = this.srcIds.size;
      this.srcIds.set(src, k);
    }
    return k;
  }

  report(): AssetReport {
    return { loaded: [...this.loaded], missing: [...this.missing] };
  }
}

function mirror(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  g.translate(w, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

/** Farbe der Rim-Kontur (Lavendel der Nebelbrut) */
const RIM_RGB = [196, 150, 255];

/** 1-px-Kontur (4-Nachbarschaft) außerhalb deckender Pixel in RIM_RGB. */
function outline(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  g.drawImage(src, 0, 0);
  try {
    const img = g.getImageData(0, 0, w, h);
    const a = img.data;
    const out = g.createImageData(w, h);
    const o = out.data;
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && a[(y * w + x) * 4 + 3] > 127;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (solid(x, y)) continue;
        if (!solid(x - 1, y) && !solid(x + 1, y) && !solid(x, y - 1) && !solid(x, y + 1)) continue;
        const i = (y * w + x) * 4;
        o[i] = RIM_RGB[0];
        o[i + 1] = RIM_RGB[1];
        o[i + 2] = RIM_RGB[2];
        o[i + 3] = 255;
      }
    g.putImageData(out, 0, 0);
  } catch {
    // z. B. verunreinigter Canvas: keine Kontur statt Absturz
    g.clearRect(0, 0, w, h);
  }
  return c;
}

function silhouette(src: CanvasImageSource, w: number, h: number, color: string): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  return c;
}

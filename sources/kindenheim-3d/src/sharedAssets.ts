import * as THREE from 'three';
import {
  TEXTURE_CLASSES,
  TEXTURE_SIZE_CAPS,
  areaThumbnail,
  classifyTextureSlot,
  downscaleImage,
  fingerprintDrawable,
  gpuBytes,
  isDrawableImage,
  isTextureBudgetLevel,
  readDrawablePixels,
  releaseTextureScratch,
  targetSizeFor,
  thumbnailDifference,
  thumbnailsMatch,
  type DrawableImage,
  type TextureBudgetLevel,
  type TextureClass,
  type ThumbDifference,
} from './textureBudget';

/**
 * Cross-GLB texture de-duplication + per-quality texture size budget.
 *
 * Every .glb embeds its own copy of the shared PBR library textures (blender/shared_textures/).
 * `dedupeModelTextures(gltf.scene)`, called by every loader right after a GLB finished loading and
 * before the first render, does three things to each embedded texture, synchronously:
 *
 *  1. Size budget — the texture is reduced to the cap of its class (albedo / cut-out / normal / ORM /
 *     emissive) for the active quality level (`src/textureBudget.ts`). The image source is swapped before
 *     the renderer ever sees it and the full-size bitmap is closed, so the full size is never uploaded.
 *  2. De-duplication — an image whose NAME, original pixel size and content fingerprint match an already
 *     registered one shares that one's `THREE.Source` (one GPU upload; sampler/UV state stays per texture).
 *     Size variants of one library map (`x_albedo`, `x_albedo_1k`, `x_albedo_512`) that end up at the same
 *     size under the budget are merged too, after checking that they show the same picture.
 *  3. Safety — a name + size match with DIFFERENT pixels is never merged silently. All such collisions are
 *     collected and thrown as one aggregated error once loading has gone quiet (and by
 *     `assertTextureDedupeConsistent()` for a caller that wants it in the loading overlay). Near-identical
 *     re-encodes are shared (listed in the error); genuinely different pictures keep their own pixels.
 *
 * Debug / test URL switches (texture budget only, the render quality is untouched):
 *   ?texBudget=off|low|medium|high|ultra      ?texCaps=normal:2048,orm:1024
 */
const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'bumpMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'specularColorMap',
  'specularIntensityMap',
  'transmissionMap',
  'thicknessMap',
] as const;

export type { TextureBudgetLevel };

// ---------------------------------------------------------------------------------------------
// Budget level
// ---------------------------------------------------------------------------------------------

type BudgetSource = 'setTextureBudgetLevel' | 'url ?quality' | 'url ?texBudget' | 'default';

interface ActiveBudget {
  level: TextureBudgetLevel;
  source: BudgetSource;
  /** False with ?texBudget=off: nothing is resized (de-duplication and the safety check still run). */
  resize: boolean;
  caps: Record<TextureClass, number>;
}

let requestedLevel: TextureBudgetLevel | null = null;
let activeBudget: ActiveBudget | null = null;
let lateChangeLogged = false;

function urlParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

function parseCapOverrides(spec: string, caps: Record<TextureClass, number>): void {
  for (const part of spec.split(',')) {
    const [cls, value] = part.split(':');
    const size = Number(value);
    if (!(TEXTURE_CLASSES as readonly string[]).includes(cls) || !Number.isInteger(size) || size < 32 || (size & (size - 1)) !== 0) {
      throw new Error(
        `[sharedAssets] Invalid ?texCaps entry "${part}". Use <class>:<power-of-two size> with class one of ${TEXTURE_CLASSES.join(', ')}.`
      );
    }
    caps[cls as TextureClass] = size;
  }
}

/** Resolved once, when the first GLB texture arrives; later level changes apply from the next page load. */
function resolveBudget(): ActiveBudget {
  if (activeBudget) return activeBudget;
  let level: TextureBudgetLevel;
  let source: BudgetSource;
  let resize = true;
  const debug = urlParam('texBudget');
  const fromQuality = urlParam('quality');
  if (requestedLevel) {
    level = requestedLevel;
    source = 'setTextureBudgetLevel';
  } else if (isTextureBudgetLevel(fromQuality)) {
    // same override the app's quality selection honours (src/renderQuality.ts); used until main.ts calls the setter
    level = fromQuality;
    source = 'url ?quality';
  } else {
    level = 'high';
    source = 'default';
  }
  if (debug !== null) {
    if (debug === 'off') resize = false;
    else if (isTextureBudgetLevel(debug)) level = debug;
    else throw new Error(`[sharedAssets] Invalid ?texBudget=${debug}. Use one of: off, low, medium, high, ultra.`);
    source = 'url ?texBudget';
  }
  const caps = { ...TEXTURE_SIZE_CAPS[level] };
  const capSpec = urlParam('texCaps');
  if (capSpec) parseCapOverrides(capSpec, caps);
  activeBudget = { level, source, resize, caps };
  return activeBudget;
}

/**
 * Called once from main.ts with the resolved render quality BEFORE any GLB is loaded.
 * `dedupeModelTextures` caps texture sizes for the level (see .gfx/review/FIXROUND.md, "Texture memory").
 * A later quality change does not re-download; the cap applies from the next page load.
 */
export function setTextureBudgetLevel(level: TextureBudgetLevel): void {
  if (!isTextureBudgetLevel(level)) {
    throw new Error(`[sharedAssets] setTextureBudgetLevel: invalid level "${String(level)}". Use low, medium, high or ultra.`);
  }
  requestedLevel = level;
  if (activeBudget && activeBudget.source !== 'url ?texBudget' && activeBudget.level !== level && !lateChangeLogged) {
    lateChangeLogged = true;
    console.info(
      `[textures] budget level "${level}" requested after ${entries.length} GLB textures were prepared for "${activeBudget.level}" ` +
        `(decided by ${activeBudget.source}); the new cap applies from the next page load.`
    );
  }
}

/** The level the loaded textures were (or, before the first GLB, will be) budgeted for. */
export function getTextureBudgetLevel(): TextureBudgetLevel {
  if (activeBudget) return activeBudget.level;
  if (requestedLevel) return requestedLevel;
  const fromQuality = urlParam('quality');
  return isTextureBudgetLevel(fromQuality) ? fromQuality : 'high';
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

interface SourceEntry {
  source: THREE.Source;
  name: string;
  owner: string;
  cls: TextureClass;
  srgb: boolean;
  mipmaps: boolean;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  /** Alpha channel in use: such images are never compared by thumbnail and never merged across names. */
  alpha: boolean;
  resizePath: 'none' | 'cpu' | 'gpu';
  thumb: Uint8ClampedArray | null;
  /** How many further GLB images share this source. */
  shared: number;
}

interface Variant {
  hash: string;
  entry: SourceEntry;
}

export interface TextureNameMismatch {
  name: string;
  width: number;
  height: number;
  firstOwner: string;
  otherOwner: string;
  /** null when one of the two has an alpha channel in use (not compared). */
  difference: ThumbDifference | null;
  /** True: near-identical re-encode, shares the first loaded copy. False: kept as its own GPU texture. */
  merged: boolean;
  extraGpuBytes: number;
}

export interface TexturePolicyConflict {
  name: string;
  loadedAs: string;
  wantedBy: string;
}

export interface TextureDedupeStats {
  level: TextureBudgetLevel;
  levelSource: BudgetSource;
  resizeEnabled: boolean;
  /** Distinct image sources that reach the GPU (kept name for existing callers). */
  uniqueSources: number;
  /** GLB images that share an already registered source instead of being uploaded again. */
  reused: number;
  /** Unique sources that were reduced by the budget. */
  resized: number;
  resizedOnGpuPath: number;
  /** Size variants of one library map (`_1k`, `_512`) merged because they end at the same size. */
  sizeVariantsMerged: number;
  sizeVariantsRejected: number;
  nameMismatches: number;
  policyConflicts: number;
  /** Textures without usable pixels (compressed / data / video): neither resized nor de-duplicated. */
  unmanaged: number;
  /** RGBA8 + mip chain estimate of what the unique sources occupy on the GPU now. */
  estimatedGpuBytes: number;
  /** Estimate of the unique sources at their original size minus `estimatedGpuBytes`. */
  bytesSavedByResize: number;
  /** Estimate of the shared duplicates at their original size (what uploading each GLB's own copy would cost). */
  bytesSavedByReuse: number;
  /** Main-thread time spent fingerprinting and resizing, in milliseconds. */
  processingMs: number;
}

const registry = new Map<string, Variant[]>();
const families = new Map<string, SourceEntry>();
const processedSources = new WeakMap<THREE.Source, SourceEntry | null>();
const entries: SourceEntry[] = [];
const mismatches: TextureNameMismatch[] = [];
const policyConflicts: TexturePolicyConflict[] = [];
const sizeVariantRejections: string[] = [];
let mismatchesThrown = 0;

let reusedCount = 0;
let reusedOriginalBytes = 0;
let sizeVariantsMerged = 0;
let unmanagedCount = 0;
let processingMs = 0;
let reportTimer: ReturnType<typeof setTimeout> | null = null;
let dirtySinceReport = false;

const SIZE_SUFFIX = /_(?:[1248]k|4096|2048|1024|512|256|128)$/i;
const QUIET_MS = 4000;

interface SourceGroup {
  source: THREE.Source;
  textures: Set<THREE.Texture>;
  cls: TextureClass;
  cap: number;
  material: string;
}

export interface DedupeOptions {
  /** Shown in mismatch reports; pass the GLB url. */
  label?: string;
  /**
   * Keep this model's textures N levels above the active budget (each level doubles the caps; never above
   * the authored size). For a hero asset that fills the screen at every quality level.
   */
  sizeBias?: number;
}

function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0);
}

function entryThumb(entry: SourceEntry): Uint8ClampedArray {
  if (entry.thumb) return entry.thumb;
  const data: unknown = entry.source.data;
  if (data instanceof ImageData) {
    entry.thumb = areaThumbnail(data, entry.srgb);
  } else if (isDrawableImage(data)) {
    entry.thumb = areaThumbnail(readDrawablePixels(data, entry.width, entry.height), entry.srgb);
  } else {
    throw new Error(`[sharedAssets] texture "${entry.name}" (${entry.owner}) has no readable pixels left to compare against`);
  }
  return entry.thumb;
}

function closeImage(image: unknown): void {
  (image as { close?: () => void } | null)?.close?.();
}

function shareEntry(group: SourceGroup, entry: SourceEntry, originalBytes: number, wantedWidth: number, owner: string): void {
  const duplicate: unknown = group.source.data;
  for (const tex of group.textures) {
    // Sharing the Source makes three upload the pixels once; sampler/UV state stays per texture.
    tex.source = entry.source;
    tex.needsUpdate = true;
  }
  // The duplicate Source can still be referenced by textures outside this model (src/buildings.ts hands
  // clones of one external-URI texture to several GLBs). Remember where it went so those are redirected
  // when their own model is processed, before its first render, instead of keeping the closed bitmap.
  processedSources.set(group.source, entry);
  if (duplicate !== entry.source.data) closeImage(duplicate);
  entry.shared++;
  reusedCount++;
  reusedOriginalBytes += originalBytes;
  if (wantedWidth > entry.width) {
    policyConflicts.push({
      name: entry.name,
      loadedAs: `${entry.width}x${entry.height} (${entry.cls}, first used by ${entry.owner})`,
      wantedBy: `${owner} (would keep ${wantedWidth} px)`,
    });
  }
}

function createEntry(
  group: SourceGroup,
  budget: ActiveBudget,
  name: string,
  owner: string,
  image: DrawableImage,
  width: number,
  height: number,
  sampledAlpha: boolean,
  target: { width: number; height: number; steps: number }
): SourceEntry {
  const first = group.textures.values().next().value as THREE.Texture;
  const srgb = first.colorSpace === THREE.SRGBColorSpace;
  const entry: SourceEntry = {
    source: group.source,
    name,
    owner,
    cls: group.cls,
    srgb,
    mipmaps: first.generateMipmaps,
    originalWidth: width,
    originalHeight: height,
    width,
    height,
    alpha: sampledAlpha,
    resizePath: 'none',
    thumb: null,
    shared: 0,
  };
  if (budget.resize && target.steps > 0) {
    const mime = (first.userData as { mimeType?: string } | undefined)?.mimeType;
    const mayHaveAlpha = sampledAlpha && mime !== 'image/jpeg';
    const result = downscaleImage(image, width, height, target.steps, srgb, mayHaveAlpha, `"${name || '(unnamed)'}" (${owner})`);
    // Swap the pixels inside the Source: every texture (and later clone) that references it follows.
    group.source.data = result.image;
    group.source.needsUpdate = true;
    closeImage(image);
    entry.width = result.image.width;
    entry.height = result.image.height;
    entry.resizePath = result.path;
    if (result.path === 'gpu') entry.alpha = true;
  }
  entries.push(entry);
  return entry;
}

function describeOwner(label: string, root: THREE.Object3D, material: string): string {
  const where = label || root.name || 'unnamed GLB scene';
  return `${where} / material "${material || '(unnamed)'}"`;
}

function collectGroups(root: THREE.Object3D, caps: Record<TextureClass, number>): Map<THREE.Source, SourceGroup> {
  const groups = new Map<THREE.Source, SourceGroup>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const slots = mat as unknown as Record<string, THREE.Texture | null | undefined>;
      for (const slot of TEXTURE_SLOTS) {
        const tex = slots[slot];
        if (!tex || !(tex as THREE.Texture).isTexture) continue;
        const cls = classifyTextureSlot(slot, mat.alphaTest > 0);
        const cap = caps[cls];
        let group = groups.get(tex.source);
        if (!group) {
          group = { source: tex.source, textures: new Set(), cls, cap, material: mat.name };
          groups.set(tex.source, group);
        } else if (cap > group.cap) {
          // several slots / materials use one image: the most demanding use decides
          group.cls = cls;
          group.cap = cap;
        }
        group.textures.add(tex);
      }
    }
  });
  return groups;
}

export function dedupeModelTextures(root: THREE.Object3D, options: DedupeOptions | string = {}): void {
  const opts: DedupeOptions = typeof options === 'string' ? { label: options } : options;
  const bias = opts.sizeBias ?? 0;
  if (!Number.isInteger(bias) || bias < 0 || bias > 3) {
    throw new Error(`[sharedAssets] dedupeModelTextures: sizeBias must be an integer 0..3, got ${String(opts.sizeBias)}`);
  }
  const budget = resolveBudget();
  const caps = { ...budget.caps };
  if (bias > 0) for (const cls of TEXTURE_CLASSES) caps[cls] = caps[cls] * 2 ** bias;
  const t0 = performance.now();

  for (const group of collectGroups(root, caps).values()) {
    const { source } = group;
    const known = processedSources.get(source);
    if (known !== undefined) {
      // already registered (or unmanaged); a Source that was merged into another one is redirected
      if (known && known.source !== source) {
        for (const tex of group.textures) {
          tex.source = known.source;
          tex.needsUpdate = true;
        }
      }
      continue;
    }
    const first = group.textures.values().next().value as THREE.Texture;
    const image: unknown = source.data;
    const size = image as { width?: number; height?: number } | null;
    const width = size?.width ?? 0;
    const height = size?.height ?? 0;
    const special = first as unknown as { isCompressedTexture?: boolean; isVideoTexture?: boolean; isRenderTargetTexture?: boolean };
    if (!width || !height || !isDrawableImage(image) || special.isCompressedTexture || special.isVideoTexture || special.isRenderTargetTexture) {
      processedSources.set(source, null);
      unmanagedCount++;
      continue;
    }

    let name = '';
    for (const tex of group.textures) {
      name = tex.name?.trim() ?? '';
      if (name) break;
    }
    const owner = describeOwner(opts.label ?? '', root, group.material);
    const target = budget.resize ? targetSizeFor(width, height, group.cap) : { width, height, steps: 0 };
    const mipmaps = first.generateMipmaps;
    const originalBytes = gpuBytes(width, height, mipmaps);

    if (!name) {
      // nothing to key a shared copy on, but the budget still applies
      const entry = createEntry(group, budget, name, owner, image, width, height, fingerprintDrawable(image, width, height).sampledAlpha, target);
      processedSources.set(source, entry);
      continue;
    }

    const fp = fingerprintDrawable(image, width, height);
    const key = `${name}|${width}x${height}`;
    const variants = registry.get(key);

    if (variants) {
      const same = variants.find((v) => v.hash === fp.hash);
      if (same) {
        shareEntry(group, same.entry, originalBytes, target.width, owner);
        continue;
      }
      // Same name and size, different pixels: the contract ("identical names mean identical bytes") is broken.
      const firstEntry = variants[0].entry;
      let difference: ThumbDifference | null = null;
      if (!fp.sampledAlpha && !firstEntry.alpha) {
        const thumb = areaThumbnail(readDrawablePixels(image, width, height), firstEntry.srgb);
        difference = thumbnailDifference(thumb, entryThumb(firstEntry));
      }
      if (difference && thumbnailsMatch(difference)) {
        mismatches.push({ name, width, height, firstOwner: firstEntry.owner, otherOwner: owner, difference, merged: true, extraGpuBytes: 0 });
        variants.push({ hash: fp.hash, entry: firstEntry });
        shareEntry(group, firstEntry, originalBytes, target.width, owner);
      } else {
        const entry = createEntry(group, budget, name, owner, image, width, height, fp.sampledAlpha, target);
        processedSources.set(source, entry);
        variants.push({ hash: fp.hash, entry });
        mismatches.push({
          name,
          width,
          height,
          firstOwner: firstEntry.owner,
          otherOwner: owner,
          difference,
          merged: false,
          extraGpuBytes: gpuBytes(entry.width, entry.height, entry.mipmaps),
        });
      }
      continue;
    }

    // First time this name + size shows up. A size variant of the same library map may already be loaded
    // at exactly the size this one ends up with.
    const familyKey = `${name.replace(SIZE_SUFFIX, '')}|${target.width}x${target.height}`;
    const relative = families.get(familyKey);
    if (relative && !fp.sampledAlpha && !relative.alpha) {
      const thumb = areaThumbnail(readDrawablePixels(image, width, height), relative.srgb);
      const difference = thumbnailDifference(thumb, entryThumb(relative));
      if (thumbnailsMatch(difference)) {
        registry.set(key, [{ hash: fp.hash, entry: relative }]);
        shareEntry(group, relative, originalBytes, target.width, owner);
        sizeVariantsMerged++;
        continue;
      }
      sizeVariantRejections.push(
        `"${name}" (${owner}) vs "${relative.name}" (${relative.owner}): mean ${difference.mean.toFixed(1)} / max ${difference.max} of 255`
      );
    }
    const entry = createEntry(group, budget, name, owner, image, width, height, fp.sampledAlpha, target);
    processedSources.set(source, entry);
    registry.set(key, [{ hash: fp.hash, entry }]);
    if (!relative) families.set(familyKey, entry);
  }

  processingMs += performance.now() - t0;
  dirtySinceReport = true;
  if (reportTimer !== null) clearTimeout(reportTimer);
  reportTimer = setTimeout(reportWhenQuiet, QUIET_MS);
}

// ---------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------

export function getTextureDedupeStats(): TextureDedupeStats {
  const budget = activeBudget;
  let estimated = 0;
  let original = 0;
  let resized = 0;
  let onGpu = 0;
  for (const e of entries) {
    estimated += gpuBytes(e.width, e.height, e.mipmaps);
    original += gpuBytes(e.originalWidth, e.originalHeight, e.mipmaps);
    if (e.resizePath !== 'none') resized++;
    if (e.resizePath === 'gpu') onGpu++;
  }
  return {
    level: budget?.level ?? getTextureBudgetLevel(),
    levelSource: budget?.source ?? (requestedLevel ? 'setTextureBudgetLevel' : 'default'),
    resizeEnabled: budget?.resize ?? true,
    uniqueSources: entries.length,
    reused: reusedCount,
    resized,
    resizedOnGpuPath: onGpu,
    sizeVariantsMerged,
    sizeVariantsRejected: sizeVariantRejections.length,
    nameMismatches: mismatches.length,
    policyConflicts: policyConflicts.length,
    unmanaged: unmanagedCount,
    estimatedGpuBytes: estimated,
    bytesSavedByResize: original - estimated,
    bytesSavedByReuse: reusedOriginalBytes,
    processingMs: Math.round(processingMs),
  };
}

export interface TextureReportRow {
  name: string;
  owner: string;
  class: TextureClass;
  original: string;
  size: string;
  resizePath: 'none' | 'cpu' | 'gpu';
  alpha: boolean;
  sharedBy: number;
  gpuBytes: number;
}

/** Per-source detail behind `getTextureDedupeStats()`, largest first. */
export function getTextureDedupeReport(): {
  stats: TextureDedupeStats;
  textures: TextureReportRow[];
  nameMismatches: TextureNameMismatch[];
  policyConflicts: TexturePolicyConflict[];
  sizeVariantRejections: string[];
} {
  const textures = entries
    .map((e) => ({
      name: e.name || '(unnamed)',
      owner: e.owner,
      class: e.cls,
      original: `${e.originalWidth}x${e.originalHeight}`,
      size: `${e.width}x${e.height}`,
      resizePath: e.resizePath,
      alpha: e.alpha,
      sharedBy: e.shared,
      gpuBytes: gpuBytes(e.width, e.height, e.mipmaps),
    }))
    .sort((a, b) => b.gpuBytes - a.gpuBytes);
  return {
    stats: getTextureDedupeStats(),
    textures,
    nameMismatches: [...mismatches],
    policyConflicts: [...policyConflicts],
    sizeVariantRejections: [...sizeVariantRejections],
  };
}

function mismatchMessage(list: TextureNameMismatch[]): string {
  const lines = list.map((m) => {
    const diff = m.difference
      ? `mean ${m.difference.mean.toFixed(2)} / max ${m.difference.max} of 255 on a 16x16 average`
      : 'alpha channel in use, not compared';
    const outcome = m.merged
      ? 'near-identical re-encode: shares the first loaded copy'
      : `different picture: kept as its own GPU texture (+${mb(m.extraGpuBytes)} MB)`;
    return `  - "${m.name}" ${m.width}x${m.height}: [${m.firstOwner}] vs [${m.otherOwner}] — ${diff}; ${outcome}`;
  });
  return (
    `[sharedAssets] ${list.length} embedded texture(s) reuse an image name with different pixels. ` +
    `Identical image names must mean identical bytes across GLBs: embed the unchanged file from blender/shared_textures/ ` +
    `(or rename the edited copy).\n${lines.join('\n')}`
  );
}

/**
 * Throws one aggregated error listing every name collision found so far that was not reported yet.
 * Call it after the last GLB load to turn collisions into a load failure; without a caller the same
 * error is thrown (uncaught, once) when loading has gone quiet.
 */
export function assertTextureDedupeConsistent(): void {
  if (mismatches.length <= mismatchesThrown) return;
  const fresh = mismatches.slice(mismatchesThrown);
  mismatchesThrown = mismatches.length;
  throw new Error(mismatchMessage(fresh));
}

function reportWhenQuiet(): void {
  reportTimer = null;
  releaseTextureScratch();
  if (!dirtySinceReport) return;
  dirtySinceReport = false;
  const s = getTextureDedupeStats();
  const notes: string[] = [];
  if (s.policyConflicts > 0) {
    notes.push(
      `${s.policyConflicts} texture(s) were sized by an earlier, less demanding use: ` +
        policyConflicts.map((c) => `"${c.name}" loaded ${c.loadedAs}, wanted by ${c.wantedBy}`).join('; ')
    );
  }
  if (s.sizeVariantsRejected > 0) notes.push(`size variants that do NOT show the same picture (kept apart): ${sizeVariantRejections.join('; ')}`);
  if (s.unmanaged > 0) notes.push(`${s.unmanaged} texture(s) without drawable pixels left untouched`);
  console.info(
    `[textures] budget "${s.level}"${s.resizeEnabled ? '' : ' (resizing OFF)'} decided by ${s.levelSource}: ` +
      `${s.uniqueSources} unique GLB textures ≈ ${mb(s.estimatedGpuBytes)} MB on the GPU; ` +
      `${s.resized} down-scaled (−${mb(s.bytesSavedByResize)} MB, ${s.resizedOnGpuPath} via the alpha-safe GPU path), ` +
      `${s.reused} duplicates shared (−${mb(s.bytesSavedByReuse)} MB), ${s.sizeVariantsMerged} of them size variants; ` +
      `${s.nameMismatches} name collision(s); ${s.processingMs} ms on the main thread.` +
      (notes.length ? `\n  ${notes.join('\n  ')}` : '')
  );
  assertTextureDedupeConsistent();
}

if (typeof window !== 'undefined') {
  // Console handle that also exists in a production build: __KINDENHEIM_TEXTURES__.report()
  (window as unknown as Record<string, unknown>).__KINDENHEIM_TEXTURES__ = {
    stats: getTextureDedupeStats,
    report: getTextureDedupeReport,
  };
}

/** Normalised [0,1] rectangle relative to an image's dimensions. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Keypoint {
  x: number
  y: number
  label: 'eye' | 'nose' | 'mouth' | 'ear'
}

export const CENSOR_STYLES = ['blur', 'pixelate', 'ink', 'static', 'sticker'] as const
export type CensorStyle = (typeof CENSOR_STYLES)[number]

export const REGION_SHAPES = ['rect', 'ellipse', 'band'] as const
export type RegionShape = (typeof REGION_SHAPES)[number]

export type RegionSource = 'auto' | 'manual'

export interface Region {
  id: string
  box: Box
  style: CensorStyle
  shape: RegionShape
  /** 0..1 — how much of the effect is applied. */
  intensity: number
  /** 0..1 — mask edge softness, relative to the box's shorter side. */
  feather: number
  /** 0..1 — outward growth, relative to the box's shorter side. */
  pad: number
  /** Glyph used by the `sticker` style. */
  emoji: string
  source: RegionSource
  confidence: number | null
  model: 'close' | 'wide' | null
}

export interface CensorPreset {
  id: string
  name: string
  style: CensorStyle
  shape: RegionShape
  intensity: number
  feather: number
  pad: number
  emoji: string
  blurb: string
}

export const PRESETS: CensorPreset[] = [
  { id: 'soft', name: 'Soft blur', style: 'blur', shape: 'ellipse', intensity: 0.55, feather: 0.4, pad: 0.06, emoji: '🫥', blurb: 'Feathered gaussian blur' },
  { id: 'heavy', name: 'Hard blur', style: 'blur', shape: 'rect', intensity: 0.9, feather: 0.06, pad: 0.1, emoji: '🫥', blurb: 'Unrecoverable mush' },
  { id: 'mosaic', name: 'Mosaic', style: 'pixelate', shape: 'rect', intensity: 0.72, feather: 0.04, pad: 0.08, emoji: '🫥', blurb: 'Classic pixelation' },
  { id: 'redact', name: 'Redaction bar', style: 'ink', shape: 'rect', intensity: 1, feather: 0.02, pad: 0.06, emoji: '🫥', blurb: 'Solid ink block' },
  { id: 'band', name: 'Censor band', style: 'ink', shape: 'band', intensity: 1, feather: 0.02, pad: 0.34, emoji: '🫥', blurb: 'Eyes-only strip' },
  { id: 'signal', name: 'Signal loss', style: 'static', shape: 'rect', intensity: 0.85, feather: 0.1, pad: 0.08, emoji: '🫥', blurb: 'Analogue static' },
  { id: 'ghost', name: 'Ghost', style: 'sticker', shape: 'rect', intensity: 0.8, feather: 0, pad: 0.1, emoji: '🫥', blurb: 'Drop a glyph on it' },
]

export const EMOJI_CHOICES = ['🫥', '🕶️', '🙂', '😐', '🖤', '⬛', '🌸', '👁️'] as const

export type ToastTone = 'default' | 'success' | 'error' | 'credit'

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clampBox(box: Box): Box {
  const x = clamp(box.x, 0, 1)
  const y = clamp(box.y, 0, 1)
  return { x, y, w: clamp(box.w, 0.01, 1 - x), h: clamp(box.h, 0.01, 1 - y) }
}

/** Turns two drag corners into a normalised box, regardless of drag direction. */
export function boxFromCorners(ax: number, ay: number, bx: number, by: number): Box {
  return clampBox({ x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) })
}

export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type ResizeHandle = (typeof RESIZE_HANDLES)[number]

const MIN_REGION = 0.012

/** Moves one edge (or corner) of a box by a normalised delta, without inverting it. */
export function resizeBox(box: Box, handle: ResizeHandle, dx: number, dy: number): Box {
  let { x, y, w, h } = box
  const right = box.x + box.w
  const bottom = box.y + box.h
  if (handle.includes('w')) {
    const nextX = clamp(box.x + dx, 0, right - MIN_REGION)
    w = right - nextX
    x = nextX
  }
  if (handle.includes('e')) w = clamp(box.w + dx, MIN_REGION, 1 - box.x)
  if (handle.includes('n')) {
    const nextY = clamp(box.y + dy, 0, bottom - MIN_REGION)
    h = bottom - nextY
    y = nextY
  }
  if (handle.includes('s')) h = clamp(box.h + dy, MIN_REGION, 1 - box.y)
  return { x, y, w, h }
}

export function moveBox(box: Box, dx: number, dy: number): Box {
  return { x: clamp(box.x + dx, 0, 1 - box.w), y: clamp(box.y + dy, 0, 1 - box.h), w: box.w, h: box.h }
}

export function regionFromPreset(preset: CensorPreset, box: Box, source: RegionSource, confidence: number | null = null, model: Region['model'] = null): Region {
  return {
    id: uid(),
    box: clampBox(box),
    style: preset.style,
    shape: preset.shape,
    intensity: preset.intensity,
    feather: preset.feather,
    pad: preset.pad,
    emoji: preset.emoji,
    source,
    confidence,
    model,
  }
}

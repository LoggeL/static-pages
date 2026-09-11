import { clamp, type Region } from './types'

export interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
}

export type ExportFormat = 'png' | 'jpeg' | 'webp'

export interface RenderOptions {
  image: DecodedImage
  regions: Region[]
  canvas: HTMLCanvasElement
  /** Backing-store size. Regions are normalised, so any size renders correctly. */
  width: number
  height: number
}

export interface ExportOptions {
  format: ExportFormat
  /** 0..1, ignored for PNG. */
  quality: number
  maxEdge: number
}

export const INK_COLOR = '#07080c'

const MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/* Scratch surfaces are module-scoped and reused: the editor re-renders on every
   pointer move, and allocating canvases per frame is what makes editors stutter. */
let effectSurface: HTMLCanvasElement | null = null
let maskSurface: HTMLCanvasElement | null = null
let tileSurface: HTMLCanvasElement | null = null

function surface(current: HTMLCanvasElement | null, width: number, height: number): HTMLCanvasElement {
  const canvas = current ?? document.createElement('canvas')
  // Assigning width/height also clears the surface, which is what we want.
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  } else {
    const ctx = canvas.getContext('2d')
    ctx?.setTransform(1, 0, 0, 1, 0, 0)
    ctx?.clearRect(0, 0, width, height)
  }
  return canvas
}

function traceRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function traceEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath()
  ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  ctx.closePath()
}

/** Deterministic per-region noise, so static does not strobe while dragging. */
function seededNoise(seed: number, cols: number, rows: number): HTMLCanvasElement {
  const canvas = surface(tileSurface, Math.max(2, cols), Math.max(2, rows))
  const ctx = canvas.getContext('2d')!
  const frame = ctx.createImageData(canvas.width, canvas.height)
  let state = seed >>> 0 || 1
  for (let i = 0; i < frame.data.length; i += 4) {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const value = ((t ^ (t >>> 14)) >>> 0) % 256
    frame.data[i] = value
    frame.data[i + 1] = value
    frame.data[i + 2] = value
    frame.data[i + 3] = 255
  }
  ctx.putImageData(frame, 0, 0)
  tileSurface = canvas
  return canvas
}

function hashKey(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Paints one region. Effects are sized from the region's shorter side rather than
 * from absolute pixels, so a 400 px preview and a 4000 px export look identical.
 */
function paintRegion(ctx: CanvasRenderingContext2D, image: DecodedImage, region: Region, targetWidth: number, targetHeight: number): void {
  const scaleX = image.width / targetWidth
  const scaleY = image.height / targetHeight

  const boxWidth = region.box.w * targetWidth
  const boxHeight = region.box.h * targetHeight
  const pad = region.pad * Math.min(boxWidth, boxHeight)
  let width = boxWidth + pad * 2
  let height = boxHeight + pad * 2
  let x = region.box.x * targetWidth - pad
  let y = region.box.y * targetHeight - pad

  if (region.shape === 'band') {
    const strip = height * 0.4
    y += (height - strip) / 2
    height = strip
  }
  if (width < 2 || height < 2) return

  const shortSide = Math.min(width, height)
  const intensity = clamp(region.intensity, 0, 1)
  const feather = clamp(region.feather, 0, 1)

  if (region.style === 'sticker') {
    const size = shortSide * (0.7 + intensity * 0.5)
    ctx.save()
    ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(region.emoji || '🫥', x + width / 2, y + height / 2 + size * 0.04)
    ctx.restore()
    return
  }

  const blurRadius = (0.03 + intensity * 0.14) * shortSide
  const featherRadius = feather * shortSide * 0.3
  const margin = Math.ceil(blurRadius * 2 + featherRadius * 2 + 6)
  const surfaceWidth = Math.ceil(width) + margin * 2
  const surfaceHeight = Math.ceil(height) + margin * 2

  const effect = surface(effectSurface, surfaceWidth, surfaceHeight)
  effectSurface = effect
  const paint = effect.getContext('2d')!

  const sourceX = (x - margin) * scaleX
  const sourceY = (y - margin) * scaleY
  const sourceW = surfaceWidth * scaleX
  const sourceH = surfaceHeight * scaleY

  if (region.style === 'ink') {
    paint.fillStyle = INK_COLOR
    paint.fillRect(0, 0, surfaceWidth, surfaceHeight)
  } else if (region.style === 'pixelate') {
    const cell = Math.max(3, Math.round((0.05 + intensity * 0.16) * shortSide))
    const cols = Math.max(1, Math.round(surfaceWidth / cell))
    const rows = Math.max(1, Math.round(surfaceHeight / cell))
    const tile = surface(tileSurface, cols, rows)
    tileSurface = tile
    const tileCtx = tile.getContext('2d')!
    tileCtx.imageSmoothingEnabled = true
    tileCtx.clearRect(0, 0, cols, rows)
    tileCtx.drawImage(image.source, sourceX, sourceY, sourceW, sourceH, 0, 0, cols, rows)
    paint.imageSmoothingEnabled = false
    paint.clearRect(0, 0, surfaceWidth, surfaceHeight)
    paint.drawImage(tile, 0, 0, cols, rows, 0, 0, surfaceWidth, surfaceHeight)
  } else if (region.style === 'static') {
    paint.filter = 'grayscale(1) contrast(1.25) brightness(0.85)'
    paint.drawImage(image.source, sourceX, sourceY, sourceW, sourceH, 0, 0, surfaceWidth, surfaceHeight)
    paint.filter = 'none'
    const cell = Math.max(3, Math.round(shortSide * 0.02))
    const noise = seededNoise(hashKey(region.id), Math.ceil(surfaceWidth / cell), Math.ceil(surfaceHeight / cell))
    paint.imageSmoothingEnabled = false
    paint.globalCompositeOperation = 'overlay'
    paint.globalAlpha = 0.55 + intensity * 0.45
    paint.drawImage(noise, 0, 0, noise.width, noise.height, 0, 0, surfaceWidth, surfaceHeight)
    paint.globalAlpha = 1
    paint.globalCompositeOperation = 'source-over'
  } else {
    if (blurRadius > 0.4) paint.filter = `blur(${blurRadius}px)`
    paint.drawImage(image.source, sourceX, sourceY, sourceW, sourceH, 0, 0, surfaceWidth, surfaceHeight)
    paint.filter = 'none'
  }

  const mask = surface(maskSurface, surfaceWidth, surfaceHeight)
  maskSurface = mask
  const maskCtx = mask.getContext('2d')!
  maskCtx.clearRect(0, 0, surfaceWidth, surfaceHeight)
  if (featherRadius > 0.4) maskCtx.filter = `blur(${featherRadius}px)`
  maskCtx.fillStyle = '#ffffff'
  if (region.shape === 'ellipse') {
    traceEllipse(maskCtx, margin, margin, width, height)
  } else {
    traceRoundedRect(maskCtx, margin, margin, width, height, region.shape === 'band' ? 2 : Math.min(width, height) * 0.1)
  }
  maskCtx.fill()
  maskCtx.filter = 'none'

  paint.globalCompositeOperation = 'destination-in'
  paint.drawImage(mask, 0, 0)
  paint.globalCompositeOperation = 'source-over'

  ctx.drawImage(effect, x - margin, y - margin)
}

export function renderComposite({ image, regions, canvas, width, height }: RenderOptions): void {
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(image.source, 0, 0, width, height)
  // Largest first, so a big blur cannot swallow a small redaction drawn inside it.
  const ordered = [...regions].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
  for (const region of ordered) paintRegion(ctx, image, region, width, height)
}

export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function encode(canvas: HTMLCanvasElement, format: ExportFormat, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, MIME[format], format === 'png' ? undefined : quality))
  if (!blob) throw new Error(`This browser could not encode a ${format.toUpperCase()} file.`)
  return blob
}

export async function renderToBlob(image: DecodedImage, regions: Region[], options: ExportOptions): Promise<Blob> {
  const { width, height } = fitWithin(image.width, image.height, options.maxEdge)
  const canvas = document.createElement('canvas')
  renderComposite({ image, regions, canvas, width, height })
  return encode(canvas, options.format, options.quality)
}

export async function renderThumbnail(image: DecodedImage, regions: Region[], maxEdge = 560): Promise<Blob> {
  const { width, height } = fitWithin(image.width, image.height, maxEdge)
  const canvas = document.createElement('canvas')
  renderComposite({ image, regions, canvas, width, height })
  return encode(canvas, 'webp', 0.82)
}

export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024

export async function decodeFile(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height }
    } catch {
      /* fall through to the <img> path below */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const element = new Image()
    element.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      element.onload = () => resolve()
      element.onerror = () => reject(new Error(`${file.name} could not be decoded as an image.`))
      element.src = url
    })
    return { source: element, width: element.naturalWidth, height: element.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

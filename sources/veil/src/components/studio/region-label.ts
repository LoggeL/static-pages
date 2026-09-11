import type { Region } from '@/lib/types'

const STYLE_LABEL: Record<Region['style'], string> = {
  blur: 'Blur',
  pixelate: 'Mosaic',
  ink: 'Redaction',
  static: 'Static',
  sticker: 'Sticker',
}

export function describeRegion(region: Region): string {
  if (region.shape === 'band') return `${STYLE_LABEL[region.style]} band`
  if (region.shape === 'ellipse') return `${STYLE_LABEL[region.style]} oval`
  return STYLE_LABEL[region.style]
}

/** Detections under this confidence are the ones the model gets wrong most often —
    backs of heads, clasped hands — so they are called out rather than trusted. */
export const WEAK_CONFIDENCE = 0.62

export function isWeakDetection(region: Region): boolean {
  return region.source === 'auto' && region.confidence != null && region.confidence < WEAK_CONFIDENCE
}

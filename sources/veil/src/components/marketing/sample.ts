import { detectFaces } from '@/lib/detect'
import type { DetectStage, DetectedFace } from '@/lib/detect'
import { assetUrl } from '@/lib/assets'
import { decodeFile } from '@/lib/imaging'
import type { DecodedImage } from '@/lib/imaging'

/** The two stock photos the marketing page runs the real pipeline against. */
export type SampleSource = 'group-studio' | 'portrait-woman'

export interface SampleDemo {
  image: DecodedImage
  faces: DetectedFace[]
  /** True when the runtime or the models could not start, so an empty `faces` means "no scan ran" rather than "no faces found". */
  degraded: boolean
}

interface StageChannel {
  current: DetectStage | null
  listeners: Set<(stage: DetectStage) => void>
}

/* One channel per photo. The hero scan and the style strip share the same
   warm-up, and a component that discovers the run halfway through still needs
   the stage the detector actually reached — not a "queued" placeholder. */
const channels: Record<SampleSource, StageChannel> = {
  'group-studio': { current: null, listeners: new Set() },
  'portrait-woman': { current: null, listeners: new Set() },
}

function publish(source: SampleSource, stage: DetectStage): void {
  const target = channels[source]
  target.current = stage
  for (const listener of target.listeners) listener(stage)
}

/** Returns an unsubscribe function. */
export function subscribeStage(source: SampleSource, listener: (stage: DetectStage) => void): () => void {
  const target = channels[source]
  target.listeners.add(listener)
  if (target.current) listener(target.current)
  return () => {
    target.listeners.delete(listener)
  }
}

const decoded: Partial<Record<SampleSource, Promise<DecodedImage>>> = {}

/** Fetch + decode, memoised: the bitmap is shared by the photo, the scan and every style frame. */
export function loadSampleImage(source: SampleSource): Promise<DecodedImage> {
  const cached = decoded[source]
  if (cached) return cached
  const pending = (async () => {
    const response = await fetch(assetUrl(`samples/${source}.jpg`))
    if (!response.ok) throw new Error(`Sample photo ${source} is unavailable.`)
    const blob = await response.blob()
    return decodeFile(new File([blob], `${source}.jpg`, { type: blob.type || 'image/jpeg' }))
  })()
  decoded[source] = pending
  return pending
}

const demos: Partial<Record<SampleSource, Promise<SampleDemo>>> = {}

/**
 * Memoised in-flight promise, so the two BlazeFace models run once per page load
 * no matter how many sections subscribe. A detector failure resolves to an empty
 * face list rather than rejecting: the page is a brochure, it must still render.
 */
export function loadSampleDemo(source: SampleSource = 'group-studio'): Promise<SampleDemo> {
  const cached = demos[source]
  if (cached) return cached
  const pending = loadSampleImage(source)
    .then(async (image) => ({
      image,
      faces: await detectFaces(image.source, image.width, image.height, {
        sensitivity: 0.7,
        onStage: (stage) => publish(source, stage),
      }),
      degraded: false,
    }))
    .catch(async () => ({ image: await loadSampleImage(source), faces: [], degraded: true }))
  demos[source] = pending
  return pending
}

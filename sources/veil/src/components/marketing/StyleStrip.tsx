import { useEffect, useRef, useState } from 'react'
import type { DetectedFace } from '@/lib/detect'
import { fitWithin, renderComposite } from '@/lib/imaging'
import type { DecodedImage } from '@/lib/imaging'
import { PRESETS, regionFromPreset, type CensorPreset } from '@/lib/types'
import { loadSampleDemo } from './sample'

/* The five treatments worth showing side by side — deliberately skips the two
   presets that read as near-duplicates of `soft` and `redact` at thumbnail size. */
const FEATURED = ['soft', 'mosaic', 'redact', 'band', 'signal']

const SHOWN = FEATURED.map((id) => PRESETS.find((preset) => preset.id === id)).filter(
  (preset): preset is CensorPreset => preset !== undefined,
)

function StyleFrame({ preset, image, faces }: { preset: CensorPreset; image: DecodedImage; faces: DetectedFace[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const size = fitWithin(image.width, image.height, 420)
    const regions = faces.map((face) => regionFromPreset(preset, face.box, 'auto', face.score, face.model))
    renderComposite({ image, regions, canvas, width: size.width, height: size.height })
  }, [preset, image, faces])

  return (
    <figure>
      <div className="overflow-hidden rounded-lg border border-line bg-ink">
        <canvas
          ref={canvasRef}
          className="block w-full"
          style={{ aspectRatio: `${image.width} / ${image.height}` }}
          aria-label={`${preset.name} applied to the sample portrait`}
        />
      </div>
      <figcaption className="mt-3.5">
        <p className="mono-label text-flare">{preset.name}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-mist">{preset.blurb}</p>
      </figcaption>
    </figure>
  )
}

/**
 * The detector is ~1 MB of model weights, so this section fetches nothing until
 * it is a screen away from the viewport.
 */
export function StyleStrip() {
  const holderRef = useRef<HTMLDivElement>(null)
  const [armed, setArmed] = useState(false)
  const [image, setImage] = useState<DecodedImage | null>(null)
  const [faces, setFaces] = useState<DetectedFace[] | null>(null)
  const [failure, setFailure] = useState<'load' | 'detector' | null>(null)

  useEffect(() => {
    const node = holderRef.current
    if (!node) return
    /* Deep links land mid-page, where no intersection change is coming. */
    const rect = node.getBoundingClientRect()
    if (typeof IntersectionObserver === 'undefined' || rect.top < window.innerHeight + 320) {
      setArmed(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setArmed(true)
        observer.disconnect()
      },
      { rootMargin: '320px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!armed) return
    let live = true
    loadSampleDemo('portrait-woman')
      .then((demo) => {
        if (!live) return
        if (demo.degraded) {
          setFailure('detector')
          return
        }
        setImage(demo.image)
        setFaces(demo.faces)
      })
      .catch(() => {
        if (live) setFailure('load')
      })
    return () => {
      live = false
    }
  }, [armed])

  return (
    <div ref={holderRef}>
      {failure ? (
        <p className="panel rounded-xl px-5 py-6 text-sm leading-relaxed text-mist">
          {failure === 'load'
            ? 'The sample portrait could not be loaded, so the style comparison is unavailable here. The studio renders all five treatments on your own photos.'
            : 'The detector could not start in this browser, so there is nothing to redact in the sample. The studio still applies all five treatments to your own photos, and a hand-drawn region never needs the model.'}
        </p>
      ) : (
        <div className="grid gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {image && faces
            ? SHOWN.map((preset) => <StyleFrame key={preset.id} preset={preset} image={image} faces={faces} />)
            : SHOWN.map((preset) => (
                <div key={preset.id}>
                  <div className="aspect-[4/5] w-full rounded-lg border border-line bg-raised/40" />
                  <div className="mt-3.5 h-2.5 w-20 rounded-full bg-raised/60" />
                  <div className="mt-2 h-2.5 w-32 rounded-full bg-raised/40" />
                </div>
              ))}
        </div>
      )}
    </div>
  )
}

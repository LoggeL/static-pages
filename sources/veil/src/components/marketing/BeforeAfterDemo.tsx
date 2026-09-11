import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { DetectStage, DetectedFace } from '@/lib/detect'
import { fitWithin, renderComposite } from '@/lib/imaging'
import type { DecodedImage } from '@/lib/imaging'
import { PRESETS, clamp, regionFromPreset, type Region } from '@/lib/types'
import { loadSampleDemo, loadSampleImage, subscribeStage } from './sample'

const STAGE_COPY: Record<DetectStage, string> = {
  runtime: 'initialising runtime',
  models: 'loading models',
  scan: 'scanning',
}

const MODEL_NAME: Record<DetectedFace['model'], string> = {
  close: 'blazeface short-range',
  wide: 'blazeface full-range',
}

const STEP = 0.02
const STEP_COARSE = 0.1

export function BeforeAfterDemo() {
  const [image, setImage] = useState<DecodedImage | null>(null)
  const [faces, setFaces] = useState<DetectedFace[] | null>(null)
  const [stage, setStage] = useState<DetectStage | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [split, setSplit] = useState(0.55)
  const stageRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const censoredRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let live = true
    const stopStage = subscribeStage('group-studio', setStage)
    loadSampleImage('group-studio')
      .then((next) => {
        if (live) setImage(next)
      })
      .catch(() => {
        if (live) setUnavailable(true)
      })
    loadSampleDemo('group-studio')
      .then((demo) => {
        if (!live) return
        setImage(demo.image)
        setFaces(demo.faces)
        setDegraded(demo.degraded)
      })
      .catch(() => {
        if (live) setUnavailable(true)
      })
    return () => {
      live = false
      stopStage()
    }
  }, [])

  /* Preset 0 (soft blur) is what the studio applies to a fresh scan. */
  const regions = useMemo<Region[]>(
    () => (faces ?? []).map((face) => regionFromPreset(PRESETS[0], face.box, 'auto', face.score, face.model)),
    [faces],
  )

  useEffect(() => {
    const base = baseRef.current
    const censored = censoredRef.current
    if (!image || !base || !censored) return
    const size = fitWithin(image.width, image.height, 1280)
    renderComposite({ image, regions: [], canvas: base, width: size.width, height: size.height })
    renderComposite({ image, regions, canvas: censored, width: size.width, height: size.height })
  }, [image, regions])

  const moveTo = useCallback((clientX: number) => {
    const node = stageRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    if (rect.width === 0) return
    setSplit(clamp((clientX - rect.left) / rect.width, 0, 1))
  }, [])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP_COARSE : STEP
    const next =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? split - step
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? split + step
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 1
              : null
    if (next === null) return
    event.preventDefault()
    setSplit(clamp(next, 0, 1))
  }, [split])

  const scanning = !image ? true : faces === null && !unavailable
  const models = faces ? [...new Set(faces.map((face) => face.model))].map((model) => MODEL_NAME[model]) : []

  return (
    <div className="w-full">
      <div
        ref={stageRef}
        className="brackets relative w-full cursor-ew-resize touch-pan-y select-none overflow-hidden rounded-lg border border-line bg-ink"
        style={{ aspectRatio: image ? `${image.width} / ${image.height}` : '3 / 2' }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          moveTo(event.clientX)
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          moveTo(event.clientX)
        }}
      >
        <canvas ref={baseRef} className="absolute inset-0 size-full" aria-hidden="true" />
        <canvas
          ref={censoredRef}
          className="absolute inset-0 size-full"
          style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }}
          aria-hidden="true"
        />

        {image ? (
          <>
            <span className="mono-label pointer-events-none absolute bottom-3 left-3 rounded-full border border-line bg-void/70 px-2.5 py-1 text-dim backdrop-blur-sm">
              original
            </span>
            <span className="mono-label pointer-events-none absolute bottom-3 right-3 rounded-full border border-flare/30 bg-void/70 px-2.5 py-1 text-flare backdrop-blur-sm">
              censored
            </span>
          </>
        ) : null}

        {scanning ? (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute inset-0 bg-void/55" />
            <div className="absolute inset-4 overflow-hidden sm:inset-6">
              <div className="absolute inset-0 grid-field opacity-40" />
              <div className="brackets absolute inset-0">
                <div className="animate-scan absolute inset-x-0 top-0 h-full">
                  <div className="h-px w-full bg-flare shadow-[0_0_22px_3px_rgba(201,249,94,0.55)]" />
                </div>
              </div>
            </div>
            <div className="mono-label absolute bottom-4 left-4 flex items-center gap-2 text-flare sm:bottom-7 sm:left-7">
              <span className="animate-blip size-1.5 rounded-full bg-flare" />
              {stage ? STAGE_COPY[stage] : 'queued'}
            </div>
          </div>
        ) : null}

        {!scanning && !unavailable ? (
          <div className="absolute inset-y-0 z-10" style={{ left: `${split * 100}%` }}>
            <div className="absolute inset-y-0 -left-px w-0.5 bg-flare shadow-[0_0_18px_2px_rgba(201,249,94,0.45)]" />
            <div
              role="slider"
              tabIndex={0}
              aria-label="Before and after divider"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split * 100)}
              aria-orientation="horizontal"
              onKeyDown={onKeyDown}
              className="absolute top-1/2 left-0 flex size-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-flare/60 bg-void/85 backdrop-blur-sm"
            >
              <svg viewBox="0 0 16 16" className="size-4 text-flare" aria-hidden="true">
                <path d="M6 3 2.5 8 6 13M10 3l3.5 5L10 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        ) : null}

        {unavailable ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="max-w-sm text-center text-sm leading-relaxed text-mist">
              The demo photo could not be loaded, so the live scan is offline. The studio still redacts whatever you open in it.
            </p>
          </div>
        ) : null}
      </div>

      <div className="mono-label mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-dim">
        <span className="text-mist">
          {faces === null
            ? 'scanning group-studio.jpg'
            : degraded
              ? 'no scan ran in this browser'
              : `${faces.length} ${faces.length === 1 ? 'face' : 'faces'} detected · sensitivity 0.70`}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {faces && faces.length > 0 ? (
            models.map((model, index) => (
              <span key={model} className="whitespace-nowrap">
                {index > 0 ? '+ ' : ''}
                {model}
              </span>
            ))
          ) : (
            <span className="whitespace-nowrap">
              {scanning ? 'blazeface × 2' : degraded ? 'manual regions only' : 'no faces at this threshold'}
            </span>
          )}
        </span>
        <span>0 bytes uploaded</span>
      </div>
    </div>
  )
}

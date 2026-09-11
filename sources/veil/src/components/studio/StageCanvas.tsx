import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { renderComposite, type DecodedImage } from '@/lib/imaging'
import { useStudio } from '@/store/studio'
import { boxFromCorners, clamp, moveBox, resizeBox, RESIZE_HANDLES, type Box, type ResizeHandle } from '@/lib/types'
import { cn } from '@/lib/cn'

const MAX_PREVIEW_EDGE = 1700
const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}
const HANDLE_ANCHORS: Record<ResizeHandle, { left: string; top: string }> = {
  nw: { left: '0%', top: '0%' },
  n: { left: '50%', top: '0%' },
  ne: { left: '100%', top: '0%' },
  e: { left: '100%', top: '50%' },
  se: { left: '100%', top: '100%' },
  s: { left: '50%', top: '100%' },
  sw: { left: '0%', top: '100%' },
  w: { left: '0%', top: '50%' },
}

type Drag =
  | { kind: 'move'; id: string; origin: Box; px: number; py: number; rect: DOMRect; dirty: boolean }
  | { kind: 'resize'; id: string; handle: ResizeHandle; origin: Box; px: number; py: number; rect: DOMRect; dirty: boolean }
  | { kind: 'draw'; ax: number; ay: number; rect: DOMRect }
  | { kind: 'split'; px: number; start: number; rect: DOMRect }

const STAGE_LABEL: Record<string, string> = {
  runtime: 'initialising runtime',
  models: 'loading models',
  scan: 'scanning for faces',
}

export function StageCanvas({ image }: { image: DecodedImage }) {
  const regions = useStudio((state) => state.regions)
  const selectedId = useStudio((state) => state.selectedId)
  const tool = useStudio((state) => state.tool)
  const scanning = useStudio((state) => state.scanning)
  const detectStage = useStudio((state) => state.stage)
  const detectError = useStudio((state) => state.detectError)
  const select = useStudio((state) => state.select)
  const pushHistory = useStudio((state) => state.pushHistory)
  const updateRegion = useStudio((state) => state.updateRegion)
  const addRegion = useStudio((state) => state.addRegion)
  const removeRegion = useStudio((state) => state.removeRegion)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const originalRef = useRef<HTMLCanvasElement>(null)
  const compositeRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<Drag | null>(null)

  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [draft, setDraft] = useState<Box | null>(null)
  const [compare, setCompare] = useState(false)
  const [split, setSplit] = useState(0.5)

  useLayoutEffect(() => {
    const element = wrapperRef.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8) return
      const scale = Math.min(rect.width / image.width, rect.height / image.height)
      setViewport({ width: Math.max(1, Math.floor(image.width * scale)), height: Math.max(1, Math.floor(image.height * scale)) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [image])

  const backing = useMemo(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const ratio = Math.min(1, MAX_PREVIEW_EDGE / Math.max(viewport.width * dpr, viewport.height * dpr))
    return { width: Math.max(1, Math.round(viewport.width * dpr * ratio)), height: Math.max(1, Math.round(viewport.height * dpr * ratio)) }
  }, [viewport])

  useEffect(() => {
    const canvas = originalRef.current
    if (!canvas || !backing.width) return
    canvas.width = backing.width
    canvas.height = backing.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image.source, 0, 0, backing.width, backing.height)
  }, [image, backing])

  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      const canvas = compositeRef.current
      if (!canvas || !backing.width) return
      renderComposite({ image, regions, canvas, width: backing.width, height: backing.height })
    })
    return () => cancelAnimationFrame(handle)
  }, [image, regions, backing])

  useEffect(() => {
    if (!compare) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') setSplit((value) => clamp(value - 0.02, 0, 1))
      if (event.key === 'ArrowRight') setSplit((value) => clamp(value + 0.02, 0, 1))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [compare])

  useEffect(() => {
    if (!selectedId) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const step = event.shiftKey ? 0.02 : 0.004
      const region = regions.find((entry) => entry.id === selectedId)
      if (!region) return
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      if (event.key in nudge) {
        event.preventDefault()
        const [dx, dy] = nudge[event.key]
        updateRegion(selectedId, { box: moveBox(region.box, dx, dy) })
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeRegion(selectedId)
      } else if (event.key === 'Escape') {
        select(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, regions, updateRegion, removeRegion, select])

  function normalised(clientX: number, clientY: number, rect: DOMRect) {
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height }
  }

  /** The stage rect is read once per gesture — reading it on every move would
      force a layout on each frame while dragging. */
  function stageRect(): DOMRect | null {
    return wrapperRef.current?.firstElementChild?.getBoundingClientRect() ?? null
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    const rect = stageRect()
    if (!rect) return
    const point = normalised(event.clientX, event.clientY, rect)
    if (compare) {
      dragRef.current = { kind: 'split', px: point.x, start: split, rect }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    const handle = target.dataset.handle as ResizeHandle | undefined
    const regionId = target.dataset.regionId ?? target.closest<HTMLElement>('[data-region-id]')?.dataset.regionId

    if (handle && selectedId) {
      const region = regions.find((entry) => entry.id === selectedId)
      if (!region) return
      dragRef.current = { kind: 'resize', id: selectedId, handle, origin: region.box, px: point.x, py: point.y, rect, dirty: false }
    } else if (regionId) {
      const region = regions.find((entry) => entry.id === regionId)
      if (!region) return
      select(regionId)
      dragRef.current = { kind: 'move', id: regionId, origin: region.box, px: point.x, py: point.y, rect, dirty: false }
    } else if (tool === 'draw') {
      dragRef.current = { kind: 'draw', ax: point.x, ay: point.y, rect }
      setDraft({ x: point.x, y: point.y, w: 0, h: 0 })
    } else {
      select(null)
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    const point = normalised(event.clientX, event.clientY, drag.rect)
    if (drag.kind === 'move') {
      if (!drag.dirty) {
        pushHistory()
        drag.dirty = true
      }
      updateRegion(drag.id, { box: moveBox(drag.origin, point.x - drag.px, point.y - drag.py) }, { history: false })
    } else if (drag.kind === 'resize') {
      if (!drag.dirty) {
        pushHistory()
        drag.dirty = true
      }
      updateRegion(drag.id, { box: resizeBox(drag.origin, drag.handle, point.x - drag.px, point.y - drag.py) }, { history: false })
    } else if (drag.kind === 'draw') {
      setDraft(boxFromCorners(drag.ax, drag.ay, point.x, point.y))
    } else {
      setSplit(clamp(drag.start - (point.x - drag.px), 0, 1))
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag?.kind === 'draw') {
      const point = normalised(event.clientX, event.clientY, drag.rect)
      const box = boxFromCorners(drag.ax, drag.ay, point.x, point.y)
      setDraft(null)
      if (box.w > 0.012 && box.h > 0.012) {
        addRegion(box)
        useStudio.getState().setTool('select')
      }
    }
  }

  const selected = regions.find((region) => region.id === selectedId) ?? null

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <span className="mono-label text-dim">{image.width} × {image.height}</span>
        <span className="text-dim">·</span>
        <span className={cn('mono-label', regions.length ? 'text-flare' : 'text-dim')}>{regions.length} region{regions.length === 1 ? '' : 's'}</span>
        {selected?.confidence != null && (
          <>
            <span className="text-dim">·</span>
            <span className="mono-label text-mist">match {(selected.confidence * 100).toFixed(0)}%</span>
          </>
        )}
        <button
          type="button"
          onClick={() => setCompare((value) => !value)}
          aria-pressed={compare}
          className={cn(
            'mono-label ml-auto rounded-full border px-3 py-1.5 transition-colors',
            compare ? 'border-flare/50 bg-flare/10 text-flare' : 'border-line text-mist hover:border-white/25 hover:text-chalk',
          )}
        >
          {compare ? 'editing' : 'compare'}
        </button>
      </div>

      <div ref={wrapperRef} className="grid min-h-0 flex-1 place-items-center overflow-hidden p-4 sm:p-6">
        <div
          className="relative touch-none select-none shadow-[0_40px_120px_-50px_rgba(0,0,0,1)]"
          style={{ width: viewport.width || 1, height: viewport.height || 1 }}
        >
          <canvas ref={originalRef} className="absolute inset-0 size-full" style={{ imageRendering: 'auto' }} />
          <canvas
            ref={compositeRef}
            className="absolute inset-0 size-full"
            style={compare ? { clipPath: `inset(0 0 0 ${split * 100}%)` } : undefined}
          />

          {!compare && (
            <div
              className={cn('absolute inset-0', tool === 'draw' ? 'cursor-crosshair' : 'cursor-default')}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div className="pointer-events-none absolute inset-0 grid-field opacity-[0.14]" />

              {regions.map((region, index) => {
                const isSelected = region.id === selectedId
                return (
                  <div
                    key={region.id}
                    data-region-id={region.id}
                    className={cn(
                      'group absolute cursor-move transition-[outline-color] duration-150',
                      region.shape === 'ellipse' ? 'rounded-full' : 'rounded-[3px]',
                      isSelected ? 'outline-2 outline-offset-0 outline-flare' : 'outline-1 outline-flare/45 hover:outline-flare',
                    )}
                    style={{
                      left: `${region.box.x * 100}%`,
                      top: `${region.box.y * 100}%`,
                      width: `${region.box.w * 100}%`,
                      height: `${region.box.h * 100}%`,
                    }}
                  >
                    <span
                      className={cn(
                        'pointer-events-none absolute -top-5 left-0 rounded-[3px] px-1.5 py-0.5 font-mono text-[9.5px] font-medium tabular-nums transition-opacity',
                        isSelected ? 'bg-flare text-[#0a0f04] opacity-100' : 'bg-black/70 text-mist opacity-0 group-hover:opacity-100',
                      )}
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>

                    {isSelected &&
                      RESIZE_HANDLES.map((handle) => (
                        <span
                          key={handle}
                          data-handle={handle}
                          className="absolute size-2.5 rounded-[2px] border border-[#0a0f04] bg-flare"
                          style={{ left: HANDLE_ANCHORS[handle].left, top: HANDLE_ANCHORS[handle].top, transform: 'translate(-50%, -50%)', cursor: HANDLE_CURSORS[handle] }}
                        />
                      ))}
                  </div>
                )
              })}

              {draft && (
                <div
                  className="pointer-events-none absolute rounded-[3px] border border-dashed border-flare bg-flare/10"
                  style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }}
                />
              )}
            </div>
          )}

          {compare && (
            <div
              className="absolute inset-0 cursor-ew-resize touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div className="absolute inset-y-0 w-px bg-flare" style={{ left: `${split * 100}%` }}>
                <span className="absolute top-1/2 left-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-flare/60 bg-[#0a0f15]/90 backdrop-blur">
                  <svg viewBox="0 0 20 20" className="size-3.5 text-flare" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M7 6l-3 4 3 4M13 6l3 4-3 4" />
                  </svg>
                </span>
              </div>
              <span className="mono-label absolute bottom-3 left-3 rounded-full bg-black/70 px-2.5 py-1 text-flare">censored</span>
              <span className="mono-label absolute right-3 bottom-3 rounded-full bg-black/70 px-2.5 py-1 text-mist">original</span>
            </div>
          )}

          {scanning && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="animate-scan absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-flare/0 via-flare/12 to-flare/0">
                <div className="absolute inset-x-0 bottom-0 h-px bg-flare shadow-[0_0_16px_2px_rgba(201,249,94,0.55)]" />
              </div>
              <div className="brackets absolute inset-3" />
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2">
        {scanning ? (
          <span className="mono-label text-flare">{STAGE_LABEL[detectStage ?? 'runtime'] ?? 'scanning'}…</span>
        ) : detectError ? (
          <span className="mono-label text-rose">{detectError}</span>
        ) : (
          <span className="mono-label text-dim">
            {tool === 'draw' ? 'drag on the photo to add a region' : regions.length ? 'drag to move · corner handles resize · arrows nudge · delete removes' : 'run auto-detect, or switch to draw and mark faces by hand'}
          </span>
        )}
      </div>
    </div>
  )
}

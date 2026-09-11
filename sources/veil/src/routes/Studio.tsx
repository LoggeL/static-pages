import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { SegmentedControl } from '@/components/ui/primitives'
import { Dropzone } from '@/components/studio/Dropzone'
import { ExportPanel } from '@/components/studio/ExportPanel'
import { Inspector } from '@/components/studio/Inspector'
import { RegionList } from '@/components/studio/RegionList'
import { PresetList, SourcePanel } from '@/components/studio/SourcePanel'
import { StageCanvas } from '@/components/studio/StageCanvas'
import { MAX_UPLOAD_BYTES } from '@/lib/imaging'
import { formatBytes } from '@/lib/format'
import { useStudio } from '@/store/studio'
import { useToasts } from '@/store/toast'

export default function Studio() {
  const photo = useStudio((state) => state.photo)
  const regions = useStudio((state) => state.regions)
  const selectedId = useStudio((state) => state.selectedId)
  const tool = useStudio((state) => state.tool)
  const setTool = useStudio((state) => state.setTool)
  const load = useStudio((state) => state.load)
  const scan = useStudio((state) => state.scan)
  const undo = useStudio((state) => state.undo)
  const redo = useStudio((state) => state.redo)
  const canUndo = useStudio((state) => state.past.length > 0)
  const canRedo = useStudio((state) => state.future.length > 0)
  const decodeError = useStudio((state) => state.decodeError)
  const push = useToasts((state) => state.push)
  const takeQueued = useStudio((state) => state.takeQueued)
  const scanning = useStudio((state) => state.scanning)
  const dragDepth = useRef(0)

  const selectedIndex = regions.findIndex((region) => region.id === selectedId)
  const selected = selectedIndex >= 0 ? regions[selectedIndex] : null

  const absorb = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        push({ tone: 'error', title: 'Not an image', description: `${file.name} is not a raster image Veil can decode.` })
        return
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        push({ tone: 'error', title: 'File too large', description: `${formatBytes(file.size)} exceeds the ${formatBytes(MAX_UPLOAD_BYTES)} ceiling.` })
        return
      }
      await load(file)
      if (useStudio.getState().photo) void scan()
    },
    [load, push, scan],
  )

  useEffect(() => {
    const queued = takeQueued()
    if (queued) void absorb(queued)
  }, [absorb, takeQueued])

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (file) {
        event.preventDefault()
        void absorb(file)
      }
    }
    function onDragEnter(event: DragEvent) {
      if (!event.dataTransfer?.types.includes('Files')) return
      dragDepth.current += 1
    }
    function onDragLeave() {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
    }
    function onDrop(event: DragEvent) {
      dragDepth.current = 0
      const file = event.dataTransfer?.files?.[0]
      if (!file) return
      event.preventDefault()
      void absorb(file)
    }
    function onDragOver(event: DragEvent) {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
    }
  }, [absorb])

  if (!photo) {
    return <Dropzone onFile={(file) => void absorb(file)} error={decodeError} />
  }

  return (
    <div className="flex flex-col lg:h-[calc(100dvh-4rem)] lg:min-h-0 lg:overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 sm:px-5">
        <SegmentedControl
          value={tool}
          onChange={setTool}
          options={[
            { value: 'select', label: 'Select', title: 'Move and resize regions' },
            { value: 'draw', label: 'Draw', title: 'Drag on the photo to mark a face' },
          ]}
        />

        <div className="flex items-center gap-1">
          <IconButton label="Undo" disabled={!canUndo} onClick={undo}>
            <path d="M8 5L4 9l4 4" />
            <path d="M4 9h7a4 4 0 0 1 0 8H9" />
          </IconButton>
          <IconButton label="Redo" disabled={!canRedo} onClick={redo}>
            <path d="M12 5l4 4-4 4" />
            <path d="M16 9H9a4 4 0 0 0 0 8h2" />
          </IconButton>
        </div>

        <span className="mono-label hidden text-dim sm:inline">
          {scanning ? 'detecting…' : `${regions.length} region${regions.length === 1 ? '' : 's'}`}
        </span>

        <span className="mono-label ml-auto hidden text-dim lg:inline">on-device · nothing uploaded</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)_20rem]">
        <aside className="order-2 overflow-y-auto border-line lg:order-1 lg:border-r">
          <SourcePanel />
          <PresetList />
          <RegionList />
        </aside>

        <div className="order-1 flex min-h-[56vh] flex-col border-b border-line lg:order-2 lg:min-h-0 lg:border-b-0">
          <StageCanvas image={photo.image} />
        </div>

        <aside className="order-3 overflow-y-auto border-line lg:border-l">
          {selected ? <Inspector region={selected} index={selectedIndex} /> : <NoSelection />}
          <ExportPanel />
        </aside>
      </div>
    </div>
  )
}

function NoSelection() {
  return (
    <section className="border-b border-line px-4 py-5">
      <p className="mono-label mb-3 text-dim">Region</p>
      <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] leading-relaxed text-dim">
        Select a region on the photo or in the list to tune its treatment, strength and coverage.
      </p>
    </section>
  )
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full border border-line text-mist transition-colors hover:border-white/25 hover:text-chalk disabled:opacity-35 disabled:hover:border-line disabled:hover:text-mist"
    >
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  )
}

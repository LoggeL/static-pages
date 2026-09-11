import { Button } from '@/components/ui/Button'
import { Slider } from '@/components/ui/primitives'
import { PRESETS } from '@/lib/types'
import { formatBytes } from '@/lib/format'
import { useStudio } from '@/store/studio'
import { cn } from '@/lib/cn'

export function SourcePanel() {
  const photo = useStudio((state) => state.photo)
  const scanning = useStudio((state) => state.scanning)
  const scan = useStudio((state) => state.scan)
  const close = useStudio((state) => state.close)
  const sensitivity = useStudio((state) => state.sensitivity)
  const setSensitivity = useStudio((state) => state.setSensitivity)
  const lastScan = useStudio((state) => state.lastScan)

  if (!photo) return null

  return (
    <section className="border-b border-line px-4 py-5">
      <p className="mono-label mb-3 text-dim">Source</p>
      <p className="truncate text-[13.5px] font-medium text-chalk" title={photo.name}>
        {photo.name}
      </p>
      <p className="mono-label mt-1 text-dim">
        {photo.image.width} × {photo.image.height} · {formatBytes(photo.size)}
      </p>

      <div className="mt-4 flex gap-2">
        <Button size="sm" className="flex-1" onClick={() => void scan()} loading={scanning}>
          {scanning ? 'Scanning' : 'Auto-detect faces'}
        </Button>
        <Button size="sm" variant="secondary" onClick={close} title="Close this photo">
          Clear
        </Button>
      </div>

      <div className="mt-5">
        <Slider
          label="Sensitivity"
          value={sensitivity}
          min={0}
          max={1}
          step={0.05}
          onChange={setSensitivity}
          format={(value) => (value < 0.34 ? 'strict' : value > 0.7 ? 'lenient' : 'balanced')}
        />
        <p className="mt-2 text-[11.5px] leading-relaxed text-dim">
          Balanced runs at 0.48 confidence: high enough to ignore the back-of-head and clasped-hands false positives the model produces in the 0.3–0.5 band, low enough
          to keep real faces. Push it right for a crowded or badly lit shot and delete anything it over-marks — or push it left to only see the obvious faces. Faces under
          about 4% of the frame width are beyond this model, so mark those by hand.
        </p>
      </div>

      {lastScan && (
        <p className={cn('mono-label mt-4', lastScan.faces ? 'text-flare' : 'text-dim')}>
          {lastScan.faces === 0 ? 'no faces found — draw regions by hand' : `${lastScan.faces} face${lastScan.faces === 1 ? '' : 's'} marked automatically`}
        </p>
      )}
    </section>
  )
}

export function PresetList() {
  const presetId = useStudio((state) => state.presetId)
  const regions = useStudio((state) => state.regions)
  const applyPresetToAll = useStudio((state) => state.applyPresetToAll)

  return (
    <section className="border-b border-line px-4 py-5">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="mono-label text-dim">Style</p>
        {regions.length > 0 && <span className="mono-label text-dim">applies to all</span>}
      </div>
      <div className="grid grid-cols-1 gap-1">
        {PRESETS.map((preset) => {
          const active = preset.id === presetId
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPresetToAll(preset.id)}
              className={cn(
                'flex items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors duration-200',
                active ? 'border-flare/50 bg-flare/[0.07]' : 'border-transparent hover:border-line hover:bg-white/[0.03]',
              )}
            >
              <StyleSwatch style={preset.style} shape={preset.shape} emoji={preset.emoji} />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-[13px] font-medium', active ? 'text-chalk' : 'text-mist')}>{preset.name}</span>
                <span className="block truncate text-[11px] text-dim">{preset.blurb}</span>
              </span>
              {active && <span className="size-1.5 shrink-0 rounded-full bg-flare" />}
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-dim">Selecting a style also sets the default for the next region you draw.</p>
    </section>
  )
}

export function StyleSwatch({ style, shape, emoji, className }: { style: string; shape: string; emoji: string; className?: string }) {
  return (
    <span className={cn('grid size-8 shrink-0 place-items-center overflow-hidden rounded-[6px] border border-line bg-[#0a0d15]', className)}>
      {style === 'sticker' ? (
        <span className="text-[15px] leading-none">{emoji}</span>
      ) : style === 'ink' ? (
        <span className={cn('block bg-[#07080c]', shape === 'band' ? 'h-1.5 w-full border-y border-white/20' : 'size-full')} />
      ) : style === 'pixelate' ? (
        <span className="grid size-full grid-cols-3 grid-rows-3 gap-px p-[3px]">
          {Array.from({ length: 9 }).map((_, index) => (
            <span key={index} className="rounded-[1px]" style={{ background: ['#5b6478', '#8b93a6', '#39414f', '#aab2c2', '#6e7789', '#4a5265', '#8f97a8', '#3d4552', '#798296'][index] }} />
          ))}
        </span>
      ) : style === 'static' ? (
        <span className="size-full" style={{ backgroundImage: 'repeating-linear-gradient(45deg,#8a92a5 0 2px,#2a3040 2px 4px)' }} />
      ) : (
        <span className="size-full bg-gradient-to-br from-[#8b93a6] via-[#5b6478] to-[#2f3543] blur-[2.5px]" />
      )}
    </span>
  )
}

import { Badge, SegmentedControl, Slider } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { StyleSwatch } from './SourcePanel'
import { isWeakDetection } from './region-label'
import { CENSOR_STYLES, EMOJI_CHOICES, REGION_SHAPES, type CensorStyle, type Region, type RegionShape } from '@/lib/types'
import { useStudio } from '@/store/studio'
import { cn } from '@/lib/cn'

const STYLE_SHORT: Record<CensorStyle, string> = {
  blur: 'Blur',
  pixelate: 'Mosaic',
  ink: 'Bar',
  static: 'Static',
  sticker: 'Glyph',
}

const SHAPE_LABEL: Record<RegionShape, string> = { rect: 'Rect', ellipse: 'Oval', band: 'Band' }

export function Inspector({ region, index }: { region: Region; index: number }) {
  const updateRegion = useStudio((state) => state.updateRegion)
  const removeRegion = useStudio((state) => state.removeRegion)

  return (
    <section className="border-b border-line px-4 py-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="mono-label text-dim">
          Region <span className="text-flare">{String(index + 1).padStart(2, '0')}</span>
        </p>
        <div className="flex items-center gap-1.5">
          <Badge tone={region.source === 'auto' ? 'iris' : 'muted'}>{region.source}</Badge>
          {region.confidence != null && <Badge tone={isWeakDetection(region) ? 'rose' : 'muted'}>{Math.round(region.confidence * 100)}%</Badge>}
        </div>
      </div>

      <p className="mono-label mb-2 text-dim">Treatment</p>
      <div className="grid grid-cols-5 gap-1">
        {CENSOR_STYLES.map((style) => {
          const active = region.style === style
          return (
            <button
              key={style}
              type="button"
              onClick={() => updateRegion(region.id, { style })}
              aria-pressed={active}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2 transition-colors duration-200',
                active ? 'border-flare/50 bg-flare/[0.07]' : 'border-transparent hover:border-line hover:bg-white/[0.03]',
              )}
            >
              <StyleSwatch style={style} shape={region.shape} emoji={region.emoji} className="size-7" />
              <span className={cn('text-[9.5px] font-medium', active ? 'text-chalk' : 'text-dim')}>{STYLE_SHORT[style]}</span>
            </button>
          )
        })}
      </div>

      {region.style === 'sticker' && (
        <div className="mt-4">
          <p className="mono-label mb-2 text-dim">Glyph</p>
          <div className="flex flex-wrap gap-1">
            {EMOJI_CHOICES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => updateRegion(region.id, { emoji })}
                aria-pressed={region.emoji === emoji}
                className={cn(
                  'grid size-8 place-items-center rounded-lg border text-[15px] transition-colors',
                  region.emoji === emoji ? 'border-flare/60 bg-flare/10' : 'border-line hover:border-white/25',
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <p className="mono-label mb-2 text-dim">Shape</p>
        <SegmentedControl
          className="w-full"
          value={region.shape}
          onChange={(shape) => updateRegion(region.id, { shape })}
          options={REGION_SHAPES.map((shape) => ({ value: shape, label: SHAPE_LABEL[shape] }))}
        />
      </div>

      <div className="mt-5 space-y-4">
        <Slider label="Strength" value={region.intensity} onChange={(intensity) => updateRegion(region.id, { intensity })} format={(value) => `${Math.round(value * 100)}%`} />
        <Slider label="Edge feather" value={region.feather} onChange={(feather) => updateRegion(region.id, { feather })} format={(value) => `${Math.round(value * 100)}%`} />
        <Slider label="Coverage" value={region.pad} max={0.6} onChange={(pad) => updateRegion(region.id, { pad })} format={(value) => `+${Math.round(value * 100)}%`} />
      </div>

      <dl className="mt-5 grid grid-cols-4 gap-2 border-t border-line pt-4">
        {(['x', 'y', 'w', 'h'] as const).map((key) => (
          <div key={key}>
            <dt className="mono-label text-dim">{key}</dt>
            <dd className="font-mono text-[11.5px] tabular-nums text-mist">{(region.box[key] * 100).toFixed(1)}%</dd>
          </div>
        ))}
      </dl>

      <Button variant="danger" size="sm" className="mt-4 w-full" onClick={() => removeRegion(region.id)}>
        Delete region
      </Button>
    </section>
  )
}

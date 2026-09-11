import { Badge } from '@/components/ui/primitives'
import { StyleSwatch } from './SourcePanel'
import { describeRegion, isWeakDetection } from './region-label'
import { useStudio } from '@/store/studio'
import { cn } from '@/lib/cn'

export function RegionList() {
  const regions = useStudio((state) => state.regions)
  const selectedId = useStudio((state) => state.selectedId)
  const select = useStudio((state) => state.select)
  const removeRegion = useStudio((state) => state.removeRegion)
  const clearRegions = useStudio((state) => state.clearRegions)
  const setTool = useStudio((state) => state.setTool)

  return (
    <section className="border-b border-line px-4 py-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="mono-label text-dim">Regions</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTool('draw')}
            className="mono-label rounded-full border border-line px-2.5 py-1 text-mist transition-colors hover:border-flare/50 hover:text-flare"
          >
            + add
          </button>
          {regions.length > 0 && (
            <button type="button" onClick={clearRegions} className="mono-label rounded-full px-2.5 py-1 text-dim transition-colors hover:text-rose">
              clear
            </button>
          )}
        </div>
      </div>

      {regions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] leading-relaxed text-dim">
          No regions yet. Run auto-detect, or switch to the draw tool and drag over a face.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {regions.map((region, index) => {
            const active = region.id === selectedId
            return (
              <li key={region.id}>
                <div
                  className={cn(
                    'group flex items-center gap-2.5 rounded-lg border px-2 py-1.5 transition-colors duration-150',
                    active ? 'border-flare/50 bg-flare/[0.06]' : 'border-transparent hover:border-line hover:bg-white/[0.03]',
                  )}
                >
                  <button type="button" onClick={() => select(region.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                    <span className={cn('font-mono text-[10.5px] tabular-nums', active ? 'text-flare' : 'text-dim')}>{String(index + 1).padStart(2, '0')}</span>
                    <StyleSwatch
                      style={region.style}
                      shape={region.shape}
                      emoji={region.emoji}
                      className="size-6"
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[12.5px]', active ? 'text-chalk' : 'text-mist')}>{describeRegion(region)}</span>
                      <span className={cn('mono-label block text-[9.5px]', isWeakDetection(region) ? 'text-rose' : 'text-dim')}>
                        {region.source === 'auto' ? `auto ${region.confidence ? `${Math.round(region.confidence * 100)}%` : ''}${isWeakDetection(region) ? ' · check' : ''}` : 'manual'}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRegion(region.id)}
                    aria-label={`Delete region ${index + 1}`}
                    className="rounded p-1 text-dim opacity-0 transition-opacity hover:text-rose group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {regions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="muted">{regions.filter((region) => region.source === 'auto').length} auto</Badge>
          <Badge tone="muted">{regions.filter((region) => region.source === 'manual').length} manual</Badge>
        </div>
      )}
    </section>
  )
}

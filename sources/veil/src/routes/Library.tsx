import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Badge, Panel } from '@/components/ui/primitives'
import { Reveal } from '@/components/Reveal'
import { ConfirmDialog } from '@/components/account/ConfirmDialog'
import { PageHeader } from '@/components/account/PageHeader'
import { DAY_FMT } from '@/components/account/format'
import { useLibrary, type LibraryItem } from '@/store/library'
import { useToasts } from '@/store/toast'
import type { CensorStyle } from '@/lib/types'

/** The stored style is an id; the grid shows it the way the studio names it. */
const STYLE_LABELS: Record<CensorStyle, string> = {
  blur: 'Blur',
  pixelate: 'Pixelate',
  ink: 'Ink',
  static: 'Static',
  sticker: 'Sticker',
}

function SkeletonCard() {
  return (
    <div className="panel overflow-hidden rounded-xl">
      <div className="aspect-[4/3] animate-pulse bg-white/[0.03]" />
      <div className="space-y-2.5 p-4">
        <div className="h-3 w-2/3 animate-pulse rounded-full bg-white/[0.05]" />
        <div className="h-3 w-1/3 animate-pulse rounded-full bg-white/[0.03]" />
      </div>
    </div>
  )
}

export default function Library() {
  const items = useLibrary((state) => state.items)
  const thumbs = useLibrary((state) => state.thumbs)
  const ready = useLibrary((state) => state.ready)
  const error = useLibrary((state) => state.error)
  const hydrate = useLibrary((state) => state.hydrate)
  const remove = useLibrary((state) => state.remove)
  const clear = useLibrary((state) => state.clear)
  const push = useToasts((state) => state.push)
  const [pending, setPending] = useState<LibraryItem | null>(null)
  const [clearOpen, setClearOpen] = useState(false)

  // Hydration is a one-shot read of IndexedDB; `ready` never flips back, so this
  // runs exactly once per session even through StrictMode's double effect.
  useEffect(() => {
    if (!ready) void hydrate()
  }, [ready, hydrate])

  const faces = items.reduce((total, item) => total + item.faces, 0)
  const credits = items.reduce((total, item) => total + item.credits, 0)
  const stem = pending?.name ?? ''

  return (
    <>
      <PageHeader
        eyebrow="library"
        title="Local export archive"
        lede="Each redaction you export is kept here as a censored thumbnail, written to this browser's IndexedDB. Deleting it here is the only deletion that exists — there is no copy anywhere else."
      >
        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button variant="danger" size="sm" onClick={() => setClearOpen(true)}>
              Clear library
            </Button>
            <p className="mono-label tabular-nums text-dim">
              {items.length} export{items.length === 1 ? '' : 's'} · {faces} face{faces === 1 ? '' : 's'} · {credits.toLocaleString()} credits
            </p>
          </div>
        )}
      </PageHeader>

      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
        {!ready ? (
          <section>
            <div className="brackets mb-8 flex items-center gap-3 overflow-hidden rounded-xl border border-line bg-surface px-5 py-4">
              <span className="size-1.5 animate-blip rounded-full bg-flare" />
              <p className="mono-label text-mist">reading local storage</p>
              <span className="ml-auto font-mono text-[11px] text-dim">veil.library.v1</span>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </section>
        ) : error && items.length === 0 ? (
          <Reveal>
            <Panel className="border-rose/30 p-8 sm:p-10">
              <p className="mono-label text-rose">storage error</p>
              <h2 className="mt-4 text-xl font-semibold">This browser would not hand over the archive</h2>
              <p className="mt-3 max-w-prose text-[14px] leading-relaxed text-mist">{error}</p>
              <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-dim">
                Private windows, blocked site data and a full quota all produce this. Exports still render — they just cannot be filed here.
              </p>
              <Button variant="secondary" className="mt-6" onClick={() => void hydrate()}>
                Try again
              </Button>
            </Panel>
          </Reveal>
        ) : items.length === 0 ? (
          <Reveal>
            <Panel className="brackets p-10 text-center sm:p-16">
              <p className="mono-label text-flare">empty</p>
              <h2 className="mt-5 text-2xl font-semibold">No exports filed yet</h2>
              <p className="mx-auto mt-4 max-w-md text-[14px] leading-relaxed text-mist">
                Redact a photo in the studio and export it. The censored thumbnail lands here with its face count and the credits it cost, stored on this device and nowhere else.
              </p>
              <div className="mt-8">
                <Link to="/studio">
                  <Button>Open the studio</Button>
                </Link>
              </div>
              <p className="mx-auto mt-6 max-w-sm text-[12.5px] leading-relaxed text-dim">Clearing this browser's site data deletes the archive permanently. There is no cloud copy to restore from.</p>
            </Panel>
          </Reveal>
        ) : (
          <section>
            {error && (
              <div className="mb-6 rounded-xl border border-rose/30 bg-rose/[0.06] px-5 py-4">
                <p className="mono-label text-rose">storage warning</p>
                <p className="mt-2 text-[13px] leading-relaxed text-mist">{error}</p>
              </div>
            )}
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item, index) => (
                <Reveal key={item.id} delay={Math.min(index, 6) * 0.04}>
                  <article className="panel group flex h-full flex-col overflow-hidden rounded-xl">
                    <div className="relative aspect-[4/3] overflow-hidden bg-ink">
                      {thumbs[item.id] ? (
                        <img src={thumbs[item.id]} alt={`Censored export of ${item.name}`} loading="lazy" className="size-full object-cover" />
                      ) : (
                        <div className="grid size-full place-items-center">
                          <p className="mono-label text-dim">preview missing</p>
                        </div>
                      )}
                      <div className="absolute left-3 top-3">
                        <Badge tone="flare">{STYLE_LABELS[item.style]}</Badge>
                      </div>
                      <button
                        type="button"
                        aria-label={`Delete ${item.name}`}
                        title="Delete this export"
                        onClick={() => setPending(item)}
                        className="absolute right-3 top-3 grid size-8 place-items-center rounded-full border border-line bg-black/55 text-mist backdrop-blur transition-colors hover:border-rose/50 hover:text-rose"
                      >
                        <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M4 6.5h12M8 6.5V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M6.5 6.5l.7 8.1a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.7-8.1" />
                        </svg>
                      </button>
                    </div>

                    <div className="flex flex-1 flex-col p-4">
                      <p className="truncate text-[14.5px] font-medium text-chalk" title={item.name}>
                        {item.name}
                      </p>
                      <p className="mt-2 font-mono text-[11.5px] tabular-nums text-dim">
                        {DAY_FMT.format(item.at)} · {item.faces} face{item.faces === 1 ? '' : 's'} · {item.credits.toLocaleString()} credit{item.credits === 1 ? '' : 's'}
                      </p>
                      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                        <span className="font-mono text-[11px] tabular-nums text-dim">
                          {item.width}×{item.height}
                        </span>
                        <span className="mono-label text-dim">{item.presetId}</span>
                      </div>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Delete this export?"
        description={pending ? `“${stem}” and its stored thumbnail are removed from this device. The credits it cost stay spent.` : ''}
        confirmLabel="Delete export"
        onConfirm={async () => {
          if (!pending) return
          await remove(pending.id)
          push({ tone: 'default', title: 'Export deleted', description: `${stem} is gone from this device.` })
        }}
      />

      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear the whole library?"
        description={`All ${items.length} thumbnail${items.length === 1 ? '' : 's'} and the index behind them are deleted from this device. The ledger in Account is untouched.`}
        confirmLabel="Clear library"
        onConfirm={async () => {
          await clear()
          push({ tone: 'default', title: 'Library cleared', description: 'Every stored thumbnail was deleted from this device.' })
        }}
      />
    </>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { SegmentedControl, Slider } from '@/components/ui/primitives'
import { renderThumbnail, renderToBlob, type ExportFormat } from '@/lib/imaging'
import { costFor } from '@/lib/pricing'
import { CENSOR_STYLES, uid, type CensorStyle } from '@/lib/types'
import { useCredits } from '@/store/credits'
import { useLibrary } from '@/store/library'
import { useStudio } from '@/store/studio'
import { useToasts } from '@/store/toast'
import { cn } from '@/lib/cn'

const SIZES = [
  { label: 'Original', value: 0 },
  { label: '8192 px', value: 8192 },
  { label: '4096 px', value: 4096 },
  { label: '2048 px', value: 2048 },
  { label: '1280 px', value: 1280 },
]

const EXTENSION: Record<ExportFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' }

function dominantStyle(styles: CensorStyle[]): CensorStyle {
  let best: CensorStyle = styles[0] ?? 'blur'
  let bestCount = 0
  for (const style of CENSOR_STYLES) {
    const count = styles.filter((entry) => entry === style).length
    if (count > bestCount) {
      best = style
      bestCount = count
    }
  }
  return best
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoke on the next tick so the download has definitely started.
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function ExportPanel() {
  const photo = useStudio((state) => state.photo)
  const regions = useStudio((state) => state.regions)
  const presetId = useStudio((state) => state.presetId)
  const balance = useCredits((state) => state.balance)
  const spend = useCredits((state) => state.spend)
  const addToLibrary = useLibrary((state) => state.add)
  const push = useToasts((state) => state.push)

  const [format, setFormat] = useState<ExportFormat>('png')
  const [quality, setQuality] = useState(0.92)
  const [maxEdge, setMaxEdge] = useState(0)
  const [busy, setBusy] = useState(false)

  const cost = costFor(regions.length)
  const affordable = balance >= cost
  const ready = Boolean(photo) && regions.length > 0

  if (!photo) return null

  async function runExport() {
    if (!photo || busy || !ready) return
    setBusy(true)
    try {
      const edge = maxEdge || 100_000
      const blob = await renderToBlob(photo.image, regions, { format, quality, maxEdge: edge })
      if (!spend(cost, `Export · ${photo.name}`, `${regions.length} face${regions.length === 1 ? '' : 's'} redacted`)) {
        push({ tone: 'error', title: 'Not enough credits', description: `This export needs ${cost} credit${cost === 1 ? '' : 's'}. Top up to continue.` })
        return
      }
      const base = photo.name.replace(/\.[^.]+$/, '') || 'image'
      triggerDownload(blob, `${base}-veiled.${EXTENSION[format]}`)

      const thumbnail = await renderThumbnail(photo.image, regions, 560)
      await addToLibrary(
        {
          id: uid(),
          name: photo.name,
          at: Date.now(),
          faces: regions.length,
          credits: cost,
          width: photo.image.width,
          height: photo.image.height,
          style: dominantStyle(regions.map((region) => region.style)),
          presetId,
        },
        thumbnail,
      )
      push({ tone: 'success', title: `Exported · −${cost} credit${cost === 1 ? '' : 's'}`, description: `${regions.length} face${regions.length === 1 ? '' : 's'} redacted at ${format.toUpperCase()}. Saved to your library.` })
    } catch (error) {
      push({ tone: 'error', title: 'Export failed', description: error instanceof Error ? error.message : 'The image could not be encoded.' })
    } finally {
      setBusy(false)
    }
  }

  async function copyToClipboard() {
    if (!photo || busy) return
    setBusy(true)
    try {
      const blob = await renderToBlob(photo.image, regions, { format: 'png', quality: 1, maxEdge: maxEdge || 100_000 })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      push({ tone: 'success', title: 'Copied to clipboard', description: 'PNG copied — no credits spent on copies.' })
    } catch {
      push({ tone: 'error', title: 'Clipboard unavailable', description: 'This browser blocked the clipboard write. Use Export instead.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="px-4 py-5">
      <p className="mono-label mb-4 text-dim">Export</p>

      <p className="mono-label mb-2 text-dim">Format</p>
      <SegmentedControl
        className="w-full"
        value={format}
        onChange={setFormat}
        options={[
          { value: 'png', label: 'PNG' },
          { value: 'jpeg', label: 'JPEG' },
          { value: 'webp', label: 'WebP' },
        ]}
      />

      {format !== 'png' && (
        <div className="mt-4">
          <Slider label="Quality" value={quality} min={0.4} max={1} step={0.02} onChange={setQuality} format={(value) => `${Math.round(value * 100)}%`} />
        </div>
      )}

      <label className="mt-4 block">
        <span className="mono-label mb-2 block text-dim">Longest edge</span>
        <select
          value={maxEdge}
          onChange={(event) => setMaxEdge(Number(event.target.value))}
          className="h-9 w-full rounded-lg border border-line bg-[#0a0d15] px-2.5 text-[13px] text-chalk outline-none transition-colors focus:border-flare/60"
        >
          {SIZES.map((size) => (
            <option key={size.value} value={size.value}>
              {size.label}
            </option>
          ))}
        </select>
      </label>

      <div className="sticky bottom-0 -mx-4 mt-5 border-t border-line bg-[#0b0e16]/95 px-4 pb-1 pt-4 backdrop-blur-xl">
        <dl className="space-y-2">
          <div className="flex items-baseline justify-between">
            <dt className="text-[12.5px] text-mist">Cost</dt>
            <dd className={cn('font-mono text-[12.5px] tabular-nums', affordable ? 'text-chalk' : 'text-rose')}>
              {ready ? `${cost} credit${cost === 1 ? '' : 's'}` : '—'}
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-[12.5px] text-mist">Balance</dt>
            <dd className="font-mono text-[12.5px] tabular-nums text-dim">{balance.toLocaleString()}</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-[12.5px] text-mist">After export</dt>
            <dd className={cn('font-mono text-[12.5px] tabular-nums', affordable ? 'text-flare' : 'text-rose')}>
              {ready ? Math.max(0, balance - cost).toLocaleString() : balance.toLocaleString()}
            </dd>
          </div>
        </dl>

        {affordable ? (
          <Button className="mt-4 w-full" size="lg" loading={busy} disabled={!ready} onClick={() => void runExport()}>
            {ready ? `Export · ${cost} credit${cost === 1 ? '' : 's'}` : 'Mark a face first'}
          </Button>
        ) : (
          <Link to="/pricing" className="mt-4 block">
            <Button className="w-full" size="lg">
              Top up credits
            </Button>
          </Link>
        )}

        <Button variant="ghost" size="sm" className="mt-2 mb-1 w-full" disabled={busy || !ready} onClick={() => void copyToClipboard()}>
          Copy as PNG
        </Button>
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-dim">
        Charged per exported face. Copying to the clipboard is always free, so you can check the result before you spend anything.
      </p>
    </section>
  )
}

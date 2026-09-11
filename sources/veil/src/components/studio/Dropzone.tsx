import { useRef, useState, type DragEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Eyebrow } from '@/components/ui/primitives'

import { SAMPLE_PHOTOS, fetchSampleFile } from '@/lib/samples'
import { assetUrl } from '@/lib/assets'
import { cn } from '@/lib/cn'

interface DropzoneProps {
  onFile: (file: File) => void
  error: string | null
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp'

export function Dropzone({ onFile, error }: DropzoneProps) {
  const [dragging, setDragging] = useState(false)
  const [loadingSample, setLoadingSample] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) onFile(file)
  }

  async function pickSample(id: string) {
    const sample = SAMPLE_PHOTOS.find((entry) => entry.id === id)
    if (!sample) return
    setLoadingSample(id)
    try {
      onFile(await fetchSampleFile(sample))
    } finally {
      setLoadingSample(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-8">
      <Eyebrow>Studio</Eyebrow>
      <h1 className="mt-5 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
        Drop a photo in.
        <br />
        <span className="font-serif italic font-normal text-flare">Nothing</span> leaves this tab.
      </h1>
      <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-mist">
        Faces are found by a model running on your own machine. Redaction, preview and export all happen in this browser — there is no upload step, because there is no server.
      </p>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'mt-10 rounded-2xl border border-dashed p-8 transition-colors duration-200 sm:p-12',
          dragging ? 'border-flare/70 bg-flare/[0.04]' : 'border-line bg-surface/50 hover:border-white/25',
        )}
      >
        <div className="flex flex-col items-center text-center">
          <span className="brackets relative grid size-14 place-items-center rounded-xl border border-line bg-white/[0.02]">
            <svg viewBox="0 0 24 24" className="size-6 text-flare" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4m0 0L8 8m4-4l4 4" />
              <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            </svg>
          </span>
          <p className="mt-5 text-[15px] font-medium text-chalk">Drop an image anywhere on this page</p>
          <p className="mt-1.5 text-[13px] text-dim">or paste from the clipboard · PNG, JPEG, WebP, AVIF up to 40 MB</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button onClick={() => inputRef.current?.click()}>Choose a file</Button>
          </div>
          <p className="mono-label mt-3 text-dim">no account needed · runs offline</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onFile(file)
              event.target.value = ''
            }}
          />
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg border border-rose/40 bg-rose/5 px-4 py-3 text-sm text-rose">{error}</p>}

      <div className="mt-12">
        <div className="flex items-baseline justify-between">
          <p className="mono-label text-dim">or start from a sample</p>
          <p className="mono-label text-dim">bundled locally</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {SAMPLE_PHOTOS.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => void pickSample(sample.id)}
              disabled={loadingSample !== null}
              className="group relative overflow-hidden rounded-lg border border-line bg-surface text-left transition-colors hover:border-flare/50 disabled:opacity-50"
            >
              <span className="block aspect-\[4/5\] overflow-hidden bg-black">
                <img src={assetUrl(sample.file)} alt="" loading="lazy" className="size-full object-cover opacity-85 transition-opacity duration-300 group-hover:opacity-100" />
              </span>
              <span className="block px-2.5 py-2">
                <span className="block truncate text-[12.5px] font-medium text-chalk">{loadingSample === sample.id ? 'loading…' : sample.label}</span>
                <span className="mono-label mt-0.5 block truncate text-[9.5px] text-dim">{sample.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

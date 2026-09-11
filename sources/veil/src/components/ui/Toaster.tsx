import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useToasts, type Toast } from '@/store/toast'
import { cn } from '@/lib/cn'

const TONES: Record<Toast['tone'], string> = {
  default: 'border-line',
  success: 'border-flare/40',
  credit: 'border-iris/45',
  error: 'border-rose/45',
}

const DOTS: Record<Toast['tone'], string> = {
  default: 'bg-mist',
  success: 'bg-flare',
  credit: 'bg-iris',
  error: 'bg-rose',
}

function Row({ toast }: { toast: Toast }) {
  const dismiss = useToasts((state) => state.dismiss)
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), 5000)
    return () => window.clearTimeout(timer)
  }, [toast.id, dismiss])

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className={cn('pointer-events-auto flex w-80 items-start gap-3 rounded-xl border bg-[#0d1018]/95 px-4 py-3.5 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] backdrop-blur-xl', TONES[toast.tone])}
    >
      <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', DOTS[toast.tone])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium leading-snug text-chalk">{toast.title}</p>
        {toast.description && <p className="mt-1 text-[12.5px] leading-relaxed text-mist">{toast.description}</p>}
      </div>
      <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss" className="-mr-1 -mt-0.5 rounded-full p-1 text-dim transition-colors hover:text-chalk">
        <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M5 5l10 10M15 5L5 15" />
        </svg>
      </button>
    </motion.li>
  )
}

export function Toaster() {
  const toasts = useToasts((state) => state.toasts)
  return (
    <ul aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-200 flex flex-col items-end gap-2.5">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <Row key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </ul>
  )
}

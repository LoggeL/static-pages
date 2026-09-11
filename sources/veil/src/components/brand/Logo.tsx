import { cn } from '@/lib/cn'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-6', className)} fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="text-flare">
        <path d="M6 12.5V9.2A3.2 3.2 0 0 1 9.2 6H12.5" />
        <path d="M19.5 6h3.3A3.2 3.2 0 0 1 26 9.2v3.3" />
        <path d="M26 19.5v3.3a3.2 3.2 0 0 1-3.2 3.2h-3.3" />
        <path d="M12.5 26H9.2A3.2 3.2 0 0 1 6 22.8v-3.3" />
      </g>
      <circle cx="16" cy="16" r="3.1" fill="currentColor" className="text-flare" />
    </svg>
  )
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-chalk', className)}>
      <LogoMark />
      {!compact && <span className="text-[17px] font-semibold tracking-[-0.04em]">veil</span>}
    </span>
  )
}

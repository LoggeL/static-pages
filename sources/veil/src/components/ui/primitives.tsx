import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('mono-label flex items-center gap-2.5 text-mist', className)}>
      <span className="inline-block size-1.5 rounded-full bg-flare" aria-hidden="true" />
      {children}
    </p>
  )
}

export type BadgeTone = 'default' | 'flare' | 'iris' | 'rose' | 'muted'

const BADGE_TONES: Record<BadgeTone, string> = {
  default: 'border-line bg-white/[0.04] text-mist',
  flare: 'border-flare/35 bg-flare/10 text-flare',
  iris: 'border-iris/40 bg-iris/12 text-[#b3a8ff]',
  rose: 'border-rose/35 bg-rose/10 text-rose',
  muted: 'border-transparent bg-white/[0.03] text-dim',
}

export function Badge({ children, tone = 'default', className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em]', BADGE_TONES[tone], className)}>
      {children}
    </span>
  )
}

export function Card({ children, className, interactive = false }: { children: ReactNode; className?: string; interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-surface',
        interactive && 'transition-colors duration-300 hover:border-white/18 hover:bg-raised',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Card with the brand's top-light sheen. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('panel rounded-xl', className)}>{children}</div>
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('gradient-rule', className)} aria-hidden="true" />
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string | null
}

export function Field({ label, hint, error, className, id, ...rest }: FieldProps) {
  const inputId = id ?? rest.name ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <label className="block" htmlFor={inputId}>
      {label && <span className="mono-label mb-2 block text-dim">{label}</span>}
      <input
        id={inputId}
        className={cn(
          'h-11 w-full rounded-lg border bg-[#0a0d15] px-3.5 text-sm text-chalk placeholder:text-dim',
          'transition-colors duration-200 outline-none',
          error ? 'border-rose/60' : 'border-line focus:border-flare/60',
          className,
        )}
        {...rest}
      />
      {error ? <span className="mt-1.5 block text-xs text-rose">{error}</span> : hint ? <span className="mt-1.5 block text-xs text-dim">{hint}</span> : null}
    </label>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  title?: string
}

export function SegmentedControl<T extends string>({ options, value, onChange, className }: { options: SegmentOption<T>[]; value: T; onChange: (value: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('inline-flex items-center gap-0.5 rounded-full border border-line bg-[#0a0d15] p-0.5', className)}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors duration-200',
              active ? 'bg-raised text-chalk shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'text-dim hover:text-mist',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

interface SliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label: string
  format?: (value: number) => string
  className?: string
}

export function Slider({ value, onChange, min = 0, max = 1, step = 0.01, label, format, className }: SliderProps) {
  const percent = ((value - min) / (max - min)) * 100
  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="mono-label text-dim">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-mist">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        className="veil-range"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ ['--range-progress' as string]: `${percent}%` }}
      />
    </div>
  )
}

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-line bg-white/[0.015] p-4', className)}>
      <p className="mono-label text-dim">{label}</p>
      <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-chalk">{value}</p>
      {sub && <p className="mt-1 text-xs text-mist">{sub}</p>}
    </div>
  )
}

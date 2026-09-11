import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-flare text-[#0a0f04] hover:bg-[#d8ff7a] shadow-[0_10px_30px_-14px_rgba(201,249,94,0.7)] hover:shadow-[0_14px_40px_-12px_rgba(201,249,94,0.85)]',
  secondary: 'bg-raised text-chalk border border-line hover:border-white/25 hover:bg-[#1b2030]',
  ghost: 'text-mist hover:text-chalk hover:bg-white/[0.06]',
  outline: 'border border-line text-chalk hover:border-flare/60 hover:text-flare',
  danger: 'border border-rose/35 text-rose hover:bg-rose/10 hover:border-rose/60',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3.5 text-[13px] gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-12 px-7 text-[15px] gap-2.5',
}

/** Shared so anchors and router links can wear the same skin as `<Button>`. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string): string {
  return cn(
    'inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-medium tracking-[-0.01em]',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-[var(--ease-out-quint)]',
    'active:scale-[0.975] disabled:pointer-events-none disabled:opacity-45',
    VARIANTS[variant],
    SIZES[size],
    extra,
  )
}

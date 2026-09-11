import type { ReactNode } from 'react'
import { Eyebrow } from '@/components/ui/primitives'

interface PageHeaderProps {
  eyebrow: string
  title: ReactNode
  lede?: ReactNode
  /** Counters, filters or CTAs that belong beside the title. */
  children?: ReactNode
}

/** Shared top band for the account-facing routes: grid field, one flare bloom,
    then the title block on the same 7xl rail the header and footer use. */
export function PageHeader({ eyebrow, title, lede, children }: PageHeaderProps) {
  return (
    <header className="relative overflow-hidden border-b border-line">
      <div className="grid-field pointer-events-none absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -left-32 -top-40 size-96 rounded-full bg-flare/[0.06] blur-3xl" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-5 pb-12 pt-14 sm:px-8 sm:pb-14 sm:pt-20">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-5 max-w-3xl text-[34px] font-semibold leading-[1.05] sm:text-5xl">{title}</h1>
        {lede && <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-mist">{lede}</p>}
        {children && <div className="mt-8">{children}</div>}
      </div>
    </header>
  )
}

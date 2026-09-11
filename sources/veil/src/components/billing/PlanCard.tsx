import { Link } from 'react-router-dom'
import { buttonClasses } from '@/components/ui/buttonStyles'
import { Badge } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import type { Plan } from '@/lib/pricing'

function Tick() {
  return (
    <svg viewBox="0 0 16 16" className="mt-[3px] size-3.5 shrink-0 text-flare" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5l3.2 3.2L13 5" />
    </svg>
  )
}

export function PlanCard({ plan }: { plan: Plan }) {
  /* The free tier never reaches checkout — it just opens the studio with the
     welcome credits the ledger already granted. */
  const to = plan.id === 'free' ? '/studio' : `/checkout?plan=${plan.id}`

  return (
    <div
      className={cn(
        'relative flex h-full flex-col rounded-xl border p-6',
        plan.featured ? 'border-flare/45 bg-surface glow-flare' : 'border-line bg-surface',
      )}
    >
      {plan.featured && (
        <Badge tone="flare" className="absolute -top-3 left-6">
          Most popular
        </Badge>
      )}

      <p className="mono-label text-dim">{plan.name}</p>

      <p className="mt-5 flex items-baseline gap-2">
        <span className="text-4xl font-medium tabular-nums tracking-[-0.03em] text-chalk">${plan.price}</span>
        <span className="text-[13px] text-dim">{plan.cadence}</span>
      </p>

      <p className="mt-3 text-[13.5px] leading-relaxed text-mist">{plan.tagline}</p>

      <p className="mono-label mt-5 text-flare">{plan.creditsLabel}</p>

      <ul className="mt-5 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-2.5 text-[13px] leading-relaxed text-mist">
            <Tick />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-7">
        <Link to={to} className={buttonClasses(plan.featured ? 'primary' : 'secondary', 'md', 'w-full')}>
          {plan.cta}
        </Link>
      </div>
    </div>
  )
}

import { Link } from 'react-router-dom'
import { buttonClasses } from '@/components/ui/buttonStyles'
import { Badge } from '@/components/ui/primitives'
import { unitPrice, type CreditPack } from '@/lib/pricing'

export function PackCard({ pack }: { pack: CreditPack }) {
  return (
    <div className="panel brackets flex h-full flex-col rounded-xl p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mono-label text-dim">One-time top-up</p>
          <p className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-medium tabular-nums tracking-[-0.03em] text-chalk">{pack.credits.toLocaleString()}</span>
            <span className="text-[13px] text-dim">credits</span>
          </p>
        </div>
        {pack.badge && <Badge tone="flare">{pack.badge}</Badge>}
      </div>

      <div className="mt-6 flex items-baseline gap-2.5">
        <span className="text-2xl font-medium tabular-nums text-chalk">${pack.price}</span>
        <span className="mono-label text-dim">{unitPrice(pack)} per credit</span>
      </div>

      <div className="mt-auto pt-7">
        <Link to={`/checkout?pack=${pack.id}`} className={buttonClasses('secondary', 'md', 'w-full')}>
          Buy {pack.credits.toLocaleString()} credits
        </Link>
      </div>
    </div>
  )
}

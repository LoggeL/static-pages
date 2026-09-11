import { Divider } from '@/components/ui/primitives'

export interface OrderSummaryProps {
  title: string
  subtitle: string
  price: number
  credits: number
  /** Absent for one-time packs. */
  cadence?: string
}

export function OrderSummary({ title, subtitle, price, credits, cadence }: OrderSummaryProps) {
  return (
    <div className="panel rounded-xl p-6">
      <p className="mono-label text-dim">Order summary</p>

      <div className="mt-5">
        <p className="text-[15px] font-medium text-chalk">{title}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-mist">{subtitle}</p>
      </div>

      <div className="mt-6 space-y-3">
        <div className="flex items-baseline justify-between gap-4 text-[13.5px]">
          <span className="text-dim">Price</span>
          <span className="tabular-nums text-mist">
            ${price}
            {cadence ? ` ${cadence}` : ''}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-4 text-[13.5px]">
          <span className="text-dim">Credits granted</span>
          <span className="tabular-nums text-flare">+{credits.toLocaleString()}</span>
        </div>
      </div>

      <Divider className="my-5" />

      <div className="flex items-baseline justify-between gap-4">
        <span className="mono-label text-dim">Total</span>
        <span className="text-2xl font-medium tabular-nums tracking-[-0.03em] text-chalk">${price}</span>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-dim">
        Billed in test mode. No card is charged and nothing leaves this tab.
      </p>
    </div>
  )
}

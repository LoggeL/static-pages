import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CardForm } from '@/components/billing/CardForm'
import { OrderSummary, type OrderSummaryProps } from '@/components/billing/OrderSummary'
import { TestModeNotice } from '@/components/billing/TestModeNotice'
import { Reveal } from '@/components/Reveal'
import { Button } from '@/components/ui/Button'
import { buttonClasses } from '@/components/ui/buttonStyles'
import { Badge, Eyebrow, Panel } from '@/components/ui/primitives'
import { PACKS, PLANS } from '@/lib/pricing'
import { uid } from '@/lib/types'
import { packById, useCredits } from '@/store/credits'
import { useToasts } from '@/store/toast'

interface Order extends OrderSummaryProps {
  heading: string
}

interface Receipt {
  reference: string
  kind: 'pack' | 'plan'
}

const LINK_PILL = 'rounded-full border border-line px-3.5 py-1.5 font-mono text-[11.5px] text-mist transition-colors duration-200 hover:border-flare/40 hover:text-chalk'

export default function Checkout() {
  const [params] = useSearchParams()
  const pack = packById(params.get('pack') ?? '')
  const plan = PLANS.find((candidate) => candidate.id === params.get('plan'))
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  const balance = useCredits((state) => state.balance)
  const purchasePack = useCredits((state) => state.purchasePack)
  const subscribe = useCredits((state) => state.subscribe)
  const push = useToasts((state) => state.push)

  const order: Order | null = pack
    ? {
        heading: `Top up ${pack.credits.toLocaleString()} credits`,
        title: `${pack.credits.toLocaleString()} credit pack`,
        subtitle: 'One-time top-up. The credits sit in this browser until you spend them.',
        credits: pack.credits,
        price: pack.price,
      }
    : plan
      ? {
          heading: `Start the ${plan.name} plan`,
          title: `${plan.name} plan`,
          subtitle: plan.tagline,
          credits: plan.credits,
          price: plan.price,
          cadence: plan.cadence,
        }
      : null

  function pay() {
    if (!order || processing || receipt) return
    const pending = order
    setProcessing(true)
    setError(null)
    // The delay is theatre — but it is the only honest way to show a processing
    // state for an order that settles instantly in local storage.
    window.setTimeout(() => {
      try {
        const reference = uid()
        if (pack) purchasePack(pack, reference)
        else if (plan) subscribe(plan.id, reference)
        else throw new Error('That link no longer points at a pack or a plan.')
        setReceipt({ reference, kind: pack ? 'pack' : 'plan' })
        push({
          tone: 'credit',
          title: `${pending.credits.toLocaleString()} credits added`,
          description: `Test-mode ${pack ? 'top-up' : 'subscription'} · ref ${reference}`,
        })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The payment could not be completed.')
      } finally {
        setProcessing(false)
      }
    }, 1400)
  }

  const available = (
    <div className="mt-8 border-t border-line pt-6">
      <p className="mono-label text-dim">Orderable now</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {PACKS.map((candidate) => (
          <Link key={candidate.id} to={`/checkout?pack=${candidate.id}`} className={LINK_PILL}>
            {candidate.credits.toLocaleString()} credits · ${candidate.price}
          </Link>
        ))}
        {PLANS.filter((candidate) => candidate.price > 0).map((candidate) => (
          <Link key={candidate.id} to={`/checkout?plan=${candidate.id}`} className={LINK_PILL}>
            {candidate.name} · ${candidate.price}/mo
          </Link>
        ))}
      </div>
    </div>
  )

  return (
    <div className="mx-auto max-w-7xl px-5 pb-24 pt-16 sm:px-8">
      <Reveal>
        <Eyebrow>Checkout</Eyebrow>
      </Reveal>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <Reveal delay={0.06}>
          {receipt && order ? (
            <Panel className="p-7 sm:p-8">
              <Badge tone="flare">Ledger updated</Badge>
              <h1 className="mt-5 text-[30px] font-medium leading-tight tracking-[-0.035em] text-chalk sm:text-[36px]">Credits landed.</h1>
              <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-mist">
                {order.credits.toLocaleString()} credits went into this browser’s ledger. Your balance is now{' '}
                <span className="font-medium tabular-nums text-chalk">{balance.toLocaleString()}</span> credits.
              </p>
              {receipt.kind === 'plan' && plan && (
                <p className="mt-2 text-[13px] leading-relaxed text-dim">
                  You are on the {plan.name} plan — {plan.creditsLabel}.
                </p>
              )}

              <div className="mt-7 flex flex-wrap gap-x-10 gap-y-4 border-t border-line pt-6">
                <div>
                  <p className="mono-label text-dim">Order</p>
                  <p className="mt-1.5 text-[13px] text-mist">{order.title}</p>
                </div>
                <div>
                  <p className="mono-label text-dim">Reference</p>
                  <p className="mt-1.5 break-all font-mono text-[12px] text-mist">{receipt.reference}</p>
                </div>
                <div>
                  <p className="mono-label text-dim">Charged</p>
                  <p className="mt-1.5 font-mono text-[12px] text-mist">$0.00 · test mode</p>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/studio" className={buttonClasses('primary', 'md')}>
                  Open studio
                </Link>
                <Link to="/account" className={buttonClasses('secondary', 'md')}>
                  View account
                </Link>
                <Link to="/pricing" className={buttonClasses('ghost', 'md')}>
                  Buy more credits
                </Link>
              </div>
            </Panel>
          ) : order ? (
            <Panel className="p-7 sm:p-8">
              <h1 className="text-[30px] font-medium leading-tight tracking-[-0.035em] text-chalk sm:text-[36px]">{order.heading}</h1>
              <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-mist">
                {order.credits.toLocaleString()} credits land in the ledger the moment this clears. No account, no upload, no card on file.
              </p>

              <TestModeNotice className="mt-6" />

              {error && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-rose/35 bg-rose/[0.06] p-4">
                  <div className="flex items-start gap-3">
                    <Badge tone="rose" className="mt-0.5 shrink-0">
                      Failed
                    </Badge>
                    <p className="text-[12.5px] leading-relaxed text-mist">
                      {error} Nothing was charged and the ledger is unchanged.
                    </p>
                  </div>
                  <Button variant="danger" size="sm" onClick={pay} disabled={processing}>
                    Retry payment
                  </Button>
                </div>
              )}

              <div className="mt-7">
                <CardForm submitLabel={`Pay $${order.price} in test mode`} processing={processing} onSubmit={pay} />
              </div>
            </Panel>
          ) : (
            <Panel className="p-7 sm:p-8">
              <h1 className="text-[30px] font-medium leading-tight tracking-[-0.035em] text-chalk sm:text-[36px]">Nothing to check out.</h1>
              <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-mist">
                This page needs a <span className="font-mono text-[13px] text-chalk">?pack=&lt;id&gt;</span> or{' '}
                <span className="font-mono text-[13px] text-chalk">?plan=&lt;id&gt;</span> in the URL. Neither matched anything in the catalogue, so
                there is no order to pay for.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/pricing" className={buttonClasses('primary', 'md')}>
                  See pricing
                </Link>
                <Link to="/studio" className={buttonClasses('secondary', 'md')}>
                  Open studio
                </Link>
              </div>
              {available}
            </Panel>
          )}
        </Reveal>

        {order && (
          <Reveal delay={0.12} className="lg:sticky lg:top-24">
            <OrderSummary {...order} />
          </Reveal>
        )}
      </div>
    </div>
  )
}

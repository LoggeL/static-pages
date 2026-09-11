import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Badge, Eyebrow, Panel, Stat } from '@/components/ui/primitives'
import { Reveal } from '@/components/Reveal'
import { ConfirmDialog } from '@/components/account/ConfirmDialog'
import { IdentityPanel } from '@/components/account/IdentityPanel'
import { LedgerTable } from '@/components/account/LedgerTable'
import { PageHeader } from '@/components/account/PageHeader'
import { DAY_FMT } from '@/components/account/format'
import { WELCOME_CREDITS, creditsSpent, facesRedacted, useCredits } from '@/store/credits'
import { useLibrary } from '@/store/library'
import { useToasts } from '@/store/toast'
import { planById } from '@/lib/pricing'

export default function Account() {
  const [resetOpen, setResetOpen] = useState(false)
  const balance = useCredits((state) => state.balance)
  const ledger = useCredits((state) => state.ledger)
  const planId = useCredits((state) => state.plan)
  const renewsAt = useCredits((state) => state.renewsAt)
  const resetDemo = useCredits((state) => state.resetDemo)
  const push = useToasts((state) => state.push)

  const plan = planById(planId)
  const spent = creditsSpent(ledger)
  const faces = facesRedacted(ledger)
  const exports = ledger.filter((txn) => txn.kind === 'spend').length

  return (
    <>
      <PageHeader
        eyebrow="account"
        title="Credits, ledger and the local session"
        lede="Everything on this page is read from this browser. The balance is a local ledger — no server holds a copy, so nothing here can be restored from one."
      />

      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
        <Reveal>
          <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Panel className="relative overflow-hidden p-7 sm:p-9">
              <div className="noise-layer pointer-events-none absolute inset-0 opacity-[0.12]" aria-hidden="true" />
              <div className="relative">
                <Eyebrow>credit balance</Eyebrow>
                <div className="mt-6 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <p className="font-mono text-[clamp(3rem,9vw,4.75rem)] font-medium leading-[0.85] tabular-nums text-chalk">{balance.toLocaleString()}</p>
                  <p className="mono-label pb-2 text-dim">credits</p>
                </div>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Badge tone={planId === 'free' ? 'muted' : 'flare'}>{plan.name}</Badge>
                  <span className="font-mono text-[12px] tabular-nums text-mist">
                    {renewsAt ? `renews ${DAY_FMT.format(renewsAt)}` : planId === 'free' ? 'no renewal — credits stay on this device' : 'no renewal scheduled'}
                  </span>
                </div>

                <p className="mt-7 max-w-xl text-[13.5px] leading-relaxed text-dim">
                  One credit per censored face, with a one-credit minimum per export. Credits are drawn when an export completes and are not refundable once spent.
                </p>

                <div className="mt-8">
                  <Link to="/pricing">
                    <Button>Top up credits</Button>
                  </Link>
                </div>
              </div>
            </Panel>

            <IdentityPanel />
          </section>
        </Reveal>

        <Reveal delay={0.08}>
          <section className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="credits remaining" value={balance.toLocaleString()} sub={plan.creditsLabel} />
            <Stat label="credits spent" value={spent.toLocaleString()} sub={`${exports} export${exports === 1 ? '' : 's'} charged`} />
            <Stat label="faces redacted" value={faces.toLocaleString()} sub="one credit per face" />
            <Stat label="exports" value={exports.toLocaleString()} sub="spend entries in the ledger" />
          </section>
        </Reveal>

        <Reveal delay={0.12}>
          <section className="mt-12">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Ledger</h2>
                <p className="mt-1.5 text-[13.5px] text-mist">Newest first. Every movement of credits on this device, with the balance it left behind.</p>
              </div>
              <p className="mono-label text-dim">localStorage · veil.credits.v1</p>
            </div>
            <LedgerTable />
          </section>
        </Reveal>

        <Reveal delay={0.16}>
          <section className="mt-14">
            <Panel className="border-rose/25 p-6 sm:p-8">
              <p className="mono-label text-rose">danger zone</p>
              <h2 className="mt-3.5 text-lg font-semibold">Reset demo data</h2>
              <p className="mt-2.5 max-w-prose text-[13.5px] leading-relaxed text-mist">
                Returns the balance to the {WELCOME_CREDITS}-credit welcome grant, drops the plan back to Free, clears the renewal date and deletes every stored export thumbnail. This device is the only place that data exists, so the reset cannot be undone.
              </p>
              <Button variant="danger" className="mt-6" onClick={() => setResetOpen(true)}>
                Reset demo data
              </Button>
            </Panel>
          </section>
        </Reveal>
      </div>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset this device?"
        description={`The ledger goes back to a single ${WELCOME_CREDITS}-credit welcome grant, the plan returns to Free, and the library index plus every stored thumbnail is deleted. Nothing is uploaded, so nothing can be recovered.`}
        confirmLabel="Reset everything"
        onConfirm={async () => {
          resetDemo()
          await useLibrary.getState().clear()
          push({ tone: 'credit', title: 'Demo data reset', description: `Ledger back to ${WELCOME_CREDITS} credits. The library is empty.` })
        }}
      />
    </>
  )
}

import { Link } from 'react-router-dom'
import { PackCard } from '@/components/billing/PackCard'
import { PlanCard } from '@/components/billing/PlanCard'
import { Reveal } from '@/components/Reveal'
import { buttonClasses } from '@/components/ui/buttonStyles'
import { Badge, Divider, Eyebrow, Panel } from '@/components/ui/primitives'
import { costFor, CREDITS_PER_FACE, MINIMUM_EXPORT_COST, PACKS, PLANS, planById, unitPrice } from '@/lib/pricing'
import { useCredits } from '@/store/credits'

const EXAMPLES = [
  { label: 'Profile portrait', faces: 1 },
  { label: 'Group shot', faces: 12 },
  { label: 'Wedding frame', faces: 30 },
]

const FAQ = [
  {
    q: 'Do credits expire?',
    a: 'Pack credits sit in this browser’s ledger until you spend them, and there is no server that could take them back. Subscriptions refill on the same day each month and keep whatever is left.',
  },
  {
    q: 'What counts as one face?',
    a: 'Every box you export. The detector charges nothing for a face it misses, and a box you draw by hand costs the same as one it found.',
  },
  {
    q: 'Does my photo get uploaded?',
    a: 'No. Detection and redaction run in your browser tab, and exports are written straight to disk. The credit ledger is the only thing this site stores, and it is local too.',
  },
  {
    q: 'Is the payment real?',
    a: 'No. Card fields are validated in the tab — including a checksum on the number — then thrown away. Nothing is transmitted and nothing is charged.',
  },
]

export default function Pricing() {
  const balance = useCredits((state) => state.balance)
  const plan = planById(useCredits((state) => state.plan))
  const entryPack = PACKS[0]
  const pro = planById('pro')

  return (
    <div className="pb-28">
      <section className="relative overflow-hidden border-b border-line">
        <div className="grid-field pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(120%_80%_at_50%_0%,black,transparent)]" aria-hidden="true" />
        <div className="relative mx-auto max-w-7xl px-5 pb-20 pt-20 sm:px-8">
          <Reveal>
            <Eyebrow>Pricing</Eyebrow>
            <h1 className="mt-6 max-w-3xl text-[40px] font-medium leading-[1.05] tracking-[-0.035em] text-chalk sm:text-[56px]">
              One credit per <span className="font-serif italic">face</span>.
            </h1>
            <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-mist">
              Everything runs in your browser tab, so the bill is the only thing that has to be simple. Redacting a photo costs{' '}
              {CREDITS_PER_FACE} credit for every face in the frame, with a floor of {MINIMUM_EXPORT_COST} credit so an export always bills something.
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <Panel className="mt-11 p-6 sm:p-7">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="mono-label text-dim">What a job costs</p>
                <p className="font-mono text-[11.5px] text-dim">
                  costFor(faces) = max({MINIMUM_EXPORT_COST}, {CREDITS_PER_FACE} &times; faces)
                </p>
              </div>

              <ul className="mt-4">
                {EXAMPLES.map((example) => (
                  <li key={example.label} className="flex items-baseline gap-4 border-t border-line py-3.5">
                    <span className="flex-1 text-[13.5px] text-mist">{example.label}</span>
                    <span className="font-mono text-[12px] tabular-nums text-dim">
                      {example.faces} {example.faces === 1 ? 'face' : 'faces'}
                    </span>
                    <span className="w-20 text-right font-mono text-[12.5px] tabular-nums text-chalk">
                      {costFor(example.faces)} {costFor(example.faces) === 1 ? 'credit' : 'credits'}
                    </span>
                  </li>
                ))}
              </ul>

              <Divider className="my-5" />

              <p className="text-[13px] leading-relaxed text-mist">
                A group shot with twelve faces is twelve credits — no bundle, no minimum spend. The {entryPack.credits.toLocaleString()}-credit
                pack is ${entryPack.price}, which is {entryPack.credits.toLocaleString()} faces at {unitPrice(entryPack)} each. {pro.name} is ${pro.price} a
                month, {pro.creditsLabel}, which works out to ${(pro.price / pro.credits).toFixed(2)} per credit.
              </p>
            </Panel>
          </Reveal>

          {balance > 0 && (
            <Reveal delay={0.12}>
              <Panel className="mt-5 flex flex-wrap items-center justify-between gap-5 p-5">
                <div className="flex items-center gap-4">
                  <span className="brackets grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-raised">
                    <span className="size-1.5 rounded-full bg-flare" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="mono-label text-dim">On this device</p>
                    <p className="mt-1.5 text-[15px] text-chalk">
                      <span className="tabular-nums">{balance.toLocaleString()}</span> credits ·{' '}
                      <span className="text-mist">{plan.name} plan</span>
                    </p>
                    <p className="mt-1 text-[12.5px] text-dim">Enough for {costFor(balance).toLocaleString()} more faces.</p>
                  </div>
                </div>
                <Link to="/account" className={buttonClasses('outline', 'sm')}>
                  Open account
                </Link>
              </Panel>
            </Reveal>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pt-20 sm:px-8">
        <Reveal>
          <Eyebrow>Subscriptions</Eyebrow>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-[28px] font-medium tracking-[-0.03em] text-chalk sm:text-[34px]">Credits that refill</h2>
            <p className="max-w-md text-[13.5px] leading-relaxed text-mist">
              For steady volume. Cancel whenever — the credits already in the ledger stay.
            </p>
          </div>
        </Reveal>

        <div className="mt-10 grid items-stretch gap-5 md:grid-cols-3">
          {PLANS.map((candidate, index) => (
            <Reveal key={candidate.id} delay={index * 0.06}>
              <PlanCard plan={candidate} />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pt-24 sm:px-8">
        <Reveal>
          <Eyebrow>Top-ups</Eyebrow>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-[28px] font-medium tracking-[-0.03em] text-chalk sm:text-[34px]">Credit packs</h2>
            <p className="max-w-md text-[13.5px] leading-relaxed text-mist">Buy once, spend whenever. No cadence, no renewal.</p>
          </div>
        </Reveal>

        <div className="mt-10 grid items-stretch gap-5 md:grid-cols-3">
          {PACKS.map((pack, index) => (
            <Reveal key={pack.id} delay={index * 0.06}>
              <PackCard pack={pack} />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pt-24 sm:px-8">
        <Reveal>
          <h2 className="text-[28px] font-medium tracking-[-0.03em] text-chalk sm:text-[34px]">Pack or subscription?</h2>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-xl border border-line bg-surface p-6">
              <Badge>Take a pack when</Badge>
              <ul className="mt-5 space-y-3 text-[13.5px] leading-relaxed text-mist">
                <li>You have one job to finish: a shoot, a story, a single archive folder.</li>
                <li>You want the lowest commitment — ${PACKS[0].price} buys {PACKS[0].credits.toLocaleString()} faces with no renewal date.</li>
                <li>Your volume is spiky and you would rather stockpile credits than pay a monthly floor.</li>
              </ul>
            </div>
          </Reveal>
          <Reveal delay={0.06}>
            <div className="h-full rounded-xl border border-line bg-surface p-6">
              <Badge tone="flare">Take a subscription when</Badge>
              <ul className="mt-5 space-y-3 text-[13.5px] leading-relaxed text-mist">
                <li>You redact every week and want the balance to refill without thinking about it.</li>
                <li>You need the higher export ceiling and batch sizes that come with {pro.name} and Studio.</li>
                <li>Per-credit cost matters: ${(pro.price / pro.credits).toFixed(2)} a credit on {pro.name} against {unitPrice(PACKS[1])} on the {PACKS[1].credits.toLocaleString()}-credit pack.</li>
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pt-24 sm:px-8">
        <Reveal>
          <h2 className="text-[28px] font-medium tracking-[-0.03em] text-chalk sm:text-[34px]">Questions</h2>
        </Reveal>
        <Reveal delay={0.06}>
          <div className="mt-8 border-t border-line">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-b border-line">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[15px] font-medium text-chalk [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span className="font-mono text-lg leading-none text-dim transition-transform duration-300 group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="max-w-3xl pb-5 text-[13.5px] leading-relaxed text-mist">{item.a}</p>
              </details>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="mt-14 flex flex-wrap items-center gap-3">
            <Link to="/checkout?pack=pack-500" className={buttonClasses('primary', 'md')}>
              Buy 500 credits
            </Link>
            <Link to="/studio" className={buttonClasses('ghost', 'md')}>
              Try the studio first
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  )
}

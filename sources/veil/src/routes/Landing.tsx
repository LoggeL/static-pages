import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BeforeAfterDemo } from '@/components/marketing/BeforeAfterDemo'
import { StyleStrip } from '@/components/marketing/StyleStrip'
import { Reveal } from '@/components/Reveal'
import { buttonClasses } from '@/components/ui/buttonStyles'
import { Badge, Divider, Eyebrow, Panel } from '@/components/ui/primitives'
import { PACKS, costFor, planById, unitPrice } from '@/lib/pricing'
import { useCredits } from '@/store/credits'

const TRUST = [
  { value: '0 bytes', caption: 'uploaded', detail: 'Decoding, detection, editing and export all happen inside the tab.' },
  { value: '1 credit', caption: 'per face', detail: 'One credit minimum per export, so a clean portrait costs one.' },
  { value: '5', caption: 'censor styles', detail: 'Blur, pixelate, ink, static and sticker — chosen per region.' },
  { value: '12K', caption: 'max export edge', detail: 'Full resolution on every plan; Studio lifts the ceiling to 12K.' },
]

const STEPS = [
  {
    n: '01',
    title: 'Detect',
    body: 'open a photo and the scan starts on its own. Two BlazeFace variants run over a scaled copy and their boxes are merged, so a face fills a box that covers brow to chin instead of stopping at the jaw.',
  },
  {
    n: '02',
    title: 'Mark',
    body: 'every box becomes a region you can restyle, resize, feather or delete. Draw your own region anywhere the scan was too shy, and mix treatments in one photo — mosaic on the crowd, blur on the front row.',
  },
  {
    n: '03',
    title: 'Export',
    body: 'the composited image is re-rendered at the full resolution of the original and handed to your browser as a file. Nothing is queued, nothing is retried on a server, and the credits are deducted from the local ledger.',
  },
]

const SENSITIVITY_ROWS = [
  { value: '0.00', floor: '0.62', note: 'only unambiguous faces survive' },
  { value: '0.60', floor: '0.32', note: 'the setting this page uses' },
  { value: '1.00', floor: '0.12', note: 'weak detections included; expect the odd false positive' },
]

const TAB_STAGES = [
  { step: '01', name: 'Decode', note: 'createImageBitmap(file)' },
  { step: '02', name: 'Detect', note: 'blazeface short + full range' },
  { step: '03', name: 'Render', note: 'canvas → blob → download' },
]

const FAQ = [
  {
    q: 'Does it work offline?',
    a: 'After the first visit, yes. The two model files and the WebAssembly runtime are cached by the browser, and detection is a local computation, so a tab that has loaded once keeps scanning with the network unplugged. Only the sample photos and fonts are re-fetched if your cache is cold.',
  },
  {
    q: 'What actually happens to my images?',
    a: 'Nothing leaves the machine. The file is decoded into a bitmap in memory, the detector reads pixels from a canvas, and the export is encoded in the same tab and handed to your browser as a download. There is no upload endpoint in this product, so there is nothing to delete later.',
  },
  {
    q: 'How accurate is the detection?',
    a: 'Two BlazeFace variants run and their output is de-duplicated by overlap. The short-range model is sharper on large faces, the full-range model picks up distant faces in a group shot, and running both is what makes the scan hold up across both. Frontal and three-quarter views are reliable. Profiles in shadow, hands over the face and heavy motion blur are the known weak spots.',
  },
  {
    q: 'What if it misses a face?',
    a: 'Draw the region yourself. The manual tools are always available and never gated by the model — drag a box, pick a style, adjust feather and pad until the face is gone. Credits are charged per censored face at export, so a face the scan missed costs the same as one it found.',
  },
  {
    q: 'Do credits expire?',
    a: 'No. The balance is a ledger stored on this device, and credits you buy in a pack stay there until you spend them — across restarts, across sessions, across months. Subscription credits land in the same ledger, and unused ones are not clawed back.',
  },
  {
    q: 'Can I use the exports commercially?',
    a: 'Yes. Exports carry no watermark and no attribution requirement. The stock photos used for the demo on this page come from Unsplash and are used here under that licence only — swap in your own files for client work.',
  },
]

function SectionHead({ eyebrow, title, lead }: { eyebrow: string; title: ReactNode; lead?: string }) {
  return (
    <div className="max-w-2xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-6 text-3xl leading-[1.1] font-medium tracking-[-0.03em] sm:text-4xl">{title}</h2>
      {lead ? <p className="mt-5 text-[16.5px] leading-relaxed text-mist">{lead}</p> : null}
    </div>
  )
}

export default function Landing() {
  const balance = useCredits((state) => state.balance)
  const freePlan = planById('free')
  const groupCost = costFor(9)
  const portraitCost = costFor(1)
  const floorCost = costFor(0)

  return (
    <div className="overflow-x-hidden">
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative isolate">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-20 grid-field"
          style={{
            maskImage: 'radial-gradient(ellipse 62% 58% at 42% 22%, #000 12%, transparent 74%)',
            WebkitMaskImage: 'radial-gradient(ellipse 62% 58% at 42% 22%, #000 12%, transparent 74%)',
          }}
        />
        <div
          aria-hidden="true"
          className="animate-drift pointer-events-none absolute -top-40 left-[38%] -z-10 h-[560px] w-[820px] -translate-x-1/2 rounded-full bg-iris/25 blur-[150px]"
        />
        <div className="mx-auto max-w-7xl px-5 pt-20 pb-16 sm:px-8 sm:pt-28 sm:pb-20">
          <div className="max-w-3xl">
            <Reveal>
              <Eyebrow>On-device face redaction</Eyebrow>
            </Reveal>
            <Reveal delay={0.06}>
              <h1 className="mt-7 text-[2.6rem] leading-[1.03] font-medium tracking-[-0.035em] sm:text-6xl lg:text-[4.4rem]">
                Face redaction that <em className="font-serif font-normal text-flare italic">never</em> leaves your browser.
              </h1>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-mist">
                Two BlazeFace models and the whole editing pipeline run on your own machine. No upload step, no server, no image analytics — one credit per face you censor.
              </p>
            </Reveal>
            <Reveal delay={0.18}>
              <div className="mt-10 flex flex-wrap items-center gap-3">
                <Link to="/studio" className={buttonClasses('primary', 'lg')}>
                  Open the studio
                </Link>
                <Link to="/pricing" className={buttonClasses('outline', 'lg')}>
                  See pricing
                </Link>
              </div>
            </Reveal>
            <Reveal delay={0.24}>
              <p className="mono-label mt-9 text-dim">{freePlan.creditsLabel} · nothing to install · works offline once loaded</p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- live demo */}
      <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-8 sm:pb-28">
        <Reveal>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mono-label text-dim">Live demo · group-studio.jpg</p>
              <h2 className="mt-3 text-2xl font-medium tracking-[-0.03em] sm:text-[1.75rem]">
                That redaction ran in this tab, a second ago.
              </h2>
            </div>
            <Badge tone="flare">real detection · no upload</Badge>
          </div>
          <BeforeAfterDemo />
        </Reveal>
      </section>

      {/* ------------------------------------------------------ trust strip */}
      <section className="border-y border-line bg-[#07080d]">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((item) => (
              <div key={item.caption} className="bg-[#07080d] px-1 py-8 sm:px-6 sm:py-10">
                <p className="text-3xl font-medium tracking-[-0.035em] text-chalk">{item.value}</p>
                <p className="mono-label mt-2.5 text-flare">{item.caption}</p>
                <p className="mt-3.5 max-w-[30ch] text-[13px] leading-relaxed text-dim">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- how it works */}
      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
        <Reveal>
          <SectionHead
            eyebrow="How it works"
            title="Three passes, all of them local."
            lead="The pipeline is the same one the studio runs on your own uploads — the only difference here is that the photo ships with the page."
          />
        </Reveal>
        <div className="mt-14 grid gap-10 lg:grid-cols-3 lg:gap-8">
          {STEPS.map((step, index) => (
            <Reveal key={step.n} delay={index * 0.07}>
              <div className="border-t border-line pt-6">
                <p className="mono-label text-flare">{step.n}</p>
                <h3 className="mt-4 text-xl font-medium tracking-[-0.02em]">{step.title}</h3>
                <p className="mt-3.5 text-[14.5px] leading-relaxed text-mist">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ #detection */}
      <section id="detection" className="scroll-mt-24 border-t border-line">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
          <div className="grid gap-14 lg:grid-cols-[1fr_1fr] lg:gap-20">
            <Reveal>
              <SectionHead
                eyebrow="Detection"
                title="Two models, merged, with the trade-off left to you."
                lead="BlazeFace ships in two flavours and neither one is right on its own. The short-range variant is trained on close, large faces; the full-range variant is trained to find small faces across a wide shot. Veil runs both over the same scaled canvas and merges the output, so a tight portrait and a twenty-person group photo are the same job."
              />
              <div className="mt-9 space-y-5 text-[14.5px] leading-relaxed text-mist">
                <p>
                  Merging is an overlap test: two boxes covering the same face more than 34% are treated as one, keeping the higher-confidence detection and its model label. What survives is sorted largest first.
                </p>
                <p>
                  Sensitivity is a score floor, not a second model. The scan always runs permissively and the slider decides how weak a detection can be before it is thrown away, which is why the control responds instantly instead of rebuilding the graph.
                </p>
                <p className="text-chalk">
                  Manual regions are always available, at any sensitivity. A missed face is a box you draw, not a dead end.
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.08}>
              <Panel className="p-6 sm:p-7">
                <p className="mono-label text-dim">Scan pipeline</p>
                <div className="mt-5 space-y-3">
                  <div className="flex items-center gap-3 rounded-md border border-line bg-void/50 px-4 py-3">
                    <span className="mono-label text-dim">A</span>
                    <span className="text-[13.5px] text-chalk">blaze_face_short_range.tflite</span>
                    <span className="mono-label ml-auto text-dim">close faces</span>
                  </div>
                  <div className="flex items-center gap-3 rounded-md border border-line bg-void/50 px-4 py-3">
                    <span className="mono-label text-dim">B</span>
                    <span className="text-[13.5px] text-chalk">blaze_face_full_range.tflite</span>
                    <span className="mono-label ml-auto text-dim">distant faces</span>
                  </div>
                  <div className="flex items-center gap-3 px-4">
                    <span className="h-6 w-px bg-line" />
                    <span className="mono-label text-flare">merge · overlap &gt; 0.34</span>
                  </div>
                  <div className="rounded-md border border-flare/30 bg-flare/[0.06] px-4 py-3">
                    <p className="text-[13.5px] text-chalk">boxes, widened brow-to-chin, plus a hairline of margin</p>
                  </div>
                </div>

                <Divider className="my-7" />

                <p className="mono-label text-dim">Sensitivity → score floor</p>
                <table className="mt-4 w-full text-left">
                  <thead>
                    <tr className="mono-label text-dim">
                      <th className="pb-2 font-medium">sensitivity</th>
                      <th className="pb-2 font-medium">floor</th>
                      <th className="pb-2 font-medium">effect</th>
                    </tr>
                  </thead>
                  <tbody className="text-[13px] text-mist">
                    {SENSITIVITY_ROWS.map((row) => (
                      <tr key={row.value} className="border-t border-line">
                        <td className="py-2.5 font-mono text-chalk">{row.value}</td>
                        <td className="py-2.5 font-mono text-chalk">{row.floor}</td>
                        <td className="py-2.5 pr-1">{row.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </Reveal>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- #styles */}
      <section id="styles" className="scroll-mt-24 border-t border-line">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
          <Reveal>
            <SectionHead
              eyebrow="Censor styles"
              title="One photo, five treatments, same detected heads."
              lead="Each frame below is this portrait run through the real compositor with a different preset applied to every face the scan returned. In the studio, styles are per region, so a photo can carry several at once."
            />
          </Reveal>
          <div className="mt-14">
            <StyleStrip />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- #credits */}
      <section id="credits" className="scroll-mt-24 border-t border-line">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
          <div className="grid gap-14 lg:grid-cols-[1fr_1fr] lg:gap-20">
            <Reveal>
              <SectionHead
                eyebrow="Credits"
                title="One credit per face. One credit minimum per export."
                lead="Credits are charged when you export, not when you scan, so a mis-scan costs nothing but a little patience. There is no subscription required to start: a new account opens with credits already on it."
              />
              <ul className="mt-9 space-y-4 text-[14.5px] leading-relaxed text-mist">
                <li className="flex gap-3">
                  <span className="mono-label mt-0.5 text-flare">→</span>
                  Credits never expire. The balance is a ledger on this device, not a countdown on a server.
                </li>
                <li className="flex gap-3">
                  <span className="mono-label mt-0.5 text-flare">→</span>
                  Top-ups start at ${PACKS[0].price} for {PACKS[0].credits.toLocaleString()} credits — {unitPrice(PACKS[0])} each.
                </li>
                <li className="flex gap-3">
                  <span className="mono-label mt-0.5 text-flare">→</span>
                  A face the scan missed still costs one credit once you censor it by hand. Nothing is billed twice.
                </li>
              </ul>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link to="/pricing" className={buttonClasses('primary', 'md')}>
                  See packs and plans
                </Link>
                <Link to="/studio" className={buttonClasses('outline', 'md')}>
                  Spend {portraitCost} credit now
                </Link>
              </div>
            </Reveal>

            <Reveal delay={0.08}>
              <Panel className="p-6 sm:p-7">
                <p className="mono-label text-dim">Worked example</p>
                <div className="mt-5 space-y-px rounded-md bg-line">
                  {[
                    { label: 'One portrait, one face', detail: `costFor(1)`, cost: portraitCost },
                    { label: 'Group photo, nine faces', detail: `costFor(9)`, cost: groupCost },
                    { label: 'Export with no faces at all', detail: `costFor(0)`, cost: floorCost },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-4 bg-void/60 px-4 py-3.5">
                      <div>
                        <p className="text-[13.5px] text-chalk">{row.label}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-dim">{row.detail}</p>
                      </div>
                      <p className="font-mono text-sm text-flare">{row.cost} cr</p>
                    </div>
                  ))}
                </div>
                <p className="mono-label mt-5 text-dim">
                  Your balance: <span className="text-chalk">{balance} credits</span> — enough for {Math.floor(balance / groupCost)} group photos, or {balance} portraits.
                </p>

                <Divider className="my-7" />

                <p className="mono-label text-dim">Pack pricing</p>
                <div className="mt-4 space-y-2.5">
                  {PACKS.map((pack) => (
                    <div key={pack.id} className="flex items-center justify-between gap-4 rounded-md border border-line px-4 py-3">
                      <div>
                        <p className="text-[13.5px] text-chalk">{pack.credits.toLocaleString()} credits</p>
                        <p className="mono-label mt-0.5 text-dim">{pack.badge ?? 'one-time pack'}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm text-chalk">${pack.price}</p>
                        <p className="mono-label mt-0.5 text-dim">{unitPrice(pack)} / credit</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </Reveal>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- privacy */}
      <section className="border-t border-line bg-[#07080d]">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
          <Reveal>
            <SectionHead
              eyebrow="Privacy"
              title="There is no server that has ever seen your photo."
              lead="Not a policy promise — an architectural fact. The upload path simply does not exist in this product, so there is no bucket to leak, no worker to log, and no retention window to argue about."
            />
          </Reveal>

          <Reveal delay={0.08}>
            <div className="mt-14">
              <Panel className="p-6 sm:p-8">
                <p className="mono-label text-dim">Your device · this browser tab</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {TAB_STAGES.map((stage) => (
                    <div key={stage.step} className="brackets rounded-md border border-line bg-void/60 px-4 py-5">
                      <p className="mono-label text-flare">{stage.step}</p>
                      <p className="mt-3 text-[15px] text-chalk">{stage.name}</p>
                      <p className="mt-1 font-mono text-[11px] break-words text-dim">{stage.note}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <span className="mono-label shrink-0 text-dim">tab boundary</span>
                  <div
                    className="h-px flex-1"
                    style={{ backgroundImage: 'repeating-linear-gradient(90deg, var(--color-line) 0 6px, transparent 6px 14px)' }}
                  />
                  <span className="mono-label flex shrink-0 items-center gap-2 text-flare">
                    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M3.6 3.6l8.8 8.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                    0 bytes cross this line
                  </span>
                </div>

                <div className="mt-6 rounded-md border border-dashed border-line bg-void/40 px-5 py-7 text-center">
                  <p className="mono-label text-dim line-through">image upload endpoint</p>
                  <p className="mt-3 text-[13.5px] text-mist">
                    None exists. No queue, no object store, no inference service — detaching the network cable changes nothing about how a photo is censored.
                  </p>
                </div>
              </Panel>
            </div>
          </Reveal>

          <div className="mt-12 grid gap-10 sm:grid-cols-3">
            {[
              {
                title: 'No image analytics',
                body: 'Face counts, scores and regions stay in the tab that produced them. Nothing about a photo — not its size, not its filename, not how many faces it held — is reported anywhere.',
              },
              {
                title: 'Local, inspectable storage',
                body: 'Exported files are ordinary browser downloads. Library thumbnails live in this browser’s IndexedDB, and clearing site data removes them completely.',
              },
              {
                title: 'Only five requests',
                body: 'The app bundle, two web fonts, two model files and the sample JPEGs. That is the entire network surface of this page.',
              },
            ].map((item, index) => (
              <Reveal key={item.title} delay={index * 0.06}>
                <h3 className="text-[15px] font-medium tracking-[-0.01em] text-chalk">{item.title}</h3>
                <p className="mt-3 text-[13.5px] leading-relaxed text-mist">{item.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ #faq */}
      <section id="faq" className="scroll-mt-24 border-t border-line">
        <div className="mx-auto max-w-4xl px-5 py-24 sm:px-8 sm:py-32">
          <Reveal>
            <SectionHead eyebrow="FAQ" title="The questions that decide whether you trust it." />
          </Reveal>
          <div className="mt-12 divide-y divide-line border-y border-line">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[16px] font-medium tracking-[-0.01em] text-chalk [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span className="relative size-4 shrink-0 text-dim transition-colors group-open:text-flare">
                    <span className="absolute top-1/2 left-0 h-px w-4 -translate-y-1/2 bg-current" />
                    <span className="absolute top-0 left-1/2 h-4 w-px -translate-x-1/2 bg-current transition-transform duration-300 group-open:rotate-90 group-open:opacity-0" />
                  </span>
                </summary>
                <p className="max-w-2xl pr-8 pb-6 text-[14.5px] leading-relaxed text-mist">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ final CTA */}
      <section className="mx-auto max-w-7xl px-5 pb-16 sm:px-8 sm:pb-24">
        <Reveal>
          <div className="panel relative isolate overflow-hidden rounded-xl px-6 py-14 sm:px-14 sm:py-20">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 grid-field opacity-70"
              style={{
                maskImage: 'radial-gradient(ellipse 55% 75% at 78% 25%, #000 5%, transparent 72%)',
                WebkitMaskImage: 'radial-gradient(ellipse 55% 75% at 78% 25%, #000 5%, transparent 72%)',
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-28 -right-24 -z-10 h-[420px] w-[420px] rounded-full bg-iris/20 blur-[130px]"
            />
            <div className="max-w-2xl">
              <Eyebrow>Start now</Eyebrow>
              <h2 className="mt-6 text-3xl leading-[1.1] font-medium tracking-[-0.03em] sm:text-[2.6rem]">
                Open a photo. The scan begins before you finish reading this.
              </h2>
              <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-mist">
                The studio runs the same detector, the same five treatments and the same full-resolution export — and it takes about a minute to redact the first face.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link to="/studio" className={buttonClasses('primary', 'lg')}>
                  Open the studio
                </Link>
                <Link to="/pricing" className={buttonClasses('ghost', 'lg')}>
                  See pricing
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  )
}

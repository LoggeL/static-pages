import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Eyebrow, Panel } from '@/components/ui/primitives'
import { DocNav } from '@/components/account/DocNav'

const UPDATED = '11 September 2026'

interface DocSection {
  id: string
  /** Short form used by the sticky rail. */
  label: string
  heading: string
  body: ReactNode
}

interface LegalDoc {
  title: ReactNode
  lede: ReactNode
  sections: DocSection[]
}

const PRIVACY: LegalDoc = {
  title: (
    <>
      Privacy, <span className="font-serif font-normal italic">in full</span>
    </>
  ),
  lede: 'Veil has no image server. This is the complete account of what happens to a photo in the studio, and the complete list of what this browser keeps afterwards.',
  sections: [
    {
      id: 'no-uploads',
      label: 'no uploads',
      heading: '01 / nothing is uploaded',
      body: (
        <>
          <p>
            When you choose a file, the browser reads it straight off your disk with <code>createImageBitmap</code>. Detection runs through MediaPipe's BlazeFace models compiled
            to WebAssembly, compositing happens on an offscreen <code>&lt;canvas&gt;</code>, and the export is re-encoded with <code>canvas.toBlob</code>. The pixels are never part
            of a request body.
          </p>
          <p>There is no upload endpoint to reach and no bucket to put anything in. The studio contains no call that carries image data, so a deliberate attempt to upload would have nothing to talk to.</p>
        </>
      ),
    },
    {
      id: 'network',
      label: 'the network',
      heading: '02 / what the network sees',
      body: (
        <>
          <p>
            Everything Veil needs is served as static files from this origin: HTML, JavaScript, CSS, the WebAssembly detector, the model weights, and the Inter Tight, JetBrains Mono
            and Instrument Serif webfonts. The sample photos in the studio are files on this same server, not a third-party image host.
          </p>
          <p>
            No analytics, advertising, error-reporting, session-replay or experiment scripts are loaded, and there are no tracking cookies. The one thing that resembles an account is
            not one: starting a session writes a label into this browser's <code>localStorage</code>. No token is minted, because there is no server to mint it.
          </p>
        </>
      ),
    },
    {
      id: 'stored',
      label: 'stored on device',
      heading: '03 / what is stored on your device',
      body: (
        <>
          <p>Four keys, all of them local. That is the entire persistence layer of this product.</p>
          <ul className="list-disc space-y-2.5 pl-5 marker:text-dim">
            <li>
              <code>veil.credits.v1</code> — <code>localStorage</code>. Balance, plan, renewal date, and every ledger entry: date, label, detail, signed credits, balance after.
            </li>
            <li>
              <code>veil.account.v1</code> — <code>localStorage</code>. The email and display name you typed, and when the session started.
            </li>
            <li>
              <code>veil.library.v1</code> — IndexedDB. One index entry per export: file name, date, face count, credits charged, pixel dimensions, censor style.
            </li>
            <li>
              <code>veil.thumb.&lt;id&gt;</code> — IndexedDB. One censored thumbnail per export, rendered small for the Library grid.
            </li>
          </ul>
          <p>The photo you loaded, the regions you drew, the detection results and the undo history live in memory only. Close the tab and they are gone.</p>
        </>
      ),
    },
    {
      id: 'never-stored',
      label: 'never stored',
      heading: '04 / what is never stored',
      body: (
        <>
          <ul className="list-disc space-y-2.5 pl-5 marker:text-dim">
            <li>Any original image at any resolution — the decoded bitmap exists only while the tab is open.</li>
            <li>Any uncensored crop of a face.</li>
            <li>EXIF, GPS, camera model, or the folder the file came from.</li>
            <li>An IP address or user-agent log. Producing one would require a request carrying your image, and there is none.</li>
            <li>Card numbers, expiry dates or security codes.</li>
          </ul>
          <p>There is also no account to delete, because no account is created. The email you type is a display label for the ledger in this browser.</p>
        </>
      ),
    },
    {
      id: 'payments',
      label: 'payments',
      heading: '05 / payments run in test mode',
      body: (
        <>
          <p>
            The packs on the pricing page and the checkout behind them are a simulation. Nothing you type into a card field is validated against a payment network, stored or
            transmitted; a completed checkout writes a locally generated reference string into the ledger and adds its credits.
          </p>
          <p>
            No money moves and no card is charged. The balance is a number in <code>localStorage</code> that this app agrees to honour.
          </p>
        </>
      ),
    },
    {
      id: 'controls',
      label: 'your controls',
      heading: '06 / deleting it',
      body: (
        <>
          <p>
            You can erase any of it without asking anyone. <strong>Reset demo data</strong> in Account returns the ledger to the welcome grant and clears the renewal date. <strong>Clear library</strong> deletes the
            index and every stored thumbnail. <strong>Sign out</strong> drops the session label. Clearing site data for this origin — or using a private window — removes all four keys at once.
          </p>
          <p>Because there is no server copy and no backup, there is nothing to request and nothing to wait for. Deletion is immediate and total.</p>
        </>
      ),
    },
    {
      id: 'changes',
      label: 'changes',
      heading: '07 / changes to this page',
      body: (
        <>
          <p>
            This document ships inside the build it describes, so the two cannot drift apart. Last updated {UPDATED}. Veil is a demonstration product: if it ever gains a backend, this
            page has to be rewritten before that backend ships.
          </p>
        </>
      ),
    },
  ],
}

const TERMS: LegalDoc = {
  title: 'Terms of service',
  lede: 'Short, because the product is small: what a credit buys, why spent credits do not come back, what you may not do with the output, and why you still have to check it yourself.',
  sections: [
    {
      id: 'agreement',
      label: 'the agreement',
      heading: '01 / the agreement',
      body: (
        <>
          <p>
            Veil is a face-redaction studio that runs entirely in your browser. Using the studio, the library or the credit system means accepting these terms. If you do not accept
            them, do not use the app.
          </p>
        </>
      ),
    },
    {
      id: 'credits',
      label: 'the credit model',
      heading: '02 / the credit model',
      body: (
        <>
          <ul className="list-disc space-y-2.5 pl-5 marker:text-dim">
            <li>
              A fresh install starts with a <strong>25-credit welcome grant</strong>. It is a one-off, not a monthly allowance.
            </li>
            <li>
              An export costs <strong>one credit per censored face</strong>, rounded up, with a <strong>one-credit minimum per export</strong>. Two faces cost two credits; an export with no detectable face still costs one.
            </li>
            <li>Credits are drawn when an export completes. The ledger in Account records the date, entry, detail, signed credits and the balance left after every movement.</li>
            <li>A pack or plan adds its credits immediately when the simulated checkout completes. A subscription adds its allowance when the plan is selected and renews 30 days later.</li>
            <li>Credits have no cash value, cannot be transferred or exchanged, and are not a financial instrument or a stored-value account.</li>
            <li>Credits do not expire on the free plan. On a paid plan they do not expire while the subscription is active.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'refunds',
      label: 'refunds',
      heading: '03 / spent credits are not refundable',
      body: (
        <>
          <p>
            A credit is consumed the moment an export finishes, whatever happens to the file afterwards. Publish it, edit it further, decide you hate it, delete it — the spend has
            already landed in the ledger and cannot be reversed.
          </p>
          <p>
            This build charges nothing real, so there is no money to refund: checkout is a simulation. If a future version of Veil takes payment, this clause is the operative one.
          </p>
        </>
      ),
    },
    {
      id: 'acceptable-use',
      label: 'acceptable use',
      heading: '04 / acceptable use',
      body: (
        <>
          <p>You may only use Veil on images you own or have permission to edit, and you are responsible for what you publish with it. In particular, you may not use it to:</p>
          <ul className="list-disc space-y-2.5 pl-5 marker:text-dim">
            <li>harass, stalk, dox or assemble a surveillance record of a person;</li>
            <li>weaken, remove or work around a redaction that someone else applied;</li>
            <li>create or process imagery that is illegal, including sexual imagery of minors;</li>
            <li>present a censored image as an authentic original, or an original as though it were censored;</li>
            <li>process images of people whose consent the law requires you to obtain.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'best-effort',
      label: 'best-effort',
      heading: '05 / redaction is best-effort — check the output',
      body: (
        <>
          <p>
            Face detection is probabilistic. Small, distant, rotated, occluded or half-cropped faces can be missed entirely, and a detection box can sit somewhere other than you
            expect. The five censor styles composite and re-encode through a canvas; they are built to make a face unreadable, not to prove that it is.
          </p>
          <p>
            <strong>Open the exported file and check every face yourself before you publish it.</strong> You are the last reviewer in the chain.
          </p>
          <p>
            Nothing here is a compliance guarantee. If you need anonymisation for a legal, medical, journalistic or regulatory purpose — anything where a missed face has consequences —
            treat this output as a draft and have it reviewed by a qualified person.
          </p>
        </>
      ),
    },
    {
      id: 'availability',
      label: 'availability',
      heading: '06 / availability and warranty',
      body: (
        <>
          <p>
            Veil is provided as-is, without warranty of any kind. It runs entirely in your browser, so it depends on your browser, your device and its local storage quota. Clearing
            site data destroys the ledger and the library permanently, and we hold no copy to restore.
          </p>
          <p>
            To the fullest extent permitted by law, we are not liable for any loss arising from a missed detection, from a redaction you published, or from local data your browser
            discarded.
          </p>
        </>
      ),
    },
    {
      id: 'changes',
      label: 'changes',
      heading: '07 / changes to these terms',
      body: (
        <>
          <p>These terms ship inside the build they describe. Continuing to use a new build means accepting its terms. Last updated {UPDATED}.</p>
        </>
      ),
    },
  ],
}

const DOCS: Record<string, LegalDoc | undefined> = { privacy: PRIVACY, terms: TERMS }

function UnknownDocument({ doc }: { doc: string }) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-24 sm:px-8">
      <Panel className="p-8 text-center sm:p-12">
        <p className="mono-label text-rose">document not found</p>
        <h1 className="mt-5 text-2xl font-semibold">{doc ? `No document named “${doc}”` : 'No document requested'}</h1>
        <p className="mx-auto mt-4 max-w-md text-[14px] leading-relaxed text-mist">Veil publishes exactly two: how photos are handled, and the terms you agree to by using it.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/legal/privacy">
            <Button variant="secondary" size="sm">
              Privacy
            </Button>
          </Link>
          <Link to="/legal/terms">
            <Button variant="secondary" size="sm">
              Terms of service
            </Button>
          </Link>
          <Link to="/">
            <Button variant="ghost" size="sm">
              Back home
            </Button>
          </Link>
        </div>
      </Panel>
    </div>
  )
}

export default function Legal() {
  const { doc: docId } = useParams()
  const doc = DOCS[docId ?? '']

  if (!doc) return <UnknownDocument doc={docId ?? ''} />

  return (
    <>
      <header className="relative overflow-hidden border-b border-line">
        <div className="grid-field pointer-events-none absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden="true" />
        <div className="pointer-events-none absolute -left-32 -top-40 size-96 rounded-full bg-iris/[0.07] blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl px-5 pb-12 pt-14 sm:px-8 sm:pb-14 sm:pt-20">
          <Eyebrow>legal · {docId}</Eyebrow>
          <h1 className="mt-5 text-[34px] font-semibold leading-[1.05] sm:text-5xl">{doc.title}</h1>
          <p className="mt-5 max-w-prose text-[15px] leading-relaxed text-mist">{doc.lede}</p>
          <p className="mono-label mt-7 text-dim">last updated · {UPDATED}</p>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[196px_minmax(0,1fr)] lg:gap-16">
        <DocNav sections={doc.sections} />

        <article className="max-w-prose">
          {doc.sections.map((section, index) => (
            <section key={section.id} id={section.id} className={index === 0 ? 'scroll-mt-28' : 'mt-12 scroll-mt-28 border-t border-line pt-12'}>
              <h2 className="mono-label text-flare">{section.heading}</h2>
              <div className="mt-5 space-y-4 text-[15px] leading-[1.75] text-mist [&_code]:rounded [&_code]:bg-white/[0.06] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-chalk [&_strong]:font-medium [&_strong]:text-chalk">
                {section.body}
              </div>
            </section>
          ))}

          <div className="mt-14 border-t border-line pt-8">
            <p className="mono-label text-dim">the other document</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {docId === 'privacy' ? (
                <Link to="/legal/terms">
                  <Button variant="outline" size="sm">
                    Read the terms
                  </Button>
                </Link>
              ) : (
                <Link to="/legal/privacy">
                  <Button variant="outline" size="sm">
                    Read the privacy note
                  </Button>
                </Link>
              )}
              <Link to="/account">
                <Button variant="ghost" size="sm">
                  Credits &amp; ledger
                </Button>
              </Link>
            </div>
          </div>
        </article>
      </div>
    </>
  )
}

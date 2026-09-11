import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Logo } from '@/components/brand/Logo'
import { Divider } from '@/components/ui/primitives'

interface FooterLink {
  to: string
  label: string
}

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Product',
    links: [
      { to: '/studio', label: 'Studio' },
      { to: '/pricing', label: 'Pricing' },
      { to: '/library', label: 'Library' },
      { to: '/account', label: 'Credits & ledger' },
    ],
  },
  {
    title: 'How it works',
    links: [
      { to: '/#detection', label: 'On-device detection' },
      { to: '/#styles', label: 'Censor styles' },
      { to: '/#credits', label: 'Credit model' },
      { to: '/#faq', label: 'FAQ' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { to: '/legal/privacy', label: 'Privacy' },
      { to: '/legal/terms', label: 'Terms' },
    ],
  },
]

/**
 * Section links carry a `#fragment` for the no-JS case, but routing runs on the
 * URL fragment itself, so scrolling has to be driven by hand: navigate to the
 * landing route, wait for it to paint, then scroll the target into view.
 */
function SectionLink({ to, label }: FooterLink) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const slug = to.slice(to.indexOf('#') + 1)

  function reveal() {
    const target = document.getElementById(slug)
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return Boolean(target)
  }

  function onClick(event: ReactMouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    if (pathname !== '/') navigate('/')
    if (reveal()) return
    let tries = 0
    const retry = window.setInterval(() => {
      tries += 1
      if (reveal() || tries > 40) window.clearInterval(retry)
    }, 50)
  }

  return (
    <a href={to} onClick={onClick} className="text-[13.5px] text-mist transition-colors hover:text-chalk">
      {label}
    </a>
  )
}

export function SiteFooter() {
  return (
    <footer className="relative mt-24 border-t border-line bg-[#07080d]">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <Logo />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-mist">
              Face redaction that never leaves the browser tab. Detection, editing and export all run on your own machine — there is no upload step and no image store.
            </p>
            <p className="mono-label mt-6 flex items-center gap-2 text-dim">
              <span className="size-1.5 rounded-full bg-flare" />
              Zero image data leaves this device
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <p className="mono-label text-dim">{column.title}</p>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.to.includes('#') ? (
                        <SectionLink {...link} />
                      ) : (
                        <Link to={link.to} className="text-[13.5px] text-mist transition-colors hover:text-chalk">
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <Divider className="my-10" />

        <div className="flex flex-col gap-4 text-xs text-dim sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Veil. A demonstration product — payments run in test mode and no card is ever charged.</p>
          <p className="font-mono">sample photography via Unsplash</p>
        </div>
      </div>
    </footer>
  )
}

import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/Button'
import { SignInDialog } from '@/components/account/SignInDialog'
import { useAccount, initials } from '@/store/account'
import { useCredits } from '@/store/credits'
import { cn } from '@/lib/cn'

const NAV = [
  { to: '/studio', label: 'Studio' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/library', label: 'Library' },
]

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const balance = useCredits((state) => state.balance)
  const email = useAccount((state) => state.email)
  const name = useAccount((state) => state.name)
  const { pathname } = useLocation()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <header className={cn('sticky top-0 z-50 transition-colors duration-300', scrolled ? 'glass border-b border-line' : 'border-b border-transparent')}>
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-5 sm:px-8">
          <Link to="/" className="shrink-0" aria-label="Veil home">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-full px-3.5 py-2 text-[13.5px] font-medium transition-colors duration-200',
                    isActive ? 'bg-white/[0.06] text-chalk' : 'text-mist hover:bg-white/[0.04] hover:text-chalk',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2.5">
            <Link
              to="/account"
              className="group hidden items-center gap-2 rounded-full border border-line bg-white/[0.02] py-1.5 pl-2.5 pr-3.5 transition-colors hover:border-flare/40 sm:inline-flex"
              title="Your credit balance"
            >
              <span className="grid size-5 place-items-center rounded-full bg-flare/15">
                <span className="size-1.5 rounded-full bg-flare" />
              </span>
              <span className="font-mono text-[12px] font-medium tabular-nums text-chalk">{balance.toLocaleString()}</span>
              <span className="mono-label text-dim">cr</span>
            </Link>

            {email ? (
              <Link to="/account" className="grid size-9 place-items-center rounded-full border border-line bg-raised font-mono text-[11px] font-medium text-mist transition-colors hover:border-flare/40 hover:text-chalk" title={name || email}>
                {initials(name, email)}
              </Link>
            ) : (
              <Button size="sm" variant="secondary" className="hidden sm:inline-flex" onClick={() => setSignInOpen(true)}>
                Sign in
              </Button>
            )}

            {pathname !== '/studio' && (
              <Link to="/studio" className="hidden md:inline-flex">
                <Button size="sm">Open studio</Button>
              </Link>
            )}

            <button
              type="button"
              aria-label="Menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="grid size-9 place-items-center rounded-full border border-line text-mist md:hidden"
            >
              <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                {menuOpen ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
              </svg>
            </button>
          </div>
        </div>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden border-t border-line glass md:hidden"
            >
              <nav className="flex flex-col gap-1 px-5 py-4">
                {NAV.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) => cn('rounded-lg px-3 py-2.5 text-sm font-medium', isActive ? 'bg-white/[0.06] text-chalk' : 'text-mist')}
                  >
                    {item.label}
                  </NavLink>
                ))}
                <Link to="/account" onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-mist">
                  Account · {balance.toLocaleString()} credits
                </Link>
                <div className="mt-2 flex gap-2 px-1">
                  <Link to="/studio" className="flex-1" onClick={() => setMenuOpen(false)}>
                    <Button className="w-full">Open studio</Button>
                  </Link>
                  {!email && (
                    <Button variant="secondary" onClick={() => setSignInOpen(true)}>
                      Sign in
                    </Button>
                  )}
                </div>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  )
}

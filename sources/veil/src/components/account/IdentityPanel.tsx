import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/primitives'
import { SignInDialog } from '@/components/account/SignInDialog'
import { DAY_FMT } from '@/components/account/format'
import { initials, useAccount } from '@/store/account'
import { useToasts } from '@/store/toast'

export function IdentityPanel() {
  const [signInOpen, setSignInOpen] = useState(false)
  const email = useAccount((state) => state.email)
  const name = useAccount((state) => state.name)
  const createdAt = useAccount((state) => state.createdAt)
  const signOut = useAccount((state) => state.signOut)
  const push = useToasts((state) => state.push)

  return (
    <Panel className="flex min-w-0 flex-col p-6">
      <p className="mono-label text-dim">session</p>

      {email ? (
        <>
          <div className="mt-5 flex items-center gap-3.5">
            <span className="grid size-12 shrink-0 place-items-center rounded-full border border-flare/30 bg-flare/10 font-mono text-[15px] font-medium text-flare">
              {initials(name, email)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium text-chalk">{name || email.split('@')[0]}</p>
              <p className="truncate font-mono text-[12px] text-dim">{email}</p>
            </div>
          </div>
          <p className="mono-label mt-6 text-dim">member since</p>
          <p className="mt-2 font-mono text-[13px] tabular-nums text-mist">{createdAt ? DAY_FMT.format(createdAt) : 'this session'}</p>
          <p className="mt-4 text-[12.5px] leading-relaxed text-dim">This label names the ledger stored in this browser. There is no account server to sign in to.</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-5 self-start"
            onClick={() => {
              signOut()
              push({ tone: 'default', title: 'Session closed', description: 'The ledger stays on this device — only the label was dropped.' })
            }}
          >
            Sign out
          </Button>
        </>
      ) : (
        <>
          <p className="mt-5 text-[15px] font-medium text-chalk">No session on this device</p>
          <p className="mt-2.5 text-[13px] leading-relaxed text-mist">
            Starting a session only labels the credit ledger in this browser. It creates no account, asks for no password and sends nothing anywhere.
          </p>
          <Button className="mt-6 self-start" onClick={() => setSignInOpen(true)}>
            Start a session
          </Button>
        </>
      )}

      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
    </Panel>
  )
}

import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/primitives'
import { useAccount } from '@/store/account'
import { useToasts } from '@/store/toast'

/** Veil runs entirely in the browser, so a "session" is a name for the local
    ledger on this device — not an account on a server, because there isn't one. */
export function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const signIn = useAccount((state) => state.signIn)
  const push = useToasts((state) => state.push)

  function submit() {
    const trimmed = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      setError('Enter an email address so the ledger has a name.')
      return
    }
    setError(null)
    signIn(trimmed, name)
    push({ tone: 'success', title: 'Session started', description: `Credits on this device now belong to ${trimmed}.` })
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Name this workspace"
      description="Veil has no server. Your session and credit ledger live in this browser only — signing in just labels them."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} data-autofocus>
            Start session
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Email" name="email" type="email" placeholder="you@studio.com" value={email} onChange={(event) => setEmail(event.target.value)} error={error} autoComplete="email" />
        <Field label="Display name" name="name" placeholder="Optional" value={name} onChange={(event) => setName(event.target.value)} hint="Used for the avatar initials in the header." />
      </div>
    </Dialog>
  )
}

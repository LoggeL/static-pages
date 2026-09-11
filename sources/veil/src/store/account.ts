import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AccountState {
  email: string | null
  name: string
  createdAt: number | null
  signIn: (email: string, name?: string) => void
  signOut: () => void
}

/** Local identity only: there is no server, so "signing in" names the session
    that owns the credit ledger stored on this device. */
export const useAccount = create<AccountState>()(
  persist(
    (set) => ({
      email: null,
      name: '',
      createdAt: null,
      signIn: (email, name) => set({ email, name: name?.trim() || email.split('@')[0], createdAt: Date.now() }),
      signOut: () => set({ email: null, name: '', createdAt: null }),
    }),
    { name: 'veil.account.v1' },
  ),
)

export function initials(name: string, email: string | null): string {
  const source = name.trim() || email?.split('@')[0] || '?'
  const parts = source.split(/[\s._-]+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2)).toUpperCase()
}

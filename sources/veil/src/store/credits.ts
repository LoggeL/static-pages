import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { uid } from '@/lib/types'
import { PACKS, planById, type CreditPack, type PlanId } from '@/lib/pricing'

export type TxnKind = 'grant' | 'spend' | 'purchase' | 'subscription' | 'refund' | 'reset'

export interface Txn {
  id: string
  at: number
  kind: TxnKind
  label: string
  /** Signed. */
  credits: number
  balanceAfter: number
  detail?: string
}

export const WELCOME_CREDITS = 25

interface CreditsState {
  balance: number
  ledger: Txn[]
  plan: PlanId
  renewsAt: number | null
  /** Returns false when the balance cannot cover the job. */
  spend: (amount: number, label: string, detail?: string) => boolean
  grant: (amount: number, label: string, kind: TxnKind, detail?: string) => void
  purchasePack: (pack: CreditPack, reference: string) => void
  subscribe: (plan: PlanId, reference: string) => void
  resetDemo: () => void
}

function seedLedger(): Txn[] {
  const at = Date.now()
  return [{ id: uid(), at, kind: 'grant', label: 'Welcome grant', credits: WELCOME_CREDITS, balanceAfter: WELCOME_CREDITS, detail: 'Free plan sign-up bonus' }]
}

export const useCredits = create<CreditsState>()(
  persist(
    (set, get) => ({
      balance: WELCOME_CREDITS,
      ledger: seedLedger(),
      plan: 'free',
      renewsAt: null,

      spend: (amount, label, detail) => {
        const cost = Math.max(0, Math.ceil(amount))
        const { balance, ledger } = get()
        if (cost > balance) return false
        const balanceAfter = balance - cost
        set({
          balance: balanceAfter,
          ledger: [...ledger, { id: uid(), at: Date.now(), kind: 'spend', label, credits: -cost, balanceAfter, detail }],
        })
        return true
      },

      grant: (amount, label, kind, detail) => {
        const value = Math.ceil(amount)
        const { balance, ledger } = get()
        const balanceAfter = balance + value
        set({ balance: balanceAfter, ledger: [...ledger, { id: uid(), at: Date.now(), kind, label, credits: value, balanceAfter, detail }] })
      },

      purchasePack: (pack, reference) => {
        const { balance, ledger } = get()
        const balanceAfter = balance + pack.credits
        set({
          balance: balanceAfter,
          ledger: [
            ...ledger,
            { id: uid(), at: Date.now(), kind: 'purchase', label: `${pack.credits.toLocaleString()} credit pack`, credits: pack.credits, balanceAfter, detail: `$${pack.price}.00 · ref ${reference}` },
          ],
        })
      },

      subscribe: (planId, reference) => {
        const plan = planById(planId)
        const { balance, ledger } = get()
        const balanceAfter = balance + plan.credits
        set({
          balance: balanceAfter,
          plan: planId,
          renewsAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          ledger: [
            ...ledger,
            { id: uid(), at: Date.now(), kind: 'subscription', label: `${plan.name} plan`, credits: plan.credits, balanceAfter, detail: `$${plan.price}/mo · ref ${reference}` },
          ],
        })
      },

      resetDemo: () => set({ balance: WELCOME_CREDITS, ledger: seedLedger(), plan: 'free', renewsAt: null }),
    }),
    { name: 'veil.credits.v1' },
  ),
)

export function creditsSpent(ledger: Txn[]): number {
  return ledger.reduce((total, txn) => (txn.credits < 0 ? total - txn.credits : total), 0)
}

export function facesRedacted(ledger: Txn[]): number {
  return ledger.reduce((total, txn) => {
    if (txn.kind !== 'spend') return total
    const match = txn.detail?.match(/^(\d+) face/)
    return total + (match ? Number(match[1]) : 0)
  }, 0)
}

export function packById(id: string): CreditPack | undefined {
  return PACKS.find((pack) => pack.id === id)
}

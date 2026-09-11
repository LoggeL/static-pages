export const CREDITS_PER_FACE = 1
export const MINIMUM_EXPORT_COST = 1

/** What a redaction job costs. One credit per face, with a one-credit floor. */
export function costFor(faces: number): number {
  return Math.max(MINIMUM_EXPORT_COST, Math.ceil(Math.max(0, faces) * CREDITS_PER_FACE))
}

export type PlanId = 'free' | 'pro' | 'studio'

export interface Plan {
  id: PlanId
  name: string
  tagline: string
  price: number
  cadence: string
  credits: number
  creditsLabel: string
  features: string[]
  featured: boolean
  cta: string
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Enough to clean up a few photos.',
    price: 0,
    cadence: 'forever',
    credits: 25,
    creditsLabel: '25 credits on sign-up',
    features: ['25 welcome credits', 'Full-resolution export', 'All five censor styles', 'Nothing leaves your browser'],
    featured: false,
    cta: 'Start free',
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For people who publish photos for a living.',
    price: 19,
    cadence: 'per month',
    credits: 500,
    creditsLabel: '500 credits every month',
    features: ['500 credits / month', 'Batch export up to 25 images', 'Exports to 6K', 'Preset library & shortcuts', 'Credits never expire on Pro'],
    featured: true,
    cta: 'Go Pro',
  },
  {
    id: 'studio',
    name: 'Studio',
    tagline: 'For newsrooms, agencies and research teams.',
    price: 59,
    cadence: 'per month',
    credits: 2400,
    creditsLabel: '2,400 credits every month',
    features: ['2,400 credits / month', 'Unlimited batch size', 'Exports to 12K', 'Shared workspace presets', 'Priority email support'],
    featured: false,
    cta: 'Talk to us',
  },
]

export interface CreditPack {
  id: string
  credits: number
  price: number
  badge?: string
}

export const PACKS: CreditPack[] = [
  { id: 'pack-100', credits: 100, price: 12 },
  { id: 'pack-500', credits: 500, price: 49, badge: 'Most popular' },
  { id: 'pack-2000', credits: 2000, price: 159, badge: 'Best value' },
]

export function unitPrice(pack: CreditPack): string {
  return `$${(pack.price / pack.credits).toFixed(2)}`
}

export function planById(id: PlanId): Plan {
  return PLANS.find((plan) => plan.id === id) ?? PLANS[0]
}

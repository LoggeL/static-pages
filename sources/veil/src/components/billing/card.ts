export interface CardValues {
  holder: string
  number: string
  expiry: string
  cvc: string
}

export type CardField = keyof CardValues

export type CardErrors = Partial<Record<CardField, string>>

/** The card the checkout page offers behind "Use test card". */
export const TEST_CARD: CardValues = {
  holder: 'Veil Test Card',
  number: '4242 4242 4242 4242',
  expiry: '12/34',
  cvc: '123',
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/** Groups whatever has been typed into 4-4-4-4 without ever blocking the caret. */
export function formatCardNumber(value: string): string {
  return (digitsOnly(value).slice(0, 19).match(/.{1,4}/g) ?? []).join(' ')
}

/** The checksum every issuer uses to catch a mistyped digit. */
export function luhnValid(value: string): boolean {
  const digits = digitsOnly(value)
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let doubling = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48
    if (doubling) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubling = !doubling
  }
  return sum % 10 === 0
}

export function formatExpiry(value: string): string {
  const digits = digitsOnly(value).slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}/${digits.slice(2)}`
}

/** True while the card is still usable — a card expires at the end of its month. */
export function expiryValid(value: string, now: Date = new Date()): boolean {
  const [monthPart, yearPart] = value.split('/')
  if (!monthPart || !yearPart || yearPart.length !== 2) return false
  const month = Number(monthPart)
  if (!Number.isInteger(month) || month < 1 || month > 12) return false
  const year = 2000 + Number(yearPart)
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1)
}

export function cardErrors(values: CardValues, now: Date = new Date()): CardErrors {
  const errors: CardErrors = {}
  const holder = values.holder.trim()
  if (holder.length < 2 || !/\p{L}/u.test(holder)) errors.holder = 'Enter the name printed on the card.'
  const number = digitsOnly(values.number)
  if (number.length < 13) errors.number = 'A card number is 13-19 digits.'
  else if (!luhnValid(number)) errors.number = 'That number fails the checksum. Check for a mistyped digit.'
  if (!expiryValid(values.expiry, now)) errors.expiry = 'Use the MM/YY printed on the card, in the future.'
  const cvc = digitsOnly(values.cvc)
  if (cvc.length < 3 || cvc.length > 4) errors.cvc = 'The CVC is 3 or 4 digits.'
  return errors
}

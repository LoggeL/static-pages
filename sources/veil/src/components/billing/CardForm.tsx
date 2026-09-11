import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/primitives'
import { cardErrors, formatCardNumber, formatExpiry, TEST_CARD, type CardField, type CardValues } from './card'

const EMPTY: CardValues = { holder: '', number: '', expiry: '', cvc: '' }

interface CardFormProps {
  submitLabel: string
  processing: boolean
  onSubmit: () => void
}

export function CardForm({ submitLabel, processing, onSubmit }: CardFormProps) {
  const [values, setValues] = useState<CardValues>(EMPTY)
  const [touched, setTouched] = useState<Partial<Record<CardField, boolean>>>({})

  const errors = cardErrors(values)
  const valid = Object.keys(errors).length === 0
  const locked = processing

  function update(field: CardField, raw: string) {
    const value = field === 'number' ? formatCardNumber(raw) : field === 'expiry' ? formatExpiry(raw) : raw
    setValues((current) => ({ ...current, [field]: value }))
  }

  function touch(field: CardField) {
    setTouched((current) => ({ ...current, [field]: true }))
  }

  function errorFor(field: CardField): string | null {
    return touched[field] ? errors[field] ?? null : null
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (!valid || locked) return
        onSubmit()
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="mono-label text-dim">Card details</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={locked}
          onClick={() => {
            setValues(TEST_CARD)
            setTouched({})
          }}
        >
          Use test card
        </Button>
      </div>

      <Field
        label="Cardholder name"
        name="cc-name"
        autoComplete="cc-name"
        placeholder="Name as printed on the card"
        value={values.holder}
        disabled={locked}
        error={errorFor('holder')}
        onChange={(event) => update('holder', event.target.value)}
        onBlur={() => touch('holder')}
      />

      <Field
        label="Card number"
        name="cc-number"
        autoComplete="cc-number"
        inputMode="numeric"
        placeholder="4242 4242 4242 4242"
        maxLength={23}
        value={values.number}
        disabled={locked}
        error={errorFor('number')}
        onChange={(event) => update('number', event.target.value)}
        onBlur={() => touch('number')}
      />

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Expiry"
          name="cc-exp"
          autoComplete="cc-exp"
          inputMode="numeric"
          placeholder="MM/YY"
          maxLength={5}
          value={values.expiry}
          disabled={locked}
          error={errorFor('expiry')}
          onChange={(event) => update('expiry', event.target.value)}
          onBlur={() => touch('expiry')}
        />
        <Field
          label="CVC"
          name="cc-csc"
          autoComplete="cc-csc"
          inputMode="numeric"
          placeholder="123"
          maxLength={4}
          value={values.cvc}
          disabled={locked}
          error={errorFor('cvc')}
          onChange={(event) => update('cvc', event.target.value)}
          onBlur={() => touch('cvc')}
        />
      </div>

      <Button type="submit" size="lg" className="w-full" loading={processing} disabled={!valid}>
        {processing ? 'Processing' : submitLabel}
      </Button>
    </form>
  )
}

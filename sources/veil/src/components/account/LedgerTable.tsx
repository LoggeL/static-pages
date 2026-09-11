import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { SegmentedControl, type SegmentOption } from '@/components/ui/primitives'
import { STAMP_FMT } from '@/components/account/format'
import { cn } from '@/lib/cn'
import { useCredits } from '@/store/credits'

type Filter = 'all' | 'added' | 'spent'

const FILTERS: SegmentOption<Filter>[] = [
  { value: 'all', label: 'All' },
  { value: 'added', label: 'Added' },
  { value: 'spent', label: 'Spent' },
]

const EMPTY_COPY: Record<Filter, string> = {
  all: 'Nothing has moved yet. The welcome grant lands here the moment the ledger is created.',
  added: 'No credits have been added yet. Packs and plans on the pricing page land here instantly.',
  spent: 'No credits spent yet. Exports are the only thing that draws from the balance.',
}

export function LedgerTable() {
  const ledger = useCredits((state) => state.ledger)
  const [filter, setFilter] = useState<Filter>('all')

  // The store appends, so reversing gives newest-first without a sort.
  const rows = [...ledger].reverse().filter((txn) => (filter === 'added' ? txn.credits > 0 : filter === 'spent' ? txn.credits < 0 : true))

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-4 py-4 sm:px-5">
        <div>
          <p className="mono-label text-dim">ledger</p>
          <p className="mt-1.5 font-mono text-[12px] tabular-nums text-mist">
            {rows.length} of {ledger.length} entries
          </p>
        </div>
        <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} />
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left">
            <thead>
              <tr className="mono-label text-dim">
                <th scope="col" className="px-4 py-3 font-medium sm:px-5">
                  date
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  entry
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  detail
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  credits
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium sm:px-5">
                  balance
                </th>
              </tr>
            </thead>
            <tbody className="font-mono text-[12.5px] tabular-nums">
              {rows.map((txn) => (
                <tr key={txn.id} className="border-t border-line/70">
                  <td className="whitespace-nowrap px-4 py-3 text-dim sm:px-5">{STAMP_FMT.format(txn.at)}</td>
                  <td className="px-4 py-3 text-chalk">{txn.label}</td>
                  <td className="px-4 py-3 text-mist">{txn.detail ?? '—'}</td>
                  <td className={cn('px-4 py-3 text-right', txn.credits < 0 ? 'text-rose' : 'text-flare')}>
                    {txn.credits > 0 ? `+${txn.credits.toLocaleString()}` : txn.credits.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-chalk sm:px-5">{txn.balanceAfter.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="border-t border-line px-6 py-14 text-center">
          <p className="mono-label text-dim">empty</p>
          <p className="mx-auto mt-3 max-w-sm text-[13.5px] leading-relaxed text-mist">{EMPTY_COPY[filter]}</p>
          {filter !== 'all' && (
            <Button variant="ghost" size="sm" className="mt-4" onClick={() => setFilter('all')}>
              Show all entries
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

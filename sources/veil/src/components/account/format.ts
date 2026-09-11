/** Formatter instances are module-scoped and reused: the ledger and the library
    re-render on every filter change, and building an Intl formatter per row is
    measurably slow on a long ledger. */
export const DAY_FMT = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export const STAMP_FMT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

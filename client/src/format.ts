// Formatting is locale-aware: the *currency* is always EUR (that's what the data
// is in), but grouping, decimal separators and month names follow the language
// the user picked. Built once per locale by the i18n provider.

export interface Formatters {
  /** "1.234,56 €" (pt-PT) / "€1,234.56" (en-GB) */
  eur: (n: number | null | undefined) => string
  /** Whole euros, no decimals. */
  eur0: (n: number | null | undefined) => string
  /** Plain whole number with locale grouping, e.g. "2.032" / "2,032". */
  int: (n: number | null | undefined) => string
  /** ISO timestamp as a locale date and time, e.g. "27/08/2026, 14:35". */
  dateTime: (iso: string | null | undefined) => string
  pct: (n: number | null | undefined) => string
  /** Short axis labels, e.g. "12 mil" / "12K". */
  compact: (n: number) => string
  /** "2025-01" -> "Jan 2025" / "jan. 2025" */
  monthLabel: (key: string) => string
}

export function createFormatters(locale: string): Formatters {
  const eurFmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  })
  const numFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const compactFmt = new Intl.NumberFormat(locale, { notation: 'compact' })
  const pctFmt = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  // Only the month part: pt-PT's combined short month+year pattern is numeric
  // ("01/2025"), which reads far worse on a chart axis than "jan. 2025".
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
  const dateTimeFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' })

  return {
    eur: (n) => eurFmt.format(Number(n ?? 0)),
    eur0: (n) => numFmt.format(Number(n ?? 0)) + ' €',
    int: (n) => numFmt.format(Number(n ?? 0)),
    dateTime: (iso) => {
      const d = iso ? new Date(iso) : null
      return d && !Number.isNaN(d.getTime()) ? dateTimeFmt.format(d) : ''
    },
    pct: (n) => `${pctFmt.format(Number(n ?? 0))}%`,
    compact: (n) => compactFmt.format(n),
    monthLabel: (key) => {
      const [y, m] = key.split('-').map(Number)
      if (!y || !m) return key
      return `${monthFmt.format(new Date(Date.UTC(y, m - 1, 1)))} ${y}`
    },
  }
}

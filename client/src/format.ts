const eurFmt = new Intl.NumberFormat('pt-PT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
})

const numFmt = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 })

export const eur = (n: number | null | undefined) => eurFmt.format(Number(n ?? 0))
export const eur0 = (n: number | null | undefined) => numFmt.format(Number(n ?? 0)) + ' €'
export const pct = (n: number | null | undefined) => `${Number(n ?? 0).toFixed(1)}%`

// "2025-01" -> "Jan 2025"
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[m - 1]} ${y}`
}

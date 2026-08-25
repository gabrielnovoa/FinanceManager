// The table used by every resource page. On top of plain rendering it adds
// three things the raw list was missing once real spreadsheets got imported:
// per-column sorting, per-column filtering, and collapsible month/year groups.
//
// All of it is client-side — these tables are a few thousand rows at most, so
// there is no need to push sorting and filtering into the API.

import { Fragment, useMemo, useState } from 'react'
import type { Formatters } from '../format'
import { languages, useI18n } from '../i18n'
import type { Translate } from '../i18n'
import type { Field, FieldType } from '../resources'

export type Row = Record<string, unknown> & { id: number }

type SortDir = 'asc' | 'desc'
interface Sort { key: string; dir: SortDir }

interface Props {
  fields: Field[]
  rows: Row[]
  loading: boolean
  /** Column summed in the footer and in each group header. */
  totalField?: string
  /** Date column to group by month/year. Omit to disable grouping. */
  groupBy?: string
  onRefresh: () => void
  onDelete: (id: number) => void
}

const NO_DATE = '__nodate__'

export default function DataTable({
  fields, rows, loading, totalField, groupBy, onRefresh, onDelete,
}: Props) {
  const { t, fmt, language } = useI18n()
  const locale = languages[language].locale

  const [sort, setSort] = useState<Sort | null>(groupBy ? { key: groupBy, dir: 'desc' } : null)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [grouped, setGrouped] = useState(Boolean(groupBy))
  // Absent key = use the default (only the first group starts open), so groups
  // that appear later after a refresh still behave sensibly.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({})

  const typeOf = useMemo(() => {
    const map: Record<string, FieldType> = {}
    for (const f of fields) map[f.key] = f.type
    return map
  }, [fields])

  const activeFilters = useMemo(
    () => Object.entries(filters).filter(([, v]) => v.trim() !== ''),
    [filters],
  )

  const filtered = useMemo(() => {
    if (activeFilters.length === 0) return rows
    return rows.filter((row) =>
      activeFilters.every(([key, query]) => matches(row[key], typeOf[key], query)),
    )
  }, [rows, activeFilters, typeOf])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const type = typeOf[sort.key]
    return [...filtered].sort((a, b) => {
      const va = a[sort.key]
      const vb = b[sort.key]
      // Blanks always sink to the bottom, whichever way the column is sorted.
      const ea = isBlank(va)
      const eb = isBlank(vb)
      if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1
      const c = compareValues(va, vb, type, locale)
      return sort.dir === 'asc' ? c : -c
    })
  }, [filtered, sort, typeOf, locale])

  const groups = useMemo(() => {
    if (!grouped || !groupBy) return null
    const buckets = new Map<string, Row[]>()
    for (const row of sorted) {
      const key = monthKey(row[groupBy])
      const bucket = buckets.get(key)
      if (bucket) bucket.push(row)
      else buckets.set(key, [row])
    }
    // Group order follows the date column when it is the sort column, so
    // clicking "Date" flips the months as well as the rows inside them.
    const dir: SortDir = sort?.key === groupBy ? sort.dir : 'desc'
    return [...buckets.entries()]
      .sort(([a], [b]) => {
        if (a === NO_DATE) return 1
        if (b === NO_DATE) return -1
        return dir === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
      })
      .map(([key, items]) => ({
        key,
        items,
        label: key === NO_DATE ? t('table.noDate') : fmt.monthLabel(key),
        total: totalField ? sum(items, totalField) : null,
      }))
  }, [sorted, grouped, groupBy, sort, totalField, t, fmt])

  const total = totalField ? sum(sorted, totalField) : null
  const colCount = fields.length + 1

  function toggleSort(key: string) {
    setSort((cur) => {
      if (cur?.key !== key) return { key, dir: defaultDir(typeOf[key]) }
      if (cur.dir === defaultDir(typeOf[key])) return { key, dir: flip(cur.dir) }
      return null // third click clears the sort
    })
  }

  const isOpen = (key: string, index: number) => openOverrides[key] ?? index === 0
  const setAllOpen = (open: boolean) =>
    setOpenOverrides(Object.fromEntries((groups ?? []).map((g) => [g.key, open])))

  const countLabel = loading
    ? t('common.loading')
    : activeFilters.length > 0
      ? t('table.showingOf', { shown: sorted.length, total: rows.length })
      : t(rows.length === 1 ? 'common.entryCount' : 'common.entryCountPlural', { count: rows.length })

  return (
    <>
      <div className="toolbar">
        <span className="count">{countLabel}</span>
        {activeFilters.length > 0 && (
          <button className="btn subtle" onClick={() => setFilters({})}>
            ✕ {t('table.clearFilters')}
          </button>
        )}
        <div className="spacer" />
        {groupBy && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={grouped}
                onChange={(e) => setGrouped(e.target.checked)}
              />
              {t('table.groupByMonth')}
            </label>
            {grouped && (
              <>
                <button className="btn subtle" onClick={() => setAllOpen(true)}>
                  {t('table.expandAll')}
                </button>
                <button className="btn subtle" onClick={() => setAllOpen(false)}>
                  {t('table.collapseAll')}
                </button>
              </>
            )}
          </>
        )}
        <button className="btn" onClick={onRefresh} disabled={loading}>{t('common.refresh')}</button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {fields.map((f) => {
                const active = sort?.key === f.key
                return (
                  <th
                    key={f.key}
                    className={`sortable${isNumeric(f.type) ? ' num' : ''}${active ? ' sorted' : ''}`}
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button
                      type="button"
                      className="th-sort"
                      onClick={() => toggleSort(f.key)}
                      title={t('table.sortAria', { column: t(f.labelKey) })}
                    >
                      <span>{t(f.labelKey)}</span>
                      <span className="sort-ind" aria-hidden="true">
                        {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                )
              })}
              <th className="row-actions">{t('common.actions')}</th>
            </tr>
            <tr className="filter-row">
              {fields.map((f) => (
                <th key={f.key}>
                  <input
                    className="filter-input"
                    value={filters[f.key] ?? ''}
                    placeholder={placeholderFor(f.type, t)}
                    aria-label={t('table.filterAria', { column: t(f.labelKey) })}
                    onChange={(e) => setFilters((cur) => ({ ...cur, [f.key]: e.target.value }))}
                  />
                </th>
              ))}
              <th className="row-actions" />
            </tr>
          </thead>

          <tbody>
            {groups
              ? groups.map((g, i) => {
                  const open = isOpen(g.key, i)
                  return (
                    <Fragment key={g.key}>
                      <tr className="group-row">
                        <td colSpan={colCount}>
                          <button
                            type="button"
                            className="group-toggle"
                            aria-expanded={open}
                            onClick={() =>
                              setOpenOverrides((cur) => ({ ...cur, [g.key]: !open }))
                            }
                            title={t(open ? 'table.collapseGroup' : 'table.expandGroup', {
                              group: g.label,
                            })}
                          >
                            <span className={`chev${open ? ' open' : ''}`} aria-hidden="true">▸</span>
                            <span className="group-label">{g.label}</span>
                            <span className="group-count">
                              {t(g.items.length === 1 ? 'common.entryCount' : 'common.entryCountPlural',
                                { count: g.items.length })}
                            </span>
                            <span className="spacer" />
                            {g.total !== null && (
                              <span className="group-total">{fmt.eur(g.total)}</span>
                            )}
                          </button>
                        </td>
                      </tr>
                      {open && g.items.map((r) => (
                        <DataRow key={r.id} row={r} fields={fields} fmt={fmt}
                                 onDelete={onDelete} deleteLabel={t('common.delete')} />
                      ))}
                    </Fragment>
                  )
                })
              : sorted.map((r) => (
                  <DataRow key={r.id} row={r} fields={fields} fmt={fmt}
                           onDelete={onDelete} deleteLabel={t('common.delete')} />
                ))}

            {!loading && sorted.length === 0 && (
              <tr>
                <td colSpan={colCount} className="empty">
                  {rows.length === 0 ? t('common.noEntries') : t('table.noMatches')}
                </td>
              </tr>
            )}
          </tbody>

          {total !== null && sorted.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={colCount} className="num" style={{ fontWeight: 700 }}>
                  {t('common.total')}: {fmt.eur(total)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  )
}

function DataRow({ row, fields, fmt, onDelete, deleteLabel }: {
  row: Row
  fields: Field[]
  fmt: Formatters
  onDelete: (id: number) => void
  deleteLabel: string
}) {
  return (
    <tr>
      {fields.map((f) => (
        <td key={f.key} className={isNumeric(f.type) ? 'num' : ''}>{cell(row[f.key], f, fmt)}</td>
      ))}
      <td className="row-actions">
        <button className="link-btn" onClick={() => onDelete(row.id)}>{deleteLabel}</button>
      </td>
    </tr>
  )
}

// ---- helpers ----

export function isNumeric(type: FieldType) {
  return type === 'money' || type === 'number' || type === 'int'
}

export function cell(value: unknown, f: Field, fmt: Formatters) {
  if (isBlank(value)) return f.type === 'money' ? fmt.eur(0) : '—'
  if (f.type === 'money') return fmt.eur(Number(value))
  return String(value)
}

function isBlank(v: unknown) {
  return v === null || v === undefined || v === ''
}

function sum(rows: Row[], key: string) {
  return rows.reduce((s, r) => s + Number(r[key] ?? 0), 0)
}

/** "2025-03-14" -> "2025-03". Anything unparseable lands in its own bucket. */
function monthKey(value: unknown) {
  const s = String(value ?? '')
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : NO_DATE
}

/** Dates and amounts are most useful newest/largest first; text reads A→Z. */
function defaultDir(type: FieldType | undefined): SortDir {
  return type === 'date' || (type && isNumeric(type)) ? 'desc' : 'asc'
}

function flip(dir: SortDir): SortDir {
  return dir === 'asc' ? 'desc' : 'asc'
}

function compareValues(a: unknown, b: unknown, type: FieldType | undefined, locale: string) {
  if (type && isNumeric(type)) return Number(a) - Number(b)
  // ISO dates sort correctly as plain strings.
  if (type === 'date') return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
  return String(a).localeCompare(String(b), locale, { numeric: true, sensitivity: 'base' })
}

function placeholderFor(type: FieldType, t: Translate) {
  if (isNumeric(type)) return t('table.filterNumPlaceholder')
  if (type === 'date') return t('table.filterDatePlaceholder')
  return t('table.filterPlaceholder')
}

/** Lowercase and strip accents so "divida" also finds "dívida". */
function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Accepts "1234.56", "1234,56" and "1.234,56". */
function parseNum(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, '')
  if (s === '') return null
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '')
  s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const NUM_QUERY = /^(>=|<=|<>|!=|>|<|=)?(.+)$/

function matches(value: unknown, type: FieldType | undefined, query: string): boolean {
  const q = query.trim()
  if (q === '') return true

  if (type && isNumeric(type)) {
    const n = Number(value ?? 0)
    // "100..250" — an inclusive range.
    const range = q.split('..')
    if (range.length === 2) {
      const lo = parseNum(range[0])
      const hi = parseNum(range[1])
      if (lo !== null && hi !== null) return n >= lo && n <= hi
    }
    const m = NUM_QUERY.exec(q)
    const target = m ? parseNum(m[2]) : null
    if (m && target !== null) {
      switch (m[1]) {
        case '>': return n > target
        case '<': return n < target
        case '>=': return n >= target
        case '<=': return n <= target
        case '!=':
        case '<>': return n !== target
        default: return n === target
      }
    }
    return String(value ?? '').includes(q)
  }

  // Dates and text both fall back to accent-insensitive substring, which lets
  // "2025-03" filter a single month and "2025" a whole year.
  return norm(String(value ?? '')).includes(norm(q))
}

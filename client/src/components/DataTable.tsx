// The table used by every resource page. On top of plain rendering it adds
// four things the raw list was missing once real spreadsheets got imported:
// per-column sorting, per-column filtering, collapsible month/year groups,
// and inline row editing.
//
// All of it is client-side — these tables are a few thousand rows at most, so
// there is no need to push sorting and filtering into the API.

import { Fragment, useMemo, useState, type KeyboardEvent } from 'react'
import type { Formatters } from '../format'
import { languages, useI18n } from '../i18n'
import type { Translate } from '../i18n'
import type { Field, FieldType } from '../resources'
import Icon from './Icon'

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
  /** Must reject on failure so the row stays open and the edit is not lost. */
  onUpdate: (id: number, values: Record<string, unknown>) => Promise<void>
}

const NO_DATE = '__nodate__'

export default function DataTable({
  fields, rows, loading, totalField, groupBy, onRefresh, onDelete, onUpdate,
}: Props) {
  const { t, fmt, language } = useI18n()
  const locale = languages[language].locale

  const [sort, setSort] = useState<Sort | null>(groupBy ? { key: groupBy, dir: 'desc' } : null)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [grouped, setGrouped] = useState(Boolean(groupBy))
  // Absent key = use the default (only the first group starts open), so groups
  // that appear later after a refresh still behave sensibly.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({})

  // ---- inline editing ----
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [savingRow, setSavingRow] = useState(false)
  const [invalid, setInvalid] = useState<string[]>([])
  const [editError, setEditError] = useState<string | null>(null)

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

  function startEdit(row: Row) {
    setEditingId(row.id)
    setDraft(Object.fromEntries(fields.map((f) => [f.key, editValue(row[f.key], f.type)])))
    setInvalid([])
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft({})
    setInvalid([])
    setEditError(null)
  }

  async function saveEdit() {
    if (editingId === null || savingRow) return

    const missing = fields
      .filter((f) => f.required && String(draft[f.key] ?? '').trim() === '')
      .map((f) => f.key)
    if (missing.length > 0) {
      setInvalid(missing)
      setEditError(t('table.requiredMissing'))
      return
    }

    setSavingRow(true)
    setEditError(null)
    try {
      await onUpdate(editingId, draft)
      cancelEdit() // only close on success, so a failed save never loses input
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setSavingRow(false)
    }
  }

  const countLabel = loading
    ? t('common.loading')
    : activeFilters.length > 0
      ? t('table.showingOf', { shown: sorted.length, total: rows.length })
      : t(rows.length === 1 ? 'common.entryCount' : 'common.entryCountPlural', { count: rows.length })

  const rowProps = {
    fields,
    fmt,
    t,
    editingId,
    draft,
    invalid,
    savingRow,
    onEdit: startEdit,
    onCancel: cancelEdit,
    onSave: saveEdit,
    onDelete,
    onDraftChange: (key: string, value: string) =>
      setDraft((cur) => ({ ...cur, [key]: value })),
  }

  return (
    <>
      {editError && <div className="alert err">{editError}</div>}

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
                        <DataRow key={r.id} row={r} {...rowProps} />
                      ))}
                    </Fragment>
                  )
                })
              : sorted.map((r) => (
                  <DataRow key={r.id} row={r} {...rowProps} />
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

interface RowProps {
  row: Row
  fields: Field[]
  fmt: Formatters
  t: Translate
  editingId: number | null
  draft: Record<string, string>
  invalid: string[]
  savingRow: boolean
  onEdit: (row: Row) => void
  onCancel: () => void
  onSave: () => void
  onDelete: (id: number) => void
  onDraftChange: (key: string, value: string) => void
}

function DataRow({
  row, fields, fmt, t, editingId, draft, invalid, savingRow,
  onEdit, onCancel, onSave, onDelete, onDraftChange,
}: RowProps) {
  const editing = editingId === row.id
  // Editing is one row at a time: while a row is open every other row's
  // buttons are disabled, so an edit can never be dropped by a stray click.
  const locked = editingId !== null && !editing

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); onSave() }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
  }

  return (
    <tr className={editing ? 'editing' : undefined}>
      {fields.map((f, i) => (
        <td key={f.key} className={isNumeric(f.type) ? 'num' : ''}>
          {editing ? (
            <input
              className={`cell-input${invalid.includes(f.key) ? ' invalid' : ''}`}
              type={inputType(f.type)}
              step={isNumeric(f.type) ? 'any' : undefined}
              value={draft[f.key] ?? ''}
              autoFocus={i === 0}
              disabled={savingRow}
              aria-label={t(f.labelKey)}
              aria-invalid={invalid.includes(f.key) || undefined}
              onChange={(e) => onDraftChange(f.key, e.target.value)}
              onKeyDown={onKeyDown}
            />
          ) : (
            cell(row[f.key], f, fmt)
          )}
        </td>
      ))}

      <td className="row-actions">
        {editing ? (
          <>
            <button
              className="icon-btn ok"
              onClick={onSave}
              disabled={savingRow}
              title={t('table.saveRow')}
              aria-label={t('common.save')}
            >
              <Icon name="save" />
            </button>
            <button
              className="icon-btn"
              onClick={onCancel}
              disabled={savingRow}
              title={t('table.cancelEdit')}
              aria-label={t('common.cancel')}
            >
              <Icon name="cancel" />
            </button>
          </>
        ) : (
          <>
            <button
              className="icon-btn"
              onClick={() => onEdit(row)}
              disabled={locked}
              title={locked ? t('table.finishEditFirst') : t('table.editRow')}
              aria-label={t('common.edit')}
            >
              <Icon name="edit" />
            </button>
            <button
              className="icon-btn danger"
              onClick={() => onDelete(row.id)}
              disabled={locked}
              title={locked ? t('table.finishEditFirst') : t('table.deleteRow')}
              aria-label={t('common.delete')}
            >
              <Icon name="delete" />
            </button>
          </>
        )}
      </td>
    </tr>
  )
}

// ---- helpers ----

export function isNumeric(type: FieldType) {
  return type === 'money' || type === 'number' || type === 'int'
}

/** Which native input a field type should use, for both the add form and inline edit. */
export function inputType(type: FieldType) {
  return type === 'date' ? 'date' : isNumeric(type) ? 'number' : 'text'
}

/**
 * Stored value -> what the edit input expects: raw numbers rather than the
 * formatted currency shown in read mode, and a bare yyyy-MM-dd for date inputs.
 */
function editValue(value: unknown, type: FieldType): string {
  if (isBlank(value)) return ''
  if (type === 'date') return String(value).slice(0, 10)
  return String(value)
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

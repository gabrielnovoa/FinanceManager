import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import type { Field, Replicate, Resource } from '../resources'
import type { Row } from './DataTable'

interface Props {
  resource: Resource
  replicate: Replicate
  rows: Row[]
  onClose: () => void
  /** Resolves once every selected row has been created. */
  onSubmit: (rows: Record<string, unknown>[]) => Promise<void>
}

interface Draft {
  /** Stable key so React keeps inputs attached to the right row. */
  id: string
  selected: boolean
  /** Copied straight from last month. */
  keys: Record<string, string>
  day: number
  /** One entry per replicate.valueFields, kept as strings while being edited. */
  values: Record<string, string>
}

/**
 * "Repeat last month": seeds a row per entry from the most recent month that has
 * data, so a monthly snapshot is a review-and-confirm rather than ten manual adds.
 * Nothing is written until the user presses the confirm button.
 */
export default function ReplicateMonthDialog({ resource, replicate, rows, onClose, onSubmit }: Props) {
  const { t, fmt } = useI18n()
  const [month, setMonth] = useState(() => nextMonth(latestMonth(rows, replicate.dateField)))
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [seededFrom, setSeededFrom] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed whenever the target month changes: the source is the latest month
  // that has data *before* it, which is usually just the previous month but
  // copes with gaps.
  const source = useMemo(
    () => latestMonth(rows.filter((r) => monthKey(r[replicate.dateField]) < month), replicate.dateField),
    [rows, month, replicate.dateField],
  )

  if (source !== seededFrom) {
    setSeededFrom(source)
    setDrafts(source ? seed(rows, source, replicate) : [])
  }

  const existing = rows.filter((r) => monthKey(r[replicate.dateField]) === month).length
  const selected = drafts.filter((d) => d.selected)

  const keyLabels = replicate.keyFields
    .map((k) => resource.fields.find((f) => f.key === k))
    .filter((f): f is Field => Boolean(f))
  const valueLabels = replicate.valueFields
    .map((k) => resource.fields.find((f) => f.key === k))
    .filter((f): f is Field => Boolean(f))

  /** Column totals, so the user can sanity-check against last month at a glance. */
  const totals = Object.fromEntries(
    replicate.valueFields.map((k) => [k, selected.reduce((sum, d) => sum + (Number(d.values[k]) || 0), 0)]),
  )

  function patch(id: string, change: Partial<Draft>) {
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...change } : d)))
  }

  function patchValue(id: string, key: string, v: string) {
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, values: { ...d.values, [key]: v } } : d)))
  }

  async function submit() {
    if (selected.length === 0 || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit(selected.map((d) => ({
        ...d.keys,
        [replicate.dateField]: isoDate(month, d.day),
        ...Object.fromEntries(replicate.valueFields.map((k) => [k, Number(d.values[k]) || 0])),
      })))
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('replicate.title')}>
      <div className="modal">
        <div className="modal-head">
          <h2>{t('replicate.title')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.cancel')} disabled={saving}>✕</button>
        </div>

        <div className="modal-body">
          <div className="form-row" style={{ marginBottom: 12 }}>
            <div className="field">
              <label>{t('replicate.targetMonth')}</label>
              <input type="month" value={month} disabled={saving} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            </div>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <p className="hint">
                {source
                  ? t('replicate.basedOn', { month: fmt.monthLabel(source) })
                  : t('replicate.noHistory')}
              </p>
            </div>
          </div>

          {existing > 0 && (
            <div className="alert warn">
              {t('replicate.alreadyHasRows', { count: existing, month: fmt.monthLabel(month) })}
            </div>
          )}
          {error && <div className="alert err">{error}</div>}

          {drafts.length === 0 ? (
            <p className="hint">{t('replicate.nothingToCopy')}</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        aria-label={t('replicate.toggleAll')}
                        checked={selected.length === drafts.length}
                        disabled={saving}
                        onChange={(e) => setDrafts((ds) => ds.map((d) => ({ ...d, selected: e.target.checked })))}
                      />
                    </th>
                    {keyLabels.map((f) => <th key={f.key}>{t(f.labelKey)}</th>)}
                    <th style={{ width: 80 }}>{t('replicate.day')}</th>
                    {valueLabels.map((f) => <th key={f.key} className="num">{t(f.labelKey)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => (
                    <tr key={d.id} className={d.selected ? undefined : 'row-off'}>
                      <td>
                        <input
                          type="checkbox"
                          checked={d.selected}
                          disabled={saving}
                          aria-label={Object.values(d.keys).join(' ')}
                          onChange={(e) => patch(d.id, { selected: e.target.checked })}
                        />
                      </td>
                      {replicate.keyFields.map((k) => <td key={k}>{d.keys[k]}</td>)}
                      <td>
                        <input
                          className="cell-input"
                          type="number"
                          min={1}
                          max={daysInMonth(month)}
                          value={d.day}
                          disabled={saving || replicate.dayMode === 'firstOfMonth'}
                          onChange={(e) => patch(d.id, { day: clampDay(Number(e.target.value), month) })}
                        />
                      </td>
                      {replicate.valueFields.map((k) => (
                        <td key={k} className="num">
                          <input
                            className="cell-input"
                            type="number"
                            step="any"
                            value={d.values[k] ?? ''}
                            disabled={saving}
                            aria-label={`${Object.values(d.keys).join(' ')} — ${k}`}
                            onChange={(e) => patchValue(d.id, k, e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2 + keyLabels.length}>
                      {t('replicate.selectedCount', { count: selected.length })}
                    </td>
                    {replicate.valueFields.map((k) => (
                      <td key={k} className="num">{fmt.eur(totals[k])}</td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={submit} disabled={saving || selected.length === 0}>
            {saving
              ? t('common.saving')
              : t('replicate.confirm', { count: selected.length })}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- helpers ----

/** "2026-08-01" | Date -> "2026-08"; anything unparseable sorts first. */
function monthKey(v: unknown): string {
  const s = String(v ?? '')
  return s.length >= 7 ? s.slice(0, 7) : ''
}

function latestMonth(rows: Row[], dateField: string): string | null {
  let best: string | null = null
  for (const r of rows) {
    const k = monthKey(r[dateField])
    if (k && (best === null || k > best)) best = k
  }
  return best
}

function nextMonth(key: string | null): string {
  const now = new Date()
  if (!key) return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [y, m] = key.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 1)) // month is 1-based here, so this is the next one
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function clampDay(day: number, month: string): number {
  if (!Number.isFinite(day)) return 1
  return Math.min(Math.max(Math.round(day), 1), daysInMonth(month))
}

function isoDate(month: string, day: number): string {
  return `${month}-${String(clampDay(day, month)).padStart(2, '0')}`
}

/**
 * One draft per row in the source month. Rows that repeat within the month (the
 * same transfer made twice) are kept as separate drafts rather than merged,
 * because both really did happen.
 */
function seed(rows: Row[], source: string, replicate: Replicate): Draft[] {
  return rows
    .filter((r) => monthKey(r[replicate.dateField]) === source)
    .map((r, i) => ({
      id: `${r.id ?? i}`,
      selected: true,
      keys: Object.fromEntries(replicate.keyFields.map((k) => [k, String(r[k] ?? '')])),
      day: replicate.dayMode === 'firstOfMonth' ? 1 : dayOf(r[replicate.dateField]),
      values: Object.fromEntries(replicate.valueFields.map((k) => [k, String(r[k] ?? 0)])),
    }))
}

function dayOf(v: unknown): number {
  const day = Number(String(v ?? '').slice(8, 10))
  return Number.isFinite(day) && day >= 1 ? day : 1
}

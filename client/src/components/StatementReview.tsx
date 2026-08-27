import { useMemo, useState } from 'react'
import { api } from '../api'
import { useI18n } from '../i18n'

export type LineKind = 'Expense' | 'Income' | 'Ignore'

export interface StatementLine {
  index: number
  date: string
  description: string
  amount: number
  isCredit: boolean
  card: string | null
  kind: LineKind
  item: string
  category: string
  matchedBy: 'alias' | 'history' | 'none'
  isDuplicate: boolean
  selected: boolean
}

export interface StatementPreview {
  fileName: string
  format: string
  source: string
  sourceDetected: boolean
  knownSources: string[]
  items: string[]
  categories: string[]
  lines: StatementLine[]
}

interface CommitResult { expenses: number; incomes: number; aliasesLearned: number }

interface Props {
  preview: StatementPreview
  onCancel: () => void
  onDone: (result: CommitResult) => void
}

/** What the classifier proposed, kept so we only teach the app when it was wrong. */
type Suggestion = Pick<StatementLine, 'kind' | 'item' | 'category'>

/**
 * Review step for an imported statement. Everything here is local until the user
 * confirms: the server has parsed and classified the file but stored nothing, so
 * a bad guess costs a correction rather than a clean-up.
 */
export default function StatementReview({ preview, onCancel, onDone }: Props) {
  const { t, fmt } = useI18n()
  const [lines, setLines] = useState<StatementLine[]>(preview.lines)
  const [source, setSource] = useState(preview.source)
  const [hideIgnored, setHideIgnored] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suggestions = useMemo(
    () => new Map<number, Suggestion>(
      preview.lines.map((l) => [l.index, { kind: l.kind, item: l.item, category: l.category }]),
    ),
    [preview.lines],
  )

  const visible = hideIgnored ? lines.filter((l) => l.kind !== 'Ignore') : lines
  const selected = lines.filter((l) => l.selected)
  const counts = {
    income: selected.filter((l) => l.kind === 'Income').length,
    expense: selected.filter((l) => l.kind === 'Expense').length,
    ignored: lines.filter((l) => l.kind === 'Ignore').length,
    duplicates: lines.filter((l) => l.isDuplicate).length,
    unknown: lines.filter((l) => l.selected && l.kind !== 'Ignore' && !l.item.trim()).length,
  }
  const totals = {
    income: selected.filter((l) => l.kind === 'Income').reduce((s, l) => s + l.amount, 0),
    expense: selected.filter((l) => l.kind === 'Expense').reduce((s, l) => s + l.amount, 0),
  }

  function patch(index: number, change: Partial<StatementLine>) {
    setLines((ls) => ls.map((l) => (l.index === index ? { ...l, ...change } : l)))
  }

  /** Marking a line as internal also unticks it — an ignored line is never written. */
  function setKind(index: number, kind: LineKind) {
    patch(index, kind === 'Ignore' ? { kind, selected: false } : { kind })
  }

  async function commit() {
    if (selected.length === 0 || counts.unknown > 0 || saving) return

    setSaving(true)
    setError(null)
    try {
      const result = await api.post<CommitResult>('statement/commit', {
        source,
        lines: selected.map((l) => {
          const was = suggestions.get(l.index)
          const corrected =
            !was || was.kind !== l.kind || was.item !== l.item || was.category !== l.category
          return {
            date: l.date,
            description: l.description,
            amount: l.amount,
            kind: l.kind,
            item: l.item,
            category: l.category,
            // Teach the app only when it had nothing to offer or offered the wrong thing.
            learn: l.matchedBy === 'none' || corrected,
          }
        }),
      })
      onDone(result)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card stmt-review" style={{ marginTop: 16 }}>
      <div className="stmt-head">
        <h3 className="chart-title" style={{ margin: 0 }}>
          {t('statement.reviewTitle', { file: preview.fileName })}
        </h3>
        <button className="icon-btn" onClick={onCancel} aria-label={t('common.cancel')} disabled={saving}>✕</button>
      </div>

      <div className="form-row" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>{t('statement.source')}</label>
          <input
            list="statement-sources"
            value={source}
            disabled={saving}
            onChange={(e) => setSource(e.target.value)}
          />
          <datalist id="statement-sources">
            {preview.knownSources.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <p className="hint">
            {preview.sourceDetected
              ? t('statement.sourceDetected', { source: preview.source })
              : t('statement.sourceUnknown')}
          </p>
        </div>
      </div>

      <div className="pill-row" style={{ marginBottom: 12 }}>
        <span className="badge">{t('statement.countIncome', { count: counts.income })}</span>
        <span className="badge">{t('statement.countExpense', { count: counts.expense })}</span>
        {counts.ignored > 0 && <span className="badge">{t('statement.countIgnored', { count: counts.ignored })}</span>}
        {counts.duplicates > 0 && <span className="badge warn">{t('statement.countDuplicates', { count: counts.duplicates })}</span>}
        <button className="btn" disabled={saving} onClick={() => setHideIgnored((v) => !v)}>
          {hideIgnored ? t('statement.showIgnored') : t('statement.hideIgnored')}
        </button>
      </div>

      {counts.duplicates > 0 && (
        <div className="alert warn">{t('statement.duplicateNotice', { count: counts.duplicates })}</div>
      )}
      {counts.unknown > 0 && (
        <div className="alert warn">{t('statement.missingItems', { count: counts.unknown })}</div>
      )}
      {error && <div className="alert err">{error}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  aria-label={t('replicate.toggleAll')}
                  checked={visible.length > 0 && visible.every((l) => l.selected)}
                  disabled={saving}
                  onChange={(e) => {
                    const on = e.target.checked
                    const ids = new Set(visible.map((l) => l.index))
                    setLines((ls) => ls.map((l) =>
                      ids.has(l.index) && l.kind !== 'Ignore' ? { ...l, selected: on } : l))
                  }}
                />
              </th>
              <th style={{ width: 96 }}>{t('field.date')}</th>
              <th>{t('statement.description')}</th>
              <th className="num" style={{ width: 100 }}>{t('field.amount')}</th>
              <th style={{ width: 110 }}>{t('statement.kind')}</th>
              <th style={{ width: 180 }}>{t('field.item')}</th>
              <th style={{ width: 160 }}>{t('field.category')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => (
              <tr key={l.index} className={l.selected ? undefined : 'row-off'}>
                <td>
                  <input
                    type="checkbox"
                    checked={l.selected}
                    disabled={saving}
                    aria-label={l.description}
                    onChange={(e) => patch(l.index, { selected: e.target.checked })}
                  />
                </td>
                <td>{l.date}</td>
                <td>
                  <span title={l.description}>{l.description}</span>
                  {l.isDuplicate && <span className="badge warn" style={{ marginLeft: 6 }}>{t('statement.duplicate')}</span>}
                  {l.matchedBy === 'none' && !l.item && (
                    <span className="badge" style={{ marginLeft: 6 }}>{t('statement.new')}</span>
                  )}
                </td>
                <td className="num">{fmt.eur(l.amount)}</td>
                <td>
                  <select
                    className="cell-input"
                    value={l.kind}
                    disabled={saving}
                    aria-label={`${l.description} — ${t('statement.kind')}`}
                    onChange={(e) => setKind(l.index, e.target.value as LineKind)}
                  >
                    <option value="Income">{t('statement.kindIncome')}</option>
                    <option value="Expense">{t('statement.kindExpense')}</option>
                    <option value="Ignore">{t('statement.kindIgnore')}</option>
                  </select>
                </td>
                <td>
                  <input
                    className="cell-input"
                    list="statement-items"
                    value={l.item}
                    disabled={saving || l.kind === 'Ignore'}
                    aria-label={`${l.description} — ${t('field.item')}`}
                    onChange={(e) => patch(l.index, { item: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="cell-input"
                    list="statement-categories"
                    value={l.category}
                    disabled={saving || l.kind === 'Ignore'}
                    aria-label={`${l.description} — ${t('field.category')}`}
                    onChange={(e) => patch(l.index, { category: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>{t('replicate.selectedCount', { count: selected.length })}</td>
              <td className="num">{fmt.eur(totals.income - totals.expense)}</td>
              <td colSpan={3} className="muted">
                {t('statement.totals', { income: fmt.eur(totals.income), expense: fmt.eur(totals.expense) })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <datalist id="statement-items">
        {preview.items.map((i) => <option key={i} value={i} />)}
      </datalist>
      <datalist id="statement-categories">
        {preview.categories.map((c) => <option key={c} value={c} />)}
      </datalist>

      <div className="stmt-foot">
        <button className="btn" onClick={onCancel} disabled={saving}>{t('common.cancel')}</button>
        <button className="btn primary" onClick={commit} disabled={saving || selected.length === 0 || counts.unknown > 0}>
          {saving ? t('common.saving') : t('statement.confirm', { count: selected.length })}
        </button>
      </div>
    </div>
  )
}

// The category and source lists behind every expense, income and fixed cost. Renaming
// an entry here renames it everywhere it is used; merging folds a duplicate ("Comida"
// and "Restaurante", "Millenium" and "Millennium") into the one to keep.

import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { api, ApiError } from '../api'
import Icon from '../components/Icon'
import type { Lookup, Lookups, Typo } from '../components/suggestions'
import { useI18n } from '../i18n'

type Kind = 'categories' | 'sources'

export default function LookupsPage() {
  const { t } = useI18n()
  const [data, setData] = useState<Lookups | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api.get<Lookups>('lookups'))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  /** Runs one change, then reloads so usage counts and names are current. */
  async function run(action: () => Promise<unknown>, done: string) {
    setError(null)
    setNotice(null)
    try {
      await action()
      setNotice(done)
      await load()
      return true
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? t('lookups.nameTaken') : (err as Error).message)
      return false
    }
  }

  return (
    <div>
      <h1 className="page-title">🏷️ {t('lookups.title')}</h1>
      <p className="page-sub">{t('lookups.subtitle')}</p>

      {error && <div className="alert err">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      {!data ? (
        <p className="hint">{t('common.loading')}</p>
      ) : (
        <>
          <TypoSuggestions typos={data.typos ?? []} run={run} />
          <div className="lookups-grid">
            <LookupTable kind="categories" items={data.categories} run={run} />
            <LookupTable kind="sources" items={data.sources} run={run} />
          </div>
        </>
      )}
    </div>
  )
}

const DISMISSED_KEY = 'financemanager.lookups.notTypos'

function loadDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[] } catch { return [] }
}

/**
 * Names that look like misspellings of each other. Only shown, never applied: each
 * merge waits for the user's click and a confirmation, and "Not a typo" hides the
 * pair for good on this device.
 */
function TypoSuggestions({ typos, run }: { typos: Typo[]; run: TableProps['run'] }) {
  const { t } = useI18n()
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed)
  const [busy, setBusy] = useState(false)
  const keyOf = (x: Typo) => `${x.kind}:${x.fromName}|${x.intoName}`
  const shown = typos.filter((x) => !dismissed.includes(keyOf(x)))
  if (shown.length === 0) return null

  function dismiss(x: Typo) {
    const next = [...dismissed, keyOf(x)]
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    setDismissed(next)
  }

  async function merge(x: Typo) {
    if (!confirm(t('lookups.confirmMerge', { from: x.fromName, to: x.intoName, count: x.fromUses }))) return
    setBusy(true)
    await run(() => api.post(`lookups/${x.kind}/${x.fromId}/merge`, { targetId: x.intoId }),
      t('lookups.merged', { from: x.fromName, to: x.intoName }))
    setBusy(false)
  }

  return (
    <section className="card typo-card">
      <h2 className="section-title">✏️ {t('lookups.typosTitle')}</h2>
      <p className="hint section-hint">{t('lookups.typosHint')}</p>
      <ul className="typo-list">
        {shown.map((x) => (
          <li key={keyOf(x)}>
            <span className="typo-pair">
              <span className="badge">{t(x.kind === 'categories' ? 'field.category' : 'field.source')}</span>
              «{x.fromName}» <span className="muted">({x.fromUses})</span> → «{x.intoName}» <span className="muted">({x.intoUses})</span>
              <span className="hint">· {t(`lookups.reason.${x.reason}`)}</span>
            </span>
            <span className="typo-actions">
              <button className="btn subtle" disabled={busy} onClick={() => merge(x)}>{t('lookups.mergeSuggested')}</button>
              <button className="btn subtle" disabled={busy} onClick={() => dismiss(x)}>{t('lookups.notTypo')}</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface TableProps {
  kind: Kind
  items: Lookup[]
  run: (action: () => Promise<unknown>, done: string) => Promise<boolean>
}

function LookupTable({ kind, items, run }: TableProps) {
  const { t, fmt } = useI18n()
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const isCategory = kind === 'categories'
  const uses = (l: Lookup) => l.expenses + l.incomes + l.fixedCosts

  async function act(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    const ok = await run(action, done)
    setBusy(false)
    return ok
  }

  async function rename(item: Lookup) {
    const name = draft.trim()
    if (!name || name === item.name) { setEditing(null); return }
    if (await act(() => api.put(`lookups/${kind}/${item.id}`, { name }), t('lookups.renamed', { from: item.name, to: name })))
      setEditing(null)
  }

  async function merge(item: Lookup, targetId: number) {
    const target = items.find((x) => x.id === targetId)
    if (!target || !confirm(t('lookups.confirmMerge', { from: item.name, to: target.name, count: uses(item) }))) return
    await act(() => api.post(`lookups/${kind}/${item.id}/merge`, { targetId }), t('lookups.merged', { from: item.name, to: target.name }))
  }

  async function remove(item: Lookup) {
    if (!confirm(t('lookups.confirmDelete', { name: item.name }))) return
    await act(() => api.del(`lookups/${kind}/${item.id}`), t('lookups.deleted', { name: item.name }))
  }

  function onKeyDown(e: KeyboardEvent, item: Lookup) {
    if (e.key === 'Enter') { e.preventDefault(); rename(item) }
    else if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
  }

  return (
    <section className="card lookup-card">
      <h2 className="section-title">{isCategory ? `📂 ${t('lookups.categories')}` : `💳 ${t('lookups.sources')}`}</h2>
      <p className="hint section-hint">{t(isCategory ? 'lookups.categoriesHint' : 'lookups.sourcesHint')}</p>

      {items.length === 0 ? (
        <p className="hint">{t('lookups.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="lookup-table">
            <thead>
              <tr>
                <th>{t('field.name')}</th>
                <th className="num">{t('res.expenses.title')}</th>
                <th className="num">{t('res.income.title')}</th>
                {isCategory && <th className="num">{t('res.fixedcosts.title')}</th>}
                <th>{t('lookups.mergeInto')}</th>
                <th className="row-actions">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isEditing = editing === item.id
                const used = uses(item)
                return (
                  <tr key={item.id} className={isEditing ? 'editing' : undefined}>
                    <td>
                      {isEditing ? (
                        <input
                          className="cell-input"
                          value={draft}
                          autoFocus
                          disabled={busy}
                          aria-label={t('field.name')}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => onKeyDown(e, item)}
                        />
                      ) : (
                        <span className="lookup-name">{item.name}</span>
                      )}
                    </td>
                    <td className="num">{fmt.int(item.expenses)}</td>
                    <td className="num">{fmt.int(item.incomes)}</td>
                    {isCategory && <td className="num">{fmt.int(item.fixedCosts)}</td>}
                    <td>
                      <select
                        className="lookup-merge"
                        value=""
                        disabled={busy || editing !== null || items.length < 2}
                        aria-label={t('lookups.mergeAria', { name: item.name })}
                        onChange={(e) => merge(item, Number(e.target.value))}
                      >
                        <option value="">—</option>
                        {items.filter((x) => x.id !== item.id).map((x) => (
                          <option key={x.id} value={x.id}>{x.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="row-actions">
                      {isEditing ? (
                        <>
                          <button className="icon-btn ok" onClick={() => rename(item)} disabled={busy}
                            title={t('table.saveRow')} aria-label={t('common.save')}>
                            <Icon name="save" />
                          </button>
                          <button className="icon-btn" onClick={() => setEditing(null)} disabled={busy}
                            title={t('table.cancelEdit')} aria-label={t('common.cancel')}>
                            <Icon name="cancel" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="icon-btn" disabled={busy || editing !== null}
                            onClick={() => { setEditing(item.id); setDraft(item.name) }}
                            title={t('lookups.rename')} aria-label={t('lookups.rename')}>
                            <Icon name="edit" />
                          </button>
                          <button className="icon-btn danger" disabled={busy || editing !== null || used > 0}
                            onClick={() => remove(item)}
                            title={used > 0 ? t('lookups.inUse') : t('lookups.delete')} aria-label={t('lookups.delete')}>
                            <Icon name="delete" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

import { useMemo, useState } from 'react'
import { api } from '../api'
import { useI18n } from '../i18n'
import { resources } from '../resources'

/**
 * Table keys as the server serialises them (BackupModel, camelCased). The order
 * is the order the tables are shown in; `resources` is keyed lowercase, so the
 * two are bridged by `toLowerCase()` rather than by a second lookup table.
 */
export const BACKUP_TABLES = [
  'expenses', 'income', 'fixedCosts', 'debts', 'netWorth', 'investments', 'accounts',
] as const

export type BackupTable = (typeof BACKUP_TABLES)[number]
export type Backup = Partial<Record<BackupTable, unknown[]>>
export type RowCounts = Partial<Record<string, number>>

/**
 * Reads a file as a backup, or explains why it is not one. Kept separate from the
 * component so the page can reject a bad file before opening the review panel.
 */
export async function parseBackup(file: File): Promise<Backup> {
  const raw: unknown = JSON.parse(await file.text())
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('shape')

  const source = raw as Record<string, unknown>
  const backup: Backup = {}
  for (const key of BACKUP_TABLES) {
    const value = source[key]
    if (Array.isArray(value)) backup[key] = value
  }
  // A JSON file with none of our tables is almost certainly the wrong file —
  // restoring it would silently do nothing, which looks like a bug to the user.
  if (Object.keys(backup).length === 0) throw new Error('shape')
  return backup
}

interface Props {
  fileName: string
  backup: Backup
  /** Row counts currently in the app, keyed like BACKUP_TABLES. */
  current: RowCounts
  onCancel(): void
  onDone(inserted: Record<string, number>): void
}

interface Row {
  key: BackupTable
  now: number
  /** Null when the table is absent from the file, which leaves it untouched. */
  incoming: number | null
  after: number
  delta: number
}

/**
 * Shows what a restore would do — table by table — before anything is sent. The
 * server's overwrite guard normally demands a confirmation round-trip; this panel
 * *is* that confirmation, spelled out in full, so the request goes straight out
 * with confirm=true instead of raising a second, less informative dialog.
 */
export default function BackupRestore({ fileName, backup, current, onCancel, onDone }: Props) {
  const { t, fmt } = useI18n()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => BACKUP_TABLES.map((key) => {
    const now = current[key] ?? 0
    const incoming = backup[key]?.length ?? null
    const after = incoming ?? now
    return { key, now, incoming, after, delta: after - now }
  }), [backup, current])

  const losing = rows.filter((r) => r.delta < 0)
  const untouched = rows.filter((r) => r.incoming === null && r.now > 0)
  const totalIncoming = rows.reduce((sum, r) => sum + (r.incoming ?? 0), 0)

  function label(key: string) {
    const res = resources[key.toLowerCase()]
    return res ? `${res.icon} ${t(res.titleKey)}` : key
  }

  async function restore() {
    setSaving(true)
    setError(null)
    try {
      const result = await api.post<{ inserted: Record<string, number> }>('import/json?confirm=true', backup)
      onDone(result.inserted)
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="card stmt-review" style={{ marginTop: 16 }}>
      <div className="stmt-head">
        <h3 className="chart-title" style={{ margin: 0 }}>
          {t('backup.restoreTitle', { file: fileName })}
        </h3>
        <button className="icon-btn" onClick={onCancel} aria-label={t('common.cancel')} disabled={saving}>✕</button>
      </div>

      <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>{t('backup.restoreIntro')}</p>

      {losing.length > 0 && (
        <div className="alert warn">
          {t('backup.warnLoss', {
            rows: losing.map((r) => `${t(resources[r.key.toLowerCase()].titleKey)} −${fmt.int(-r.delta)}`).join(', '),
          })}
        </div>
      )}
      {untouched.length > 0 && (
        <div className="alert">
          {t('backup.warnMissing', {
            rows: untouched.map((r) => t(resources[r.key.toLowerCase()].titleKey)).join(', '),
          })}
        </div>
      )}
      {error && <div className="alert err">{error}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('backup.colTable')}</th>
              <th className="num">{t('backup.colNow')}</th>
              <th className="num">{t('backup.colFile')}</th>
              <th className="num">{t('backup.colAfter')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.incoming === null ? 'row-off' : undefined}>
                <td>{label(r.key)}</td>
                <td className="num">{fmt.int(r.now)}</td>
                <td className="num">{r.incoming === null ? '—' : fmt.int(r.incoming)}</td>
                <td className="num">
                  {fmt.int(r.after)}
                  {r.delta !== 0 && (
                    <span className={`delta ${r.delta > 0 ? 'up' : 'down'}`}>
                      {r.delta > 0 ? '+' : '−'}{fmt.int(Math.abs(r.delta))}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="stmt-foot">
        <button className="btn" onClick={onCancel} disabled={saving}>{t('common.cancel')}</button>
        <button className="btn primary" onClick={restore} disabled={saving}>
          {saving ? t('common.saving') : t('backup.restoreConfirm', { count: totalIncoming })}
        </button>
      </div>
    </div>
  )
}

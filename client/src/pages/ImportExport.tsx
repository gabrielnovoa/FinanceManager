import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { api } from '../api'
import { useI18n } from '../i18n'
import { resources } from '../resources'
import StatementReview, { type StatementPreview } from '../components/StatementReview'
import BackupRestore, {
  BACKUP_TABLES, parseBackup, type Backup, type RowCounts,
} from '../components/BackupRestore'

interface ImportResult { message: string; inserted: Record<string, number> }

/** Remembers when a backup was last downloaded, so the card can say how stale it is. */
const LAST_BACKUP_KEY = 'financemanager.lastBackup'

export default function ImportExport() {
  const { t, fmt } = useI18n()
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const jsonRef = useRef<HTMLInputElement>(null)
  const stmtRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<StatementPreview | null>(null)
  const [pending, setPending] = useState<{ fileName: string; backup: Backup } | null>(null)
  const [counts, setCounts] = useState<RowCounts | null>(null)
  const [lastBackup, setLastBackup] = useState(() => localStorage.getItem(LAST_BACKUP_KEY))
  const [dragging, setDragging] = useState(false)

  const loadCounts = useCallback(async () => {
    try {
      setCounts(await api.get<RowCounts>('backup/summary'))
    } catch {
      setCounts({}) // a failed count must not block exporting or restoring
    }
  }, [])

  useEffect(() => { void loadCounts() }, [loadCounts])

  function reset() { setOk(null); setErr(null) }

  /** Server table keys are the resource keys in camelCase, e.g. netWorth -> networth. */
  function tableLabel(key: string) {
    const res = resources[key.toLowerCase()]
    return res ? t(res.titleKey) : key
  }

  const totalRows = counts
    ? BACKUP_TABLES.reduce((sum, k) => sum + (counts[k] ?? 0), 0)
    : 0

  // ---- export --------------------------------------------------------------

  async function exportJson() {
    reset()
    setBusy(true)
    try {
      const res = await fetch('/api/export/json')
      if (!res.ok) throw new Error(t('import.exportFailed'))
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)

      const now = new Date().toISOString()
      localStorage.setItem(LAST_BACKUP_KEY, now)
      setLastBackup(now)
      setOk(t('backup.downloaded', { count: fmt.int(totalRows) }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ---- restore -------------------------------------------------------------

  /**
   * Opens the comparison panel. Nothing is sent to the server here — the file is
   * parsed in the browser so the user sees exactly what a restore would replace
   * before agreeing to it.
   */
  async function openBackup(file: File) {
    reset()
    setBusy(true)
    try {
      setPending({ fileName: file.name, backup: await parseBackup(file) })
    } catch {
      setErr(t('backup.badFile', { file: file.name }))
    } finally {
      setBusy(false)
      if (jsonRef.current) jsonRef.current.value = ''
    }
  }

  function onJsonInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void openBackup(file)
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void openBackup(file)
  }

  function allowDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault()
    setDragging(true)
  }

  // ---- statements ----------------------------------------------------------

  /**
   * Parses a bank or card statement and opens the review table. Nothing reaches the
   * database here — the server classifies and hands the lines back for correction.
   */
  async function onStatement(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    reset(); setBusy(true)
    try {
      setPreview(await api.upload<StatementPreview>('statement/preview', file))
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
      if (stmtRef.current) stmtRef.current.value = ''
    }
  }

  // ---- danger zone ---------------------------------------------------------

  async function resetAll() {
    // Deleting is the whole point of this button, so its own prompt is the confirmation
    // the server guard asks for — sending confirm=true avoids a redundant second dialog.
    if (!confirm(t('import.confirmReset'))) return
    reset(); setBusy(true)
    try {
      await api.post<ImportResult>('import/reset?confirm=true', {})
      setOk(t('import.allCleared'))
      await loadCounts()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="page-title">⇄ {t('import.title')}</h1>
      <p className="page-sub">{t('import.subtitle')}</p>

      {ok && <div className="alert ok">{ok}</div>}
      {err && <div className="alert err">{err}</div>}

      <div className="grid chart-grid">
        <div className="card">
          <h3 className="chart-title">{t('backup.title')}</h3>
          <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>{t('backup.body')}</p>

          <section className="backup-block">
            <div className="backup-head">
              <strong>{t('backup.exportHeading')}</strong>
              <span className="hint">
                {lastBackup
                  ? t('backup.lastExport', { when: fmt.dateTime(lastBackup) })
                  : t('backup.neverExported')}
              </span>
            </div>

            <div className="pill-row" style={{ margin: '10px 0 12px' }}>
              {counts === null ? (
                <span className="hint">{t('common.loading')}</span>
              ) : totalRows === 0 ? (
                <span className="hint">{t('backup.empty')}</span>
              ) : (
                BACKUP_TABLES.filter((k) => (counts[k] ?? 0) > 0).map((k) => (
                  <span key={k} className="badge">
                    {resources[k.toLowerCase()].icon} {fmt.int(counts[k])} {tableLabel(k)}
                  </span>
                ))
              )}
            </div>

            <button className="btn primary" onClick={exportJson} disabled={busy || totalRows === 0}>
              {t('backup.export')}
            </button>
          </section>

          <section className="backup-block">
            <strong>{t('backup.restoreHeading')}</strong>
            <p className="hint" style={{ margin: '2px 0 10px' }}>{t('backup.restoreHint')}</p>

            <button
              type="button"
              className={`dropzone${dragging ? ' over' : ''}`}
              onClick={() => jsonRef.current?.click()}
              onDragEnter={allowDrop}
              onDragOver={allowDrop}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              disabled={busy}
            >
              <span className="dropzone-icon">{dragging ? '📂' : '📄'}</span>
              <span className="dropzone-main">{t('backup.drop')}</span>
              <span className="hint">{t('backup.dropHint')}</span>
            </button>
            <input
              ref={jsonRef}
              type="file"
              accept=".json,application/json"
              onChange={onJsonInput}
              hidden
            />
          </section>
        </div>

        <div className="card">
          <h3 className="chart-title">{t('statement.title')}</h3>
          <p className="muted" style={{ fontSize: 14 }}>{t('statement.body')}</p>
          <p className="hint" style={{ marginBottom: 8 }}>{t('statement.nameHint')}</p>
          <input ref={stmtRef} type="file" accept=".xls,.xlsx" onChange={onStatement} disabled={busy} />
        </div>

        <div className="card">
          <h3 className="chart-title">{t('import.danger.title')}</h3>
          <p className="muted" style={{ fontSize: 14 }}>{t('import.danger.body')}</p>
          <button className="btn danger" onClick={resetAll} disabled={busy}>{t('import.danger.button')}</button>
        </div>
      </div>

      {pending && counts && (
        <BackupRestore
          fileName={pending.fileName}
          backup={pending.backup}
          current={counts}
          onCancel={() => setPending(null)}
          onDone={(inserted) => {
            setPending(null)
            const parts = Object.entries(inserted).map(([k, v]) => `${fmt.int(v)} ${tableLabel(k)}`)
            setOk(t('backup.restored', { parts: parts.join(', ') }))
            void loadCounts()
          }}
        />
      )}

      {preview && (
        <StatementReview
          preview={preview}
          onCancel={() => setPreview(null)}
          onDone={(r) => {
            setPreview(null)
            setOk(t('statement.committed', {
              incomes: r.incomes,
              expenses: r.expenses,
              rules: r.aliasesLearned,
            }))
            void loadCounts()
          }}
        />
      )}
    </div>
  )
}

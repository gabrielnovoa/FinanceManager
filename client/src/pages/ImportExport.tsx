import { useRef, useState, type ChangeEvent } from 'react'
import { api, ApiError } from '../api'
import { useI18n } from '../i18n'
import { resources } from '../resources'

interface ImportResult { message: string; inserted: Record<string, number> }

/** Body the server returns with 409 when an import would destroy existing rows. */
interface OverwriteGuard {
  message: string
  requiresConfirmation: boolean
  existing: Record<string, number>
}

function asOverwriteGuard(e: unknown): OverwriteGuard | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null
  const body = e.body as OverwriteGuard | null
  return body?.requiresConfirmation ? body : null
}

export default function ImportExport() {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const xlsxRef = useRef<HTMLInputElement>(null)
  const jsonRef = useRef<HTMLInputElement>(null)

  function reset() { setOk(null); setErr(null) }
  function summarize(r: ImportResult) {
    const parts = Object.entries(r.inserted).map(([k, v]) => `${v} ${k}`)
    setOk(t('import.result', {
      message: r.message,
      parts: parts.join(', ') || t('import.resultNothing'),
    }))
  }

  /** Server table keys are the resource keys in camelCase, e.g. netWorth -> networth. */
  function tableLabel(key: string) {
    const res = resources[key.toLowerCase()]
    return res ? t(res.titleKey) : key
  }

  const query = (confirm: boolean) => (confirm ? '?confirm=true' : '')

  /**
   * Runs a destructive import. Outside local development the server refuses the first
   * attempt if rows would be lost, so we spell out exactly what is at stake and only
   * retry when the user agrees. Resolves to null when they back out.
   */
  async function runGuarded(call: (confirmed: boolean) => Promise<ImportResult>): Promise<ImportResult | null> {
    try {
      return await call(false)
    } catch (e) {
      const guard = asOverwriteGuard(e)
      if (!guard) throw e
      const rows = Object.entries(guard.existing)
        .map(([key, count]) => `• ${count} × ${tableLabel(key)}`)
        .join('\n')
      if (!confirm(t('import.confirmOverwrite', { rows }))) return null
      return await call(true)
    }
  }

  function report(r: ImportResult | null) {
    if (r) summarize(r)
    else setOk(t('import.cancelled'))
  }

  async function onExcel(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    reset(); setBusy(true)
    try {
      report(await runGuarded(c => api.upload<ImportResult>(`import/excel${query(c)}`, file)))
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
      if (xlsxRef.current) xlsxRef.current.value = ''
    }
  }

  async function onJson(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    reset(); setBusy(true)
    try {
      const parsed = JSON.parse(await file.text())
      report(await runGuarded(c => api.post<ImportResult>(`import/json${query(c)}`, parsed)))
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
      if (jsonRef.current) jsonRef.current.value = ''
    }
  }

  async function exportJson() {
    reset()
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
      setOk(t('import.backupDownloaded'))
    } catch (e2) {
      setErr((e2 as Error).message)
    }
  }

  async function resetAll() {
    // Deleting is the whole point of this button, so its own prompt is the confirmation
    // the server guard asks for — sending confirm=true avoids a redundant second dialog.
    if (!confirm(t('import.confirmReset'))) return
    reset(); setBusy(true)
    try {
      await api.post<ImportResult>('import/reset?confirm=true', {})
      setOk(t('import.allCleared'))
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
          <h3 className="chart-title">{t('import.excel.title')}</h3>
          <p className="muted" style={{ fontSize: 14 }}>{t('import.excel.body')}</p>
          <p className="alert err" style={{ fontSize: 13 }}>{t('import.excel.note')}</p>
          <input ref={xlsxRef} type="file" accept=".xlsx" onChange={onExcel} disabled={busy} />
        </div>

        <div className="card">
          <h3 className="chart-title">{t('import.json.title')}</h3>
          <p className="muted" style={{ fontSize: 14 }}>{t('import.json.body')}</p>
          <div className="pill-row" style={{ marginBottom: 12 }}>
            <button className="btn" onClick={exportJson} disabled={busy}>{t('import.json.export')}</button>
          </div>
          <label className="muted" style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
            {t('import.json.restore')}
          </label>
          <input ref={jsonRef} type="file" accept=".json,application/json" onChange={onJson} disabled={busy} />
        </div>

        <div className="card">
          <h3 className="chart-title">{t('import.danger.title')}</h3>
          <p className="muted" style={{ fontSize: 14 }}>{t('import.danger.body')}</p>
          <button className="btn danger" onClick={resetAll} disabled={busy}>{t('import.danger.button')}</button>
        </div>
      </div>
    </div>
  )
}

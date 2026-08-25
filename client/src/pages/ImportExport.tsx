import { useRef, useState, type ChangeEvent } from 'react'
import { api } from '../api'
import { useI18n } from '../i18n'

interface ImportResult { message: string; inserted: Record<string, number> }

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

  async function onExcel(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    reset(); setBusy(true)
    try {
      summarize(await api.upload<ImportResult>('import/excel', file))
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
      summarize(await api.post<ImportResult>('import/json', parsed))
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
    if (!confirm(t('import.confirmReset'))) return
    reset(); setBusy(true)
    try {
      await api.post<ImportResult>('import/reset', {})
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

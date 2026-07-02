import { useRef, useState, type ChangeEvent } from 'react'
import { api } from '../api'

interface ImportResult { message: string; inserted: Record<string, number> }

export default function ImportExport() {
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const xlsxRef = useRef<HTMLInputElement>(null)
  const jsonRef = useRef<HTMLInputElement>(null)

  function reset() { setOk(null); setErr(null) }
  function summarize(r: ImportResult) {
    const parts = Object.entries(r.inserted).map(([k, v]) => `${v} ${k}`)
    setOk(`${r.message} Loaded ${parts.join(', ') || 'nothing'}.`)
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
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setOk('Backup downloaded.')
    } catch (e2) {
      setErr((e2 as Error).message)
    }
  }

  async function resetAll() {
    if (!confirm('Delete ALL data from the app database? Export a backup first if unsure.')) return
    reset(); setBusy(true)
    try {
      await api.post<ImportResult>('import/reset', {})
      setOk('All data cleared.')
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="page-title">⇄ Import / Export</h1>
      <p className="page-sub">Load your spreadsheet, restore a backup, or export everything.</p>

      {ok && <div className="alert ok">{ok}</div>}
      {err && <div className="alert err">{err}</div>}

      <div className="grid chart-grid">
        <div className="card">
          <h3 className="chart-title">📥 Import from Excel</h3>
          <p className="muted" style={{ fontSize: 14 }}>
            Upload your <strong>Finance.xlsx</strong>. Matching sheets (Despesas, Receitas, Gastos Fixos,
            Dívidas, Patrimônio, Investimentos, Contas Bancárias) replace the current data.
          </p>
          <p className="alert err" style={{ fontSize: 13 }}>
            The file must not be password-protected. In Excel: <em>File → Info → Protect Workbook →
            Encrypt with Password</em>, clear the box, and save.
          </p>
          <input ref={xlsxRef} type="file" accept=".xlsx" onChange={onExcel} disabled={busy} />
        </div>

        <div className="card">
          <h3 className="chart-title">🗂️ Import / Export JSON</h3>
          <p className="muted" style={{ fontSize: 14 }}>Restore a JSON backup, or download everything currently in the app.</p>
          <div className="pill-row" style={{ marginBottom: 12 }}>
            <button className="btn" onClick={exportJson} disabled={busy}>⬇ Export backup (JSON)</button>
          </div>
          <label className="muted" style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Restore from JSON:</label>
          <input ref={jsonRef} type="file" accept=".json,application/json" onChange={onJson} disabled={busy} />
        </div>

        <div className="card">
          <h3 className="chart-title">🧹 Danger zone</h3>
          <p className="muted" style={{ fontSize: 14 }}>Clear everything and start fresh. Export a backup first.</p>
          <button className="btn danger" onClick={resetAll} disabled={busy}>Delete all data</button>
        </div>
      </div>
    </div>
  )
}

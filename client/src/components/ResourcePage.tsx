import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api } from '../api'
import { eur } from '../format'
import type { Field, Resource } from '../resources'

type Row = Record<string, unknown> & { id: number }

export default function ResourcePage({ resource }: { resource: Resource }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, unknown>>(resource.defaults())
  const [saving, setSaving] = useState(false)

  // Reset state whenever we switch to a different resource.
  useEffect(() => {
    setForm(resource.defaults())
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.key])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setRows(await api.get<Row[]>(resource.endpoint))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.post(resource.endpoint, coerce(form, resource.fields))
      setForm(resource.defaults())
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    if (!confirm('Delete this entry? This cannot be undone.')) return
    try {
      await api.del(`${resource.endpoint}/${id}`)
      setRows((r) => r.filter((x) => x.id !== id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const total = useMemo(() => {
    if (!resource.totalField) return null
    return rows.reduce((s, r) => s + Number(r[resource.totalField!] ?? 0), 0)
  }, [rows, resource.totalField])

  return (
    <div>
      <h1 className="page-title">{resource.icon} {resource.title}</h1>
      <p className="page-sub">{resource.subtitle}</p>

      {error && <div className="alert err">{error}</div>}

      {/* Add form */}
      <form className="card" onSubmit={add} style={{ marginBottom: 20 }}>
        <div className="form-row">
          {resource.fields.map((f) => (
            <div className="field" key={f.key}>
              <label>{f.label}{f.required && ' *'}</label>
              <input
                type={inputType(f.type)}
                step={isNumeric(f.type) ? 'any' : undefined}
                required={f.required}
                value={String(form[f.key] ?? '')}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            </div>
          ))}
          <div className="field">
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : '+ Add'}
            </button>
          </div>
        </div>
      </form>

      {/* Table */}
      <div className="toolbar">
        <span className="count">{loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}</span>
        <div className="spacer" />
        <button className="btn" onClick={load} disabled={loading}>↻ Refresh</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {resource.fields.map((f) => (
                <th key={f.key} className={isNumeric(f.type) ? 'num' : ''}>{f.label}</th>
              ))}
              <th className="row-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {resource.fields.map((f) => (
                  <td key={f.key} className={isNumeric(f.type) ? 'num' : ''}>{cell(r[f.key], f)}</td>
                ))}
                <td className="row-actions">
                  <button className="link-btn" onClick={() => remove(r.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={resource.fields.length + 1} className="empty">No entries yet — add one above, or use Import.</td></tr>
            )}
          </tbody>
          {total !== null && rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={resource.fields.length + 1} className="num" style={{ fontWeight: 700 }}>
                  Total: {eur(total)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

// ---- helpers ----
function isNumeric(t: Field['type']) { return t === 'money' || t === 'number' || t === 'int' }
function inputType(t: Field['type']) { return t === 'date' ? 'date' : isNumeric(t) ? 'number' : 'text' }

function cell(value: unknown, f: Field) {
  if (value === null || value === undefined || value === '') return f.type === 'money' ? eur(0) : '—'
  if (f.type === 'money') return eur(Number(value))
  return String(value)
}

function coerce(form: Record<string, unknown>, fields: Field[]) {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const v = form[f.key]
    if (f.type === 'money' || f.type === 'number') out[f.key] = Number(v || 0)
    else if (f.type === 'int') out[f.key] = v === '' || v === null ? null : Math.round(Number(v))
    else out[f.key] = v ?? ''
  }
  return out
}

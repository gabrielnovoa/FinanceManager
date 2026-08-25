import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { useI18n } from '../i18n'
import type { Field, Resource } from '../resources'
import DataTable, { isNumeric, type Row } from './DataTable'

export default function ResourcePage({ resource }: { resource: Resource }) {
  const { t } = useI18n()
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
    if (!confirm(t('common.confirmDelete'))) return
    try {
      await api.del(`${resource.endpoint}/${id}`)
      setRows((r) => r.filter((x) => x.id !== id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div>
      <h1 className="page-title">{resource.icon} {t(resource.titleKey)}</h1>
      <p className="page-sub">{t(resource.subtitleKey)}</p>

      {error && <div className="alert err">{error}</div>}

      {/* Add form */}
      <form className="card" onSubmit={add} style={{ marginBottom: 20 }}>
        <div className="form-row">
          {resource.fields.map((f) => (
            <div className="field" key={f.key}>
              <label>{t(f.labelKey)}{f.required && ' *'}</label>
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
              {saving ? t('common.saving') : t('common.add')}
            </button>
          </div>
        </div>
      </form>

      {/* Sorting, filtering and grouping state is per-resource, so remount on switch. */}
      <DataTable
        key={resource.key}
        fields={resource.fields}
        rows={rows}
        loading={loading}
        totalField={resource.totalField}
        groupBy={resource.groupBy}
        onRefresh={load}
        onDelete={remove}
      />
    </div>
  )
}

// ---- helpers ----
function inputType(t: Field['type']) { return t === 'date' ? 'date' : isNumeric(t) ? 'number' : 'text' }

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

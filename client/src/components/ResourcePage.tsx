import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { coerce } from '../fieldValues'
import { useI18n } from '../i18n'
import type { Resource } from '../resources'
import DataTable from './DataTable'
import FieldInput from './FieldInput'
import ReplicateMonthDialog from './ReplicateMonthDialog'
import { useResourceData } from './useResourceData'

export default function ResourcePage({ resource }: { resource: Resource }) {
  const { t } = useI18n()
  const { rows, loading, error, load, create, remove, save } = useResourceData(resource)
  const [form, setForm] = useState<Record<string, unknown>>(resource.defaults())
  const [saving, setSaving] = useState(false)
  const [replicating, setReplicating] = useState(false)

  // Reset the form whenever we switch to a different resource.
  useEffect(() => {
    setForm(resource.defaults())
    setReplicating(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.key])

  async function add(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await create(coerce(form, resource.fields))
      setForm(resource.defaults())
      await load()
    } catch {
      // The hook has already surfaced the error; keep the form as typed.
    } finally {
      setSaving(false)
    }
  }

  // The API replaces the whole row, so the body carries every editable field.
  const update = (id: number, values: Record<string, unknown>) => save(id, coerce(values, resource.fields))

  // Bulk add from the "repeat last month" dialog. Posted one at a time so a
  // failure part-way through still leaves the rows that did succeed.
  async function addMany(newRows: Record<string, unknown>[]) {
    for (const r of newRows) {
      await api.post(resource.endpoint, coerce({ ...resource.defaults(), ...r }, resource.fields))
    }
    await load()
  }

  return (
    <div>
      <h1 className="page-title">{resource.icon} {t(resource.titleKey)}</h1>
      <p className="page-sub">{t(resource.subtitleKey)}</p>

      {error && <div className="alert err">{error}</div>}

      {/* Add form */}
      <form className="card" onSubmit={add} style={{ marginBottom: 20 }}>
        <div className="form-row">
          {resource.fields.filter((f) => !f.computed).map((f) => (
            <div className="field" key={f.key}>
              <label>{t(f.labelKey)}{f.required && ' *'}</label>
              <FieldInput
                field={f}
                required={f.required}
                value={String(form[f.key] ?? '')}
                onChange={(value) => setForm({ ...form, [f.key]: value })}
              />
            </div>
          ))}
          <div className="field">
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('common.add')}
            </button>
          </div>
          {resource.replicate && (
            <div className="field">
              <button
                className="btn"
                type="button"
                disabled={saving || loading}
                title={t('replicate.buttonHint')}
                onClick={() => setReplicating(true)}
              >
                🔁 {t('replicate.button')}
              </button>
            </div>
          )}
        </div>
      </form>

      {replicating && resource.replicate && (
        <ReplicateMonthDialog
          resource={resource}
          replicate={resource.replicate}
          rows={rows}
          onClose={() => setReplicating(false)}
          onSubmit={addMany}
        />
      )}

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
        onUpdate={update}
      />
    </div>
  )
}

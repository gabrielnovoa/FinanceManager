import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useI18n } from '../i18n'
import type { Resource } from '../resources'
import type { Row } from './DataTable'

/** Loading, adding, saving and deleting the rows of one resource. */
export function useResourceData(resource: Resource) {
  const { t } = useI18n()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await api.get<Row[]>(resource.endpoint))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [resource.endpoint])

  // Reload whenever we switch to a different resource.
  useEffect(() => {
    load()
  }, [load])

  /** Rethrows so a form can keep its input when the add fails. */
  async function create(body: Record<string, unknown>) {
    setError(null)
    try {
      await api.post(resource.endpoint, body)
    } catch (err) {
      setError((err as Error).message)
      throw err
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

  /**
   * The API replaces the whole row, so `body` must carry every field. Rethrowing
   * lets the table keep the row open when a save fails.
   */
  async function save(id: number, body: Record<string, unknown>) {
    setError(null)
    try {
      await api.put(`${resource.endpoint}/${id}`, { ...body, id })
      // Calculated columns are derived server-side, and category/source names are
      // matched to the canonical entry ("casa" → "Casa"), so an optimistic merge would
      // show stale values — refetch instead when the resource has either.
      if (resource.fields.some((f) => f.computed || f.suggest === 'category' || f.suggest === 'source')) await load()
      else setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...body, id } : r)))
    } catch (err) {
      setError((err as Error).message)
      throw err
    }
  }

  return { rows, loading, error, setError, load, create, remove, save }
}

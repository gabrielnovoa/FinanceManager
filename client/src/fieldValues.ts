// Conversions between what the API stores and what form inputs hold. Inputs work
// on strings; the API wants numbers, null terms and month arrays.

import type { Field, FieldType } from './resources'

export function isNumeric(type: FieldType) {
  return type === 'money' || type === 'number' || type === 'int'
}

/** Which native input a field type should use, for both the add form and inline edit. */
export function inputType(type: FieldType) {
  return type === 'date' ? 'date' : isNumeric(type) ? 'number' : 'text'
}

/** "5, 8,11" / [5, 8, 11] -> [5, 8, 11] — sorted, de-duplicated, 1–12 only. */
export function parseMonths(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',')
  const months = raw.map((m) => Number(String(m).trim())).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
  return [...new Set(months)].sort((a, b) => a - b)
}

export function monthsToString(value: unknown): string {
  return parseMonths(value).join(',')
}

/** Form values -> request body. Calculated columns are left out; the server derives them. */
export function coerce(form: Record<string, unknown>, fields: Field[]) {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.computed) continue
    const v = form[f.key]
    if (f.type === 'money' || f.type === 'number') out[f.key] = Number(v || 0)
    else if (f.type === 'int') out[f.key] = v === '' || v === null ? null : Math.round(Number(v))
    else if (f.type === 'months') out[f.key] = parseMonths(v)
    else out[f.key] = v ?? ''
  }
  return out
}

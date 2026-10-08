// "Gastos Fixos" split the way the original spreadsheet reads it: costs charged every
// month, costs charged once (or a few times) a year, and a calendar showing which
// months the annual ones fall due in so the money can be ready in time.

import { useMemo, useState, type FormEvent } from 'react'
import DataTable, { type Row } from '../components/DataTable'
import FieldInput from '../components/FieldInput'
import MonthPicker from '../components/MonthPicker'
import { SuggestionsProvider } from '../components/suggestions'
import { useResourceData } from '../components/useResourceData'
import { coerce, parseMonths } from '../fieldValues'
import { useI18n } from '../i18n'
import { resources, type Field } from '../resources'

const resource = resources.fixedcosts
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

const field = (key: string) => resource.fields.find((f) => f.key === key)!

// Each table shows the amount that is actually typed in as editable and the
// other one as calculated — the white and grey cells of the spreadsheet.
// No frequency column: the table a row sits in already says how often it is charged.
const monthlyFields: Field[] = [
  field('type'), field('category'), field('item'),
  { ...field('monthlyAmount'), required: true },
  { ...field('annualAmount'), computed: true },
]
const annualFields: Field[] = [
  field('type'), field('category'), field('item'), field('dueMonths'),
  { ...field('annualAmount'), required: true },
  { ...field('monthlyAmount'), labelKey: 'field.setAside', computed: true },
]

const isAnnual = (r: Row) => r.frequency === 'Annual'
const num = (v: unknown) => Number(v ?? 0)
const round2 = (n: number) => Math.round(n * 100) / 100
const sum = (rows: Row[], key: string) => round2(rows.reduce((s, r) => s + num(r[key]), 0))

/** Splits an annual amount evenly over its due months, to the cent. */
function instalments(annual: number, months: number[]): Map<number, number> {
  const out = new Map<number, number>()
  if (months.length === 0) return out
  const cents = Math.round(annual * 100)
  const each = Math.floor(cents / months.length)
  const extra = cents - each * months.length
  months.forEach((m, i) => out.set(m, (each + (i < extra ? 1 : 0)) / 100))
  return out
}

interface NewCost {
  type: string
  category: string
  item: string
  frequency: string
  amount: string
  dueMonths: string
}

const emptyForm = (): NewCost => ({
  type: 'Conta Fixa', category: '', item: '', frequency: 'Monthly', amount: '', dueMonths: '',
})

export default function FixedCosts() {
  const { t, fmt } = useI18n()
  const { rows, loading, error, setError, load, create, remove, save } = useResourceData(resource)
  const [form, setForm] = useState<NewCost>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)

  const monthly = useMemo(() => rows.filter((r) => !isAnnual(r)), [rows])
  const annual = useMemo(() => rows.filter(isAnnual), [rows])

  const monthlyTotal = sum(monthly, 'monthlyAmount')
  const annualTotal = sum(annual, 'annualAmount')
  const setAside = sum(annual, 'monthlyAmount')

  const formAnnual = form.frequency === 'Annual'

  async function add(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const amount = Number(form.amount || 0)
    try {
      await create({
        type: form.type,
        category: form.category,
        item: form.item,
        frequency: form.frequency,
        dueMonths: formAnnual ? parseMonths(form.dueMonths) : [],
        monthlyAmount: formAnnual ? 0 : amount,
        annualAmount: formAnnual ? amount : 0,
      })
      // Keep the frequency: annual costs tend to be entered one after another.
      setForm({ ...emptyForm(), frequency: form.frequency })
      await load()
    } catch {
      // The hook has already surfaced the error; keep the form as typed.
    } finally {
      setSaving(false)
    }
  }

  /** Every save sends the full row; the server derives whichever amount is not typed in. */
  async function saveRow(prev: Row, changes: Record<string, unknown>) {
    const body: Record<string, unknown> = { ...coerce(prev, resource.fields), ...changes }
    // Moving a cost to the other table: carry its amount across, so a 10 €/month
    // cost becomes 120 €/year rather than whatever the stale derived figure was.
    if (body.frequency !== prev.frequency) {
      if (body.frequency === 'Annual') body.annualAmount = round2(num(body.monthlyAmount) * 12)
      else body.monthlyAmount = round2(num(body.annualAmount) / 12)
    }
    await save(prev.id, body)
    await load()
  }

  const updateFrom = (fields: Field[]) => (id: number, values: Record<string, unknown>) =>
    saveRow(rows.find((r) => r.id === id)!, coerce(values, fields))

  /** Moves a cost to the other table; saveRow carries its amount across. */
  async function moveRow(row: Row) {
    try {
      await saveRow(row, { frequency: isAnnual(row) ? 'Monthly' : 'Annual' })
    } catch {
      // Error already shown by the hook.
    }
  }

  async function toggleMonth(row: Row, month: number) {
    if (toggling) return
    const months = parseMonths(row.dueMonths)
    const next = months.includes(month) ? months.filter((m) => m !== month) : [...months, month]
    setToggling(true)
    try {
      await saveRow(row, { dueMonths: parseMonths(next) })
    } catch {
      // Error already shown by the hook.
    } finally {
      setToggling(false)
    }
  }

  return (
    <SuggestionsProvider rows={rows} version={rows}>
    <div>
      <h1 className="page-title">{resource.icon} {t(resource.titleKey)}</h1>
      <p className="page-sub">{t(resource.subtitleKey)}</p>

      {error && <div className="alert err" onClick={() => setError(null)}>{error}</div>}

      <div className="grid kpi-grid" style={{ marginBottom: 20 }}>
        <Kpi label={t('kpi.monthlyCosts')} value={fmt.eur(monthlyTotal)} hint={t('fixed.perMonth')} />
        <Kpi label={t('kpi.annualCosts')} value={fmt.eur(annualTotal)} hint={t('fixed.perYear')} />
        <Kpi label={t('kpi.setAside')} value={fmt.eur(setAside)} hint={t('kpi.setAsideHint')} />
        <Kpi label={t('kpi.fixedTotal')} value={fmt.eur(round2(monthlyTotal + setAside))} hint={t('kpi.fixedTotalHint')} />
      </div>

      <form className="card" onSubmit={add} style={{ marginBottom: 24 }}>
        <div className="form-row">
          {(['type', 'category', 'item', 'frequency'] as const).map((key) => {
            const f = field(key)
            return (
              <div className="field" key={key}>
                <label>{t(f.labelKey)}{f.required && ' *'}</label>
                <FieldInput
                  field={f}
                  required={f.required}
                  value={form[key]}
                  onChange={(value) => setForm({ ...form, [key]: value })}
                />
              </div>
            )
          })}
          <div className="field">
            <label>{t(formAnnual ? 'fixed.amountAnnual' : 'fixed.amountMonthly')} *</label>
            <input
              type="number"
              step="any"
              required
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
          {formAnnual && (
            <div className="field field-wide">
              <label>{t('field.dueMonths')}</label>
              <MonthPicker
                value={form.dueMonths}
                label={t('field.dueMonths')}
                onChange={(value) => setForm({ ...form, dueMonths: value })}
              />
            </div>
          )}
          <div className="field">
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('common.add')}
            </button>
          </div>
        </div>
      </form>

      <section className="section">
        <h2 className="section-title">🗓️ {t('fixed.monthlyTitle')}</h2>
        <p className="hint section-hint">{t('fixed.monthlyHint')}</p>
        <DataTable
          fields={monthlyFields}
          rows={monthly}
          loading={loading}
          totalField="monthlyAmount"
          onRefresh={load}
          onDelete={remove}
          onUpdate={updateFrom(monthlyFields)}
          rowAction={{ icon: 'swap', title: t('fixed.moveToAnnual'), onClick: moveRow }}
        />
      </section>

      <section className="section">
        <h2 className="section-title">📆 {t('fixed.annualTitle')}</h2>
        <p className="hint section-hint">{t('fixed.annualHint')}</p>
        <DataTable
          fields={annualFields}
          rows={annual}
          loading={loading}
          totalField="annualAmount"
          onRefresh={load}
          onDelete={remove}
          onUpdate={updateFrom(annualFields)}
          rowAction={{ icon: 'swap', title: t('fixed.moveToMonthly'), onClick: moveRow }}
        />
      </section>

      <section className="section">
        <h2 className="section-title">🧭 {t('fixed.calendarTitle')}</h2>
        <p className="hint section-hint">{t('fixed.calendarHint')}</p>
        <AnnualCalendar rows={annual} setAside={setAside} busy={toggling} onToggle={toggleMonth} />
      </section>
    </div>
    </SuggestionsProvider>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="hint">{hint}</div>
    </div>
  )
}

interface CalendarProps {
  rows: Row[]
  setAside: number
  busy: boolean
  onToggle: (row: Row, month: number) => void
}

function AnnualCalendar({ rows, setAside, busy, onToggle }: CalendarProps) {
  const { t, fmt } = useI18n()
  const currentMonth = new Date().getMonth() + 1

  const lines = useMemo(
    () =>
      rows
        .map((row) => {
          const months = parseMonths(row.dueMonths)
          return { row, months, due: instalments(num(row.annualAmount), months) }
        })
        // Earliest payment first; costs without a month go last.
        .sort((a, b) => (a.months[0] ?? 13) - (b.months[0] ?? 13) || String(a.row.item).localeCompare(String(b.row.item))),
    [rows],
  )

  const totals = MONTHS.map((m) => round2(lines.reduce((s, l) => s + (l.due.get(m) ?? 0), 0)))

  // A reserve fed with the monthly set-aside from January and drawn down by each
  // payment. Where it dips below zero the set-aside alone is not enough in time.
  const reserve: number[] = []
  let balance = 0
  for (const due of totals) {
    balance = round2(balance + setAside - due)
    reserve.push(balance)
  }
  const lowest = Math.min(0, ...reserve)

  // The next month (this one included) with something to pay, wrapping into next year.
  const next = MONTHS.map((_, i) => ((currentMonth - 1 + i) % 12) + 1).find((m) => totals[m - 1] > 0)
  const unscheduled = lines.filter((l) => l.months.length === 0).length

  if (rows.length === 0) return <div className="card empty">{t('fixed.noAnnual')}</div>

  return (
    <>
      <div className="pill-row" style={{ marginBottom: 12 }}>
        {next && (
          <span className="badge info">
            {t('fixed.next', { month: fmt.monthName(next, 'long'), amount: fmt.eur(totals[next - 1]) })}
          </span>
        )}
        <span className={`badge ${lowest < 0 ? 'warn' : 'ok'}`}>
          {lowest < 0
            ? t('fixed.reserveShort', { amount: fmt.eur(setAside), buffer: fmt.eur(-lowest) })
            : t('fixed.reserveOk', { amount: fmt.eur(setAside) })}
        </span>
      </div>

      {unscheduled > 0 && <div className="alert warn">{t('fixed.noMonthsNotice', { count: unscheduled })}</div>}

      <div className="table-wrap">
        <table className="calendar">
          <thead>
            <tr>
              <th>{t('field.item')}</th>
              {MONTHS.map((m) => (
                <th key={m} className={`num${m === currentMonth ? ' now' : ''}`} title={fmt.monthName(m, 'long')}>
                  {fmt.monthName(m).replace('.', '')}
                </th>
              ))}
              <th className="num">{t('common.total')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ row, months, due }) => (
              <tr key={row.id}>
                <td className="cal-item">
                  <span>{String(row.item)}</span>
                  {months.length === 0 && <span className="badge warn">{t('fixed.noMonths')}</span>}
                </td>
                {MONTHS.map((m) => {
                  const amount = due.get(m)
                  return (
                    <td key={m} className={`num cal-cell${amount !== undefined ? ' due' : ''}${m === currentMonth ? ' now' : ''}`}>
                      <button
                        type="button"
                        disabled={busy}
                        aria-pressed={amount !== undefined}
                        title={t('fixed.toggleMonth', { month: fmt.monthName(m, 'long'), item: String(row.item) })}
                        onClick={() => onToggle(row, m)}
                      >
                        {amount !== undefined ? fmt.eur(amount) : ''}
                      </button>
                    </td>
                  )
                })}
                <td className="num">{fmt.eur(num(row.annualAmount))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{t('fixed.monthTotal')}</td>
              {totals.map((v, i) => (
                <td key={i} className={`num${i + 1 === currentMonth ? ' now' : ''}`}>{v > 0 ? fmt.eur(v) : '—'}</td>
              ))}
              <td className="num">{fmt.eur(round2(totals.reduce((a, b) => a + b, 0)))}</td>
            </tr>
            <tr className="reserve">
              <td title={t('fixed.reserveHint', { amount: fmt.eur(setAside) })}>{t('fixed.reserve')} ⓘ</td>
              {reserve.map((v, i) => (
                <td key={i} className={`num${v < 0 ? ' neg' : ''}${i + 1 === currentMonth ? ' now' : ''}`}>{fmt.eur(v)}</td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  )
}

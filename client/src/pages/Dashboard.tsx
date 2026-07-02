import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../api'
import { eur, monthLabel, pct } from '../format'
import type { Dashboard as DashboardDto, NamedValue } from '../types'

const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5']
const compact = (v: number) => new Intl.NumberFormat('pt-PT', { notation: 'compact' }).format(v)
const money = (v: number | string) => eur(Number(v))

export default function Dashboard() {
  const [data, setData] = useState<DashboardDto | null>(null)
  const [year, setYear] = useState<number | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const q = year === 'all' ? '' : `?year=${year}`
    api.get<DashboardDto>(`dashboard/summary${q}`)
      .then((d) => { setData(d); setError(null) })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [year])

  if (loading && !data) return <p className="muted">Loading dashboard…</p>
  if (error) return <div className="alert err">{error}</div>
  if (!data) return null

  const isEmpty = data.months.length === 0 && data.netWorthTrend.length === 0
  if (isEmpty) {
    return (
      <div>
        <h1 className="page-title">🏠 Dashboard</h1>
        <div className="card empty">
          <h3>No data yet</h3>
          <p>Import your <strong>Finance.xlsx</strong> (once the password is removed) or a JSON backup to see your reports and charts.</p>
          <Link className="btn primary" to="/import" style={{ display: 'inline-block', marginTop: 12 }}>Go to Import →</Link>
        </div>
      </div>
    )
  }

  const months = data.months.map((m) => ({ ...m, label: monthLabel(m.month) }))
  const expenseCats = topN(data.expenseByCategory, 8)

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1 className="page-title" style={{ marginBottom: 0 }}>🏠 Dashboard</h1>
          <p className="page-sub" style={{ margin: 0 }}>Income, spending, net worth and debt at a glance.</p>
        </div>
        <div className="spacer" />
        <label className="muted" style={{ fontSize: 13 }}>Period&nbsp;</label>
        <select value={String(year)} onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All years</option>
          {data.availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* KPIs */}
      <div className="grid kpi-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Income" value={eur(data.totalIncome)} tone="green" />
        <Kpi label="Expenses" value={eur(data.totalExpenses)} tone="red" />
        <Kpi label="Net" value={eur(data.net)} tone={data.net >= 0 ? 'green' : 'red'} hint={`Savings rate ${pct(data.savingsRatePct)}`} />
        <Kpi label="Fixed / month" value={eur(data.fixedMonthly)} hint="Recurring commitments" />
        <Kpi label="Net worth" value={eur(data.latestNetWorth)} hint="Latest snapshot" />
        <Kpi label="Total debt" value={eur(data.totalDebt)} tone="red" hint="Latest snapshot" />
      </div>

      {/* Charts */}
      <div className="grid chart-grid">
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3 className="chart-title">Monthly income vs expenses</h3>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={months} margin={{ left: 6, right: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis tickFormatter={compact} fontSize={12} />
              <Tooltip formatter={money} />
              <Legend />
              <Bar dataKey="income" name="Income" fill="#16a34a" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill="#dc2626" radius={[3, 3, 0, 0]} />
              <Line dataKey="net" name="Net" stroke="#2563eb" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="chart-title">Expenses by category</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={expenseCats} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                {expenseCats.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={money} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="chart-title">Expenses by source</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topN(data.expenseBySource, 8)} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis type="number" tickFormatter={compact} fontSize={12} />
              <YAxis type="category" dataKey="name" width={110} fontSize={12} />
              <Tooltip formatter={money} />
              <Bar dataKey="value" name="Spent" fill="#7c3aed" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="chart-title">Net worth over time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data.netWorthTrend} margin={{ left: 6, right: 6 }}>
              <defs>
                <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis tickFormatter={compact} fontSize={12} />
              <Tooltip formatter={money} />
              <Area dataKey="value" name="Net worth" stroke="#2563eb" strokeWidth={2} fill="url(#nw)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="chart-title">Debt over time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.debtTrend} margin={{ left: 6, right: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis tickFormatter={compact} fontSize={12} />
              <Tooltip formatter={money} />
              <Line dataKey="value" name="Outstanding" stroke="#dc2626" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: 'green' | 'red'; hint?: string }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className={'value' + (tone ? ' ' + tone : '')}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

/** Keep the largest N slices, roll the rest into "Other". */
function topN(items: NamedValue[], n: number): NamedValue[] {
  if (items.length <= n) return items
  const top = items.slice(0, n)
  const rest = items.slice(n).reduce((s, x) => s + x.value, 0)
  return rest > 0 ? [...top, { name: 'Other', value: Math.round(rest * 100) / 100 }] : top
}

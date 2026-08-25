import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../api'
import { useI18n } from '../i18n'
import type { Dashboard as DashboardDto, NamedValue } from '../types'

const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5']

export default function Dashboard() {
  const { t, fmt } = useI18n()
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

  const money = (v: number | string) => fmt.eur(Number(v))

  if (loading && !data) return <p className="muted">{t('dashboard.loading')}</p>
  if (error) return <div className="alert err">{error}</div>
  if (!data) return null

  const isEmpty = data.months.length === 0 && data.netWorthTrend.length === 0
  if (isEmpty) {
    return (
      <div>
        <h1 className="page-title">🏠 {t('dashboard.title')}</h1>
        <div className="card empty">
          <h3>{t('dashboard.empty.title')}</h3>
          <p>{t('dashboard.empty.body')}</p>
          <Link className="btn primary" to="/import" style={{ display: 'inline-block', marginTop: 12 }}>
            {t('dashboard.empty.cta')}
          </Link>
        </div>
      </div>
    )
  }

  const months = data.months.map((m) => ({ ...m, label: fmt.monthLabel(m.month) }))
  const expenseCats = topN(data.expenseByCategory, 8, t('common.other'))

  return (
    <div>
      <div className="toolbar">
        <div>
          <h1 className="page-title" style={{ marginBottom: 0 }}>🏠 {t('dashboard.title')}</h1>
          <p className="page-sub" style={{ margin: 0 }}>{t('dashboard.subtitle')}</p>
        </div>
        <div className="spacer" />
        <label className="muted" style={{ fontSize: 13 }}>{t('dashboard.period')}&nbsp;</label>
        <select value={String(year)} onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">{t('dashboard.allYears')}</option>
          {data.availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* KPIs */}
      <div className="grid kpi-grid" style={{ marginBottom: 20 }}>
        <Kpi label={t('kpi.income')} value={fmt.eur(data.totalIncome)} tone="green" />
        <Kpi label={t('kpi.expenses')} value={fmt.eur(data.totalExpenses)} tone="red" />
        <Kpi
          label={t('kpi.net')}
          value={fmt.eur(data.net)}
          tone={data.net >= 0 ? 'green' : 'red'}
          hint={t('kpi.savingsRate', { rate: fmt.pct(data.savingsRatePct) })}
        />
        <Kpi label={t('kpi.fixedMonthly')} value={fmt.eur(data.fixedMonthly)} hint={t('kpi.recurring')} />
        <Kpi label={t('kpi.netWorth')} value={fmt.eur(data.latestNetWorth)} hint={t('kpi.latestSnapshot')} />
        <Kpi label={t('kpi.totalDebt')} value={fmt.eur(data.totalDebt)} tone="red" hint={t('kpi.latestSnapshot')} />
      </div>

      {/* Charts */}
      <div className="grid chart-grid">
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3 className="chart-title">{t('chart.monthlyIncomeVsExpenses')}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={months} margin={{ left: 6, right: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis tickFormatter={fmt.compact} fontSize={12} />
              <Tooltip formatter={money} />
              <Legend />
              <Bar dataKey="income" name={t('series.income')} fill="#16a34a" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenses" name={t('series.expenses')} fill="#dc2626" radius={[3, 3, 0, 0]} />
              <Line dataKey="net" name={t('series.net')} stroke="#2563eb" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="chart-title">{t('chart.expensesByCategory')}</h3>
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
          <h3 className="chart-title">{t('chart.expensesBySource')}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topN(data.expenseBySource, 8, t('common.other'))} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis type="number" tickFormatter={fmt.compact} fontSize={12} />
              <YAxis type="category" dataKey="name" width={110} fontSize={12} />
              <Tooltip formatter={money} />
              <Bar dataKey="value" name={t('series.spent')} fill="#7c3aed" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="chart-title">{t('chart.netWorthOverTime')}</h3>
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
              <YAxis tickFormatter={fmt.compact} fontSize={12} />
              <Tooltip formatter={money} />
              <Area dataKey="value" name={t('series.netWorth')} stroke="#2563eb" strokeWidth={2} fill="url(#nw)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="chart-title">{t('chart.debtOverTime')}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.debtTrend} margin={{ left: 6, right: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis tickFormatter={fmt.compact} fontSize={12} />
              <Tooltip formatter={money} />
              <Line dataKey="value" name={t('series.outstanding')} stroke="#dc2626" strokeWidth={2} dot={false} />
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

/** Keep the largest N slices, roll the rest into a translated "Other". */
function topN(items: NamedValue[], n: number, otherLabel: string): NamedValue[] {
  if (items.length <= n) return items
  const top = items.slice(0, n)
  const rest = items.slice(n).reduce((s, x) => s + x.value, 0)
  return rest > 0 ? [...top, { name: otherLabel, value: Math.round(rest * 100) / 100 }] : top
}

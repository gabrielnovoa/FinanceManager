// Shapes returned by the .NET API (System.Text.Json emits camelCase).

export interface Expense {
  id: number
  date: string // yyyy-MM-dd
  item: string
  amount: number
  category: string
  source: string
}

export type Income = Expense // identical shape

export interface FixedCost {
  id: number
  type: string
  category: string
  item: string
  monthlyAmount: number
  annualAmount: number
}

export interface Debt {
  id: number
  date: string
  item: string
  installment: number
  outstanding: number
  termMonths: number | null
  interest: number
}

export interface NetWorthEntry {
  id: number
  date: string
  liquidity: string
  assetClass: string
  item: string
  value: number
}

export interface Investment {
  id: number
  date: string
  origin: string
  destination: string
  amount: number
}

export interface BankAccount {
  id: number
  name: string
  iban: string
  swift: string
}

export interface NamedValue { name: string; value: number }
export interface DatePoint { date: string; value: number }
export interface MonthPoint { month: string; income: number; expenses: number; net: number }

export interface Dashboard {
  totalIncome: number
  totalExpenses: number
  net: number
  savingsRatePct: number
  fixedMonthly: number
  latestNetWorth: number
  totalDebt: number
  availableYears: number[]
  months: MonthPoint[]
  expenseByCategory: NamedValue[]
  incomeByCategory: NamedValue[]
  expenseBySource: NamedValue[]
  netWorthTrend: DatePoint[]
  debtTrend: DatePoint[]
}

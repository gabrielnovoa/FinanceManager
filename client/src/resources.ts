// Declarative definition of every data table. Each page is just one of these
// configs handed to <ResourcePage>, so adding a new table is a few lines here.
// Labels are translation keys rather than literal text — see src/i18n.

import type { TranslationKey } from './i18n/translations'

export type FieldType = 'text' | 'money' | 'number' | 'int' | 'date' | 'select' | 'months'

export interface FieldOption {
  value: string
  labelKey: TranslationKey
}

export interface Field {
  key: string
  labelKey: TranslationKey
  type: FieldType
  required?: boolean
  /** Derived on the server from other columns — shown, but never editable. */
  computed?: boolean
  /** Choices for a 'select' field. */
  options?: FieldOption[]
  /** Offer autocomplete from the category list, the source list, or the items already used. */
  suggest?: SuggestKind
}

export type SuggestKind = 'category' | 'source' | 'item'

export interface Resource {
  key: string        // URL segment, e.g. "expenses"
  endpoint: string   // API path, e.g. "expenses"
  titleKey: TranslationKey
  subtitleKey: TranslationKey
  icon: string
  fields: Field[]
  /** Column whose sum is shown in the table footer. */
  totalField?: string
  /** Date column to group rows by month/year. Omit to disable grouping. */
  groupBy?: string
  /** Enables the "repeat last month" bulk add. Omit for one-off tables. */
  replicate?: Replicate
  defaults: () => Record<string, unknown>
}

/**
 * Some tables are filled in with the same handful of rows every month — the
 * account balances on the 1st, the standing transfers mid-month. Rather than
 * retyping them, we copy last month's rows forward and let the user adjust.
 */
export interface Replicate {
  /** Date column the monthly grouping is based on. */
  dateField: string
  /** Columns that identify a recurring row; copied across unchanged. */
  keyFields: string[]
  /** Editable numeric columns carried over — each gets its own column and total. */
  valueFields: string[]
  /**
   * 'firstOfMonth' pins every copied row to day 1 (net worth snapshots);
   * 'sameDay'      keeps the day each row had last month (standing transfers).
   */
  dayMode: 'firstOfMonth' | 'sameDay'
}

const today = () => new Date().toISOString().slice(0, 10)

/** How often a fixed cost is charged — mirrors the server's CostFrequency enum. */
export const frequencyOptions: FieldOption[] = [
  { value: 'Monthly', labelKey: 'freq.monthly' },
  { value: 'Annual', labelKey: 'freq.annual' },
]

export const resources: Record<string, Resource> = {
  expenses: {
    key: 'expenses',
    endpoint: 'expenses',
    titleKey: 'res.expenses.title',
    subtitleKey: 'res.expenses.subtitle',
    icon: '💸',
    totalField: 'amount',
    groupBy: 'date',
    fields: [
      { key: 'date', labelKey: 'field.date', type: 'date', required: true },
      { key: 'item', labelKey: 'field.item', type: 'text', required: true, suggest: 'item' },
      { key: 'amount', labelKey: 'field.amount', type: 'money', required: true },
      { key: 'category', labelKey: 'field.category', type: 'text', required: true, suggest: 'category' },
      { key: 'source', labelKey: 'field.source', type: 'text', suggest: 'source' },
    ],
    defaults: () => ({ date: today(), item: '', amount: 0, category: '', source: '' }),
  },
  income: {
    key: 'income',
    endpoint: 'income',
    titleKey: 'res.income.title',
    subtitleKey: 'res.income.subtitle',
    icon: '💰',
    totalField: 'amount',
    groupBy: 'date',
    fields: [
      { key: 'date', labelKey: 'field.date', type: 'date', required: true },
      { key: 'item', labelKey: 'field.item', type: 'text', required: true, suggest: 'item' },
      { key: 'amount', labelKey: 'field.amount', type: 'money', required: true },
      { key: 'category', labelKey: 'field.category', type: 'text', required: true, suggest: 'category' },
      { key: 'source', labelKey: 'field.source', type: 'text', suggest: 'source' },
    ],
    defaults: () => ({ date: today(), item: '', amount: 0, category: '', source: '' }),
  },
  fixedcosts: {
    key: 'fixedcosts',
    endpoint: 'fixedcosts',
    titleKey: 'res.fixedcosts.title',
    subtitleKey: 'res.fixedcosts.subtitle',
    icon: '📌',
    totalField: 'monthlyAmount',
    // The full row. The page itself (pages/FixedCosts.tsx) splits it into a monthly
    // and an annual table, each showing only the columns that matter there.
    fields: [
      { key: 'type', labelKey: 'field.type', type: 'text' },
      { key: 'category', labelKey: 'field.category', type: 'text', required: true, suggest: 'category' },
      { key: 'item', labelKey: 'field.item', type: 'text', required: true, suggest: 'item' },
      { key: 'frequency', labelKey: 'field.frequency', type: 'select', options: frequencyOptions },
      { key: 'dueMonths', labelKey: 'field.dueMonths', type: 'months' },
      { key: 'monthlyAmount', labelKey: 'field.monthlyAmount', type: 'money' },
      { key: 'annualAmount', labelKey: 'field.annualAmount', type: 'money' },
    ],
    defaults: () => ({
      type: 'Conta Fixa', category: '', item: '', frequency: 'Monthly', dueMonths: [], monthlyAmount: 0, annualAmount: 0,
    }),
  },
  debts: {
    key: 'debts',
    endpoint: 'debts',
    titleKey: 'res.debts.title',
    subtitleKey: 'res.debts.subtitle',
    icon: '🏦',
    totalField: 'outstanding',
    groupBy: 'date',
    fields: [
      { key: 'date', labelKey: 'field.date', type: 'date', required: true },
      { key: 'item', labelKey: 'field.item', type: 'text', required: true },
      { key: 'installment', labelKey: 'field.installment', type: 'money' },
      { key: 'outstanding', labelKey: 'field.outstanding', type: 'money', required: true },
      { key: 'termMonths', labelKey: 'field.termMonths', type: 'int', computed: true },
      { key: 'interest', labelKey: 'field.interest', type: 'money', computed: true },
    ],
    defaults: () => ({ date: today(), item: '', installment: 0, outstanding: 0 }),
    replicate: {
      dateField: 'date',
      keyFields: ['item'],
      // Prazo/Juros are derived server-side, so only these two are carried over.
      valueFields: ['installment', 'outstanding'],
      dayMode: 'firstOfMonth', // debt snapshots are taken on the 1st
    },
  },
  networth: {
    key: 'networth',
    endpoint: 'networth',
    titleKey: 'res.networth.title',
    subtitleKey: 'res.networth.subtitle',
    icon: '📈',
    totalField: 'value',
    groupBy: 'date',
    fields: [
      { key: 'date', labelKey: 'field.date', type: 'date', required: true },
      { key: 'liquidity', labelKey: 'field.liquidity', type: 'text' },
      { key: 'assetClass', labelKey: 'field.assetClass', type: 'text', required: true },
      { key: 'item', labelKey: 'field.item', type: 'text', required: true },
      { key: 'value', labelKey: 'field.value', type: 'money', required: true },
    ],
    replicate: {
      dateField: 'date',
      keyFields: ['liquidity', 'assetClass', 'item'],
      valueFields: ['value'],
      dayMode: 'firstOfMonth', // balances are always taken on the 1st
    },
    defaults: () => ({ date: today(), liquidity: 'Alta', assetClass: '', item: '', value: 0 }),
  },
  investments: {
    key: 'investments',
    endpoint: 'investments',
    titleKey: 'res.investments.title',
    subtitleKey: 'res.investments.subtitle',
    icon: '🪙',
    totalField: 'amount',
    groupBy: 'date',
    fields: [
      { key: 'date', labelKey: 'field.date', type: 'date', required: true },
      { key: 'origin', labelKey: 'field.origin', type: 'text', required: true },
      { key: 'destination', labelKey: 'field.destination', type: 'text', required: true },
      { key: 'amount', labelKey: 'field.amount', type: 'money', required: true },
    ],
    replicate: {
      dateField: 'date',
      keyFields: ['origin', 'destination'],
      valueFields: ['amount'],
      dayMode: 'sameDay', // standing transfers land on the same day each month
    },
    defaults: () => ({ date: today(), origin: '', destination: '', amount: 0 }),
  },
  accounts: {
    key: 'accounts',
    endpoint: 'accounts',
    titleKey: 'res.accounts.title',
    subtitleKey: 'res.accounts.subtitle',
    icon: '💳',
    fields: [
      { key: 'name', labelKey: 'field.name', type: 'text', required: true },
      { key: 'iban', labelKey: 'field.iban', type: 'text' },
      { key: 'swift', labelKey: 'field.swift', type: 'text' },
    ],
    defaults: () => ({ name: '', iban: '', swift: '' }),
  },
}

export const resourceList = Object.values(resources)

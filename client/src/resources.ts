// Declarative definition of every data table. Each page is just one of these
// configs handed to <ResourcePage>, so adding a new table is a few lines here.
// Labels are translation keys rather than literal text — see src/i18n.

import type { TranslationKey } from './i18n/translations'

export type FieldType = 'text' | 'money' | 'number' | 'int' | 'date'

export interface Field {
  key: string
  labelKey: TranslationKey
  type: FieldType
  required?: boolean
}

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
  defaults: () => Record<string, unknown>
}

const today = () => new Date().toISOString().slice(0, 10)

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
      { key: 'item', labelKey: 'field.item', type: 'text', required: true },
      { key: 'amount', labelKey: 'field.amount', type: 'money', required: true },
      { key: 'category', labelKey: 'field.category', type: 'text', required: true },
      { key: 'source', labelKey: 'field.source', type: 'text' },
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
      { key: 'item', labelKey: 'field.item', type: 'text', required: true },
      { key: 'amount', labelKey: 'field.amount', type: 'money', required: true },
      { key: 'category', labelKey: 'field.category', type: 'text', required: true },
      { key: 'source', labelKey: 'field.source', type: 'text' },
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
    fields: [
      { key: 'type', labelKey: 'field.type', type: 'text' },
      { key: 'category', labelKey: 'field.category', type: 'text', required: true },
      { key: 'item', labelKey: 'field.item', type: 'text', required: true },
      { key: 'monthlyAmount', labelKey: 'field.monthlyAmount', type: 'money', required: true },
      { key: 'annualAmount', labelKey: 'field.annualAmount', type: 'money' },
    ],
    defaults: () => ({ type: 'Conta Fixa', category: '', item: '', monthlyAmount: 0, annualAmount: 0 }),
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
      { key: 'termMonths', labelKey: 'field.termMonths', type: 'int' },
      { key: 'interest', labelKey: 'field.interest', type: 'money' },
    ],
    defaults: () => ({ date: today(), item: '', installment: 0, outstanding: 0, termMonths: 0, interest: 0 }),
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

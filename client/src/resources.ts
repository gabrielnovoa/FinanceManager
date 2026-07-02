// Declarative definition of every data table. Each page is just one of these
// configs handed to <ResourcePage>, so adding a new table is a few lines here.

export type FieldType = 'text' | 'money' | 'number' | 'int' | 'date'

export interface Field {
  key: string
  label: string
  type: FieldType
  required?: boolean
}

export interface Resource {
  key: string        // URL segment, e.g. "expenses"
  endpoint: string   // API path, e.g. "expenses"
  title: string
  subtitle: string
  icon: string
  fields: Field[]
  /** Column whose sum is shown in the table footer. */
  totalField?: string
  defaults: () => Record<string, unknown>
}

const today = () => new Date().toISOString().slice(0, 10)

export const resources: Record<string, Resource> = {
  expenses: {
    key: 'expenses',
    endpoint: 'expenses',
    title: 'Expenses',
    subtitle: 'Every outgoing transaction — add or remove entries.',
    icon: '💸',
    totalField: 'amount',
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'money', required: true },
      { key: 'category', label: 'Category', type: 'text', required: true },
      { key: 'source', label: 'Source', type: 'text' },
    ],
    defaults: () => ({ date: today(), item: '', amount: 0, category: '', source: '' }),
  },
  income: {
    key: 'income',
    endpoint: 'income',
    title: 'Income',
    subtitle: 'Salary, refunds, cashback and other money in.',
    icon: '💰',
    totalField: 'amount',
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'money', required: true },
      { key: 'category', label: 'Category', type: 'text', required: true },
      { key: 'source', label: 'Source', type: 'text' },
    ],
    defaults: () => ({ date: today(), item: '', amount: 0, category: '', source: '' }),
  },
  fixedcosts: {
    key: 'fixedcosts',
    endpoint: 'fixedcosts',
    title: 'Fixed Costs',
    subtitle: 'Recurring monthly commitments and their yearly weight.',
    icon: '📌',
    totalField: 'monthlyAmount',
    fields: [
      { key: 'type', label: 'Type', type: 'text' },
      { key: 'category', label: 'Category', type: 'text', required: true },
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'monthlyAmount', label: 'Monthly', type: 'money', required: true },
      { key: 'annualAmount', label: 'Annual', type: 'money' },
    ],
    defaults: () => ({ type: 'Conta Fixa', category: '', item: '', monthlyAmount: 0, annualAmount: 0 }),
  },
  debts: {
    key: 'debts',
    endpoint: 'debts',
    title: 'Debts',
    subtitle: 'Monthly snapshots of what you owe.',
    icon: '🏦',
    totalField: 'outstanding',
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'installment', label: 'Installment', type: 'money' },
      { key: 'outstanding', label: 'Outstanding', type: 'money', required: true },
      { key: 'termMonths', label: 'Term (months)', type: 'int' },
      { key: 'interest', label: 'Interest', type: 'money' },
    ],
    defaults: () => ({ date: today(), item: '', installment: 0, outstanding: 0, termMonths: 0, interest: 0 }),
  },
  networth: {
    key: 'networth',
    endpoint: 'networth',
    title: 'Net Worth',
    subtitle: 'Asset snapshots by class and liquidity.',
    icon: '📈',
    totalField: 'value',
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'liquidity', label: 'Liquidity', type: 'text' },
      { key: 'assetClass', label: 'Asset Class', type: 'text', required: true },
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'value', label: 'Value', type: 'money', required: true },
    ],
    defaults: () => ({ date: today(), liquidity: 'Alta', assetClass: '', item: '', value: 0 }),
  },
  investments: {
    key: 'investments',
    endpoint: 'investments',
    title: 'Investments',
    subtitle: 'Contributions and transfers into your holdings.',
    icon: '🪙',
    totalField: 'amount',
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'origin', label: 'Origin', type: 'text', required: true },
      { key: 'destination', label: 'Destination', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'money', required: true },
    ],
    defaults: () => ({ date: today(), origin: '', destination: '', amount: 0 }),
  },
  accounts: {
    key: 'accounts',
    endpoint: 'accounts',
    title: 'Bank Accounts',
    subtitle: 'Reference list of your accounts.',
    icon: '💳',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'iban', label: 'IBAN', type: 'text' },
      { key: 'swift', label: 'SWIFT', type: 'text' },
    ],
    defaults: () => ({ name: '', iban: '', swift: '' }),
  },
}

export const resourceList = Object.values(resources)

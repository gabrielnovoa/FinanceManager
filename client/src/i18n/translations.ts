// Every user-facing string in the app lives here, keyed the same way in each
// language. `en` is the source of truth: `pt` is typed against it, so a missing
// or misspelled Portuguese key is a compile error rather than a runtime blank.

export const languages = {
  en: { label: 'English', flag: '🇬🇧', locale: 'en-GB' },
  pt: { label: 'Português', flag: '🇵🇹', locale: 'pt-PT' },
} as const

export type Language = keyof typeof languages

export const en = {
  // ---- Navigation / shell ----
  'nav.dashboard': 'Dashboard',
  'nav.importExport': 'Import / Export',
  'layout.footer': 'Finance Manager · runs locally & on Azure',
  'lang.label': 'Language',

  // ---- Shared ----
  'common.other': 'Other',
  'common.loading': 'Loading…',
  'common.saving': 'Saving…',
  'common.add': '+ Add',
  'common.refresh': '↻ Refresh',
  'common.actions': 'Actions',
  'common.delete': 'Delete',
  'common.total': 'Total',
  'common.entryCount': '{count} entry',
  'common.entryCountPlural': '{count} entries',
  'common.confirmDelete': 'Delete this entry? This cannot be undone.',
  'common.noEntries': 'No entries yet — add one above, or use Import.',

  // ---- Table: sorting / filtering / grouping ----
  'table.groupByMonth': 'Group by month',
  'table.expandAll': 'Expand all',
  'table.collapseAll': 'Collapse all',
  'table.clearFilters': 'Clear filters',
  'table.filterPlaceholder': 'Filter…',
  'table.filterNumPlaceholder': '> 100',
  'table.filterDatePlaceholder': '2025-03',
  'table.filterAria': 'Filter by {column}',
  'table.sortAria': 'Sort by {column}',
  'table.noDate': 'Undated',
  'table.noMatches': 'No entries match your filters.',
  'table.showingOf': '{shown} of {total} shown',
  'table.subtotal': 'Subtotal',
  'table.expandGroup': 'Expand {group}',
  'table.collapseGroup': 'Collapse {group}',

  // ---- Dashboard ----
  'dashboard.title': 'Dashboard',
  'dashboard.subtitle': 'Income, spending, net worth and debt at a glance.',
  'dashboard.loading': 'Loading dashboard…',
  'dashboard.period': 'Period',
  'dashboard.allYears': 'All years',
  'dashboard.empty.title': 'No data yet',
  'dashboard.empty.body':
    'Import your Finance.xlsx spreadsheet or a JSON backup to see your reports and charts.',
  'dashboard.empty.cta': 'Go to Import →',

  'kpi.income': 'Income',
  'kpi.expenses': 'Expenses',
  'kpi.net': 'Net',
  'kpi.fixedMonthly': 'Fixed / month',
  'kpi.netWorth': 'Net worth',
  'kpi.totalDebt': 'Total debt',
  'kpi.savingsRate': 'Savings rate {rate}',
  'kpi.recurring': 'Recurring commitments',
  'kpi.latestSnapshot': 'Latest snapshot',

  'chart.monthlyIncomeVsExpenses': 'Monthly income vs expenses',
  'chart.expensesByCategory': 'Expenses by category',
  'chart.expensesBySource': 'Expenses by source',
  'chart.netWorthOverTime': 'Net worth over time',
  'chart.debtOverTime': 'Debt over time',
  'series.income': 'Income',
  'series.expenses': 'Expenses',
  'series.net': 'Net',
  'series.spent': 'Spent',
  'series.netWorth': 'Net worth',
  'series.outstanding': 'Outstanding',

  // ---- Import / Export ----
  'import.title': 'Import / Export',
  'import.subtitle': 'Load your spreadsheet, restore a backup, or export everything.',
  'import.excel.title': '📥 Import from Excel',
  'import.excel.body':
    'Upload your Finance.xlsx. Matching sheets (Despesas, Receitas, Gastos Fixos, Dívidas, Patrimônio, Investimentos, Contas Bancárias) replace the current data.',
  'import.excel.note':
    'The file must not be password-protected. In Excel: File → Info → Protect Workbook → Encrypt with Password, clear the box, and save.',
  'import.json.title': '🗂️ Import / Export JSON',
  'import.json.body': 'Restore a JSON backup, or download everything currently in the app.',
  'import.json.export': '⬇ Export backup (JSON)',
  'import.json.restore': 'Restore from JSON:',
  'import.danger.title': '🧹 Danger zone',
  'import.danger.body': 'Clear everything and start fresh. Export a backup first.',
  'import.danger.button': 'Delete all data',
  'import.confirmReset': 'Delete ALL data from the app database? Export a backup first if unsure.',
  'import.result': '{message} Loaded {parts}.',
  'import.resultNothing': 'nothing',
  'import.backupDownloaded': 'Backup downloaded.',
  'import.allCleared': 'All data cleared.',
  'import.exportFailed': 'Export failed',

  // ---- Resource pages ----
  'res.expenses.title': 'Expenses',
  'res.expenses.subtitle': 'Every outgoing transaction — add or remove entries.',
  'res.income.title': 'Income',
  'res.income.subtitle': 'Salary, refunds, cashback and other money in.',
  'res.fixedcosts.title': 'Fixed Costs',
  'res.fixedcosts.subtitle': 'Recurring monthly commitments and their yearly weight.',
  'res.debts.title': 'Debts',
  'res.debts.subtitle': 'Monthly snapshots of what you owe.',
  'res.networth.title': 'Net Worth',
  'res.networth.subtitle': 'Asset snapshots by class and liquidity.',
  'res.investments.title': 'Investments',
  'res.investments.subtitle': 'Contributions and transfers into your holdings.',
  'res.accounts.title': 'Bank Accounts',
  'res.accounts.subtitle': 'Reference list of your accounts.',

  // ---- Field labels ----
  'field.date': 'Date',
  'field.item': 'Item',
  'field.amount': 'Amount',
  'field.category': 'Category',
  'field.source': 'Source',
  'field.type': 'Type',
  'field.monthlyAmount': 'Monthly',
  'field.annualAmount': 'Annual',
  'field.installment': 'Installment',
  'field.outstanding': 'Outstanding',
  'field.termMonths': 'Term (months)',
  'field.interest': 'Interest',
  'field.liquidity': 'Liquidity',
  'field.assetClass': 'Asset Class',
  'field.value': 'Value',
  'field.origin': 'Origin',
  'field.destination': 'Destination',
  'field.name': 'Name',
  'field.iban': 'IBAN',
  'field.swift': 'SWIFT',
}

export type TranslationKey = keyof typeof en

export const pt: Record<TranslationKey, string> = {
  // ---- Navegação / estrutura ----
  'nav.dashboard': 'Painel',
  'nav.importExport': 'Importar / Exportar',
  'layout.footer': 'Finance Manager · corre localmente e no Azure',
  'lang.label': 'Idioma',

  // ---- Comum ----
  'common.other': 'Outros',
  'common.loading': 'A carregar…',
  'common.saving': 'A guardar…',
  'common.add': '+ Adicionar',
  'common.refresh': '↻ Atualizar',
  'common.actions': 'Ações',
  'common.delete': 'Eliminar',
  'common.total': 'Total',
  'common.entryCount': '{count} registo',
  'common.entryCountPlural': '{count} registos',
  'common.confirmDelete': 'Eliminar este registo? Esta ação não pode ser anulada.',
  'common.noEntries': 'Ainda não há registos — adicione um acima ou use a importação.',

  // ---- Tabela: ordenação / filtros / agrupamento ----
  'table.groupByMonth': 'Agrupar por mês',
  'table.expandAll': 'Expandir tudo',
  'table.collapseAll': 'Recolher tudo',
  'table.clearFilters': 'Limpar filtros',
  'table.filterPlaceholder': 'Filtrar…',
  'table.filterNumPlaceholder': '> 100',
  'table.filterDatePlaceholder': '2025-03',
  'table.filterAria': 'Filtrar por {column}',
  'table.sortAria': 'Ordenar por {column}',
  'table.noDate': 'Sem data',
  'table.noMatches': 'Nenhum registo corresponde aos filtros.',
  'table.showingOf': '{shown} de {total} visíveis',
  'table.subtotal': 'Subtotal',
  'table.expandGroup': 'Expandir {group}',
  'table.collapseGroup': 'Recolher {group}',

  // ---- Painel ----
  'dashboard.title': 'Painel',
  'dashboard.subtitle': 'Receitas, despesas, património e dívida num relance.',
  'dashboard.loading': 'A carregar o painel…',
  'dashboard.period': 'Período',
  'dashboard.allYears': 'Todos os anos',
  'dashboard.empty.title': 'Ainda não há dados',
  'dashboard.empty.body':
    'Importe a sua folha de cálculo Finance.xlsx ou uma cópia de segurança JSON para ver os relatórios e gráficos.',
  'dashboard.empty.cta': 'Ir para Importar →',

  'kpi.income': 'Receitas',
  'kpi.expenses': 'Despesas',
  'kpi.net': 'Saldo',
  'kpi.fixedMonthly': 'Fixos / mês',
  'kpi.netWorth': 'Património',
  'kpi.totalDebt': 'Dívida total',
  'kpi.savingsRate': 'Taxa de poupança {rate}',
  'kpi.recurring': 'Compromissos recorrentes',
  'kpi.latestSnapshot': 'Último registo',

  'chart.monthlyIncomeVsExpenses': 'Receitas vs despesas mensais',
  'chart.expensesByCategory': 'Despesas por categoria',
  'chart.expensesBySource': 'Despesas por origem',
  'chart.netWorthOverTime': 'Evolução do património',
  'chart.debtOverTime': 'Evolução da dívida',
  'series.income': 'Receitas',
  'series.expenses': 'Despesas',
  'series.net': 'Saldo',
  'series.spent': 'Gasto',
  'series.netWorth': 'Património',
  'series.outstanding': 'Em dívida',

  // ---- Importar / Exportar ----
  'import.title': 'Importar / Exportar',
  'import.subtitle':
    'Carregue a sua folha de cálculo, restaure uma cópia de segurança ou exporte tudo.',
  'import.excel.title': '📥 Importar do Excel',
  'import.excel.body':
    'Carregue o seu Finance.xlsx. As folhas correspondentes (Despesas, Receitas, Gastos Fixos, Dívidas, Patrimônio, Investimentos, Contas Bancárias) substituem os dados atuais.',
  'import.excel.note':
    'O ficheiro não pode estar protegido por palavra-passe. No Excel: Ficheiro → Informações → Proteger Livro → Encriptar com Palavra-passe, limpe a caixa e guarde.',
  'import.json.title': '🗂️ Importar / Exportar JSON',
  'import.json.body':
    'Restaure uma cópia de segurança JSON ou descarregue tudo o que está na aplicação.',
  'import.json.export': '⬇ Exportar cópia de segurança (JSON)',
  'import.json.restore': 'Restaurar a partir de JSON:',
  'import.danger.title': '🧹 Zona de perigo',
  'import.danger.body': 'Apague tudo e comece do zero. Exporte primeiro uma cópia de segurança.',
  'import.danger.button': 'Eliminar todos os dados',
  'import.confirmReset':
    'Eliminar TODOS os dados da base de dados da aplicação? Exporte primeiro uma cópia de segurança se tiver dúvidas.',
  'import.result': '{message} Carregado {parts}.',
  'import.resultNothing': 'nada',
  'import.backupDownloaded': 'Cópia de segurança descarregada.',
  'import.allCleared': 'Todos os dados foram eliminados.',
  'import.exportFailed': 'A exportação falhou',

  // ---- Páginas de dados ----
  'res.expenses.title': 'Despesas',
  'res.expenses.subtitle': 'Todas as saídas de dinheiro — adicione ou remova registos.',
  'res.income.title': 'Receitas',
  'res.income.subtitle': 'Salário, reembolsos, cashback e outras entradas de dinheiro.',
  'res.fixedcosts.title': 'Gastos Fixos',
  'res.fixedcosts.subtitle': 'Compromissos mensais recorrentes e o seu peso anual.',
  'res.debts.title': 'Dívidas',
  'res.debts.subtitle': 'Registos mensais do que deve.',
  'res.networth.title': 'Património',
  'res.networth.subtitle': 'Registos de ativos por classe e liquidez.',
  'res.investments.title': 'Investimentos',
  'res.investments.subtitle': 'Contribuições e transferências para os seus investimentos.',
  'res.accounts.title': 'Contas Bancárias',
  'res.accounts.subtitle': 'Lista de referência das suas contas.',

  // ---- Etiquetas dos campos ----
  'field.date': 'Data',
  'field.item': 'Item',
  'field.amount': 'Valor',
  'field.category': 'Categoria',
  'field.source': 'Origem',
  'field.type': 'Tipo',
  'field.monthlyAmount': 'Mensal',
  'field.annualAmount': 'Anual',
  'field.installment': 'Prestação',
  'field.outstanding': 'Em dívida',
  'field.termMonths': 'Prazo (meses)',
  'field.interest': 'Juros',
  'field.liquidity': 'Liquidez',
  'field.assetClass': 'Classe de ativo',
  'field.value': 'Valor',
  'field.origin': 'Origem',
  'field.destination': 'Destino',
  'field.name': 'Nome',
  'field.iban': 'IBAN',
  'field.swift': 'SWIFT',
}

export const dictionaries: Record<Language, Record<TranslationKey, string>> = { en, pt }

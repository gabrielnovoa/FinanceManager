// Autocomplete lists for category, source and item inputs. A page provides them once
// (categories and sources from the server, items from its own rows) and every
// FieldInput below it — add form and inline row editing alike — picks them up.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api'
import type { SuggestKind } from '../resources'
import type { Row } from './DataTable'

export interface Lookup {
  id: number
  name: string
  expenses: number
  incomes: number
  fixedCosts: number
}

export interface Typo {
  kind: 'categories' | 'sources'
  fromId: number
  fromName: string
  fromUses: number
  intoId: number
  intoName: string
  intoUses: number
  reason: 'case' | 'accents' | 'spelling'
}

export interface Lookups {
  categories: Lookup[]
  sources: Lookup[]
  typos?: Typo[]
}

type Suggestions = Partial<Record<SuggestKind, string[]>>

const SuggestionsContext = createContext<Suggestions>({})

export const useSuggestions = (kind: SuggestKind | undefined) => {
  const all = useContext(SuggestionsContext)
  return kind ? all[kind] ?? [] : []
}

/**
 * Provides suggestions for a page. `rows` feeds the item list; `version` refetches
 * the category and source lists, e.g. after a save that may have created one.
 */
export function SuggestionsProvider({ rows, version, children }: { rows: Row[]; version?: unknown; children: ReactNode }) {
  const [lookups, setLookups] = useState<Lookups>({ categories: [], sources: [] })

  useEffect(() => {
    api.get<Lookups>('lookups').then(setLookups).catch(() => { /* autocomplete is a nicety */ })
  }, [version])

  const value = useMemo<Suggestions>(() => {
    const items = new Set<string>()
    for (const r of rows) {
      const item = String(r.item ?? '').trim()
      if (item) items.add(item)
    }
    return {
      category: lookups.categories.map((c) => c.name),
      source: lookups.sources.map((s) => s.name),
      item: [...items].sort((a, b) => a.localeCompare(b)),
    }
  }, [rows, lookups])

  return <SuggestionsContext.Provider value={value}>{children}</SuggestionsContext.Provider>
}

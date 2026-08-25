import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react'
import { createFormatters, type Formatters } from '../format'
import {
  dictionaries, languages, type Language, type TranslationKey,
} from './translations'

const STORAGE_KEY = 'financemanager.language'

/** Saved choice wins; otherwise fall back to the browser, then English. */
function initialLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && saved in languages) return saved as Language
  return navigator.language?.toLowerCase().startsWith('pt') ? 'pt' : 'en'
}

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

interface I18nValue {
  language: Language
  setLanguage: (lang: Language) => void
  t: Translate
  fmt: Formatters
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage)

  // Keep the document in sync so screen readers and browser tooling agree.
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const setLanguage = useCallback((lang: Language) => {
    localStorage.setItem(STORAGE_KEY, lang)
    setLanguageState(lang)
  }, [])

  const t = useCallback<Translate>(
    (key, params) => {
      const template = dictionaries[language][key] ?? dictionaries.en[key] ?? key
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      )
    },
    [language],
  )

  const fmt = useMemo(() => createFormatters(languages[language].locale), [language])

  const value = useMemo(() => ({ language, setLanguage, t, fmt }), [language, setLanguage, t, fmt])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}

export { languages }
export type { Language, TranslationKey }

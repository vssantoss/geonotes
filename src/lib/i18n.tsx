import { createContext, useContext, type ReactNode } from 'react'
import en from '../locales/en.json'
import es from '../locales/es.json'
import pt from '../locales/pt.json'

type Dict = Record<string, string>

const DICTS: Record<string, Dict> = { en, es, pt }

/**
 * Picks the best supported locale from the browser's language preferences.
 *
 * @returns 'en', 'es' or 'pt' (English is the fallback).
 */
export function detectLocale(): string {
  for (const lang of navigator.languages ?? [navigator.language]) {
    const base = lang.slice(0, 2).toLowerCase()
    if (base in DICTS) return base
  }
  return 'en'
}

const I18nContext = createContext<Dict>(DICTS.en)

/**
 * Provides the detected locale's dictionary to the component tree.
 *
 * @param children - app subtree that needs translations.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  return (
    <I18nContext.Provider value={DICTS[detectLocale()]}>
      {children}
    </I18nContext.Provider>
  )
}

/**
 * Hook returning the translate function.
 *
 * @returns t(key, params?) which resolves the key in the active locale and
 *          substitutes `{name}` placeholders from params. Missing keys fall
 *          back to English, then to the key itself.
 */
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const dict = useContext(I18nContext)
  return (key, params) => {
    let out = dict[key] ?? DICTS.en[key] ?? key
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        out = out.replace(`{${name}}`, String(value))
      }
    }
    return out
  }
}

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import en from '../locales/en.json'
import es from '../locales/es.json'
import pt from '../locales/pt.json'

type Dict = Record<string, string>

const DICTS: Record<string, Dict> = { en, es, pt }

/** The locales the app ships dictionaries for, in menu order. */
export const SUPPORTED_LOCALES = ['en', 'es', 'pt'] as const

/** localStorage key holding an explicit language override (device-only). */
const LOCALE_STORAGE_KEY = 'geonotes-locale'

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

/**
 * Reads an explicit, still-supported language override, or null to follow the
 * browser's languages. Guards against a stale value for a locale we no longer
 * ship and against storage being blocked (private browsing).
 *
 * @returns the stored locale, or null to auto-detect.
 */
function readStoredLocale(): string | null {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored && stored in DICTS) return stored
  } catch {
    /* storage blocked: fall back to auto-detection */
  }
  return null
}

const I18nContext = createContext<{
  /** The active locale, whatever its source (override or detected). */
  locale: string
  /** The explicit override, or null when auto-detecting ("System"). */
  choice: string | null
  /** Sets an explicit language override, or null to auto-detect again. */
  setLocale: (locale: string | null) => void
}>({ locale: 'en', choice: null, setLocale: () => {} })

/**
 * Provides the active locale to the component tree. The language is device-only:
 * an explicit choice is persisted in localStorage, otherwise it follows the
 * browser's preferred languages.
 *
 * @param children - app subtree that needs translations.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  // null = auto-detect from the browser; a value = explicit user choice.
  const [choice, setChoiceState] = useState<string | null>(readStoredLocale)
  const locale = choice ?? detectLocale()

  // Keep the document language in sync so the browser and assistive tech read
  // the app in the active language.
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  /** Persists an explicit language, or clears it (null) to auto-detect again. */
  const setLocale = (next: string | null) => {
    try {
      if (next === null) localStorage.removeItem(LOCALE_STORAGE_KEY)
      else localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      /* storage blocked: the choice lives for this session only */
    }
    setChoiceState(next)
  }

  return (
    <I18nContext.Provider value={{ locale, choice, setLocale }}>{children}</I18nContext.Provider>
  )
}

/**
 * Hook exposing the active locale and the language setter.
 *
 * @returns { locale, choice, setLocale } from the nearest I18nProvider.
 */
export function useLocale() {
  return useContext(I18nContext)
}

/**
 * Hook returning the translate function.
 *
 * @returns t(key, params?) which resolves the key in the active locale and
 *          substitutes `{name}` placeholders from params. Missing keys fall
 *          back to English, then to the key itself.
 */
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const { locale } = useContext(I18nContext)
  const dict = DICTS[locale] ?? DICTS.en
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

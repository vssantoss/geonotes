import { createContext, useContext, useState, type ReactNode } from 'react'
import { localeUnits, type UnitSystem } from './geo'
import { useLocale } from './i18n'

/** The distance-unit preference: an explicit system, or 'auto' to follow the language. */
export type UnitsPref = UnitSystem | 'auto'

/** localStorage key holding an explicit distance-unit override (device-only). */
const UNITS_STORAGE_KEY = 'geonotes-units'

/**
 * Reads a stored distance-unit preference, or 'auto' when absent, invalid or
 * storage is blocked (private browsing).
 *
 * @returns the stored preference, or 'auto' to follow the language default.
 */
function readStoredPref(): UnitsPref {
  try {
    const stored = localStorage.getItem(UNITS_STORAGE_KEY)
    if (stored === 'imperial' || stored === 'metric') return stored
  } catch {
    /* storage blocked: fall back to the language default */
  }
  return 'auto'
}

const UnitsContext = createContext<{
  /** The resolved unit system to display distances in. */
  units: UnitSystem
  /** The stored preference, or 'auto' when following the language default. */
  pref: UnitsPref
  /** Sets an explicit unit system, or 'auto' to follow the language again. */
  setPref: (pref: UnitsPref) => void
}>({ units: 'imperial', pref: 'auto', setPref: () => {} })

/**
 * Provides the resolved distance-unit system. The preference is device-only: an
 * explicit choice is persisted in localStorage, otherwise the units default to
 * the active language (English/Spanish imperial, Portuguese metric). Must be
 * mounted inside I18nProvider so it can read the active locale.
 *
 * @param children - app subtree that formats distances.
 */
export function UnitsProvider({ children }: { children: ReactNode }) {
  const { locale } = useLocale()
  const [pref, setPrefState] = useState<UnitsPref>(readStoredPref)
  // 'auto' resolves from the active language, preserving the product default.
  const units = pref === 'auto' ? localeUnits(locale) : pref

  /** Persists an explicit unit system, or clears it ('auto') to follow the language. */
  const setPref = (next: UnitsPref) => {
    try {
      if (next === 'auto') localStorage.removeItem(UNITS_STORAGE_KEY)
      else localStorage.setItem(UNITS_STORAGE_KEY, next)
    } catch {
      /* storage blocked: the choice lives for this session only */
    }
    setPrefState(next)
  }

  return <UnitsContext.Provider value={{ units, pref, setPref }}>{children}</UnitsContext.Provider>
}

/**
 * Hook exposing the resolved unit system and the preference setter.
 *
 * @returns { units, pref, setPref } from the nearest UnitsProvider.
 */
export function useUnits() {
  return useContext(UnitsContext)
}

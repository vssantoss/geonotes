import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** An explicit theme choice; the absence of one means "follow the OS". */
export type ThemeChoice = 'light' | 'dark'

/** localStorage key; also read by the pre-paint script in index.html. */
export const THEME_STORAGE_KEY = 'geonotes-theme'

/** How long (ms) an explicit choice is remembered before reverting to the OS. */
const CHOICE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/* Browser-chrome colors matching --background in each theme, kept in sync
   with global.css so the status bar blends with the app. */
const THEME_COLOR = { light: '#f1f2eb', dark: '#161a17' }

/**
 * Reads the saved explicit choice, returning null when it is absent, expired,
 * malformed or storage is unavailable (private browsing) so the app falls
 * back to the OS setting.
 *
 * @returns the remembered 'light'/'dark' choice, or null to follow the OS.
 */
function readStoredChoice(): ThemeChoice | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) return null
    const { value, expires } = JSON.parse(raw) as { value?: unknown; expires?: unknown }
    if ((value === 'light' || value === 'dark') && typeof expires === 'number' && Date.now() < expires) {
      return value
    }
  } catch {
    /* absent, malformed or blocked: fall through to the OS setting */
  }
  return null
}

/** @returns true when the OS currently prefers a dark color scheme. */
function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Applies a resolved appearance to the document: toggles the `.dark` class
 * that drives every token and updates the theme-color meta for browser chrome.
 *
 * @param dark - whether dark mode should be shown.
 */
function applyDark(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light)
}

const ThemeContext = createContext<{
  /** Whether dark mode is currently shown, whatever its source. */
  isDark: boolean
  /** Records an explicit choice, remembered for a month. */
  setChoice: (choice: ThemeChoice) => void
}>({ isDark: false, setChoice: () => {} })

/**
 * Provides the resolved appearance and keeps the document in sync: an explicit
 * choice wins for a month, otherwise the app follows the OS setting live.
 *
 * @param children - app subtree that needs theming.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // null = follow the OS; a value = explicit user choice.
  const [choice, setChoiceState] = useState<ThemeChoice | null>(readStoredChoice)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  // The explicit choice overrides the OS; without one, track the OS live.
  const isDark = choice ? choice === 'dark' : systemDark

  useEffect(() => {
    applyDark(isDark)
  }, [isDark])

  useEffect(() => {
    // Keep following the OS when the user flips their system theme.
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  /** Persists an explicit choice with a one-month expiry and applies it. */
  const setChoice = (next: ThemeChoice) => {
    try {
      localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ value: next, expires: Date.now() + CHOICE_TTL_MS }),
      )
    } catch {
      /* storage blocked: the choice lives for this session only */
    }
    setChoiceState(next)
  }

  return <ThemeContext.Provider value={{ isDark, setChoice }}>{children}</ThemeContext.Provider>
}

/**
 * Hook exposing the resolved appearance and the choice setter.
 *
 * @returns { isDark, setChoice } from the nearest ThemeProvider.
 */
export function useTheme() {
  return useContext(ThemeContext)
}

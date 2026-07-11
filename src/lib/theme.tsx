import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** The user's theme preference: follow the OS, or force light/dark. */
export type ThemePreference = 'system' | 'light' | 'dark'

/** localStorage key; also read by the pre-paint script in index.html. */
export const THEME_STORAGE_KEY = 'geonotes-theme'

/* Browser-chrome colors matching --background in each theme, kept in sync
   with global.css so the status bar blends with the app. */
const THEME_COLOR = { light: '#f1f2eb', dark: '#161a17' }

/**
 * Reads the stored preference, defaulting to 'system' when absent or when
 * storage is unavailable (private browsing on some engines).
 *
 * @returns the stored preference or 'system'.
 */
function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    /* storage blocked: fall through to system */
  }
  return 'system'
}

/**
 * Applies a preference to the document: toggles the `.dark` class that
 * drives every token and updates the theme-color meta for browser chrome.
 *
 * @param preference - the preference to apply.
 */
function applyTheme(preference: ThemePreference) {
  const dark =
    preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light)
}

const ThemeContext = createContext<{
  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void
}>({ theme: 'system', setTheme: () => {} })

/**
 * Provides the theme preference and keeps the document in sync with it,
 * including live OS changes while in 'system' mode.
 *
 * @param children - app subtree that needs theming.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredPreference)

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    // While following the OS, react to the user flipping their system theme.
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [theme])

  /** Persists and applies a new preference. */
  const setTheme = (next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* storage blocked: preference lives for this session only */
    }
    setThemeState(next)
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

/**
 * Hook exposing the current theme preference and its setter.
 *
 * @returns { theme, setTheme } from the nearest ThemeProvider.
 */
export function useTheme() {
  return useContext(ThemeContext)
}

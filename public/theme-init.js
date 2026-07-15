// Apply the stored theme before first paint to avoid a light flash. Keep this
// aligned with THEME_STORAGE_KEY, THEME_COLOR and CHOICE_TTL_MS in theme.tsx.
;(function applyStoredTheme() {
  let choice = null
  try {
    const raw = localStorage.getItem('geonotes-theme')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (
        (parsed.value === 'light' || parsed.value === 'dark') &&
        typeof parsed.expires === 'number' &&
        Date.now() < parsed.expires
      ) {
        choice = parsed.value
      }
    }
  } catch {
    // Missing, malformed or blocked storage falls back to the OS preference.
  }
  const dark = choice
    ? choice === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches
  if (dark) {
    document.documentElement.classList.add('dark')
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', '#161a17')
  }
})()

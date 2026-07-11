import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { I18nProvider } from './lib/i18n'
import { ThemeProvider } from './lib/theme'
import { initSync } from './lib/sync'
import '@fontsource-variable/bricolage-grotesque/index.css'
import './styles/global.css'

// Service worker for the offline app shell; updates apply on next launch.
registerSW({ immediate: true })

// Push pending changes and pull server changes on every app start.
initSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)

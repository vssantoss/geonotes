import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { I18nProvider } from './lib/i18n'
import { UnitsProvider } from './lib/units'
import { ThemeProvider } from './lib/theme'
import { initSync } from './lib/sync'
import { preconnectApi } from './lib/api'
import { warmUpPlayIntegrity } from './lib/play-integrity'
import '@fontsource-variable/bricolage-grotesque/index.css'
import './styles/global.css'

// Service worker for the offline app shell; updates apply on next launch.
registerSW({ immediate: true })

// Warm the two slow first-use costs while the user is still reading the screen,
// so neither lands on a tap. Both are no-ops on web. They come before initSync
// because a signed-out start does no network at all, which is exactly the case
// where the sign-in tap would otherwise pay for the cold connection.
preconnectApi()
void warmUpPlayIntegrity()

// Push pending changes and pull server changes on every app start.
initSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <UnitsProvider>
          <App />
        </UnitsProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)

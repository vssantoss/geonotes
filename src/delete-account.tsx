import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DeleteAccountPage } from './screens/DeleteAccountPage'
import { I18nProvider } from './lib/i18n'
import { ThemeProvider } from './lib/theme'
import '@fontsource-variable/bricolage-grotesque/index.css'
import './styles/global.css'

// Entry point of the standalone account-deletion page (delete-account.html),
// the public URL published on the Google Play listing. Deliberately much
// smaller than the app's main.tsx: no service worker (this page must never be
// answered from a cached app shell), no initSync, no Dexie and no units
// provider. It owns no notes, holds no session and works for someone who has
// already uninstalled the app, which is exactly who it is for.
//
// Theme and language still apply, so the page looks and reads like the app.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <DeleteAccountPage />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)

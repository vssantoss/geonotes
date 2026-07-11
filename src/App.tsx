import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, KV } from './lib/db'
import { signOut } from './lib/auth'
import { useOnline } from './hooks/useOnline'
import { useSyncStatus } from './hooks/useSyncStatus'
import { useT } from './lib/i18n'
import { MainScreen } from './screens/MainScreen'
import { EditorScreen, type EditorTarget } from './screens/EditorScreen'
import { AuthScreen } from './screens/AuthScreen'

/**
 * App shell: gates on authentication, then routes between the main screen
 * and the editor with plain state (no router needed for two screens).
 */
export default function App() {
  const t = useT()
  const online = useOnline()
  const syncStatus = useSyncStatus()
  const [editing, setEditing] = useState<EditorTarget | null>(null)
  // undefined = still reading IndexedDB, null = signed out. Absent rows must
  // map to null because Dexie resolves get() misses with undefined, which
  // would be indistinguishable from the loading sentinel and blank the app.
  const token = useLiveQuery(async () => (await db.kv.get(KV.sessionToken)) ?? null, [], undefined)

  // The auth flow continues past token issuance (passkey enrollment offer),
  // so the gate is explicit completion, not mere token presence. null means
  // "not initialized yet"; a session existing at launch skips the flow.
  const [authDone, setAuthDone] = useState<boolean | null>(null)
  useEffect(() => {
    if (token === undefined) return
    if (authDone === null) setAuthDone(!!token)
    else if (!token && authDone) setAuthDone(false) // signed out: gate again
  }, [token, authDone])

  // Wait for the session read to avoid a sign-in flash on every launch.
  if (token === undefined || authDone === null) return null

  if (!authDone) {
    return (
      <div className="app">
        <AuthScreen onSignedIn={() => setAuthDone(true)} />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>{t('app.name')}</h1>
        <span
          className={`status-dot ${!online ? 'offline' : syncStatus === 'error' ? 'error' : ''}`}
          title={!online ? t('sync.offline') : syncStatus === 'syncing' ? t('sync.syncing') : ''}
        />
        <button className="btn" onClick={() => void signOut()}>
          {t('auth.signOut')}
        </button>
      </header>

      {!online && <div className="notice">{t('sync.offline')}</div>}
      {syncStatus === 'unauthorized' && (
        <div className="notice">
          {t('auth.error.generic')}{' '}
          <button className="btn" onClick={() => void signOut()}>
            {t('auth.title')}
          </button>
        </div>
      )}

      {editing ? (
        <EditorScreen target={editing} onDone={() => setEditing(null)} />
      ) : (
        <MainScreen
          onAdd={(locked) => setEditing({ kind: 'new', location: locked })}
          onOpen={(note) => setEditing({ kind: 'edit', note })}
        />
      )}

      <footer className="attribution">{t('attribution.osm')}</footer>
    </div>
  )
}

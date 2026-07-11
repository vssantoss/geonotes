import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, KV } from './lib/db'
import { signOut } from './lib/auth'
import { useOnline } from './hooks/useOnline'
import { useSyncStatus } from './hooks/useSyncStatus'
import { useT } from './lib/i18n'
import { MainScreen } from './screens/MainScreen'
import { EditorScreen, type EditorTarget } from './screens/EditorScreen'
import { AuthScreen } from './screens/AuthScreen'
import { ConfirmDialog } from './components/ConfirmDialog'

/**
 * App shell: routes between the main screen, the editor and the optional
 * sign-in flow with plain state (no router needed for three screens).
 *
 * Signing in is optional. Without a session the app opens straight on the
 * main screen and keeps every note on this device only; signing in later
 * uploads those notes (they wait in the outbox) and enables cross-device sync.
 */
export default function App() {
  const t = useT()
  const online = useOnline()
  const syncStatus = useSyncStatus()
  const [editing, setEditing] = useState<EditorTarget | null>(null)
  const [showAuth, setShowAuth] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  // undefined = still reading IndexedDB, null = signed out. Absent rows must
  // map to null because Dexie resolves get() misses with undefined, which
  // would be indistinguishable from the loading sentinel.
  const token = useLiveQuery(async () => (await db.kv.get(KV.sessionToken)) ?? null, [], undefined)
  const signedIn = token !== undefined && token !== null

  if (showAuth) {
    return (
      <div className="app">
        <AuthScreen onSignedIn={() => setShowAuth(false)} onCancel={() => setShowAuth(false)} />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>{t('app.name')}</h1>
        {/* Sync indicator only makes sense with an account to sync against. */}
        {signedIn && (
          <span
            className={`status-dot ${!online ? 'offline' : syncStatus === 'error' ? 'error' : ''}`}
            title={!online ? t('sync.offline') : syncStatus === 'syncing' ? t('sync.syncing') : ''}
          />
        )}
        {/* Hidden until the session read settles so the label never flips. */}
        {token !== undefined && (
          <button
            className="btn"
            onClick={() => (signedIn ? setConfirmSignOut(true) : setShowAuth(true))}
          >
            {t(signedIn ? 'auth.signOut' : 'auth.signIn')}
          </button>
        )}
      </header>

      {/* Offline is the normal state without an account; only warn about
          pending sync when there is an account to sync with. */}
      {!online && signedIn && <div className="notice">{t('sync.offline')}</div>}
      {syncStatus === 'unauthorized' && signedIn && (
        <div className="notice">
          {t('auth.sessionExpired')}{' '}
          <button className="btn" onClick={() => setShowAuth(true)}>
            {t('auth.signIn')}
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

      {confirmSignOut && (
        <ConfirmDialog
          message={t('auth.signOutConfirm')}
          confirmLabel={t('auth.signOut')}
          cancelLabel={t('editor.cancel')}
          onConfirm={() => {
            setConfirmSignOut(false)
            void signOut()
          }}
          onCancel={() => setConfirmSignOut(false)}
        />
      )}
    </div>
  )
}

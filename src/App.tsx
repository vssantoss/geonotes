import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { db, KV } from './lib/db'
import { hasUnsyncedNotes, signOut } from './lib/auth'
import { syncNow } from './lib/sync'
import { useGeolocation } from './hooks/useGeolocation'
import { useOnline } from './hooks/useOnline'
import { useSyncStatus } from './hooks/useSyncStatus'
import { useT } from './lib/i18n'
import { MainScreen, type ViewMode } from './screens/MainScreen'
import { EditorScreen, type EditorTarget } from './screens/EditorScreen'
import { AuthScreen } from './screens/AuthScreen'
import { AccountMenu } from './components/AccountMenu'
import { SignOutDialog } from './components/SignOutDialog'
import { Notice } from './components/Notice'
import { ThemeToggle } from './components/ThemeToggle'

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
  const sync = useSyncStatus()
  const [editing, setEditing] = useState<EditorTarget | null>(null)
  const [showAuth, setShowAuth] = useState(false)
  // The nearby/all filter lives here (not in MainScreen) so it survives opening
  // the editor and returning; a fresh app launch remounts App and resets it to
  // nearby.
  const [view, setView] = useState<ViewMode>('nearby')
  // Lives in the shell (not MainScreen) so the GPS watch keeps refining the
  // location while a new note is being written during the refinement window.
  const geo = useGeolocation(editing === null && !showAuth)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  // Whether unsynced changes remain when the sign-out dialog opens, so it can
  // warn that removing notes from the device would lose them.
  const [signOutUnsynced, setSignOutUnsynced] = useState(false)
  // undefined = still reading IndexedDB, null = signed out. Absent rows must
  // map to null because Dexie resolves get() misses with undefined, which
  // would be indistinguishable from the loading sentinel.
  const token = useLiveQuery(async () => (await db.kv.get(KV.sessionToken)) ?? null, [], undefined)
  const signedIn = token !== undefined && token !== null

  /**
   * Begins sign-out. With no notes on the device there is nothing to keep, so
   * it signs out straight away. Otherwise it flushes pending changes first,
   * then opens the keep/remove dialog, flagging when some notes still could not
   * sync so the dialog can warn before they are removed.
   */
  const handleSignOut = async () => {
    if ((await db.notes.count()) === 0) {
      void signOut(false)
      return
    }
    // Best-effort flush so the warning reflects what genuinely failed to sync,
    // not changes that simply had not been pushed yet.
    await syncNow()
    setSignOutUnsynced(await hasUnsyncedNotes())
    setConfirmSignOut(true)
  }

  if (showAuth) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
        <AuthScreen onSignedIn={() => setShowAuth(false)} onCancel={() => setShowAuth(false)} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <header className="sticky top-0 z-20 flex items-center gap-1 border-b border-border/60 bg-background/85 px-4 pt-[calc(env(safe-area-inset-top)+0.625rem)] pb-2.5 backdrop-blur">
        <h1 className="flex flex-1 items-center gap-2 font-display text-xl font-bold tracking-tight">
          <MapPin className="size-5 text-primary" aria-hidden />
          {t('app.name')}
        </h1>
        <ThemeToggle />
        {/* Hidden until the session read settles so the badge never flips. */}
        {token !== undefined && (
          <AccountMenu
            signedIn={signedIn}
            onSignIn={() => setShowAuth(true)}
            onSignOut={() => void handleSignOut()}
          />
        )}
      </header>

      {/* Offline is the normal state without an account; only warn about
          pending sync when there is an account to sync with. */}
      {!online && signedIn && <Notice>{t('sync.offline')}</Notice>}
      {/* A persistent sync failure (see SYNC_ERROR_ALERT_MS): shown only while
          online, since offline already has its own banner above. */}
      {online && signedIn && sync.alerting && <Notice>{t('sync.error')}</Notice>}
      {sync.status === 'unauthorized' && signedIn && (
        <Notice>
          {t('auth.sessionExpired')}
          <Button variant="outline" size="xs" onClick={() => setShowAuth(true)}>
            {t('auth.signIn')}
          </Button>
        </Notice>
      )}

      {editing ? (
        <EditorScreen target={editing} geo={geo} onDone={() => setEditing(null)} />
      ) : (
        <MainScreen
          geo={geo}
          view={view}
          onViewChange={setView}
          onAdd={(location) => setEditing({ kind: 'new', location })}
          onOpen={(note) => setEditing({ kind: 'edit', note })}
        />
      )}

      <footer className="mt-auto px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-center text-[11px] text-muted-foreground/70">
        {t('attribution.osm')}
      </footer>

      {confirmSignOut && (
        <SignOutDialog
          unsynced={signOutUnsynced}
          onKeep={() => {
            setConfirmSignOut(false)
            void signOut(true)
          }}
          onDelete={() => {
            setConfirmSignOut(false)
            void signOut(false)
          }}
          onCancel={() => setConfirmSignOut(false)}
        />
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { db, KV } from './lib/db'
import { clearDraft, readDraft } from './lib/draft'
import { hasUnsyncedNotes, signOut } from './lib/auth'
import { syncNow } from './lib/sync'
import { useGeolocation } from './hooks/useGeolocation'
import { useLocationPermission } from './hooks/useLocationPermission'
import { useNavigation } from './hooks/useNavigation'
import { useOnline } from './hooks/useOnline'
import { useSyncStatus } from './hooks/useSyncStatus'
import { useT } from './lib/i18n'
import { MainScreen, type ViewMode } from './screens/MainScreen'
import { EditorScreen, type EditorTarget } from './screens/EditorScreen'
import { AuthScreen } from './screens/AuthScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { AccountMenu } from './components/AccountMenu'
import { SignOutDialog } from './components/SignOutDialog'
import { LocationPermissionDialog } from './components/LocationPermissionDialog'
import { Notice } from './components/Notice'

/**
 * App shell: routes between the main screen, the editor, Settings and the
 * optional sign-in flow over the history stack (see useNavigation), so back
 * returns to the main screen instead of leaving the app.
 *
 * Signing in is optional. Without a session the app opens straight on the
 * main screen and keeps every note on this device only; signing in later
 * uploads those notes (they wait in the outbox) and enables cross-device sync.
 */
export default function App() {
  const t = useT()
  const online = useOnline()
  const sync = useSyncStatus()
  // Restored synchronously so a note left unsaved when the webview or tab was
  // discarded reopens in the editor, at the fix it was written at, with no
  // flash of the main screen in between.
  const [editing, setEditing] = useState<EditorTarget | null>(() => {
    const draft = readDraft()
    return draft === null ? null : { kind: 'draft', location: draft.location, text: draft.text }
  })
  // A restored draft opens the editor above the main screen, so back leaves it
  // for the notes list like any other way of reaching the editor.
  const { route, go } = useNavigation(editing === null ? ['main'] : ['main', 'editor'])
  // The nearby/all filter lives here (not in MainScreen) so it survives opening
  // the editor and returning; a fresh app launch remounts App and resets it to
  // nearby.
  const [view, setView] = useState<ViewMode>('nearby')
  // Lives in the shell (not MainScreen) so the GPS watch keeps refining the
  // location while a new note is being written during the refinement window.
  const locationPermission = useLocationPermission()
  // Acquisition is gated on the permission: starting a watch first would make
  // the Android WebView raise the system prompt itself, on top of the app's
  // explanation dialog.
  const geo = useGeolocation(route === 'main', locationPermission.permission)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  // Whether unsynced changes remain when the sign-out dialog opens, so it can
  // warn that removing notes from the device would lose them.
  const [signOutUnsynced, setSignOutUnsynced] = useState(false)
  // undefined = still reading IndexedDB, null = signed out. The stored e-mail
  // is a non-secret local account marker; the credential is an HttpOnly cookie.
  // Absent rows must
  // map to null because Dexie resolves get() misses with undefined, which
  // would be indistinguishable from the loading sentinel.
  const account = useLiveQuery(async () => (await db.kv.get(KV.userEmail)) ?? null, [], undefined)
  const signedIn = account !== undefined && account !== null

  // Keeps the editor's route and the note it holds in step, however the screen
  // is entered or left, so the back press needs no special case.
  useEffect(() => {
    if (route === 'editor') {
      // An editor entry with no note left behind it: the browser's forward
      // button, after the editor was left. There is nothing to reopen.
      if (editing === null) go('main')
      return
    }
    // The editor has been left, by saving, deleting, cancelling or pressing
    // back. The note is settled by this point, so the crash-recovery draft is
    // no longer wanted and must go, or the next launch would reopen it.
    if (editing === null) return
    clearDraft()
    setEditing(null)
  }, [route, editing, go])

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

  /**
   * Retry from the location banner. Re-arming the watch cannot fix a permission
   * problem, so those reopen the explanation dialog instead, which is what
   * leads to the system prompt or to the settings. Acquisition is still
   * restarted either way, since on the web the permission may have been granted
   * in the browser's own UI while the banner was up.
   */
  const handleRetryLocation = () => {
    if (geo.error === 'denied' || geo.error === 'imprecise') locationPermission.reopen()
    geo.retry()
  }

  if (route === 'auth') {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
        <AuthScreen onSignedIn={() => go('main')} onCancel={() => go('main')} />
      </div>
    )
  }

  if (route === 'settings') {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
        <SettingsScreen signedIn={signedIn} onClose={() => go('main')} />
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
        {/* Hidden until the session read settles so the badge never flips. */}
        {account !== undefined && (
          <AccountMenu
            signedIn={signedIn}
            onSignIn={() => go('auth')}
            onSignOut={() => void handleSignOut()}
            onOpenSettings={() => go('settings')}
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
          <Button variant="outline" size="xs" onClick={() => go('auth')}>
            {t('auth.signIn')}
          </Button>
        </Notice>
      )}
      {/* Revoked from another device: the account marker and notes are already
          wiped, so this is shown regardless of signedIn (now false). */}
      {sync.status === 'revoked' && (
        <Notice>
          {t('auth.signedOutRemotely')}
          <Button variant="outline" size="xs" onClick={() => go('auth')}>
            {t('auth.signIn')}
          </Button>
        </Notice>
      )}

      {route === 'editor' && editing ? (
        <EditorScreen target={editing} geo={geo} onDone={() => go('main')} />
      ) : (
        <MainScreen
          geo={{ ...geo, retry: handleRetryLocation }}
          view={view}
          onViewChange={setView}
          onAdd={(location) => {
            setEditing({ kind: 'new', location })
            go('editor')
          }}
          onOpen={(note) => {
            setEditing({ kind: 'edit', note })
            go('editor')
          }}
        />
      )}

      <footer className="mt-auto px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-center text-[11px] text-muted-foreground/70">
        {t('attribution.osm')}
      </footer>

      {locationPermission.explaining && (
        <LocationPermissionDialog
          permission={locationPermission.explaining}
          onAllow={() => void locationPermission.request()}
          onDismiss={locationPermission.dismiss}
        />
      )}

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

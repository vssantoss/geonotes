import { useEffect, useState } from 'react'
import { Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  listSessions,
  revokeOtherSessions,
  revokeSession,
  type SessionInfo,
} from '@/lib/account'
import { deviceLabel } from '@/lib/ua'
import { useT, useLocale } from '@/lib/i18n'
import { SettingsSection } from './SettingsControls'

/**
 * Settings section listing the account's active sessions. Each session shows a
 * best-effort device label and when it was last active; the current device is
 * badged and cannot be revoked here. Other sessions can be signed out
 * individually, or all at once via "Sign out all other sessions". Sessions
 * predating the metadata migration have a null id and are only clearable
 * through the bulk action.
 */
export function SessionsSection() {
  const t = useT()
  const { locale } = useLocale()
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The session pending single-revoke confirmation.
  const [revokeTarget, setRevokeTarget] = useState<SessionInfo | null>(null)
  // Whether the "sign out all others" confirmation is open.
  const [confirmOthers, setConfirmOthers] = useState(false)

  /** Loads (or reloads) the session list, surfacing a generic error on failure. */
  const reload = async () => {
    try {
      setSessions(await listSessions())
    } catch {
      setError(t('auth.error.generic'))
    }
  }

  useEffect(() => {
    // One-shot load on mount; reload closes over stable setters only.
    void reload()
  }, [])

  /**
   * Formats an epoch-ms timestamp as a short localized date, or a dash when the
   * value is missing (pre-migration sessions have no created_at/last_seen).
   */
  const fmtDate = (ms: number | null): string =>
    ms
      ? new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
      : '—'

  /** Revokes the confirmed single session, then reloads. */
  const confirmRevoke = async () => {
    if (!revokeTarget?.id) return
    setBusy(true)
    setError(null)
    try {
      await revokeSession(revokeTarget.id)
      await reload()
    } catch {
      setError(t('auth.error.generic'))
    } finally {
      setRevokeTarget(null)
      setBusy(false)
    }
  }

  /** Signs out every other session, then reloads. */
  const confirmRevokeOthers = async () => {
    setBusy(true)
    setError(null)
    try {
      await revokeOtherSessions()
      await reload()
    } catch {
      setError(t('auth.error.generic'))
    } finally {
      setConfirmOthers(false)
      setBusy(false)
    }
  }

  // Whether any revocable (non-current) session exists, to gate the bulk action.
  const hasOthers = sessions?.some((s) => !s.current) ?? false

  return (
    <SettingsSection title={t('sessions.title')} description={t('sessions.description')}>
      <ul className="flex flex-col gap-2">
        {sessions?.map((session, i) => (
          <li
            // Sessions may have a null id (pre-migration); fall back to index.
            key={session.id ?? `legacy-${i}`}
            className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
          >
            <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate">
                  {deviceLabel(session.userAgent) ?? t('sessions.unknownDevice')}
                </span>
                {session.current && (
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {t('sessions.current')}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('sessions.lastActive', { date: fmtDate(session.lastSeen) })}
              </p>
            </div>
            {!session.current && session.id && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setRevokeTarget(session)}
              >
                {t('sessions.revoke')}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {hasOthers && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setConfirmOthers(true)}
        >
          {t('sessions.revokeOthers')}
        </Button>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {revokeTarget && (
        <ConfirmDialog
          message={t('sessions.revokeConfirm')}
          confirmLabel={t('sessions.revokeConfirmYes')}
          cancelLabel={t('editor.cancel')}
          onConfirm={() => void confirmRevoke()}
          onCancel={() => setRevokeTarget(null)}
        />
      )}

      {confirmOthers && (
        <ConfirmDialog
          message={t('sessions.revokeOthersConfirm')}
          confirmLabel={t('sessions.revokeOthersConfirmYes')}
          cancelLabel={t('editor.cancel')}
          onConfirm={() => void confirmRevokeOthers()}
          onCancel={() => setConfirmOthers(false)}
        />
      )}
    </SettingsSection>
  )
}

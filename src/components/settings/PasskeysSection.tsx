import { useEffect, useState } from 'react'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { addPasskey, listPasskeys, removePasskey, type PasskeyInfo } from '@/lib/account'
import { ApiError } from '@/lib/api'
import { settingsErrorKey } from '@/lib/auth-error'
import { useOnline } from '@/hooks/useOnline'
import { useT, useLocale } from '@/lib/i18n'
import { SettingsSection } from './SettingsControls'

/**
 * Settings section for managing the account's passkeys: lists them, adds a new
 * one (a registration ceremony authorized by the current session) and removes
 * one (blocked server-side when it is the last passkey). Loads the list on
 * mount and refreshes it after every change.
 *
 * The passkey that signed this session in is badged and has no remove button,
 * the same way the current session cannot be revoked from SessionsSection. The
 * server refuses it too (403), since this list can be stale. Removing it means
 * signing in with another passkey first.
 *
 * Every action here needs the server, so offline the controls are disabled and
 * the list load is held back rather than allowed to fail; SettingsScreen already
 * says why once for the whole screen.
 */
export function PasskeysSection() {
  const t = useT()
  const online = useOnline()
  const { locale } = useLocale()
  const [passkeys, setPasskeys] = useState<PasskeyInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The inline add form: null when closed, otherwise the typed passkey name.
  const [addingName, setAddingName] = useState<string | null>(null)
  // The passkey pending removal confirmation.
  const [removeTarget, setRemoveTarget] = useState<PasskeyInfo | null>(null)

  /** Loads (or reloads) the passkey list, surfacing the failure reason. */
  const reload = async () => {
    try {
      setPasskeys(await listPasskeys())
      // A successful reload clears whatever the previous attempt complained about.
      setError(null)
    } catch (err) {
      const key = settingsErrorKey(err)
      setError(key && t(key))
    }
  }

  useEffect(() => {
    // Loads on mount, and again when connectivity comes back so a section opened
    // offline fills itself in. Offline the call could only fail, so it is skipped.
    if (online) void reload()
    // reload closes over stable setters only, so connectivity is the sole trigger.
  }, [online])

  /** Runs the add-passkey ceremony with the optional typed name. */
  const confirmAdd = async () => {
    setBusy(true)
    setError(null)
    try {
      await addPasskey(addingName?.trim() || undefined)
      setAddingName(null)
      await reload()
    } catch (err) {
      // A cancelled/failed browser ceremony is silent; a server rejection or a
      // failed call surfaces. The passkey list is unchanged either way.
      if (!(err instanceof DOMException)) {
        const key = settingsErrorKey(err)
        setError(key && t(key))
      }
    } finally {
      setBusy(false)
    }
  }

  /**
   * Removes the confirmed passkey, naming the two refusals the server can
   * return: 409 for the account's last passkey, 403 for the one that signed
   * this session in (reachable if the list went stale under us).
   */
  const confirmRemove = async () => {
    if (!removeTarget) return
    setBusy(true)
    setError(null)
    try {
      await removePasskey(removeTarget.id)
      await reload()
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      const refusals: Record<number, string> = {
        409: 'passkeys.lastError',
        403: 'passkeys.inUseError',
      }
      const key = settingsErrorKey(err, refusals[status] ?? 'auth.error.generic')
      setError(key && t(key))
    } finally {
      setRemoveTarget(null)
      setBusy(false)
    }
  }

  // Gate for every control that hits the server. Cancelling the add form is
  // local-only and stays available.
  const blocked = busy || !online

  return (
    <SettingsSection title={t('passkeys.title')} description={t('passkeys.description')}>
      <ul className="flex flex-col gap-2">
        {passkeys?.map((passkey) => (
          <li
            key={passkey.id}
            className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
          >
            <KeyRound className="size-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate">{passkey.label ?? t('passkeys.unnamed')}</span>
                {passkey.current && (
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {t('passkeys.current')}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('passkeys.added', {
                  date: new Date(passkey.created_at).toLocaleDateString(locale, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  }),
                })}
              </p>
            </div>
            {!passkey.current && (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={blocked}
                aria-label={t('passkeys.remove')}
                title={t('passkeys.remove')}
                onClick={() => setRemoveTarget(passkey)}
              >
                <Trash2 className="text-destructive" />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {addingName === null ? (
        <Button variant="outline" size="sm" disabled={blocked} onClick={() => setAddingName('')}>
          <Plus />
          {t('passkeys.add')}
        </Button>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('passkeys.nameLabel')}
            <Input
              autoFocus
              value={addingName}
              placeholder={t('passkeys.namePlaceholder')}
              onChange={(e) => setAddingName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !blocked && void confirmAdd()}
              className="bg-card"
            />
          </label>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              disabled={busy}
              onClick={() => setAddingName(null)}
            >
              {t('editor.cancel')}
            </Button>
            <Button size="sm" disabled={blocked} onClick={() => void confirmAdd()}>
              {t('passkeys.continue')}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {removeTarget && (
        <ConfirmDialog
          message={t('passkeys.removeConfirm')}
          confirmLabel={t('passkeys.removeConfirmYes')}
          cancelLabel={t('editor.cancel')}
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </SettingsSection>
  )
}

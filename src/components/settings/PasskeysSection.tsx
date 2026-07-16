import { useEffect, useState } from 'react'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { addPasskey, listPasskeys, removePasskey, type PasskeyInfo } from '@/lib/account'
import { ApiError } from '@/lib/api'
import { useT, useLocale } from '@/lib/i18n'
import { SettingsSection } from './SettingsControls'

/**
 * Settings section for managing the account's passkeys: lists them, adds a new
 * one (a registration ceremony authorized by the current session) and removes
 * one (blocked server-side when it is the last passkey). Loads the list on
 * mount and refreshes it after every change.
 */
export function PasskeysSection() {
  const t = useT()
  const { locale } = useLocale()
  const [passkeys, setPasskeys] = useState<PasskeyInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The inline add form: null when closed, otherwise the typed passkey name.
  const [addingName, setAddingName] = useState<string | null>(null)
  // The passkey pending removal confirmation.
  const [removeTarget, setRemoveTarget] = useState<PasskeyInfo | null>(null)

  /** Loads (or reloads) the passkey list, surfacing a generic error on failure. */
  const reload = async () => {
    try {
      setPasskeys(await listPasskeys())
    } catch {
      setError(t('auth.error.generic'))
    }
  }

  useEffect(() => {
    // One-shot load on mount; reload closes over stable setters only.
    void reload()
  }, [])

  /** Runs the add-passkey ceremony with the optional typed name. */
  const confirmAdd = async () => {
    setBusy(true)
    setError(null)
    try {
      await addPasskey(addingName?.trim() || undefined)
      setAddingName(null)
      await reload()
    } catch (err) {
      // A cancelled/failed browser ceremony and a server rejection both surface
      // as a generic error; the passkey list is unchanged.
      if (!(err instanceof DOMException)) setError(t('auth.error.generic'))
    } finally {
      setBusy(false)
    }
  }

  /** Removes the confirmed passkey, mapping the last-passkey 409 to its message. */
  const confirmRemove = async () => {
    if (!removeTarget) return
    setBusy(true)
    setError(null)
    try {
      await removePasskey(removeTarget.id)
      await reload()
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? t('passkeys.lastError')
          : t('auth.error.generic'),
      )
    } finally {
      setRemoveTarget(null)
      setBusy(false)
    }
  }

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
              <p className="truncate text-sm font-medium">{passkey.label ?? t('passkeys.unnamed')}</p>
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
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={t('passkeys.remove')}
              title={t('passkeys.remove')}
              onClick={() => setRemoveTarget(passkey)}
            >
              <Trash2 className="text-destructive" />
            </Button>
          </li>
        ))}
      </ul>

      {addingName === null ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setAddingName('')}>
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
              onKeyDown={(e) => e.key === 'Enter' && !busy && void confirmAdd()}
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
            <Button size="sm" disabled={busy} onClick={() => void confirmAdd()}>
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

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { deleteAccount } from '@/lib/account'
import { useT } from '@/lib/i18n'
import { SettingsSection } from './SettingsControls'

/**
 * Settings section for permanently deleting the account. The action is
 * destructive, so it is gated behind a confirmation dialog whose copy spells out
 * the 30-day grace window, the sign-out on every device, and that signing back
 * in cancels the deletion. On confirmation the account is marked server-side and
 * the local account data is wiped, after which onDeleted returns the app to its
 * signed-out state.
 *
 * @param onDeleted - called once the account has been marked and local data
 *   wiped, so the caller can leave Settings.
 */
export function DeleteAccountSection({ onDeleted }: { onDeleted: () => void }) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Requests deletion and, on success, hands control back to leave Settings. */
  const confirmDelete = async () => {
    setBusy(true)
    setError(null)
    try {
      await deleteAccount()
      setConfirming(false)
      onDeleted()
    } catch {
      setError(t('auth.error.generic'))
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <SettingsSection title={t('account.deleteTitle')} description={t('account.deleteDescription')}>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        className="text-destructive hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        <Trash2 />
        {t('account.delete')}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {confirming && (
        <ConfirmDialog
          message={t('account.deleteConfirm')}
          confirmLabel={t('account.deleteConfirmYes')}
          cancelLabel={t('editor.cancel')}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </SettingsSection>
  )
}

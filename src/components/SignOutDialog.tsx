import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { useT } from '../lib/i18n'

/**
 * Sign-out dialog offering a single choice between keeping the notes on this
 * device for offline use, removing them from the device, or cancelling. Built
 * on the shadcn Dialog (focus trap, Escape and backdrop dismissal included).
 *
 * When `unsynced` is set, some changes have not reached the account yet, so the
 * copy warns that removing them from the device would lose them for good.
 *
 * @param unsynced - true when local changes are still waiting to sync.
 * @param onKeep - sign out but leave notes on the device (local-only mode).
 * @param onDelete - sign out and wipe notes from the device.
 * @param onCancel - dismiss without signing out (also on Escape or backdrop tap).
 */
export function SignOutDialog({
  unsynced,
  onKeep,
  onDelete,
  onCancel,
}: {
  unsynced: boolean
  onKeep: () => void
  onDelete: () => void
  onCancel: () => void
}) {
  const t = useT()
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm rounded-xl" showCloseButton={false}>
        <DialogTitle className="text-base leading-snug font-medium">
          {t('auth.signOutTitle')}
        </DialogTitle>
        <p className="text-sm text-muted-foreground">
          {t(unsynced ? 'auth.signOutUnsyncedBody' : 'auth.signOutBody')}
        </p>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={onKeep}>{t('auth.signOutKeep')}</Button>
          <Button variant="destructive" onClick={onDelete}>
            {t(unsynced ? 'auth.signOutDeleteAnyway' : 'auth.signOutDelete')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('editor.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

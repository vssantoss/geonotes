import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'

/**
 * Modal confirmation dialog for destructive actions, built on the shadcn
 * Dialog (focus trap, Escape and backdrop dismissal included).
 *
 * @param message - the question to show.
 * @param confirmLabel - label of the destructive confirm button.
 * @param cancelLabel - label of the cancel button.
 * @param onConfirm - called when the user confirms.
 * @param onCancel - called when the user cancels, presses Escape or taps the backdrop.
 */
export function ConfirmDialog({
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  message: ReactNode
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm rounded-xl" showCloseButton={false}>
        <DialogTitle className="text-base leading-snug font-medium">{message}</DialogTitle>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

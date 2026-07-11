import type { ReactNode } from 'react'

/**
 * Minimal modal confirmation dialog (window.confirm is unavailable in some
 * webviews and blocks the thread).
 *
 * @param message - the question to show.
 * @param confirmLabel - label of the destructive confirm button.
 * @param cancelLabel - label of the cancel button.
 * @param onConfirm - called when the user confirms.
 * @param onCancel - called when the user cancels or taps the backdrop.
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
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <p style={{ margin: 0 }}>{message}</p>
        <div className="actions">
          <button className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="btn danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

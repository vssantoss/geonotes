import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { CharCounter } from '@/components/CharCounter'
import { sendContactMessage } from '@/lib/contact'
import { useT } from '@/lib/i18n'
import { CONTACT_MESSAGE_MAX_LENGTH } from '../../shared/types'

/**
 * A minimal contact form, reached from the About dialog by signed-in users. A
 * single plain-text field (bounded and counted, exactly like the note editor)
 * and a Send button; the server e-mails the message to the app owner with the
 * user's address as Reply-To, so no address is collected here. On success the
 * form is replaced by a short confirmation. Built on the shared Dialog (focus
 * trap, Escape and backdrop dismissal included).
 *
 * @param onClose - called when the user dismisses the dialog.
 * @returns the modal contact dialog.
 */
export function ContactDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(false)

  /** Submits the message, showing the confirmation on success or an error otherwise. */
  const send = async () => {
    const trimmed = message.trim()
    if (trimmed.length === 0 || sending) return
    setSending(true)
    setError(false)
    try {
      await sendContactMessage(trimmed)
      setSent(true)
    } catch {
      setError(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm rounded-xl">
        <DialogTitle className="text-base leading-snug font-medium">
          {t('contact.title')}
        </DialogTitle>
        {sent ? (
          <>
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="size-10 text-primary" aria-hidden />
              <p className="text-sm text-muted-foreground">{t('contact.sent')}</p>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>{t('common.close')}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogDescription>{t('contact.subtitle')}</DialogDescription>
            <Textarea
              autoFocus
              maxLength={CONTACT_MESSAGE_MAX_LENGTH}
              placeholder={t('contact.placeholder')}
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, CONTACT_MESSAGE_MAX_LENGTH))}
              className="min-h-32 resize-y bg-card text-base"
            />
            <CharCounter used={message.length} max={CONTACT_MESSAGE_MAX_LENGTH} />
            {error && <p className="text-sm text-destructive">{t('contact.error')}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button disabled={message.trim().length === 0 || sending} onClick={() => void send()}>
                {sending ? t('contact.sending') : t('contact.send')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

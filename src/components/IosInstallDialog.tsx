import { Share } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/lib/i18n'

/**
 * Instructions for installing the app on iOS, where no automatic install prompt
 * exists (WebKit does not fire `beforeinstallprompt`). Explains the manual
 * Share menu -> "Add to Home Screen" flow, showing the Share glyph inline so the
 * user can recognise the toolbar button. Built on the shared Dialog (focus trap,
 * Escape and backdrop dismissal included).
 *
 * @param onClose - called when the user dismisses the dialog.
 * @returns the modal instructions dialog.
 */
export function IosInstallDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm rounded-xl">
        <DialogTitle className="text-base leading-snug font-medium">
          {t('install.iosTitle')}
        </DialogTitle>
        {/* Not a DialogDescription (which renders plain text) because the Share
            glyph is shown inline to match the browser toolbar button. */}
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('install.iosStep1')}{' '}
          <Share className="inline size-4 -translate-y-px align-middle text-foreground" aria-hidden />{' '}
          {t('install.iosStep2')}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

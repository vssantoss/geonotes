import { Heart } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/lib/i18n'

/**
 * A small "About" dialog reached from the account menu. Centred, chromeless
 * (no close button, dismissed via Escape or backdrop) and stacked vertically:
 * the app logo, the app name, a warm "made with love" line with a beating
 * heart, and a link to the author's site. Built on the shared Dialog (focus
 * trap, Escape and backdrop dismissal included).
 *
 * @param onClose - called when the user dismisses the dialog.
 * @returns the modal about dialog.
 */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-xs rounded-xl">
        <div className="flex flex-col items-center gap-3 text-center">
          {/* Logo and wordmark sit side by side as the brand lockup. */}
          <div className="flex items-center gap-3">
            {/* The brand mark, reused from the favicon so the dialog shows the
                real app logo rather than the header's map-pin glyph. */}
            <img src="/favicon.svg" alt="" className="size-12 rounded-2xl" />
            <DialogTitle className="font-display text-2xl font-bold tracking-tight">
              {t('app.name')}
            </DialogTitle>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
            {t('about.madeWith')}
            <Heart
              className="size-4 animate-heartbeat fill-red-500 text-red-500"
              aria-label={t('about.love')}
            />
          </p>
          <p className="text-sm text-muted-foreground">
            {t('about.by')}{' '}
            <a
              href="https://vss.dev"
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-foreground underline underline-offset-2"
            >
              vss.dev
            </a>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

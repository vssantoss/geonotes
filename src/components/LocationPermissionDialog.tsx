import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { useT } from '@/lib/i18n'
import type { ExplainablePermission } from '@/lib/location-permission'

/**
 * Title and body copy for each state, and whether the system prompt is still
 * worth offering. `askable` and `coarse` lead somewhere: for `coarse` it is
 * Android's upgrade-to-precise prompt, which the system offers once. The two
 * blocked states do not, and a button that visibly does nothing is worse than
 * the sentence explaining the settings route.
 */
const COPY: Record<ExplainablePermission, { title: string; body: string; canAsk: boolean }> = {
  askable: {
    title: 'permission.locationTitle',
    body: 'permission.locationBody',
    canAsk: true,
  },
  coarse: {
    title: 'permission.locationCoarseTitle',
    body: 'permission.locationCoarse',
    canAsk: true,
  },
  coarseBlocked: {
    title: 'permission.locationCoarseTitle',
    body: 'permission.locationCoarseBlocked',
    canAsk: false,
  },
  blocked: {
    title: 'permission.locationTitle',
    body: 'permission.locationBlocked',
    canAsk: false,
  },
}

/**
 * Explains why the app needs location before the system prompt appears, so the
 * user is deciding on an informed question rather than a bare Android dialog.
 * Every note is anchored to a place, so without a fix the app cannot do its one
 * job, which is what the copy says.
 *
 * Four states, because the remedies genuinely differ; see COPY above for which
 * of them can still reach a system prompt.
 *
 * @param permission - which state to explain.
 * @param onAllow - called to raise the system prompt; unused when blocked.
 * @param onDismiss - called when the user declines; the buttons are the only way out.
 * @returns the modal explanation dialog.
 */
export function LocationPermissionDialog({
  permission,
  onAllow,
  onDismiss,
}: {
  permission: ExplainablePermission
  onAllow: () => void
  onDismiss: () => void
}) {
  const t = useT()
  const copy = COPY[permission]
  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent
        className="max-w-sm rounded-xl"
        showCloseButton={false}
        // The dialog asks one plain question with both answers on screen, so
        // there is nothing to escape from; taking either button is quicker than
        // hunting for the backdrop, and a stray tap outside should not count as
        // an answer.
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="flex items-center gap-2 text-base leading-snug font-medium">
          <MapPin className="size-5 shrink-0 text-primary" aria-hidden />
          {t(copy.title)}
        </DialogTitle>
        <DialogDescription className="text-sm leading-relaxed">{t(copy.body)}</DialogDescription>
        <DialogFooter>
          {copy.canAsk ? (
            <>
              <Button variant="outline" onClick={onDismiss}>
                {t('permission.notNow')}
              </Button>
              <Button onClick={onAllow}>{t('permission.allowLocation')}</Button>
            </>
          ) : (
            <Button variant="outline" onClick={onDismiss}>
              {t('common.close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

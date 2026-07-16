import { LocateFixed, LocateOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '../lib/i18n'
import { useUnits } from '../lib/units'
import { formatDistance, type GeoFix } from '../lib/geo'

/**
 * Compact GPS instrument chip, docked next to the + button. Shows a pulsing
 * dot while acquiring, keeps pulsing over the best accuracy while the fix is
 * ready but still refining, settles on a crosshair once the fix locks, and
 * turns into a struck-out marker when acquisition fails. Numbers are mono;
 * the full state description lives in the title/aria-label to keep the chip
 * short.
 *
 * @param fix - latest raw fix (null before the first one).
 * @param location - best ready fix, refining until locked (null while acquiring).
 * @param locked - whether refinement finished and the location is final.
 * @param error - acquisition error, or null; takes over the chip when set.
 */
export function AccuracyBadge({
  fix,
  location,
  locked,
  error,
}: {
  fix: GeoFix | null
  location: GeoFix | null
  locked: boolean
  error: 'denied' | 'unavailable' | 'timeout' | null
}) {
  const t = useT()
  const { units } = useUnits()
  // Accuracy shown in the chosen units (feet for imperial, meters for metric);
  // formatDistance rounds, so raw meters can be passed straight in.
  const accuracy = (meters: number) => t('gps.accuracy', { d: formatDistance(meters, units) })
  const base =
    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md'

  // No usable location: show a failed state instead of a live/acquiring one.
  if (error) {
    return (
      <span
        className={cn(base, 'border-destructive/40 bg-destructive/10 text-destructive')}
        title={t(error === 'denied' ? 'gps.denied' : error === 'timeout' ? 'gps.timeout' : 'gps.unavailable')}
        aria-label={t('gps.noFix')}
      >
        <LocateOff className="size-3.5" aria-hidden />
        {t('gps.noFix')}
      </span>
    )
  }

  if (location && locked) {
    return (
      <span
        className={cn(base, 'border-primary/40 bg-accent text-accent-foreground')}
        title={t('gps.locked')}
        aria-label={`${t('gps.locked')} ${accuracy(location.accuracy)}`}
      >
        <LocateFixed className="size-3.5 text-primary" aria-hidden />
        <span className="font-mono text-primary">
          {accuracy(location.accuracy)}
        </span>
      </span>
    )
  }

  if (location) {
    return (
      <span
        className={cn(base, 'border-primary/40 bg-accent text-accent-foreground')}
        title={t('gps.refining')}
        aria-label={`${t('gps.refining')} ${accuracy(location.accuracy)}`}
      >
        {/* Pulsing dot: notes can be added, but the fix is still refining. */}
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
        <span className="font-mono text-primary">
          {accuracy(location.accuracy)}
        </span>
      </span>
    )
  }

  return (
    <span
      className={cn(base, 'border-border bg-card text-muted-foreground')}
      title={t('gps.acquiring')}
    >
      {/* Pulsing dot: the instrument is still searching for a good fix. */}
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-primary" />
      </span>
      {fix ? (
        <span className="font-mono">{accuracy(fix.accuracy)}</span>
      ) : (
        t('gps.acquiring')
      )}
    </span>
  )
}

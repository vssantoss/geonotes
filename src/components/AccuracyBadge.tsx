import { LocateFixed } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '../lib/i18n'
import type { GeoFix } from '../lib/geo'

/**
 * Compact GPS instrument chip, docked next to the + button. Shows a pulsing
 * dot while acquiring, keeps pulsing over the best accuracy while the fix is
 * ready but still refining, and settles on a crosshair once the fix locks.
 * Numbers are mono; the full state description lives in the title/aria-label
 * to keep the chip short.
 *
 * @param fix - latest raw fix (null before the first one).
 * @param location - best ready fix, refining until locked (null while acquiring).
 * @param locked - whether refinement finished and the location is final.
 */
export function AccuracyBadge({
  fix,
  location,
  locked,
}: {
  fix: GeoFix | null
  location: GeoFix | null
  locked: boolean
}) {
  const t = useT()
  const base =
    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md'

  if (location && locked) {
    return (
      <span
        className={cn(base, 'border-primary/40 bg-accent text-accent-foreground')}
        title={t('gps.locked')}
        aria-label={`${t('gps.locked')} ${t('gps.accuracy', { m: Math.round(location.accuracy) })}`}
      >
        <LocateFixed className="size-3.5 text-primary" aria-hidden />
        <span className="font-mono text-primary">
          {t('gps.accuracy', { m: Math.round(location.accuracy) })}
        </span>
      </span>
    )
  }

  if (location) {
    return (
      <span
        className={cn(base, 'border-primary/40 bg-accent text-accent-foreground')}
        title={t('gps.refining')}
        aria-label={`${t('gps.refining')} ${t('gps.accuracy', { m: Math.round(location.accuracy) })}`}
      >
        {/* Pulsing dot: notes can be added, but the fix is still refining. */}
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
        <span className="font-mono text-primary">
          {t('gps.accuracy', { m: Math.round(location.accuracy) })}
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
        <span className="font-mono">{t('gps.accuracy', { m: Math.round(fix.accuracy) })}</span>
      ) : (
        t('gps.acquiring')
      )}
    </span>
  )
}

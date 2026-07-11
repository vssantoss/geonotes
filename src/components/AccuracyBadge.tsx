import { LocateFixed } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '../lib/i18n'
import type { GeoFix } from '../lib/geo'

/**
 * GPS instrument chip: a live readout of the fix state. Shows a pulsing dot
 * while acquiring, the raw accuracy once a fix exists, and a filled locked
 * state with a crosshair once the fix is accepted. Numbers are mono.
 *
 * @param fix - latest raw fix (null before the first one).
 * @param locked - the accepted fix, or null while acquiring.
 */
export function AccuracyBadge({ fix, locked }: { fix: GeoFix | null; locked: GeoFix | null }) {
  const t = useT()
  const base = 'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium'

  if (locked) {
    return (
      <span className={cn(base, 'border-primary/40 bg-accent text-accent-foreground')}>
        <LocateFixed className="size-3.5 text-primary" aria-hidden />
        {t('gps.locked')}
        <span className="font-mono text-primary">
          {t('gps.accuracy', { m: Math.round(locked.accuracy) })}
        </span>
      </span>
    )
  }

  return (
    <span className={cn(base, 'border-border bg-card text-muted-foreground')}>
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

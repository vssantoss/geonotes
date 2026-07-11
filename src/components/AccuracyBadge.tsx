import { useT } from '../lib/i18n'
import type { GeoFix } from '../lib/geo'

/**
 * Pill showing live GPS state: acquiring spinner text, the current accuracy
 * in meters, or a locked confirmation.
 *
 * @param fix - latest raw fix (null before the first one).
 * @param locked - the accepted fix, or null while acquiring.
 */
export function AccuracyBadge({ fix, locked }: { fix: GeoFix | null; locked: GeoFix | null }) {
  const t = useT()
  if (locked) {
    return (
      <span className="badge locked">
        ✓ {t('gps.locked')} · {t('gps.accuracy', { m: Math.round(locked.accuracy) })}
      </span>
    )
  }
  if (fix) {
    return <span className="badge">{t('gps.accuracy', { m: Math.round(fix.accuracy) })}</span>
  }
  return <span className="badge">{t('gps.acquiring')}</span>
}

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { distanceMeters, nearbyRadiusMeters, type GeoFix } from '../lib/geo'
import { useGeolocation } from '../hooks/useGeolocation'
import { useT } from '../lib/i18n'
import { AccuracyBadge } from '../components/AccuracyBadge'
import { NoteCard } from '../components/NoteCard'
import type { Note } from '../../shared/types'

type ViewMode = 'nearby' | 'all'

/**
 * Home screen: live accuracy badge, the notes list (nearby-first once a fix
 * exists, every note before that) and the floating + button that unlocks
 * when the GPS fix is precise enough.
 *
 * @param onAdd - called with the locked fix when the user taps +.
 * @param onOpen - called with a note when the user taps it.
 */
export function MainScreen({
  onAdd,
  onOpen,
}: {
  onAdd: (locked: GeoFix) => void
  onOpen: (note: Note) => void
}) {
  const t = useT()
  const { fix, locked, error, retry } = useGeolocation()
  const [view, setView] = useState<ViewMode>('nearby')
  const notes = useLiveQuery(() => db.notes.orderBy('updatedAt').reverse().toArray(), [], [])

  // Before any fix arrives the app lists everything (spec: list all notes
  // and start filtering while the GPS signal is being acquired).
  const reference = locked ?? fix
  const radius = reference ? nearbyRadiusMeters(reference.accuracy) : null

  const decorated = notes.map((note) => {
    const distance = reference
      ? distanceMeters(reference.lat, reference.lng, note.lat, note.lng)
      : null
    return { note, distance, here: distance !== null && radius !== null && distance <= radius }
  })

  if (reference) {
    decorated.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
  }

  const shown = view === 'nearby' && reference ? decorated.filter((d) => d.here) : decorated

  return (
    <>
      <div className="topbar" style={{ paddingTop: 0 }}>
        <AccuracyBadge fix={fix} locked={locked} />
      </div>

      {error && (
        <div className="notice">
          {t(error === 'denied' ? 'gps.denied' : 'gps.unavailable')}{' '}
          <button className="btn" onClick={retry}>
            {t('gps.retry')}
          </button>
        </div>
      )}

      <div className="segmented" role="tablist">
        <button
          role="tab"
          className={view === 'nearby' ? 'active' : ''}
          onClick={() => setView('nearby')}
        >
          {t('main.nearby')}
        </button>
        <button role="tab" className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>
          {t('main.all')}
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          {notes.length === 0 ? t('main.empty') : view === 'nearby' ? t('main.emptyHere') : null}
        </div>
      ) : (
        <ul className="notes">
          {shown.map(({ note, distance, here }) => (
            <NoteCard
              key={note.id}
              note={note}
              distance={distance}
              here={here}
              onClick={() => onOpen(note)}
            />
          ))}
        </ul>
      )}

      <button
        className="fab"
        aria-label={t('main.addNote')}
        title={locked ? t('main.addNote') : t('gps.waitingToAdd')}
        disabled={!locked}
        onClick={() => locked && onAdd(locked)}
      >
        +
      </button>
    </>
  )
}

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { db } from '../lib/db'
import { distanceMeters, nearbyRadiusMeters, type GeoFix } from '../lib/geo'
import { useGeolocation } from '../hooks/useGeolocation'
import { useT } from '../lib/i18n'
import { AccuracyBadge } from '../components/AccuracyBadge'
import { NoteCard } from '../components/NoteCard'
import { Notice } from '../components/Notice'
import { EmptyState } from '../components/EmptyState'
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
      <div className="mx-4 mt-2 mb-3 grid grid-cols-2 gap-1 rounded-full bg-muted p-1" role="tablist">
        {(['nearby', 'all'] as const).map((mode) => (
          <button
            key={mode}
            role="tab"
            aria-selected={view === mode}
            onClick={() => setView(mode)}
            className={cn(
              'rounded-full py-1.5 text-sm transition-colors',
              'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              view === mode
                ? 'bg-card font-medium text-foreground shadow-sm'
                : 'text-muted-foreground',
            )}
          >
            {t(mode === 'nearby' ? 'main.nearby' : 'main.all')}
          </button>
        ))}
      </div>

      {error && (
        <Notice>
          {t(error === 'denied' ? 'gps.denied' : 'gps.unavailable')}
          <Button variant="outline" size="xs" onClick={retry}>
            {t('gps.retry')}
          </Button>
        </Notice>
      )}

      {shown.length === 0 ? (
        <EmptyState
          message={
            notes.length === 0 ? t('main.empty') : view === 'nearby' ? t('main.emptyHere') : ''
          }
        />
      ) : (
        <ul className="flex flex-col gap-2.5 px-4 pt-1 pb-28">
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

      {/* GPS chip rides with the + button: it explains why + is disabled
          while acquiring and confirms the accuracy once locked. */}
      <div className="fixed right-[max(1.25rem,env(safe-area-inset-right))] bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-10 flex items-center gap-2.5">
        <AccuracyBadge fix={fix} locked={locked} />
        <button
          aria-label={t('main.addNote')}
          title={locked ? t('main.addNote') : t('gps.waitingToAdd')}
          disabled={!locked}
          onClick={() => locked && onAdd(locked)}
          className={cn(
            'flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground',
            'shadow-lg shadow-primary/25 transition-all active:scale-95',
            'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
          )}
        >
          <Plus className="size-7" aria-hidden />
        </button>
      </div>
    </>
  )
}

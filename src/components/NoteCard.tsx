import { MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { renderBold } from '../lib/bold'
import { formatDistance } from '../lib/geo'
import { detectLocale } from '../lib/i18n'
import type { Note } from '../../shared/types'

/**
 * A single note in a list: bold-rendered text, distance from the user (when
 * a fix exists), address and last-update date. Notes within the nearby
 * radius get the "you are here" treatment: accent fill and a pin marker.
 *
 * @param note - the note to render.
 * @param distance - meters from the current fix, or null when unknown.
 * @param here - whether the note is within the nearby radius (highlighted).
 * @param onClick - opens the note in the editor.
 */
export function NoteCard({
  note,
  distance,
  here,
  onClick,
}: {
  note: Note
  distance: number | null
  here: boolean
  onClick: () => void
}) {
  const updated = new Date(note.updatedAt).toLocaleDateString(detectLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'w-full rounded-xl border p-4 text-left shadow-xs transition-all',
          'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          'active:scale-[0.99]',
          here ? 'border-primary/40 bg-accent' : 'border-border bg-card hover:border-primary/30',
        )}
      >
        <p className="mb-2 wrap-anywhere whitespace-pre-wrap text-[15px] leading-relaxed">
          {renderBold(note.text)}
        </p>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {here && <MapPin className="size-3.5 shrink-0 text-primary" aria-hidden />}
          {distance !== null && (
            <span className="shrink-0 font-mono font-medium text-primary">
              {formatDistance(distance, detectLocale())}
            </span>
          )}
          <span className="truncate">
            {note.address ?? (
              <span className="font-mono">{`${note.lat.toFixed(5)}, ${note.lng.toFixed(5)}`}</span>
            )}
          </span>
          <span className="shrink-0">· {updated}</span>
        </div>
      </button>
    </li>
  )
}

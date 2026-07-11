import { renderBold } from '../lib/bold'
import { formatDistance } from '../lib/geo'
import { detectLocale } from '../lib/i18n'
import type { Note } from '../../shared/types'

/**
 * A single note in a list: bold-rendered text, distance from the user (when
 * a fix exists), address and last-update date.
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
    <li className={here ? 'note-card here' : 'note-card'} onClick={onClick}>
      <p>{renderBold(note.text)}</p>
      <div className="meta">
        {distance !== null && <span className="distance">{formatDistance(distance)}</span>}
        <span>{note.address ?? `${note.lat.toFixed(5)}, ${note.lng.toFixed(5)}`}</span>
        <span>· {updated}</span>
      </div>
    </li>
  )
}

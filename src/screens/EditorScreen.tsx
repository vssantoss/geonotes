import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createNote, deleteNote, updateNoteText } from '../lib/notes'
import { reverseGeocode } from '../lib/api'
import { renderBold } from '../lib/bold'
import { writeDraft } from '../lib/draft'
import { useT } from '../lib/i18n'
import { useUnits } from '../lib/units'
import { useOnline } from '../hooks/useOnline'
import { CharCounter } from '../components/CharCounter'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { GeolocationState } from '../hooks/useGeolocation'
import { formatDistance, type GeoFix } from '../lib/geo'
import { NOTE_MAX_LENGTH, type Note } from '../../shared/types'

/**
 * Editor target: an existing note, a new one at the fix + was tapped on, or a
 * new one restored from a draft after the app was discarded, which carries the
 * text typed so far and the fix it was written at.
 */
export type EditorTarget =
  | { kind: 'edit'; note: Note }
  | { kind: 'new'; location: GeoFix }
  | { kind: 'draft'; location: GeoFix; text: string }

/**
 * Note editor for creating and editing. A new note starts at the fix that
 * was current when + was tapped and keeps following the live fix until the
 * refinement window ends and the location locks. Editing an existing note
 * keeps its original location (locations are immutable), and a restored draft
 * keeps the fix it was written at.
 *
 * @param target - what is being edited.
 * @param geo - geolocation state owned by the app shell; supplies the live
 *   fix and the locked flag for new notes.
 * @param onDone - called when the user saves, deletes or cancels.
 */
export function EditorScreen({
  target,
  geo,
  onDone,
}: {
  target: EditorTarget
  geo: GeolocationState
  onDone: () => void
}) {
  const t = useT()
  const { units } = useUnits()
  const online = useOnline()
  const [text, setText] = useState(
    target.kind === 'edit' ? target.note.text : target.kind === 'draft' ? target.text : '',
  )
  const [confirming, setConfirming] = useState(false)
  const [address, setAddress] = useState<string | null>(
    target.kind === 'edit' ? target.note.address : null,
  )
  const [resolving, setResolving] = useState(target.kind !== 'edit' && online)
  // Still refining: the note's location keeps updating until the lock lands.
  // A restored draft is already pinned, so it never shows as updating.
  const updating = target.kind === 'new' && !geo.locked

  // The fix a new note will be saved at, or null when editing an existing note
  // (whose location is immutable). A restored draft keeps the fix it was
  // written at, so coming back to it does not move the note.
  const fix =
    target.kind === 'edit'
      ? null
      : target.kind === 'draft'
        ? target.location
        : // The tap-time fix is the fallback for the moment geo state resets.
          (geo.location ?? target.location)

  // Coordinates shown and saved: a saved note's own, or the fix above.
  const location =
    target.kind === 'edit'
      ? { lat: target.note.lat, lng: target.note.lng }
      : (fix ?? target.location)

  useEffect(() => {
    // Keep the unsaved note on disk: a backgrounded webview or tab can be
    // discarded at any time, and without this the text is gone on return.
    // Existing notes are not drafted, their text is already in the database.
    //
    // This starts the moment the editor opens, before anything is typed:
    // tapping + is itself a decision to keep this spot, and the fix cannot be
    // recovered later by standing somewhere else. Only leaving the editor
    // (save, delete or cancel) discards the draft.
    if (fix === null) return
    writeDraft({ location: fix, text })
  }, [fix, text])

  useEffect(() => {
    // Resolve the address only once the location is locked (it is final at
    // that point); a restored draft is pinned, so it resolves right away.
    // Offline creations are backfilled by the sync engine later.
    if (target.kind === 'edit' || !online) return
    if (target.kind === 'new' && !geo.locked) return
    let cancelled = false
    void reverseGeocode(location.lat, location.lng).then((addr) => {
      if (cancelled) return
      setAddress(addr)
      setResolving(false)
    })
    return () => {
      cancelled = true
    }
    // The location no longer changes once locked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind, online, geo.locked])

  /** Persists the note (create or update) and leaves the editor. */
  const save = async () => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    if (target.kind === 'edit') {
      await updateNoteText(target.note.id, trimmed)
    } else {
      await createNote(trimmed, location.lat, location.lng, address)
    }
    onDone()
  }

  /** Hard-deletes the note and leaves the editor. */
  const remove = async () => {
    if (target.kind === 'edit') await deleteNote(target.note.id)
    onDone()
  }

  return (
    <div className="flex flex-1 flex-col gap-3 px-4 pt-2 pb-6">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-display text-lg font-semibold tracking-tight">
          {t(target.kind === 'edit' ? 'editor.edit' : 'editor.new')}
        </h2>
        {/* Docked by the title so a long address gets the whole line below. */}
        {fix && (
          <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
            {updating
              ? t('editor.locationUpdating')
              : t('editor.locationLocked', { d: formatDistance(fix.accuracy, units) })}
          </span>
        )}
      </div>

      <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        {/* While refining there is no address to show yet (it is resolved on
            lock), so the live coordinates take its place. */}
        {updating || (!resolving && !address) ? (
          <span className="font-mono text-[13px]">
            {`${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`}
          </span>
        ) : resolving ? (
          t('editor.resolvingAddress')
        ) : (
          <span className="wrap-anywhere">{address}</span>
        )}
      </div>

      <Textarea
        autoFocus
        maxLength={NOTE_MAX_LENGTH}
        placeholder={t('editor.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, NOTE_MAX_LENGTH))}
        className="min-h-40 resize-y bg-card text-base"
      />
      <CharCounter used={text.length} />

      {text.includes('**') && (
        <div className="rounded-lg border border-dashed px-3 py-2 text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground">
          {renderBold(text)}
        </div>
      )}

      <div className="flex gap-2">
        {target.kind === 'edit' && (
          <Button
            variant="ghost"
            className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            {t('editor.delete')}
          </Button>
        )}
        <Button variant="outline" className="ml-auto" onClick={onDone}>
          {t('editor.cancel')}
        </Button>
        <Button disabled={text.trim().length === 0} onClick={() => void save()}>
          {t('editor.save')}
        </Button>
      </div>

      {confirming && (
        <ConfirmDialog
          message={t('editor.deleteConfirm')}
          confirmLabel={t('editor.deleteYes')}
          cancelLabel={t('editor.cancel')}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}

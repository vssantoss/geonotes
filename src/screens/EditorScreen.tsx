import { useEffect, useState } from 'react'
import { createNote, deleteNote, updateNoteText } from '../lib/notes'
import { reverseGeocode } from '../lib/api'
import { renderBold } from '../lib/bold'
import { useT } from '../lib/i18n'
import { useOnline } from '../hooks/useOnline'
import { CharCounter } from '../components/CharCounter'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { GeoFix } from '../lib/geo'
import { NOTE_MAX_LENGTH, type Note } from '../../shared/types'

/** Editor target: an existing note, or a new one at a locked location. */
export type EditorTarget = { kind: 'edit'; note: Note } | { kind: 'new'; location: GeoFix }

/**
 * Note editor for creating and editing. The location is snapshotted when +
 * was tapped and never changes here, even if the user moves. Editing an
 * existing note keeps its original location (locations are immutable).
 *
 * @param target - what is being edited.
 * @param onDone - called when the user saves, deletes or cancels.
 */
export function EditorScreen({ target, onDone }: { target: EditorTarget; onDone: () => void }) {
  const t = useT()
  const online = useOnline()
  const [text, setText] = useState(target.kind === 'edit' ? target.note.text : '')
  const [confirming, setConfirming] = useState(false)
  const [address, setAddress] = useState<string | null>(
    target.kind === 'edit' ? target.note.address : null,
  )
  const [resolving, setResolving] = useState(target.kind === 'new' && online)

  const location =
    target.kind === 'edit'
      ? { lat: target.note.lat, lng: target.note.lng }
      : { lat: target.location.lat, lng: target.location.lng }

  useEffect(() => {
    // Resolve the address for a brand-new location right away when online;
    // offline creations are backfilled by the sync engine later.
    if (target.kind !== 'new' || !online) return
    let cancelled = false
    void reverseGeocode(location.lat, location.lng).then((addr) => {
      if (cancelled) return
      setAddress(addr)
      setResolving(false)
    })
    return () => {
      cancelled = true
    }
    // Location is immutable for the lifetime of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    <div className="editor">
      <h2 style={{ margin: '4px 0 0' }}>
        {t(target.kind === 'edit' ? 'editor.edit' : 'editor.new')}
      </h2>

      <div className="location">
        📍{' '}
        {resolving
          ? t('editor.resolvingAddress')
          : (address ?? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`)}
        {target.kind === 'new' && <> · {t('editor.locationLocked')}</>}
      </div>

      <textarea
        autoFocus
        maxLength={NOTE_MAX_LENGTH}
        placeholder={t('editor.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, NOTE_MAX_LENGTH))}
      />
      <CharCounter used={text.length} />

      {text.includes('**') && <div className="preview">{renderBold(text)}</div>}

      <div className="actions">
        {target.kind === 'edit' && (
          <button className="btn danger" onClick={() => setConfirming(true)} style={{ marginRight: 'auto' }}>
            {t('editor.delete')}
          </button>
        )}
        <button className="btn" onClick={onDone}>
          {t('editor.cancel')}
        </button>
        <button className="btn primary" disabled={text.trim().length === 0} onClick={() => void save()}>
          {t('editor.save')}
        </button>
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

import type { GeoFix } from './geo'

// Crash-safe storage for the note currently being written.
//
// localStorage rather than Dexie on purpose: a backgrounded webview or tab can
// be discarded at any moment, and the draft has to be on disk *before* that
// happens. localStorage writes land synchronously; an IndexedDB write is async
// and is not guaranteed to complete once the page is being torn down.

/** localStorage key holding the unsaved new note (device-only, never synced). */
const DRAFT_STORAGE_KEY = 'geonotes-draft'

/** A new note that has been started but not saved yet. */
export interface Draft {
  /** The fix the note will be saved at, pinned when the draft was written so
      restoring it does not move the note to wherever the device is now. This
      is the part that cannot be recovered later, which is why a draft is kept
      even with no text: the spot is the point. */
  location: GeoFix
  /** What has been typed so far, empty when the editor was only opened. */
  text: string
}

/**
 * Type guard for a parsed draft, so a truncated or hand-edited storage value
 * cannot reach the editor as a half-built note.
 *
 * @param value - the parsed JSON value.
 * @returns true when the value has the full Draft shape.
 */
function isDraft(value: unknown): value is Draft {
  if (typeof value !== 'object' || value === null) return false
  const { location, text } = value as Partial<Draft>
  if (typeof text !== 'string') return false
  if (typeof location !== 'object' || location === null) return false
  return (
    typeof location.lat === 'number' &&
    typeof location.lng === 'number' &&
    typeof location.accuracy === 'number' &&
    typeof location.timestamp === 'number'
  )
}

/**
 * Reads the stored draft.
 *
 * @returns the draft, or null when there is none, it is malformed, or storage
 *   is blocked (private browsing).
 */
export function readDraft(): Draft | null {
  try {
    const stored = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (stored === null) return null
    const parsed: unknown = JSON.parse(stored)
    return isDraft(parsed) ? parsed : null
  } catch {
    /* absent, unparseable or storage blocked: no draft to restore */
    return null
  }
}

/**
 * Stores the draft, replacing any previous one. There is only ever one, since
 * only one note can be open in the editor.
 *
 * @param draft - the pinned fix and the text typed so far.
 */
export function writeDraft(draft: Draft): void {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch {
    /* storage blocked or full: the draft simply is not crash-proof */
  }
}

/** Discards the stored draft, once the note is saved or abandoned. */
export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
  } catch {
    /* storage blocked: nothing was stored in the first place */
  }
}

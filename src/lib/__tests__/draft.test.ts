import { beforeEach, describe, expect, it } from 'vitest'
import { clearDraft, readDraft, writeDraft, type Draft } from '../draft'

const STORAGE_KEY = 'geonotes-draft'

/**
 * Installs a minimal in-memory localStorage. The unit project runs in Node,
 * which has no DOM storage, and the draft module is deliberately synchronous
 * around it.
 *
 * @returns the backing map, for asserting and seeding raw values.
 */
function fakeStorage(): Map<string, string> {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => void store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
  return store
}

const draft: Draft = {
  location: { lat: 38.7223, lng: -9.1393, accuracy: 12, timestamp: 1_700_000_000_000 },
  text: 'the note I did not want to lose',
}

describe('draft', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = fakeStorage()
  })

  it('round-trips a draft', () => {
    writeDraft(draft)
    expect(readDraft()).toEqual(draft)
  })

  it('reads null when nothing is stored', () => {
    expect(readDraft()).toBeNull()
  })

  // The editor opened but nothing was typed yet. The fix is the whole point of
  // such a draft, so an empty text must survive the round trip like any other.
  it('round-trips a draft with no text yet', () => {
    writeDraft({ ...draft, text: '' })
    expect(readDraft()).toEqual({ ...draft, text: '' })
  })

  it('keeps only the latest draft', () => {
    writeDraft(draft)
    writeDraft({ ...draft, text: 'newer' })
    expect(readDraft()?.text).toBe('newer')
  })

  it('clears the draft', () => {
    writeDraft(draft)
    clearDraft()
    expect(readDraft()).toBeNull()
    expect(store.has(STORAGE_KEY)).toBe(false)
  })

  it('rejects unparseable storage instead of throwing', () => {
    store.set(STORAGE_KEY, '{not json')
    expect(readDraft()).toBeNull()
  })

  // A half-written draft must not reach the editor: a note with a missing
  // coordinate would be saved at NaN.
  it('rejects a draft with an incomplete fix', () => {
    store.set(STORAGE_KEY, JSON.stringify({ text: 'hi', location: { lat: 1, lng: 2 } }))
    expect(readDraft()).toBeNull()
  })

  it('rejects a draft with no text', () => {
    store.set(STORAGE_KEY, JSON.stringify({ location: draft.location }))
    expect(readDraft()).toBeNull()
  })
})

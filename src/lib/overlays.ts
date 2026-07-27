// Back press -> Escape bridge for the app's overlays.
//
// Every dialog, dropdown and popover in the app is a Radix layer, and Radix
// already closes the topmost one on Escape (only the topmost listens, and it
// marks the event handled). A back press is the same intent on a device with
// no Escape key, so rather than tracking open overlays in a registry of our
// own, back is offered to Radix as an Escape and the layers answer for
// themselves.

/**
 * Offers a back press to the topmost open overlay.
 *
 * @returns true when an overlay took it (and closed, or deliberately refused
 *   to), meaning the press must not also navigate.
 */
export function closeTopOverlay(): boolean {
  // Radix listens on the document in the capture phase, so dispatching there
  // reaches it. It calls preventDefault() before dismissing, which is the only
  // signal available that something was open at all.
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  document.dispatchEvent(escape)
  return escape.defaultPrevented
}

import type { ReactNode } from 'react'

/**
 * Renders note text with the only markup GeoNotes supports: **bold**.
 * Produces React nodes directly (never HTML strings) so user content can
 * never inject markup.
 *
 * @param text - raw note text.
 * @returns React nodes with `<strong>` around **wrapped** segments;
 *          unclosed markers are left as literal asterisks.
 */
export function renderBold(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let rest = text
  let key = 0
  while (rest.length > 0) {
    const open = rest.indexOf('**')
    // No opening marker left: the remainder is plain text.
    if (open === -1) {
      nodes.push(rest)
      break
    }
    const close = rest.indexOf('**', open + 2)
    // Opening marker without a closing one renders literally.
    if (close === -1) {
      nodes.push(rest)
      break
    }
    if (open > 0) nodes.push(rest.slice(0, open))
    const inner = rest.slice(open + 2, close)
    // "****" (empty bold) renders literally rather than as an empty element.
    if (inner.length === 0) {
      nodes.push('****')
    } else {
      nodes.push(<strong key={key++}>{inner}</strong>)
    }
    rest = rest.slice(close + 2)
  }
  return nodes
}

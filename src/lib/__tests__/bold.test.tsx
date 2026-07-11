import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import { renderBold } from '../bold'

/**
 * Extracts a comparable shape from renderBold output: strings stay strings,
 * <strong> elements become { bold: content }.
 */
function shape(nodes: ReturnType<typeof renderBold>) {
  return nodes.map((n) => (isValidElement(n) ? { bold: (n.props as { children: string }).children } : n))
}

describe('renderBold', () => {
  it('returns plain text untouched', () => {
    expect(shape(renderBold('hello world'))).toEqual(['hello world'])
  })

  it('bolds a wrapped segment', () => {
    expect(shape(renderBold('go **left** here'))).toEqual(['go ', { bold: 'left' }, ' here'])
  })

  it('handles multiple bold segments', () => {
    expect(shape(renderBold('**a** and **b**'))).toEqual([{ bold: 'a' }, ' and ', { bold: 'b' }])
  })

  it('leaves an unclosed marker literal', () => {
    expect(shape(renderBold('oops **left'))).toEqual(['oops **left'])
  })

  it('renders empty bold markers literally', () => {
    expect(shape(renderBold('a****b'))).toEqual(['a', '****', 'b'])
  })

  it('handles bold at the very start and end', () => {
    expect(shape(renderBold('**x**'))).toEqual([{ bold: 'x' }])
  })

  it('never produces HTML strings', () => {
    const nodes = renderBold('<img src=x onerror=alert(1)> **<b>**')
    expect(shape(nodes)).toEqual(['<img src=x onerror=alert(1)> ', { bold: '<b>' }])
  })
})

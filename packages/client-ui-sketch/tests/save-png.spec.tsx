/**
 * Plot PNG export: the file name rule and the presence of the control.
 *
 * The canvas itself cannot be rasterized in a node test, but the two regressions
 * that matter here are pure/static: an expression with a slash producing a
 * broken download name, and one of the two render surfaces forgetting the button.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SketchFigure } from '../src/client/SketchFigure.tsx'
import { pngFilename } from '../src/client/save-png.ts'

/** The translate stand-in returns the key, so the copy is visible in the markup. */
const t = ((key: string) => key) as never

describe('pngFilename', () => {
  it('keeps a readable expression and appends the png extension', () => {
    expect(pngFilename('sin(x)')).toBe('sin(x).png')
  })

  it('replaces path separators and other unsafe characters', () => {
    expect(pngFilename('a/b\\c:d')).toBe('a_b_c_d.png')
  })

  it('uses a stable fallback for an empty expression', () => {
    expect(pngFilename('  ')).toBe('function-plot.png')
    expect(pngFilename('///')).toBe('function-plot.png')
  })

  it('caps a long expression so the download name stays sane', () => {
    const name = pngFilename('x'.repeat(200))
    expect(name.endsWith('.png')).toBe(true)
    expect(name.length).toBe(60 + 4)
  })
})

describe('the save control on plots', () => {
  it('renders the button with the localized hint', () => {
    const html = renderToStaticMarkup(<SketchFigure spec={{ expr: 'sin(x)' }} t={t} />)
    expect(html).toContain('data-tool="sketch_function"')
    expect(html).toContain('sk-action')
    expect(html).toContain('⇩ card.save')
    expect(html).toContain('card.saveHint')
    expect(html).toContain('<canvas')
  })
})

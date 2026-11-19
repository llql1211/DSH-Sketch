/**
 * Theme-aware plot ink tests.
 *
 * The bug this guards is easy to eyeball and hard to assert from geometry:
 * the canvas inherited a dark surface from the host while its labels were
 * painted in a dark gray, so the ticks disappeared. These tests pin the two
 * halves of the fix — choosing a palette from the painted surface, and actually
 * painting with the palette the caller passed.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COLORS,
  DARK_COLORS,
  Viewport,
  chartPaletteFor,
  drawAxes,
  isDarkSurface,
} from '../src/client/render.ts'

/** Minimal 2D context: the draw functions only set fields and call these methods. */
function recordingContext(): CanvasRenderingContext2D {
  const noop = (): void => {}
  return {
    clearRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: noop,
    arc: noop,
    fillRect: noop,
    strokeRect: noop,
    fillText: noop,
    setLineDash: noop,
    closePath: noop,
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
  } as unknown as CanvasRenderingContext2D
}

describe('isDarkSurface', () => {
  it('recognises dark surfaces in rgb and hex form', () => {
    expect(isDarkSurface('rgb(31, 32, 35)')).toBe(true)
    expect(isDarkSurface('#1f2023')).toBe(true)
    expect(isDarkSurface('#000')).toBe(true)
  })

  it('keeps light and unresolved surfaces on the light palette', () => {
    expect(isDarkSurface('rgb(255, 255, 255)')).toBe(false)
    expect(isDarkSurface('#ffffff')).toBe(false)
    expect(isDarkSurface('')).toBe(false)
    expect(isDarkSurface('transparent')).toBe(false)
    expect(isDarkSurface('rgba(0, 0, 0, 0)')).toBe(false)
  })
})

describe('chartPaletteFor', () => {
  it('switches ink with the painted surface', () => {
    expect(chartPaletteFor('rgb(32, 33, 36)')).toBe(DARK_COLORS)
    expect(chartPaletteFor('rgb(250, 250, 250)')).toBe(COLORS)
  })

  it('uses light ink for labels and a light grid on a dark surface', () => {
    // The original failure: both were black-based and vanished into the card.
    expect(isDarkSurface(DARK_COLORS.text)).toBe(false)
    expect(DARK_COLORS.grid).toContain('255,255,255')
    expect(DARK_COLORS.text).not.toBe(COLORS.text)
  })
})

describe('palette-aware drawing', () => {
  const viewport = new Viewport(-6, 6, -1, 1).fit(620, 380)

  it('paints axes with the caller palette when one is given', () => {
    const ctx = recordingContext()
    drawAxes(ctx, viewport, DARK_COLORS)
    // drawAxes finishes its axis stroke, then labels in the text color.
    expect(ctx.strokeStyle).toBe(DARK_COLORS.axis)
    expect(ctx.fillStyle).toBe(DARK_COLORS.text)
  })

  it('keeps the light palette as the default for existing callers', () => {
    const ctx = recordingContext()
    drawAxes(ctx, viewport)
    expect(ctx.strokeStyle).toBe(COLORS.axis)
    expect(ctx.fillStyle).toBe(COLORS.text)
  })
})

describe('card font stack', () => {
  const sheet = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')

  it('inherits the host body font instead of a font-less monospace stack', () => {
    // A bare `monospace` stack has no CJK face on Windows, so Chinese card
    // chrome used to fall back to SimSun (宋体).
    expect(sheet).toContain('var(--dsw-font-family')
    expect(sheet).not.toContain('ui-monospace, SFMono-Regular, Menlo, monospace')
  })
})

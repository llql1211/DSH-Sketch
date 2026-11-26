/**
 * Canvas render tests.
 *
 * These exercise the drawing code against a recording stub context rather than
 * a real canvas: the question here is "does the renderer emit the primitives
 * the geometry calls for", not "does the browser rasterise them". A stub makes
 * that question answerable without a DOM, and — more importantly — lets the
 * assertions read the recorded calls directly instead of guessing at pixels.
 *
 * The colour assertions matter: the prototype shipped a near-invisible grid
 * colour and an axis colour that was mistaken for it, so a test that only
 * counted strokes would have passed while the frame was unreadable.
 */

import { describe, expect, it } from 'vitest'
import { COLORS, Viewport, drawAxes, drawBars, drawCurve, drawLegend, drawNote, drawVLine, squareBounds } from '../src/client/render.ts'
import type { Sample } from '../src/client/render.ts'

/** One recorded context call. */
interface Call {
  readonly fn: string
  readonly args: readonly unknown[]
}

/** A 2D context that records every call instead of drawing. */
function stubContext(): CanvasRenderingContext2D & { calls: Call[] } {
  const calls: Call[] = []
  const record = (fn: string) => (...args: unknown[]): void => {
    calls.push({ fn, args })
  }
  const ctx = {
    calls,
    clearRect: record('clearRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    fill: record('fill'),
    arc: record('arc'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    fillText: record('fillText'),
    setLineDash: record('setLineDash'),
    closePath: record('closePath'),
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    setTransform: record('setTransform'),
  }
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] }
}

/** All recorded calls of one kind. */
function callsOf(ctx: { calls: Call[] }, fn: string): readonly Call[] {
  return ctx.calls.filter((c) => c.fn === fn)
}

describe('drawAxes', () => {
  it('emits both a grid pass and an axis pass in distinct colours', () => {
    const ctx = stubContext()
    const vp = new Viewport(-6.28, 6.28, -1.2, 1.2).fit(620, 380)
    drawAxes(ctx, vp)

    // One clear, then two strokes: grid first, opaque axes second.
    expect(callsOf(ctx, 'clearRect')).toHaveLength(1)
    expect(callsOf(ctx, 'stroke').length).toBeGreaterThanOrEqual(2)

    // The axis must not be drawn in the grid's near-transparent colour, which
    // is the mistake the prototype made and a pixel probe could not catch.
    expect(COLORS.axis).not.toBe(COLORS.grid)
  })

  it('labels the axes without labelling the origin twice', () => {
    const ctx = stubContext()
    const vp = new Viewport(-6.28, 6.28, -1.2, 1.2).fit(620, 380)
    drawAxes(ctx, vp)
    const labels = callsOf(ctx, 'fillText').map((c) => String(c.args[0]))
    expect(labels.length).toBeGreaterThan(0)
    expect(labels).not.toContain('0.0')
  })
})

describe('drawCurve', () => {
  it('breaks the stroke at a null sample instead of bridging the gap', () => {
    const ctx = stubContext()
    const vp = new Viewport(-1, 1, -1, 1).fit(100, 100)
    const points: Sample[] = [[-1, 0], [0, 1], [0, null], [1, 0]]
    drawCurve(ctx, vp, points, COLORS.curve[0])

    // Three real samples produce two segments: one moveTo plus one lineTo per
    // run, and the null forces a fresh moveTo rather than a joining lineTo.
    expect(callsOf(ctx, 'moveTo')).toHaveLength(2)
    expect(callsOf(ctx, 'lineTo')).toHaveLength(1)
  })

  it('draws nothing for an all-null series', () => {
    const ctx = stubContext()
    const vp = new Viewport(-1, 1, -1, 1).fit(100, 100)
    drawCurve(ctx, vp, [[0, null], [1, null]], COLORS.curve[0])
    expect(callsOf(ctx, 'lineTo')).toHaveLength(0)
    expect(callsOf(ctx, 'moveTo')).toHaveLength(0)
  })

  it('strokes a plain series as one connected line', () => {
    const ctx = stubContext()
    const vp = new Viewport(0, 10, 0, 10).fit(100, 100)
    // A control that can fail: a renderer that dropped the stroke would leave
    // an empty frame while every other assertion in this file still passed.
    drawCurve(ctx, vp, [[0, 0], [5, 5], [10, 0]], COLORS.curve[0])
    expect(callsOf(ctx, 'moveTo')).toHaveLength(1)
    expect(callsOf(ctx, 'lineTo')).toHaveLength(2)
    expect(callsOf(ctx, 'stroke')).toHaveLength(1)
  })
})

describe('drawBars', () => {
  it('draws one rectangle per bar, using the heights the sum used', () => {
    const ctx = stubContext()
    const vp = new Viewport(0, 1, 0, 1).fit(620, 380)
    const bars = Array.from({ length: 15 }, (_, i) => [i / 15, 0.5] as const)
    drawBars(ctx, vp, bars, 0, 1)
    expect(callsOf(ctx, 'fillRect')).toHaveLength(15)
    expect(callsOf(ctx, 'strokeRect')).toHaveLength(15)
  })

  it('skips bars whose height is not finite', () => {
    const ctx = stubContext()
    const vp = new Viewport(0, 1, 0, 1).fit(620, 380)
    drawBars(ctx, vp, [[0, Number.NaN], [0.5, 0.2]], 0, 1)
    expect(callsOf(ctx, 'fillRect')).toHaveLength(1)
  })
})

describe('squareBounds', () => {
  it('expands the shorter axis so one pixel covers equal x/y units', () => {
    // The screenshot's window: x span 8 over 620px, y span 3.48 over 380px.
    const [x0, x1, y0, y1] = squareBounds(-4, 4, -1.24, 2.24, 620, 380)
    const vp = new Viewport(x0 as number, x1 as number, y0 as number, y1 as number).fit(620, 380)
    expect((x1 as number) - (x0 as number)).toBeCloseTo(8, 6)
    expect((y1 as number) - (y0 as number)).toBeCloseTo(8 * 380 / 620, 6)
    // One math unit is the same number of pixels on either axis.
    expect(Math.abs(vp.px(1) - vp.px(0))).toBeCloseTo(Math.abs(vp.py(1) - vp.py(0)), 6)
    // Nothing is cropped: both original windows sit inside the widened one.
    expect(x0).toBeLessThanOrEqual(-4)
    expect(x1).toBeGreaterThanOrEqual(4)
    expect(y0).toBeLessThanOrEqual(-1.24)
    expect(y1).toBeGreaterThanOrEqual(2.24)
  })

  it('leaves bounds untouched for a degenerate canvas', () => {
    expect(squareBounds(-1, 1, -1, 1, 0, 380)).toEqual([-1, 1, -1, 1])
  })
})

describe('drawVLine', () => {
  it('strokes one finite segment and honours its dash', () => {
    const ctx = stubContext()
    const vp = new Viewport(0, 2, 0, 2).fit(200, 200)
    drawVLine(ctx, vp, 1, 0, 1.5, '#00bcd4', [6, 4], 3)
    expect(callsOf(ctx, 'moveTo')).toHaveLength(1)
    expect(callsOf(ctx, 'lineTo')).toHaveLength(1)
    expect(callsOf(ctx, 'stroke')).toHaveLength(1)
    expect(callsOf(ctx, 'setLineDash').map((call) => call.args[0])).toContainEqual([6, 4])
  })
})

describe('canvas annotations', () => {
  it('draws a dot and a caption for a point note', () => {
    const ctx = stubContext()
    const vp = new Viewport(0, 1, 0, 1).fit(620, 380)
    drawNote(ctx, vp, { x: 0.5, y: 0.5, text: '原点', dx: 8, dy: -6, color: '#E24B4A', dot: true })
    expect(callsOf(ctx, 'arc')).toHaveLength(1)
    expect(callsOf(ctx, 'fillText')).toHaveLength(1)
  })

  it('draws text only for a floating note', () => {
    const ctx = stubContext()
    const vp = new Viewport(0, 1, 0, 1).fit(620, 380)
    drawNote(ctx, vp, { x: 0.5, y: 0.5, text: '注释', dx: 0, dy: 0, color: '#E24B4A', dot: false })
    expect(callsOf(ctx, 'arc')).toHaveLength(0)
    expect(callsOf(ctx, 'fillText')).toHaveLength(1)
  })

  it('draws a legend swatch per labelled curve', () => {
    const ctx = stubContext()
    const vp = new Viewport(0, 1, 0, 1).fit(620, 380)
    drawLegend(ctx, vp, [
      { label: 'sin', color: '#378ADD', dash: [], width: 2 },
      { label: 'cos', color: '#1D9E75', dash: [6, 4], width: 2 },
    ])
    expect(callsOf(ctx, 'fillText')).toHaveLength(2)
    expect(callsOf(ctx, 'stroke')).toHaveLength(2)
  })
})

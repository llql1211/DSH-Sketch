/**
 * Chart painting tests.
 *
 * The question here is "does the renderer emit the primitives the payload asks
 * for", not "does the browser rasterize them". A recording 2D context answers
 * it without a DOM and, more importantly, makes determinism and theme choice
 * directly assertable instead of guessed from pixels.
 */
import { describe, expect, it } from 'vitest'
import { parseChartPayload } from '@aisketch/cards-core'
import type { ChartPayload } from '@aisketch/cards-core'
import {
  CHART_COLORS, DARK_CHART_COLORS, chartPaletteFor, drawChart, isDarkSurface, niceDataRange, niceStep,
} from '../src/client/chart-canvas.ts'

/** One recorded context call, with the ink in force at the time. */
interface Call {
  readonly fn: string
  readonly args: readonly unknown[]
  readonly fillStyle: string
  readonly strokeStyle: string
  readonly lineWidth: number
}

type Stub = CanvasRenderingContext2D & {
  calls: Call[]
  fillStyle: string
  strokeStyle: string
  lineWidth: number
}

/** A 2D context that records calls instead of painting. */
function stubContext(): Stub {
  const calls: Call[] = []
  const ctx: Record<string, unknown> = { calls }
  const record = (fn: string) => (...args: unknown[]): void => {
    calls.push({
      fn,
      args,
      fillStyle: String(ctx.fillStyle ?? ''),
      strokeStyle: String(ctx.strokeStyle ?? ''),
      lineWidth: Number(ctx.lineWidth ?? 0),
    })
  }
  for (const fn of [
    'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'closePath', 'fillText',
  ]) ctx[fn] = record(fn)
  ctx.fillStyle = ''
  ctx.strokeStyle = ''
  ctx.lineWidth = 1
  ctx.font = ''
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  return ctx as unknown as Stub
}

/** Draw a payload through the real core parser, as the card does. */
function paint(payload: unknown, ctx: Stub = stubContext()): Stub {
  const chart = parseChartPayload(payload)
  if (chart === null) throw new Error('test payload must be a valid chart')
  drawChart(ctx, chart)
  return ctx
}

/** All recorded calls of one kind. */
function callsOf(ctx: Stub, fn: string): readonly Call[] {
  return ctx.calls.filter((call) => call.fn === fn)
}

/** Text drawn by the renderer. */
function labelsOf(ctx: Stub): readonly string[] {
  return callsOf(ctx, 'fillText').map((call) => String(call.args[0]))
}

/** A two-series chart with named categories. */
const scores = {
  type: 'line',
  series: [{ label: '上学期', data: [72, 85, 63] }, { label: '下学期', data: [80, 90, 77] }],
  categories: ['语文', '数学', '英语'],
}

describe('the drawing surface', () => {
  it('picks ink from the resolved surface, not from a theme class', () => {
    expect(isDarkSurface('#ffffff')).toBe(false)
    expect(isDarkSurface('rgb(20, 20, 24)')).toBe(true)
    expect(isDarkSurface('rgba(20, 20, 24, 0)')).toBe(false)
    expect(isDarkSurface('not-a-color')).toBe(false)
    expect(chartPaletteFor('#ffffff')).toBe(CHART_COLORS)
    expect(chartPaletteFor('rgb(20, 20, 24)')).toBe(DARK_CHART_COLORS)
    expect(DARK_CHART_COLORS.text).not.toBe(CHART_COLORS.text)
    // A series keeps its identity when the host changes theme.
    expect(DARK_CHART_COLORS.curve).toEqual(CHART_COLORS.curve)
  })

  it('chooses human-friendly ticks and always brackets zero', () => {
    expect(niceStep(0.23)).toBeCloseTo(0.2)
    expect(niceStep(1.7)).toBe(2)
    expect(niceStep(0)).toBe(1)
    const range = niceDataRange([72, 85, 63])
    expect(range.min).toBe(0)
    expect(range.max).toBeGreaterThanOrEqual(85)
    expect(range.step).toBeGreaterThan(0)
    const signed = niceDataRange([-5, 0, 10])
    expect(signed.min).toBeLessThanOrEqual(-5)
    expect(signed.max).toBeGreaterThanOrEqual(10)
  })
})

describe('drawChart', () => {
  it('paints a line chart with value ticks, a zero baseline, categories and a legend', () => {
    const ctx = paint(scores)
    expect(callsOf(ctx, 'clearRect')).toHaveLength(1)
    const labels = labelsOf(ctx)
    expect(labels).toContain('上学期')
    expect(labels).toContain('下学期')
    expect(labels).toContain('语文')
    expect(labels).toContain('数学')
    expect(labels).toContain('英语')
    expect(labels).toContain('0')
    // One stroke per series plus the grid and the axis passes.
    const strokes = callsOf(ctx, 'stroke')
    expect(strokes.filter((call) => call.strokeStyle === CHART_COLORS.curve[0])).toHaveLength(1)
    expect(strokes.filter((call) => call.strokeStyle === CHART_COLORS.curve[1])).toHaveLength(1)
    expect(strokes.filter((call) => call.strokeStyle === CHART_COLORS.axis)).toHaveLength(1)
    // A marker is filled on every datum of both series.
    expect(callsOf(ctx, 'arc')).toHaveLength(6)
  })

  it('falls back to numeric captions when no categories were supplied', () => {
    const ctx = paint({ series: [{ label: 'A', data: [1, 2] }] })
    const labels = labelsOf(ctx)
    expect(labels).toContain('1')
    expect(labels).toContain('2')
    expect(labels).toContain('A')
  })

  it('groups bars per category and draws them from the zero baseline', () => {
    const ctx = paint({ ...scores, type: 'bar' })
    // Two legend swatches plus six bars.
    expect(callsOf(ctx, 'fillRect')).toHaveLength(8)
    const bars = callsOf(ctx, 'fillRect').filter((call) => Number(call.args[2]) > 20)
    expect(bars).toHaveLength(6)
    expect(bars[0]?.fillStyle).toBe(CHART_COLORS.curve[0])
    expect(bars[3]?.fillStyle).toBe(CHART_COLORS.curve[1])
  })

  it('draws scatter points without joining them into a line', () => {
    const ctx = paint({ ...scores, type: 'scatter' })
    expect(callsOf(ctx, 'arc')).toHaveLength(6)
    const seriesStrokes = callsOf(ctx, 'stroke').filter((call) => CHART_COLORS.curve.includes(call.strokeStyle as never))
    expect(seriesStrokes).toHaveLength(0)
  })

  it('draws one pie slice and percentage per datum, ignoring extra series', () => {
    const ctx = paint({
      type: 'pie',
      series: [{ label: '分布', data: [35, 25, 40] }, { label: 'ignored', data: [1, 1] }],
      categories: ['甲', '乙', '丙'],
    })
    expect(callsOf(ctx, 'arc')).toHaveLength(3)
    const percentages = labelsOf(ctx).filter((label) => label.endsWith('%'))
    expect(percentages).toEqual(['35%', '25%', '40%'])
    expect(labelsOf(ctx)).not.toContain('ignored')
    expect(labelsOf(ctx)).toContain('甲')
  })

  it('skips slices with no positive total', () => {
    const ctx = paint({ type: 'pie', series: [{ label: 'empty', data: [0, 0] }] })
    expect(callsOf(ctx, 'arc')).toHaveLength(0)
  })

  it('is a pure function of the payload: identical specs paint identical calls', () => {
    const left = paint(scores)
    const right = paint(scores)
    expect(left.calls).toEqual(right.calls)
    const pie = { type: 'pie', series: [{ label: '分布', data: [1, 2] }, { label: 'extra', data: [9] }] }
    expect(paint(pie).calls).toEqual(paint({ type: 'pie', series: pie.series.slice(0, 1) }).calls)
  })

  it('honors the supplied palette when the host surface turns dark', () => {
    const ctx = stubContext()
    const chart = parseChartPayload(scores) as ChartPayload
    drawChart(ctx, chart, DARK_CHART_COLORS)
    expect(callsOf(ctx, 'stroke').some((call) => call.strokeStyle === DARK_CHART_COLORS.axis)).toBe(true)
    expect(labelsOf(ctx)).toContain('语文')
  })
})

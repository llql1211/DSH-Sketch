/**
 * Canvas 2D painting for the data-chart card.
 *
 * This is a typed, self-contained port of the plot palette and chart primitives
 * used by the expression plotter: the cards package must not import across to
 * the sketch package, so the two small helpers that matter here (surface-aware
 * palette choice and nice axis ticks) live in this file instead.
 *
 * Nothing below reads React, the DOM or the clock. `drawChart` is a pure
 * function of its payload, palette and canvas size, which is what makes a
 * replayed card pixel-for-pixel identical to the original.
 */

import type { ChartPayload } from '@aisketch/cards-core'

/**
 * Every color a chart paints on its canvas.
 *
 * A 2D context cannot resolve `var(--dsw-alias-*)`, so the caller reads the
 * resolved surface and hands down one concrete palette.
 */
export interface ChartPalette {
  /** Axis lines and the zero baseline. */
  readonly axis: string
  /** Value grid lines; the faintest ink in the palette. */
  readonly grid: string
  /** Tick labels, category captions and legend text. */
  readonly text: string
  /** Series colors, assigned by index and cycled past the list. */
  readonly curve: readonly [string, ...string[]]
  /** Percentage labels drawn inside pie slices. */
  readonly pieLabel: string
}

/** Light-theme palette; series colors stay stable across a theme switch. */
export const CHART_COLORS: ChartPalette = {
  axis: '#9aa0a6',
  grid: 'rgba(0,0,0,.07)',
  text: '#5f6368',
  curve: ['#378ADD', '#1D9E75', '#7F77DD', '#EF9F27', '#D4537E', '#0AA3C2', '#8430CE', '#8D6E63'],
  pieLabel: '#ffffff',
}

/** Dark-theme palette: same hierarchy, light ink on a dark surface. */
export const DARK_CHART_COLORS: ChartPalette = {
  axis: '#7c848f',
  grid: 'rgba(255,255,255,.09)',
  text: '#c6ccd4',
  curve: CHART_COLORS.curve,
  pieLabel: '#ffffff',
}

/** Parse a CSS color into RGB channels, or undefined when unrecognised. */
function cssRgb(value: string): { r: number; g: number; b: number; a: number } | undefined {
  const text = value.trim().toLowerCase()
  if (text === '' || text === 'transparent') return { r: 255, g: 255, b: 255, a: 0 }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1]
  if (hex !== undefined) {
    const digits = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: 1,
    }
  }
  const body = /^rgba?\(([^)]+)\)$/.exec(text)?.[1]
  if (body !== undefined) {
    const numbers = body.split(/[\s,/]+/).filter((part) => part !== '').map(Number)
    const [r, g, b] = numbers
    if (r !== undefined && g !== undefined && b !== undefined && [r, g, b].every(Number.isFinite)) {
      return { r, g, b, a: numbers[3] ?? 1 }
    }
  }
  return undefined
}

/**
 * Whether a painted surface is dark enough to need light ink.
 * Perceptual RGB weights; an unresolved or transparent token counts as light.
 * @param cssColor - a computed color such as `rgb(31, 32, 35)` or `#1f2023`.
 * @returns true when the dark palette is needed.
 */
export function isDarkSurface(cssColor: string): boolean {
  const color = cssRgb(cssColor)
  if (color === undefined || color.a === 0) return false
  return (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255 < 0.5
}

/**
 * Pick the palette for the surface the canvas is actually painted on.
 * @param surfaceColor - the canvas's computed background color.
 * @returns the matching palette.
 */
export function chartPaletteFor(surfaceColor: string): ChartPalette {
  return isDarkSurface(surfaceColor) ? DARK_CHART_COLORS : CHART_COLORS
}

/** Canvas size in CSS pixels; the element backs itself at device resolution. */
export const CHART_WIDTH = 620
export const CHART_HEIGHT = 380

/** Gutters: the top row holds the legend, the bottom row category captions. */
const PAD_LEFT = 46
const PAD_RIGHT = 14
const PAD_TOP = 36
const PAD_BOTTOM = 42

/**
 * Pick a "nice" axis step close to a target, from the 1/2/5 progression.
 * @param target - desired step in value units.
 * @returns a human-friendly positive step.
 */
export function niceStep(target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 1
  const exp = Math.floor(Math.log10(target))
  const base = target / 10 ** exp
  const mult = base < 1.5 ? 1 : base < 3.5 ? 2 : base < 7.5 ? 5 : 10
  return mult * 10 ** exp
}

/** @returns a tick label with just enough decimals for the given step. */
function formatTick(value: number, step: number): string {
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(step))))
  return value.toFixed(decimals)
}

/**
 * Choose nice bounds for the value axis, always including zero.
 * @param values - all numbers across every series.
 * @returns `{ min, max, step }` for the value axis.
 */
export function niceDataRange(values: readonly number[]): { min: number; max: number; step: number } {
  if (values.length === 0) return { min: 0, max: 1, step: 0.25 }
  let lo = 0
  let hi = 0
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    lo = Math.min(lo, value)
    hi = Math.max(hi, value)
  }
  if (hi === lo) hi = lo + 1
  const step = niceStep((hi - lo) / 5)
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  return { min: lo, max: hi, step }
}

/**
 * Enumerate tick values without an open-ended float loop.
 * Computed from integer indices so even a sub-ulp step cannot hang the paint.
 */
function ticksOf(min: number, max: number, step: number): number[] {
  if (!(step > 0) || !Number.isFinite(step)) return []
  const first = Math.ceil(min / step - 1e-9)
  const last = Math.floor(max / step + 1e-9)
  const count = Math.min(64, Math.max(0, last - first + 1))
  const values: number[] = []
  for (let index = 0; index < count; index += 1) values.push((first + index) * step)
  return values
}

/** Clip a caption to the space its slot has, without wrapping the canvas. */
function fitLabel(text: string, maxChars: number): string {
  if (maxChars < 2) return ''
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`
}

/** The series color for one index; eight authored colors cover eight series. */
function seriesColor(palette: ChartPalette, index: number): string {
  return palette.curve[index % palette.curve.length] ?? palette.curve[0]
}

/** Paint one legend row of color swatches and captions. */
function drawLegend(
  ctx: CanvasRenderingContext2D,
  entries: readonly { readonly label: string; readonly color: string }[],
  width: number,
  palette: ChartPalette,
): void {
  if (entries.length === 0) return
  const slot = width / entries.length
  const maxChars = Math.max(2, Math.floor(slot / 8) - 2)
  ctx.fillStyle = palette.text
  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  entries.forEach((entry, index) => {
    const x = slot * index + 6
    ctx.fillStyle = entry.color
    ctx.fillRect(x, 10, 10, 10)
    ctx.fillStyle = palette.text
    ctx.fillText(fitLabel(entry.label, maxChars), x + 15, 16)
  })
}

/** Paint the value grid, the zero baseline, the axis and its tick labels. */
function drawValueAxis(
  ctx: CanvasRenderingContext2D,
  plotTop: number,
  plotBottom: number,
  plotRight: number,
  range: { min: number; max: number; step: number },
  valueToY: (value: number) => number,
  palette: ChartPalette,
): void {
  const ticks = ticksOf(range.min, range.max, range.step)
  ctx.lineWidth = 1
  ctx.strokeStyle = palette.grid
  ctx.beginPath()
  for (const tick of ticks) {
    const y = Math.round(valueToY(tick)) + 0.5
    ctx.moveTo(PAD_LEFT, y)
    ctx.lineTo(plotRight, y)
  }
  ctx.stroke()

  // Zero is always in the fitted range; mark it with the stronger ink so a
  // grouped bar stays legible even when the data never crosses it.
  const zeroY = Math.round(valueToY(0)) + 0.5
  ctx.strokeStyle = palette.axis
  ctx.beginPath()
  ctx.moveTo(PAD_LEFT, zeroY)
  ctx.lineTo(plotRight, zeroY)
  ctx.moveTo(PAD_LEFT + 0.5, plotTop)
  ctx.lineTo(PAD_LEFT + 0.5, plotBottom)
  ctx.stroke()

  ctx.fillStyle = palette.text
  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const tick of ticks) ctx.fillText(formatTick(tick, range.step), PAD_LEFT - 6, valueToY(tick))
}

/** Paint captions under the category slots, with a deterministic fallback. */
function drawCategories(
  ctx: CanvasRenderingContext2D,
  categories: readonly string[],
  slots: number,
  slotWidth: number,
  height: number,
  palette: ChartPalette,
): void {
  ctx.fillStyle = palette.text
  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const maxChars = Math.max(3, Math.floor(slotWidth / 8))
  for (let index = 0; index < slots; index += 1) {
    const label = categories[index] ?? String(index + 1)
    ctx.fillText(fitLabel(label, maxChars), PAD_LEFT + slotWidth * (index + 0.5), height - 24)
  }
}

/** Paint a line, scatter or bar chart. */
function drawCartesian(
  ctx: CanvasRenderingContext2D,
  chart: ChartPayload,
  palette: ChartPalette,
  width: number,
  height: number,
): void {
  const plotTop = PAD_TOP
  const plotBottom = height - PAD_BOTTOM
  const plotRight = width - PAD_RIGHT
  const plotWidth = plotRight - PAD_LEFT
  const plotHeight = plotBottom - plotTop
  const values = chart.series.flatMap((entry) => [...entry.data])
  const range = niceDataRange(values)
  const span = range.max - range.min
  const valueToY = (value: number): number => plotTop + plotHeight - ((value - range.min) / span) * plotHeight
  const slots = Math.max(1, ...chart.series.map((entry) => entry.data.length))
  const slotWidth = plotWidth / slots

  drawValueAxis(ctx, plotTop, plotBottom, plotRight, range, valueToY, palette)
  drawCategories(ctx, chart.categories, slots, slotWidth, height, palette)

  ctx.font = '11px system-ui, sans-serif'
  if (chart.type === 'bar') {
    const groupWidth = slotWidth * 0.7
    const barWidth = groupWidth / chart.series.length
    chart.series.forEach((entry, seriesIndex) => {
      ctx.fillStyle = seriesColor(palette, seriesIndex)
      entry.data.forEach((value, index) => {
        const center = PAD_LEFT + slotWidth * (index + 0.5)
        const x = center - groupWidth / 2 + barWidth * seriesIndex
        const y = valueToY(value)
        const zero = valueToY(0)
        ctx.fillRect(x, Math.min(y, zero), Math.max(1, barWidth - 2), Math.abs(zero - y))
      })
    })
    return
  }

  chart.series.forEach((entry, seriesIndex) => {
    const color = seriesColor(palette, seriesIndex)
    const points = entry.data.map((value, index) => ({
      x: PAD_LEFT + slotWidth * (index + 0.5),
      y: valueToY(value),
    }))
    if (chart.type === 'line') {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.beginPath()
      points.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)))
      ctx.stroke()
    }
    ctx.fillStyle = color
    const radius = chart.type === 'line' ? 3.5 : 4.5
    for (const point of points) {
      ctx.beginPath()
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

/** Paint a pie: the first series only, with a percentage inside every slice. */
function drawPie(
  ctx: CanvasRenderingContext2D,
  chart: ChartPayload,
  palette: ChartPalette,
  width: number,
  height: number,
): void {
  const first = chart.series[0]
  if (first === undefined) return
  // A negative share cannot be a slice; clamping keeps the ring honest without
  // refusing a payload with signed values (a line chart can still draw them).
  const values = first.data.map((value) => Math.max(0, value))
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return

  const cx = width / 2
  const cy = (PAD_TOP + height - PAD_BOTTOM) / 2
  const radius = Math.min(width - PAD_LEFT - PAD_RIGHT, height - PAD_TOP - PAD_BOTTOM) * 0.42
  let angle = -Math.PI / 2
  values.forEach((value, index) => {
    const share = value / total
    const slice = share * Math.PI * 2
    ctx.fillStyle = seriesColor(palette, index)
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, radius, angle, angle + slice)
    ctx.closePath()
    ctx.fill()
    if (share > 0) {
      const mid = angle + slice / 2
      ctx.fillStyle = palette.pieLabel
      ctx.font = '12px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${Math.round(share * 100)}%`, cx + Math.cos(mid) * radius * 0.68, cy + Math.sin(mid) * radius * 0.68)
    }
    angle += slice
  })
}

/**
 * Draw one chart into a 2D context.
 *
 * The only inputs are the parsed payload, an ink palette and a canvas size; no
 * random source, clock, locale or interaction state enters the picture.
 * @param ctx - the 2D context, already transformed to CSS pixels.
 * @param chart - the parsed chart payload.
 * @param palette - ink for the current surface.
 * @param width - CSS pixel width.
 * @param height - CSS pixel height.
 */
export function drawChart(
  ctx: CanvasRenderingContext2D,
  chart: ChartPayload,
  palette: ChartPalette = CHART_COLORS,
  width: number = CHART_WIDTH,
  height: number = CHART_HEIGHT,
): void {
  ctx.clearRect(0, 0, width, height)
  const first = chart.series[0]
  const legendEntries = chart.type === 'pie'
    ? (first?.data ?? []).slice(0, 8).map((_value, index) => ({
      label: chart.categories[index] ?? `${first?.label ?? ''} ${index + 1}`.trim(),
      color: seriesColor(palette, index),
    }))
    : chart.series.map((entry, index) => ({ label: entry.label, color: seriesColor(palette, index) }))
  drawLegend(ctx, legendEntries, width, palette)

  if (chart.type === 'pie') drawPie(ctx, chart, palette, width, height)
  else drawCartesian(ctx, chart, palette, width, height)
}

/**
 * Canvas rendering for the AISketch function canvas.
 *
 * This is a typed port of the prototype's `renderer.js`. It lives in the
 * browser package rather than in `@aisketch/sketch-core` on purpose: the core
 * owns the maths (what curve to draw), this owns the pixels (how it looks).
 * Data charts are no longer drawn here -- they belong to show_card's `chart`
 * kind, whose renderer lives with the other cards.
 *
 * Nothing here reads React or the DOM beyond the 2D context it is handed, so
 * the drawing can be exercised from a test with a stub context.
 */

/** Every color a plot paints on its canvas. */
export interface ChartPalette {
  /** Axis lines. */
  readonly axis: string
  /** Grid lines; the faintest ink in the palette. */
  readonly grid: string
  /** Tick labels and category captions. */
  readonly text: string
  /** Series colors, cycled for extra curves; the first is always available. */
  readonly curve: readonly [string, ...string[]]
  /** Tangent line. */
  readonly tangent: string
  /** Highlighted point and its readout. */
  readonly point: string
  /** Riemann bar fill. */
  readonly rect: string
  /** Riemann bar edge. */
  readonly rectEdge: string
}

/** Light-theme palette, kept as the default so every existing caller stays valid. */
export const COLORS: ChartPalette = {
  axis: '#9aa0a6',
  grid: 'rgba(0,0,0,.07)',
  curve: ['#378ADD', '#1D9E75', '#7F77DD', '#EF9F27', '#D4537E'],
  tangent: '#E24B4A',
  point: '#E24B4A',
  rect: 'rgba(55,138,221,.24)',
  rectEdge: '#378ADD',
  text: '#5f6368',
}

/** Dark-theme palette; series colors stay the same across a theme switch. */
export const DARK_COLORS: ChartPalette = {
  axis: '#7c848f',
  grid: 'rgba(255,255,255,.09)',
  curve: COLORS.curve,
  tangent: '#ff6b6b',
  point: '#ff6b6b',
  rect: 'rgba(55,138,221,.28)',
  rectEdge: '#5b9cf0',
  text: '#c6ccd4',
}

/** Parse a CSS color into RGB channels, or `undefined` when unrecognised. */
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
    const numbers = body.split(/[\s,/]+/).filter((p) => p !== '').map(Number)
    const [r, g, b] = numbers
    if (r !== undefined && g !== undefined && b !== undefined && [r, g, b].every(Number.isFinite)) {
      return { r, g, b, a: numbers[3] ?? 1 }
    }
  }
  return undefined
}

/** Whether a painted surface is dark enough to need light ink. */
export function isDarkSurface(cssColor: string): boolean {
  const color = cssRgb(cssColor)
  if (color === undefined || color.a === 0) return false
  const luminance = (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255
  return luminance < 0.5
}

/** Pick the plot palette for the surface the canvas is actually painted on. */
export function chartPaletteFor(surfaceColor: string): ChartPalette {
  return isDarkSurface(surfaceColor) ? DARK_COLORS : COLORS
}

/** One math-space point; a null `y` marks a gap the stroke must not cross. */
export type Sample = readonly [number, number | null]

/** A viewport describing the visible math region. */
export class Viewport {
  constructor(
    readonly xMin: number,
    readonly xMax: number,
    readonly yMin: number,
    readonly yMax: number,
  ) {}

  width = 0
  height = 0

  fit(width: number, height: number): this {
    this.width = width
    this.height = height
    return this
  }

  px(x: number): number {
    return ((x - this.xMin) / (this.xMax - this.xMin)) * this.width
  }

  py(y: number): number {
    return this.height - ((y - this.yMin) / (this.yMax - this.yMin)) * this.height
  }

  xAt(px: number): number {
    return this.xMin + (px / this.width) * (this.xMax - this.xMin)
  }

  yAt(py: number): number {
    return this.yMin + ((this.height - py) / this.height) * (this.yMax - this.yMin)
  }
}

/** Widen math bounds to one scale for the "equal aspect" view. */
export function squareBounds(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  width: number,
  height: number,
): readonly [number, number, number, number] {
  if (width <= 0 || height <= 0) return [xMin, xMax, yMin, yMax]
  const xSpan = xMax - xMin
  const ySpan = yMax - yMin
  if (!(xSpan > 0) || !(ySpan > 0)) return [xMin, xMax, yMin, yMax]
  const scale = Math.min(width / xSpan, height / ySpan)
  const cx = (xMin + xMax) / 2
  const cy = (yMin + yMax) / 2
  return [
    cx - width / scale / 2,
    cx + width / scale / 2,
    cy - height / scale / 2,
    cy + height / scale / 2,
  ]
}

/** Pick a "nice" axis step close to a target, from the 1/2/5 progression. */
function niceStep(target: number): number {
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

/** Draw grid lines, axes, and tick labels for the current viewport. */
export function drawAxes(ctx: CanvasRenderingContext2D, vp: Viewport, palette: ChartPalette = COLORS): void {
  const { width: w, height: h } = vp
  ctx.clearRect(0, 0, w, h)
  ctx.lineWidth = 1

  const xStep = niceStep((vp.xMax - vp.xMin) / 8)
  const yStep = niceStep((vp.yMax - vp.yMin) / 6)

  ctx.strokeStyle = palette.grid
  ctx.beginPath()
  for (let x = Math.ceil(vp.xMin / xStep) * xStep; x <= vp.xMax; x += xStep) {
    const px = Math.round(vp.px(x)) + 0.5
    ctx.moveTo(px, 0)
    ctx.lineTo(px, h)
  }
  for (let y = Math.ceil(vp.yMin / yStep) * yStep; y <= vp.yMax; y += yStep) {
    const py = Math.round(vp.py(y)) + 0.5
    ctx.moveTo(0, py)
    ctx.lineTo(w, py)
  }
  ctx.stroke()

  const xAxisY = Math.round(vp.py(Math.min(Math.max(0, vp.yMin), vp.yMax))) + 0.5
  const yAxisX = Math.round(vp.px(Math.min(Math.max(0, vp.xMin), vp.xMax))) + 0.5
  ctx.strokeStyle = palette.axis
  ctx.beginPath()
  ctx.moveTo(0, xAxisY)
  ctx.lineTo(w, xAxisY)
  ctx.moveTo(yAxisX, 0)
  ctx.lineTo(yAxisX, h)
  ctx.stroke()

  ctx.fillStyle = palette.text
  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let x = Math.ceil(vp.xMin / xStep) * xStep; x <= vp.xMax; x += xStep) {
    if (Math.abs(x) < xStep / 100) continue
    ctx.fillText(formatTick(x, xStep), vp.px(x), Math.min(xAxisY + 4, h - 14))
  }
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let y = Math.ceil(vp.yMin / yStep) * yStep; y <= vp.yMax; y += yStep) {
    if (Math.abs(y) < yStep / 100) continue
    ctx.fillText(formatTick(y, yStep), Math.max(yAxisX - 4, 28), vp.py(y))
  }
}

/** Draw one sampled curve. Gaps (nulls) break the stroke instead of connecting. */
export function drawCurve(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  points: readonly Sample[],
  color: string,
  lineWidth = 2,
  dash: readonly number[] = [],
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.setLineDash([...dash])
  ctx.beginPath()
  let pen = false
  for (const [x, y] of points) {
    if (y === null) {
      pen = false
      continue
    }
    const sx = vp.px(x)
    const sy = vp.py(y)
    if (!pen) {
      ctx.moveTo(sx, sy)
      pen = true
    } else {
      ctx.lineTo(sx, sy)
    }
  }
  ctx.stroke()
  ctx.setLineDash([])
}

/** Draw a finite vertical guide between two math-space y values. */
export function drawVLine(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  x: number,
  y0: number,
  y1: number,
  color: string,
  dash: readonly number[] = [],
  width = 2,
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash([...dash])
  ctx.beginPath()
  ctx.moveTo(vp.px(x), vp.py(y0))
  ctx.lineTo(vp.px(x), vp.py(y1))
  ctx.stroke()
  ctx.setLineDash([])
}

/** One note anchor: either a dot with a caption, or a floating text label. */
export interface NoteDraw {
  readonly x: number
  readonly y: number
  readonly text: string | undefined
  readonly dx: number
  readonly dy: number
  readonly color: string
  readonly dot: boolean
}

/** Draw a point note or a floating text note in math coordinates. */
export function drawNote(ctx: CanvasRenderingContext2D, vp: Viewport, note: NoteDraw): void {
  const sx = vp.px(note.x)
  const sy = vp.py(note.y)
  ctx.fillStyle = note.color
  ctx.strokeStyle = note.color
  if (note.dot) {
    ctx.beginPath()
    ctx.arc(sx, sy, 4.5, 0, Math.PI * 2)
    ctx.fill()
  }
  if (note.text === undefined || note.text === '') return
  const tx = sx + note.dx
  const ty = sy + note.dy
  if (note.dot) {
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(tx - (note.dx < 0 ? -2 : 2), ty + 2)
    ctx.stroke()
  }
  ctx.font = '12px system-ui, sans-serif'
  ctx.textAlign = note.dx < 0 ? 'right' : 'left'
  ctx.textBaseline = note.dy < 0 ? 'bottom' : 'top'
  ctx.fillText(note.text, tx, ty)
}

/** Draw a highlighted point with an optional label. */
export function drawPoint(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  x: number,
  y: number,
  label: string | undefined,
  color: string = COLORS.point,
): void {
  drawNote(ctx, vp, { x, y, text: label, dx: 8, dy: -6, color, dot: true })
}

/** One Riemann rectangle as `[leftEdge, height]` in math coordinates. */
export type Bar = readonly [leftEdge: number, height: number]

/** Draw the area mark's rectangles; the heights are the ones the sum used. */
export function drawBars(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  bars: readonly Bar[],
  a: number,
  b: number,
  palette: ChartPalette = COLORS,
): void {
  const step = (b - a) / Math.max(1, bars.length)
  ctx.fillStyle = palette.rect
  ctx.strokeStyle = palette.rectEdge
  ctx.lineWidth = 1
  for (let i = 0; i < bars.length; i += 1) {
    const [left, height] = bars[i] as Bar
    if (!Number.isFinite(height)) continue
    const x0 = vp.px(left)
    const x1 = vp.px(left + step)
    const y0 = vp.py(0)
    const y1 = vp.py(height)
    ctx.fillRect(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0))
    if (bars.length <= 40) ctx.strokeRect(x0 + 0.5, Math.min(y0, y1) + 0.5, x1 - x0 - 1, Math.abs(y1 - y0) - 1)
  }
}

/** One legend swatch: the label and the exact stroke that represents it. */
export interface LegendEntry {
  readonly label: string
  readonly color: string
  readonly dash: readonly number[]
  readonly width: number
}

/** Draw a compact legend in the top-right corner, over a translucent backdrop. */
export function drawLegend(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  entries: readonly LegendEntry[],
  palette: ChartPalette = COLORS,
): void {
  if (entries.length === 0) return
  const rowH = 18
  const boxW = 150
  const boxH = entries.length * rowH + 10
  const x0 = vp.width - boxW - 8
  const y0 = 8
  ctx.fillStyle = palette === DARK_COLORS ? 'rgba(20,20,24,.72)' : 'rgba(255,255,255,.78)'
  ctx.fillRect(x0, y0, boxW, boxH)
  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  entries.forEach((entry, index) => {
    const y = y0 + 9 + index * rowH + rowH / 2 - 9
    ctx.strokeStyle = entry.color
    ctx.lineWidth = Math.max(1, entry.width)
    ctx.setLineDash([...entry.dash])
    ctx.beginPath()
    ctx.moveTo(x0 + 8, y)
    ctx.lineTo(x0 + 36, y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = palette.text
    const label = entry.label.length > 16 ? `${entry.label.slice(0, 15)}…` : entry.label
    ctx.fillText(label, x0 + 42, y)
  })
}

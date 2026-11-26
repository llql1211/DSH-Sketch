/**
 * Function-canvas spec and geometry.
 *
 * The canvas is the replacement for the old six-mode sketch spec: one window,
 * a list of `y = f(x)` curves with optional styling, and a list of optional
 * marks (tangent, area, Taylor polynomial, point or text note). There is no
 * mode and no primary curve -- curve zero is simply the first entry.
 *
 * `upgradeSpec` is the single adapter for old persisted specs and tool-argument
 * spellings. It deliberately returns null for the retired `data` mode: a chart
 * fence must not silently degrade into an unrelated function line.
 *
 * Geometry is a pure function of the spec, as in `geometry.ts`: the Host tool
 * and the browser card call the same resolver, so a replayed session draws
 * exactly the same picture.
 */

import { build, derivativeAt, integrate, taylorCoefficients, taylorEvaluator } from './parser.ts'
import type { CompiledExpression, CompiledFn } from './parser.ts'
import { autoRangeY, resolveXRange, splitCurveLine } from './geometry.ts'
import type { Point, Range } from './geometry.ts'

/** Dash choices the model may name. The exact pixel rhythm is fixed here. */
export const DASH_PRESETS = ['solid', 'dashed', 'dotted'] as const

/** One dash choice for a curve. */
export type DashPreset = typeof DASH_PRESETS[number]

/**
 * The only dash arrays the canvas can produce. Models choose a name, not
 * numbers: `[6,4]` and `[5,5]` are indistinguishable on a card, so exposing
 * raw arrays only invites breakdowns in readability.
 */
export const DASH_ARRAYS: Readonly<Record<DashPreset, readonly number[]>> = {
  solid: [],
  dashed: [6, 4],
  dotted: [2, 3],
}

/** Upper bound on curves in one canvas, so a call cannot flood a transcript. */
export const MAX_CANVAS_CURVES = 8

/** Upper bound on marks in one canvas. */
export const MAX_CANVAS_MARKS = 12

/** Upper bound on a curve label or mark label. */
export const MAX_CANVAS_LABEL = 48

/** Upper bound on a free note's text. */
export const MAX_CANVAS_TEXT = 80

/** Named colors accepted alongside `#rgb` / `#rrggbb`. */
export const SKETCH_COLOR_NAMES = [
  'black', 'gray', 'red', 'orange', 'yellow', 'green', 'teal', 'cyan',
  'blue', 'purple', 'pink', 'brown', 'white',
] as const

/** Hex color forms a curve color accepts. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Whether a value is an admitted color literal. Nothing else reaches canvas. */
export function isSketchColor(value: unknown): value is string {
  return typeof value === 'string'
    && (HEX_COLOR.test(value.trim()) || (SKETCH_COLOR_NAMES as readonly string[]).includes(value.trim()))
}

/** Optional styling for one curve; omitting every field yields the palette default. */
export interface CurveStyle {
  /** Stroke color; the renderer's palette is cycled when absent. */
  readonly color?: string
  /** Stroke rhythm; solid when absent. */
  readonly dash?: DashPreset
  /** Stroke width, 0.5..6; 2 when absent. */
  readonly width?: number
  /** Label shown in the legend; unused when absent. */
  readonly label?: string
}

/** One curve: a bare expression, or an expression with optional styling. */
export type CurveSpec = string | (CurveStyle & { readonly expr: string })

/** A tangent line at a point of a curve. `x` defaults to the window centre. */
export interface TangentMark {
  readonly type: 'tangent'
  /** Zero-based curve index; defaults to 0. */
  readonly curve?: number
  /** Abscissa of the tangent point. */
  readonly x?: number
}

/** A left-endpoint Riemann sum under a curve. */
export interface AreaMark {
  readonly type: 'area'
  readonly curve?: number
  /** Lower bound. */
  readonly a: number
  /** Upper bound. */
  readonly b: number
  /** Rectangle count, 1..200; 15 when absent. */
  readonly n?: number
}

/** A Taylor polynomial drawn over the same window. */
export interface PolyMark {
  readonly type: 'poly'
  readonly curve?: number
  /** Expansion point; 0 when absent. */
  readonly center?: number
  /** Highest degree, 1..12; 5 when absent. */
  readonly order?: number
  /** Legend label; `Tn` when absent. */
  readonly label?: string
}

/** A dot anchored at a data coordinate with an optional caption. */
export interface PointMark {
  readonly type: 'point'
  readonly x: number
  readonly y: number
  readonly text?: string
  /** Text offset from the dot, in pixels; defaults to 8 and -6. */
  readonly dx?: number
  readonly dy?: number
  readonly color?: string
}

/** A floating text note at a data coordinate, with no dot or leader. */
export interface TextMark {
  readonly type: 'text'
  readonly x: number
  readonly y: number
  readonly text: string
  readonly color?: string
}

/**
 * A finite vertical guide, e.g. from the x-axis to a curve value.
 * `y1` defaults to f(x) on the referenced curve, `y0` defaults to zero.
 */
export interface VLineMark {
  readonly type: 'vline'
  readonly x: number
  readonly curve?: number
  readonly y0?: number
  readonly y1?: number
  readonly label?: string
  readonly color?: string
  readonly dash?: DashPreset
  readonly width?: number
}

/** Every optional layer that can sit on top of the curves. */
export type MarkSpec = TangentMark | AreaMark | PolyMark | PointMark | TextMark | VLineMark

/** A three-number parameter tuple: `[min, max, value]`. */
export type CanvasParam = readonly [min: number, max: number, value: number]

/** The complete canvas request. */
export interface CanvasSpec {
  /** Curves in draw order; 1..MAX_CANVAS_CURVES. */
  readonly curves: readonly CurveSpec[]
  /** Explicit x-window; auto-fitted when absent. */
  readonly x?: readonly [number, number]
  /** Explicit y-window; fitted from all curves when absent. */
  readonly y?: readonly [number, number]
  /** Named sliders shared by every curve. */
  readonly params?: Readonly<Record<string, CanvasParam>>
  /** Optional annotation layers. */
  readonly marks?: readonly MarkSpec[]
  /** Draw a legend for labelled curves; on when absent. */
  readonly legend?: boolean
}

/** Sampling density, shared with the legacy engine so both draw the same smoothness. */
const SAMPLES = 900

/** One curve's resolved geometry, including the style the renderer must use. */
export interface CanvasCurveGeometry {
  readonly expr: string
  readonly label: string | undefined
  readonly color: string | undefined
  readonly dash: readonly number[]
  readonly width: number
  readonly points: readonly Point[]
}

/** Resolved tangent geometry. */
export interface TangentGeometry {
  readonly type: 'tangent'
  readonly curve: number
  readonly x: number
  readonly y: number
  readonly slope: number
}

/** Resolved area geometry. */
export interface AreaGeometry {
  readonly type: 'area'
  readonly curve: number
  readonly a: number
  readonly b: number
  readonly n: number
  /** Rectangle tops as `[leftEdge, height]`. */
  readonly bars: readonly (readonly [number, number])[]
  readonly sum: number
  readonly exact: number
}

/** Resolved Taylor geometry. */
export interface PolyGeometry {
  readonly type: 'poly'
  readonly curve: number
  readonly center: number
  readonly order: number
  readonly coefficients: readonly number[]
  readonly label: string
  readonly points: readonly Point[]
}

/** Resolved finite vertical guide geometry. */
export interface VLineGeometry {
  readonly type: 'vline'
  readonly x: number
  readonly y0: number
  readonly y1: number
  readonly label: string | undefined
  readonly color: string | undefined
  readonly dash: readonly number[]
  readonly width: number
}

/** Resolved point/text note geometry. */
export interface NoteGeometry {
  readonly type: 'point' | 'text'
  readonly x: number
  readonly y: number
  readonly text: string | undefined
  readonly dx: number
  readonly dy: number
  readonly color: string | undefined
}

/** Every mark the renderer needs for one frame. */
export type CanvasMarkGeometry = TangentGeometry | AreaGeometry | PolyGeometry | NoteGeometry | VLineGeometry

/** Everything the canvas renderer needs for one frame. */
export interface CanvasGeometry {
  readonly xRange: readonly [number, number]
  readonly yRange: Range
  readonly curves: readonly CanvasCurveGeometry[]
  readonly marks: readonly CanvasMarkGeometry[]
}

/** Narrow an unknown value to a non-array object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a finite `[lo, hi]` pair with a strictly increasing order. */
function asPair(value: unknown): readonly [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined
  const lo = value[0]
  const hi = value[1]
  if (typeof lo !== 'number' || typeof hi !== 'number') return undefined
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return undefined
  return [lo, hi]
}

/** Read a bounds object such as `{ x: [lo, hi] }`. */
function asBounds(value: unknown): readonly [number, number] | undefined {
  if (!isObject(value)) return undefined
  return asPair(value.x)
}

/** Read named parameter tuples, dropping anything that is not a valid tuple. */
function asParams(value: unknown): Record<string, CanvasParam> | undefined {
  if (!isObject(value)) return undefined
  const out: Record<string, CanvasParam> = {}
  for (const [name, raw] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
    if (!Array.isArray(raw) || raw.length !== 3) continue
    const bound = asPair([raw[0], raw[1]])
    if (bound === undefined || typeof raw[2] !== 'number' || !Number.isFinite(raw[2])) continue
    if (raw[2] < bound[0] || raw[2] > bound[1]) continue
    out[name] = [bound[0], bound[1], raw[2]]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Whether a string is a valid math expression. */
function compiles(expr: string): boolean {
  try {
    build(expr)
    return true
  } catch {
    return false
  }
}

/**
 * Read one curve from either a bare expression or a styled object.
 *
 * A legacy `"label, expr"` line is split into a labelled object only when the
 * suffix compiles and the whole line does not. That keeps a legitimate
 * expression such as `min(x, 1)` intact while still accepting old fences.
 */
function asCurve(value: unknown): CurveSpec | undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.length === 0) return undefined
    const parts = splitCurveLine(text)
    if (parts.expr !== text && compiles(parts.expr) && !compiles(text)) {
      return parts.label === undefined ? parts.expr : { expr: parts.expr, label: parts.label }
    }
    return text
  }
  if (!isObject(value)) return undefined
  const expr = value.expr
  if (typeof expr !== 'string' || expr.trim().length === 0) return undefined
  const out: { expr: string; color?: string; dash?: DashPreset; width?: number; label?: string } = { expr: expr.trim() }
  if (isSketchColor(value.color)) out.color = value.color.trim()
  if (typeof value.dash === 'string' && (DASH_PRESETS as readonly string[]).includes(value.dash)) {
    out.dash = value.dash as DashPreset
  }
  if (typeof value.width === 'number' && Number.isFinite(value.width) && value.width >= 0.5 && value.width <= 6) {
    out.width = value.width
  }
  if (typeof value.label === 'string' && value.label.trim().length > 0) {
    out.label = value.label.trim().slice(0, MAX_CANVAS_LABEL)
  }
  return out
}

/** Read a finite number, or undefined for anything the renderer could not use. */
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Read one optional mark from an untyped fence or tool argument. */
function asMark(value: unknown): MarkSpec | undefined {
  if (!isObject(value)) return undefined
  const type = value.type
  if (typeof type !== 'string') return undefined
  const curve = asNumber(value.curve)
  const color = isSketchColor(value.color) ? value.color.trim() : undefined

  if (type === 'tangent') {
    const x = asNumber(value.x)
    return { type, ...curve === undefined ? {} : { curve }, ...x === undefined ? {} : { x } }
  }
  if (type === 'area') {
    const a = asNumber(value.a)
    const b = asNumber(value.b)
    if (a === undefined || b === undefined || !(b > a)) return undefined
    const n = asNumber(value.n)
    return {
      type, a, b, ...curve === undefined ? {} : { curve },
      ...n === undefined ? {} : { n: Math.min(200, Math.max(1, Math.round(n))) },
    }
  }
  if (type === 'poly') {
    const center = asNumber(value.center)
    const order = asNumber(value.order)
    const label = typeof value.label === 'string' && value.label.trim().length > 0
      ? value.label.trim().slice(0, MAX_CANVAS_LABEL)
      : undefined
    return {
      type,
      ...curve === undefined ? {} : { curve },
      ...center === undefined ? {} : { center },
      ...order === undefined ? {} : { order: Math.min(12, Math.max(1, Math.round(order))) },
      ...label === undefined ? {} : { label },
    }
  }
  if (type === 'vline') {
    const x = asNumber(value.x)
    if (x === undefined) return undefined
    const y0 = asNumber(value.y0)
    const y1 = asNumber(value.y1)
    const label = typeof value.label === 'string' && value.label.trim().length > 0
      ? value.label.trim().slice(0, MAX_CANVAS_LABEL)
      : undefined
    const dash = typeof value.dash === 'string' && (DASH_PRESETS as readonly string[]).includes(value.dash)
      ? value.dash as DashPreset
      : undefined
    const width = asNumber(value.width)
    return {
      type, x,
      ...curve === undefined ? {} : { curve },
      ...y0 === undefined ? {} : { y0 },
      ...y1 === undefined ? {} : { y1 },
      ...label === undefined ? {} : { label },
      ...color === undefined ? {} : { color },
      ...dash === undefined ? {} : { dash },
      ...width === undefined ? {} : { width: Math.min(6, Math.max(0.5, width)) },
    }
  }
  if (type === 'point' || type === 'text') {
    const x = asNumber(value.x)
    const y = asNumber(value.y)
    if (x === undefined || y === undefined) return undefined
    const text = typeof value.text === 'string' && value.text.length > 0
      ? value.text.slice(0, MAX_CANVAS_TEXT)
      : undefined
    if (type === 'text') {
      if (text === undefined) return undefined
      return { type, x, y, text, ...color === undefined ? {} : { color } }
    }
    const dx = asNumber(value.dx)
    const dy = asNumber(value.dy)
    return {
      type, x, y,
      ...text === undefined ? {} : { text },
      ...dx === undefined ? {} : { dx },
      ...dy === undefined ? {} : { dy },
      ...color === undefined ? {} : { color },
    }
  }
  return undefined
}

/** Build the legacy mark implied by an old `mode`, when one was declared. */
function legacyModeMark(raw: Record<string, unknown>): MarkSpec | undefined {
  const mode = raw.mode
  if (typeof mode !== 'string') return undefined
  if (mode === 'tangent') {
    const x = asNumber(raw.probe)
    return { type: 'tangent', ...x === undefined ? {} : { x } }
  }
  if (mode === 'riemann') {
    const a = asNumber(raw.a) ?? 0
    const b = asNumber(raw.b) ?? Math.PI
    if (!(b > a)) return undefined
    const n = asNumber(raw.n)
    return { type: 'area', a, b, ...n === undefined ? {} : { n: Math.min(200, Math.max(1, Math.round(n))) } }
  }
  if (mode === 'taylor') {
    const center = asNumber(raw.center) ?? asNumber(raw.centerX) ?? 0
    const order = asNumber(raw.order)
    return {
      type: 'poly', center,
      ...order === undefined ? {} : { order: Math.min(12, Math.max(1, Math.round(order))) },
    }
  }
  return undefined
}

/**
 * Upgrade any admitted sketch spelling into the canvas spec.
 *
 * Accepts the new canvas fields, the old canonical spec (`expr` + `compare` +
 * `mode`) and the old tool-argument names (`x_min`, `y_max`, `curves`, ...).
 * A payload naming the retired `data` mode is refused outright: drawing a
 * function line in its place would look like a successful render of the wrong
 * chart.
 *
 * @param value - an untyped spec-like object.
 * @returns the canvas spec, or null when nothing drawable remains.
 */
export function upgradeSpec(value: unknown): CanvasSpec | null {
  if (!isObject(value)) return null
  if ('data' in value || 'dataset' in value || 'series' in value) return null

  const curves: CurveSpec[] = []
  if (typeof value.expr === 'string') {
    const curve = asCurve(value.expr)
    if (curve !== undefined) curves.push(curve)
  }
  if (Array.isArray(value.curves)) {
    for (const raw of value.curves) {
      if (curves.length >= MAX_CANVAS_CURVES) break
      const curve = asCurve(raw)
      if (curve !== undefined) curves.push(curve)
    }
  }
  if (Array.isArray(value.compare)) {
    for (const raw of value.compare) {
      if (curves.length >= MAX_CANVAS_CURVES) break
      const curve = asCurve(raw)
      if (curve !== undefined) curves.push(curve)
    }
  }
  if (curves.length === 0 || curves.length > MAX_CANVAS_CURVES) return null

  const x = asPair(value.x) ?? asBounds(value.range)
    ?? asPair([value.x_min, value.x_max])
  const y = asPair(value.y) ?? asPair([value.y_min, value.y_max])

  const marks: MarkSpec[] = []
  if (Array.isArray(value.marks)) {
    for (const raw of value.marks) {
      if (marks.length >= MAX_CANVAS_MARKS) break
      const mark = asMark(raw)
      if (mark !== undefined) marks.push(mark)
    }
  } else {
    const legacy = legacyModeMark(value)
    if (legacy !== undefined) marks.push(legacy)
  }

  const params = asParams(value.params)
  return {
    curves,
    ...x === undefined ? {} : { x },
    ...y === undefined ? {} : { y },
    ...params === undefined ? {} : { params },
    ...marks.length === 0 ? {} : { marks },
    ...typeof value.legend === 'boolean' ? { legend: value.legend } : {},
  }
}

/**
 * Resolve a canvas spec into everything the renderer needs.
 *
 * A spec that cannot compile yields an empty curve rather than throwing: a card
 * with no line is a better failure than a broken transcript. An explicit y
 * window always wins over both auto-fitting and a caller-supplied frozen range.
 *
 * @param spec - the canvas request.
 * @param options.frozenYRange - hold this y-window instead of fitting one.
 * @returns the geometry to draw.
 */
export function resolveCanvas(
  spec: CanvasSpec,
  options: { frozenYRange?: Range } = {},
): CanvasGeometry {
  const params: Record<string, number> = {}
  for (const [name, tuple] of Object.entries(spec.params ?? {})) params[name] = tuple[2]

  const first = spec.curves[0]
  const firstExpr = typeof first === 'string' ? first : (first?.expr ?? '')
  let probe: CompiledExpression | undefined
  try {
    probe = build(firstExpr)
  } catch {
    probe = undefined
  }
  const xRange: readonly [number, number] = spec.x ?? resolveXRange(
    { expr: firstExpr }, 'plain', 5, probe,
  )
  const [xMin, xMax] = xRange

  const compiled = new Map<string, CompiledExpression>()
  const curves: CanvasCurveGeometry[] = []
  for (let index = 0; index < spec.curves.length; index += 1) {
    const raw = spec.curves[index] as CurveSpec
    const expr = typeof raw === 'string' ? raw : raw.expr
    let fn = compiled.get(expr)
    if (fn === undefined) {
      try {
        fn = build(expr)
        compiled.set(expr, fn)
      } catch {
        fn = undefined
      }
    }
    const style: CurveStyle = typeof raw === 'string' ? {} : raw
    const dash = style.dash ?? 'solid'
    curves.push({
      expr,
      label: style.label,
      color: style.color,
      dash: DASH_ARRAYS[dash] ?? DASH_ARRAYS.solid,
      width: style.width ?? 2,
      points: fn === undefined ? [] : fn.sample(xMin, xMax, SAMPLES, params).map(([x, y]) => ({ x, y })),
    })
  }

  const fitted = options.frozenYRange ?? autoRangeY(
    curves.flatMap((curve) => curve.points.map((p) => [p.x, p.y] as const)),
  )
  const yRange: Range = spec.y === undefined
    ? fitted
    : { yMin: spec.y[0], yMax: spec.y[1] }

  const evaluator = (index: number | undefined): CompiledFn | undefined => {
    const at = index === undefined ? 0 : Math.min(Math.max(0, Math.round(index)), curves.length - 1)
    const curve = curves[at]
    const found = curve === undefined ? undefined : compiled.get(curve.expr)
    return found?.eval
  }

  const marks: CanvasMarkGeometry[] = []
  for (const mark of spec.marks ?? []) {
    if (mark.type === 'tangent') {
      const fn = evaluator(mark.curve)
      if (fn === undefined) continue
      const x = mark.x ?? (xMin + xMax) / 2
      marks.push({ type: 'tangent', curve: mark.curve ?? 0, x, y: fn({ ...params, x }), slope: derivativeAt(fn, x, params) })
      continue
    }
    if (mark.type === 'area') {
      const fn = evaluator(mark.curve)
      if (fn === undefined) continue
      const n = Math.min(200, Math.max(1, Math.round(mark.n ?? 15)))
      const width = (mark.b - mark.a) / n
      const bars: (readonly [number, number])[] = []
      let sum = 0
      for (let i = 0; i < n; i += 1) {
        const left = mark.a + i * width
        const height = fn({ ...params, x: left })
        const finite = Number.isFinite(height) ? height : 0
        bars.push([left, finite])
        sum += finite * width
      }
      const exact = Number.isFinite(fn({ ...params, x: mark.a }))
        ? integrate(fn, mark.a, mark.b, params, 2000)
        : 0
      marks.push({ type: 'area', curve: mark.curve ?? 0, a: mark.a, b: mark.b, n, bars, sum, exact })
      continue
    }
    if (mark.type === 'poly') {
      const fn = evaluator(mark.curve)
      if (fn === undefined) continue
      const center = mark.center ?? 0
      const order = Math.min(12, Math.max(1, Math.round(mark.order ?? 5)))
      const coefficients = taylorCoefficients(fn, center, params, order)
      const poly = taylorEvaluator(coefficients, center)
      const step = (xMax - xMin) / (SAMPLES - 1)
      const points: Point[] = []
      for (let i = 0; i < SAMPLES; i += 1) {
        const x = xMin + step * i
        const y = poly(x)
        points.push({ x, y: Number.isFinite(y) ? y : null })
      }
      marks.push({
        type: 'poly', curve: mark.curve ?? 0, center, order, coefficients,
        label: mark.label ?? `T${order}`, points,
      })
      continue
    }
    if (mark.type === 'vline') {
      const fn = evaluator(mark.curve)
      const fallback = fn === undefined ? Number.NaN : fn({ ...params, x: mark.x })
      const y1 = mark.y1 ?? fallback
      if (!Number.isFinite(y1)) continue
      const dash = mark.dash ?? 'solid'
      marks.push({
        type: 'vline', x: mark.x, y0: mark.y0 ?? 0, y1,
        label: mark.label, color: mark.color,
        dash: DASH_ARRAYS[dash] ?? DASH_ARRAYS.solid,
        width: mark.width ?? 2,
      })
      continue
    }
    const isPoint = mark.type === 'point'
    marks.push({
      type: mark.type,
      x: mark.x,
      y: mark.y,
      text: mark.text,
      dx: isPoint ? (mark.dx ?? 8) : 0,
      dy: isPoint ? (mark.dy ?? -6) : 0,
      color: mark.color,
    })
  }

  return { xRange, yRange, curves, marks }
}

/** Expressions of every curve, in draw order; used by the hover tracer. */
export function canvasExpressions(spec: CanvasSpec): readonly string[] {
  return spec.curves.map((curve) => typeof curve === 'string' ? curve : curve.expr)
}

/** Every identifier that needs a slider, across all curves. */
export function canvasParameters(spec: CanvasSpec): readonly string[] {
  const names = new Set<string>()
  for (const expr of canvasExpressions(spec)) {
    try {
      const compiled = build(expr)
      for (const name of compiled.vars) {
        if (name !== 'x' && name !== 'y') names.add(name)
      }
    } catch {
      // A broken curve has no parameters to collect.
    }
  }
  return [...names].sort()
}

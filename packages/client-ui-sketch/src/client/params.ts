/**
 * The local parameter state behind the card's sliders, and the y-window rule
 * that keeps them from moving the axes.
 *
 * Interaction state lives here and in the component, never in the spec: the
 * persisted `params` tuple keeps the values the call declared, so a replay or
 * a reload rests every slider back where the AI put it.
 *
 * The window is frozen over the corners of the parameter box rather than the
 * current values. A window that follows the curve is the defect already
 * recorded once for the sweep animation -- the axes quietly re-fit every frame,
 * so the waveform looks pinned to a band while everything moves. Corners are
 * what any combination of slider positions can reach.
 */

import { build, canvasExpressions, resolveCanvas } from '@aisketch/sketch-core'
import type { CanvasParam, CanvasSpec, CompiledFn, Range } from '@aisketch/sketch-core'

/** The current value of each declared parameter. */
export type ParamValues = Readonly<Record<string, number>>

/** Above this many parameters the corner probe would exceed its cost bound. */
const CORNER_LIMIT = 5

/** Where every slider rests before the user touches it. */
export function initialValues(spec: CanvasSpec): ParamValues {
  const values: Record<string, number> = {}
  for (const [name, tuple] of Object.entries(spec.params ?? {})) values[name] = tuple[2]
  return values
}

/** Rebuild the spec with new current values, keeping bounds and every other field. */
export function withValues(spec: CanvasSpec, values: ParamValues): CanvasSpec {
  const declared = spec.params
  if (declared === undefined) return spec
  const params: Record<string, CanvasParam> = {}
  let moved = false
  for (const [name, tuple] of Object.entries(declared)) {
    const value = values[name]
    if (value === undefined || value === tuple[2]) {
      params[name] = tuple
      continue
    }
    params[name] = [tuple[0], tuple[1], value]
    moved = true
  }
  return moved ? { ...spec, params } : spec
}

/** One slider's increment. */
export function stepOf(tuple: CanvasParam): number {
  const span = tuple[1] - tuple[0]
  return Number.isFinite(span) && span > 0 ? span / 200 : 0.01
}

/**
 * One compiled evaluator per plotted expression, keyed by the bare expression.
 * A broken expression simply has no tracer; it never takes the card down.
 */
export function compileCurves(spec: CanvasSpec): ReadonlyMap<string, CompiledFn> {
  const map = new Map<string, CompiledFn>()
  for (const expr of canvasExpressions(spec)) {
    if (map.has(expr)) continue
    try {
      map.set(expr, build(expr).eval)
    } catch {
      // No curve to trace for this expression; the picture still draws.
    }
  }
  return map
}

/** The y-window the engine would choose for one spec, as a probe candidate. */
function probe(spec: CanvasSpec): Range {
  return resolveCanvas(spec).yRange
}

/**
 * The y-window that holds every slider position the card can reach.
 * An explicit canvas y-window wins regardless of the probe result.
 */
export function freezeWindow(spec: CanvasSpec): Range {
  const declared = Object.entries(spec.params ?? {})
  if (declared.length === 0 || spec.y !== undefined) return probe(spec)
  const names = declared.map(([name]) => name)
  const spans = declared.map(([, tuple]) => tuple)
  const candidates: Range[] = []
  if (names.length <= CORNER_LIMIT) {
    for (let mask = 0; mask < 2 ** names.length; mask += 1) {
      const values: ParamValues = Object.fromEntries(names.map((name, index) => {
        const tuple = spans[index] as CanvasParam
        return [name, mask & (1 << index) ? tuple[1] : tuple[0]]
      }))
      candidates.push(probe(withValues(spec, values)))
    }
  } else {
    for (const [name, tuple] of declared) {
      for (const value of [tuple[0], (tuple[0] + tuple[1]) / 2, tuple[1]]) {
        candidates.push(probe(withValues(spec, { [name]: value })))
      }
    }
  }
  return {
    yMin: Math.min(...candidates.map((range) => range.yMin)),
    yMax: Math.max(...candidates.map((range) => range.yMax)),
  }
}

/**
 * Reading a plot spec out of the bytes the Host persisted.
 *
 * Shared by the toolview card and the completed-Turn tail so the two surfaces
 * cannot drift on what counts as a drawable result.
 */
import type { SketchSpec } from '@aisketch/sketch-core'

/** Whether a value is a usable finite bound. */
function isBound(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Read an x-window from either the canonical `{x:[lo,hi]}` or a loose `[lo,hi]`.
 * @param value - the raw range value.
 * @returns the canonical range, or undefined for a partial/reversed/broken pair.
 */
function asRange(value: unknown): { x: readonly [number, number] } | undefined {
  let lo: unknown
  let hi: unknown
  if (Array.isArray(value) && value.length === 2) {
    lo = value[0]
    hi = value[1]
  } else if (typeof value === 'object' && value !== null) {
    const x = (value as { x?: unknown }).x
    if (Array.isArray(x) && x.length === 2) [lo, hi] = x
  }
  return isBound(lo) && isBound(hi) && hi > lo ? { x: [lo, hi] } : undefined
}

/**
 * Narrow an untyped object to the canonical spec the engine draws from.
 *
 * The model is told to put the tool's JSON in the fence, so a fence often
 * carries the *argument* names (`curves`, `x_min`, `x_max`) rather than the
 * canonical spec names (`compare`, `range.x`) that `toSpec` produces on the
 * Host. Without this mapping the extra curves and the explicit window are
 * silently dropped and only the primary expression is drawn over the default
 * window. Accept both spellings here so a copied call renders as intended.
 *
 * @param value - an untyped spec-like object.
 * @returns the canonical spec, or null when no expression is present.
 */
export function canonicalSpec(value: unknown): SketchSpec | null {
  if (typeof value !== 'object' || value === null) return null
  const raw: Record<string, unknown> = { ...value }
  const expr = raw.expr
  if (typeof expr !== 'string' || expr.length === 0) return null

  // Tool argument `curves` -> canonical `compare`. A canonical spec always wins.
  if (raw.compare === undefined && Array.isArray(raw.curves)) {
    const curves = raw.curves.filter((line): line is string => typeof line === 'string' && line.length > 0)
    if (curves.length > 0) raw.compare = curves
  }
  delete raw.curves

  // Tool arguments `x_min`/`x_max` -> canonical `range.x`. Also accept the
  // loose `[lo, hi]` range some authored specs use, but never a partial or
  // reversed bound, which would poison the viewport with NaN.
  if (raw.range === undefined) {
    const fromArgs = asRange([raw.x_min, raw.x_max])
    if (fromArgs !== undefined) raw.range = fromArgs
  } else {
    const range = asRange(raw.range)
    if (range !== undefined) raw.range = range
    else delete raw.range
  }
  delete raw.x_min
  delete raw.x_max

  return raw as unknown as SketchSpec
}

/**
 * Narrow the persisted presentation metadata to the spec this plugin understands.
 * @param meta - `tool/result` metadata, untyped on the wire.
 * @returns the spec when it carries a non-empty expression, otherwise null.
 */
export function readSpec(meta: unknown): SketchSpec | null {
  if (typeof meta !== 'object' || meta === null) return null
  return canonicalSpec((meta as { spec?: unknown }).spec)
}

/**
 * Narrow the JSON body of an `aisketch-plot` fence to a drawable spec.
 * @param code - the fence body as written in the assistant message.
 * @returns the spec, or null for incomplete or malformed payloads.
 */
export function readFenceSpec(code: string): SketchSpec | null {
  if (code.trim() === '') return null
  try {
    const parsed = JSON.parse(code) as unknown
    return canonicalSpec(parsed)
  } catch {
    return null
  }
}

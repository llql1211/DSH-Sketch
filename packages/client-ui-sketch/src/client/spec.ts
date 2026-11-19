/**
 * Reading a plot spec out of the bytes the Host persisted.
 *
 * Shared by the toolview card and the completed-Turn tail so the two surfaces
 * cannot drift on what counts as a drawable result.
 */
import type { SketchSpec } from '@aisketch/sketch-core'

/**
 * Narrow the persisted presentation metadata to the spec this plugin understands.
 * @param meta - `tool/result` metadata, untyped on the wire.
 * @returns the spec when it carries a non-empty expression, otherwise null.
 */
export function readSpec(meta: unknown): SketchSpec | null {
  if (typeof meta !== 'object' || meta === null) return null
  const spec = (meta as { spec?: unknown }).spec
  if (typeof spec !== 'object' || spec === null) return null
  const expr = (spec as { expr?: unknown }).expr
  if (typeof expr !== 'string' || expr.length === 0) return null
  return spec as SketchSpec
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
    if (typeof parsed !== 'object' || parsed === null) return null
    const expr = (parsed as { expr?: unknown }).expr
    return typeof expr === 'string' && expr.length > 0 ? parsed as SketchSpec : null
  } catch {
    return null
  }
}

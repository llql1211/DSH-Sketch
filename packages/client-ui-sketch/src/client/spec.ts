/**
 * Reading a function canvas out of the bytes the Host persisted.
 *
 * The browser needs the exact same spec the tool validated, and it must accept
 * the JSON the model puts in an `aisketch-plot` fence. Both spellings go through
 * `upgradeSpec` in the core package so the Host and the card cannot disagree
 * about what counts as a drawable canvas. The retired `data` mode is refused
 * there: a chart fence must not silently turn into a function line.
 */

import { upgradeSpec } from '@aisketch/sketch-core'
import type { CanvasSpec } from '@aisketch/sketch-core'

/** Narrow a persisted spec-like object to the canvas spec, or null. */
export function canonicalSpec(value: unknown): CanvasSpec | null {
  return upgradeSpec(value)
}

/**
 * Narrow the persisted presentation metadata to the canvas this plugin draws.
 * @param meta - `tool/result` metadata, untyped on the wire.
 * @returns the canvas, or null when it carries nothing drawable.
 */
export function readSpec(meta: unknown): CanvasSpec | null {
  if (typeof meta !== 'object' || meta === null) return null
  return canonicalSpec((meta as { spec?: unknown }).spec)
}

/**
 * Narrow the JSON body of an `aisketch-plot` fence to a drawable canvas.
 * @param code - the fence body as written in the assistant message.
 * @returns the canvas, or null for incomplete, malformed or retired payloads.
 */
export function readFenceSpec(code: string): CanvasSpec | null {
  if (code.trim() === '') return null
  try {
    return canonicalSpec(JSON.parse(code) as unknown)
  } catch {
    return null
  }
}

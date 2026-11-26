/** Inline `aisketch-plot` fence payload parsing. */
import { describe, expect, it } from 'vitest'
import { readFenceSpec } from '../src/client/spec.ts'

describe('reading a plot fence body', () => {
  it('returns the spec when it carries an expression', () => {
    expect(readFenceSpec('{"expr":"x^2","mode":"tangent"}')).toMatchObject({ expr: 'x^2', mode: 'tangent' })
  })

  it('returns null while the body is empty, malformed or missing an expression', () => {
    expect(readFenceSpec('')).toBeNull()
    expect(readFenceSpec('{oops')).toBeNull()
    expect(readFenceSpec('{"mode":"plain"}')).toBeNull()
    expect(readFenceSpec('42')).toBeNull()
  })
})

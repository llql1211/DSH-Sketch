/** Inline `aisketch-plot` fence payload parsing. */
import { describe, expect, it } from 'vitest'
import { resolveGeometry } from '@aisketch/sketch-core'
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

  it('maps the tool argument aliases onto the canonical spec', () => {
    const fence = '{"expr":"-x^2","mode":"compare",'
      + '"curves":["未校正 初级球差, -x^2","校正后 高次残余, 0.12*x^4"],'
      + '"x_min":0,"x_max":1}'
    expect(readFenceSpec(fence)).toEqual({
      expr: '-x^2',
      mode: 'compare',
      compare: ['未校正 初级球差, -x^2', '校正后 高次残余, 0.12*x^4'],
      range: { x: [0, 1] },
    })
  })

  it('draws every aliased comparison curve inside the requested window', () => {
    const spec = readFenceSpec('{"expr":"-x^2","mode":"compare","curves":["0.12*x^4"],"x_min":0,"x_max":1}')
    expect(spec).not.toBeNull()
    const geometry = resolveGeometry(spec!)
    expect(geometry.curves).toHaveLength(2)
    expect(geometry.xRange).toEqual([0, 1])
  })

  it('keeps an already canonical spec and ignores incomplete aliases', () => {
    expect(readFenceSpec('{"expr":"x^2","compare":["2x"],"range":{"x":[-1,1]}}')).toEqual({
      expr: 'x^2', compare: ['2x'], range: { x: [-1, 1] },
    })
    expect(readFenceSpec('{"expr":"x^2","curves":"2x","x_min":0}')).toEqual({ expr: 'x^2' })
  })
})

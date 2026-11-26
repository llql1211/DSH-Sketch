/** Inline `aisketch-plot` fence payload parsing. */
import { describe, expect, it } from 'vitest'
import { resolveCanvas } from '@aisketch/sketch-core'
import { readFenceSpec } from '../src/client/spec.ts'

describe('reading a plot fence body', () => {
  it('returns the canvas when it carries a curve', () => {
    expect(readFenceSpec('{"expr":"x^2","marks":[{"type":"tangent"}]}')).toMatchObject({
      curves: ['x^2'], marks: [{ type: 'tangent' }],
    })
  })

  it('returns null for an empty, malformed or retired payload', () => {
    expect(readFenceSpec('')).toBeNull()
    expect(readFenceSpec('{oops')).toBeNull()
    expect(readFenceSpec('{"mode":"plain"}')).toBeNull()
    expect(readFenceSpec('42')).toBeNull()
    expect(readFenceSpec('{"expr":"x","data":"bar"}')).toBeNull()
  })

  it('accepts a full canvas spec with explicit windows and styling', () => {
    const spec = readFenceSpec(
      '{"curves":["-x^2",{"expr":"0.12*x^4","color":"red","dash":"dashed","label":"残余"}],'
      + '"x":[-1,1],"y":[0,1],"legend":false}',
    )
    expect(spec).toEqual({
      curves: ['-x^2', { expr: '0.12*x^4', color: 'red', dash: 'dashed', label: '残余' }],
      x: [-1, 1], y: [0, 1], legend: false,
    })
  })

  it('draws every curve inside the requested window', () => {
    const spec = readFenceSpec('{"expr":"-x^2","curves":["0.12*x^4"],"x_min":0,"x_max":1}')
    expect(spec).not.toBeNull()
    const geometry = resolveCanvas(spec!)
    expect(geometry.curves).toHaveLength(2)
    expect(geometry.xRange).toEqual([0, 1])
  })

  it('upgrades an old fence into a canvas instead of dropping its curves', () => {
    const spec = readFenceSpec('{"expr":"x^2","compare":["2x"],"range":{"x":[-1,1]},"mode":"taylor","order":3}')
    expect(spec).toEqual({
      curves: ['x^2', '2x'],
      x: [-1, 1],
      marks: [{ type: 'poly', center: 0, order: 3 }],
    })
  })

  it('splits an old label line but keeps a comma inside a function call', () => {
    expect(readFenceSpec('{"expr":"x^2","compare":["直线, 2x"]}')?.curves[1]).toEqual({ expr: '2x', label: '直线' })
    expect(readFenceSpec('{"expr":"min(x, 1)"}')?.curves[0]).toBe('min(x, 1)')
  })

  it('ignores incomplete window aliases', () => {
    expect(readFenceSpec('{"expr":"x^2","x_min":0}')).toEqual({ curves: ['x^2'] })
  })
})

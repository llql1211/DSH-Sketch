/**
 * Parameter interaction primitives: the local value map, the slider step, and
 * the y-window union that keeps the axes still while any parameter is dragged.
 */
import { describe, expect, it } from 'vitest'
import { resolveCanvas } from '@aisketch/sketch-core'
import type { CanvasSpec } from '@aisketch/sketch-core'
import { compileCurves, freezeWindow, initialValues, stepOf, withValues } from '../src/client/params.ts'

describe('compileCurves', () => {
  it('compiles bare expressions and styled curve objects', () => {
    const spec: CanvasSpec = {
      curves: ['sin(x)/x', { expr: 'exp(-x^2)', label: '高斯' }, { expr: 'x/3', label: '直线' }],
    }
    const compiled = compileCurves(spec)
    expect([...compiled.keys()].sort()).toEqual(['exp(-x^2)', 'sin(x)/x', 'x/3'])
    for (const fn of compiled.values()) expect(typeof fn).toBe('function')
  })

  it('skips one the interpreter refuses without taking the card down', () => {
    const compiled = compileCurves({ curves: ['sin(x)', 'cos(x)', '1 +'] })
    expect([...compiled.keys()].sort()).toEqual(['cos(x)', 'sin(x)'])
  })

  it('evaluates a compiled curve at a point', () => {
    const compiled = compileCurves({ curves: [{ expr: 'exp(-x^2)', label: '高斯' }] })
    expect(compiled.get('exp(-x^2)')?.({ x: 0 })).toBeCloseTo(1)
  })
})

describe('initialValues', () => {
  it('rests every parameter at the value the call declared', () => {
    expect(initialValues({
      curves: ['A*sin(w*x+p)'], params: { A: [0.2, 2, 1], w: [0.5, 4, 0.5], p: [0, 6.28, 0] },
    })).toEqual({ A: 1, w: 0.5, p: 0 })
  })

  it('is empty for a spec with no parameters', () => {
    expect(initialValues({ curves: ['sin(x)'] })).toEqual({})
  })
})

describe('withValues', () => {
  const spec: CanvasSpec = {
    curves: [{ expr: 'A*x', label: 'line', dash: 'dashed' }],
    params: { A: [0, 10, 2] },
    x: [-1, 1],
  }

  it('replaces only the current slot of each declared parameter', () => {
    expect(withValues(spec, { A: 7 })).toEqual({
      curves: [{ expr: 'A*x', label: 'line', dash: 'dashed' }],
      params: { A: [0, 10, 7] },
      x: [-1, 1],
    })
  })

  it('ignores keys the spec never declared and leaves the spec alone when there are none', () => {
    expect(withValues(spec, { Z: 1 })).toEqual(spec)
    expect(withValues({ curves: ['sin(x)'] }, { A: 1 })).toEqual({ curves: ['sin(x)'] })
  })
})

describe('stepOf', () => {
  it('divides the declared box into 200 stops', () => {
    expect(stepOf([0, 10, 5])).toBeCloseTo(0.05)
  })

  it('stays a positive finite number for a degenerate or broken box', () => {
    for (const tuple of [[5, 5, 5], [Number.NaN, 1, 0], [1, Number.NaN, 0]] as const) {
      const step = stepOf(tuple)
      expect(Number.isFinite(step)).toBe(true)
      expect(step).toBeGreaterThan(0)
    }
  })
})

describe('freezeWindow', () => {
  const spec: CanvasSpec = { curves: ['A*sin(x)+p'], params: { A: [0.2, 3, 1], p: [-5, 5, 0] } }

  it('covers the amplitude box and the offset box at once', () => {
    const { yMin, yMax } = freezeWindow(spec)
    expect(yMin).toBeLessThan(-7.5)
    expect(yMax).toBeGreaterThan(7.5)
  })

  it('depends on the declared boxes, not on where the parameters currently rest', () => {
    expect(freezeWindow(withValues(spec, { A: 3, p: 5 }))).toEqual(freezeWindow(spec))
  })

  it('holds a curve that a live resample would push out of the frame', () => {
    const window = freezeWindow(spec)
    const dragged = resolveCanvas(withValues(spec, { A: 3, p: 5 }), { frozenYRange: window })
    const drawn = dragged.curves[0]?.points ?? []
    const offFrame = drawn.filter((point) => point.y !== null && (point.y < window.yMin || point.y > window.yMax))
    expect(offFrame).toHaveLength(0)
  })

  it('honours an explicit y-window instead of fitting one', () => {
    expect(freezeWindow({ curves: ['sin(x)'], y: [-2, 2] })).toEqual({ yMin: -2, yMax: 2 })
  })

  it('falls back to the engine window for a parameter-free spec', () => {
    expect(freezeWindow({ curves: ['sin(x)'] })).toEqual(resolveCanvas({ curves: ['sin(x)'] }).yRange)
  })
})

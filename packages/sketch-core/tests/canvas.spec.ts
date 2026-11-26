/**
 * Function-canvas spec and geometry tests.
 *
 * The canvas replaced the mode-based sketch spec. These tests pin the adapter
 * that keeps old fences drawable, the refusal of the retired data mode, and the
 * style/mark resolution the browser card relies on.
 */
import { describe, expect, it } from 'vitest'
import {
  DASH_ARRAYS, MAX_CANVAS_CURVES, canvasExpressions, canvasParameters,
  resolveCanvas, upgradeSpec,
} from '../src/canvas.ts'

describe('upgradeSpec', () => {
  it('reads a minimal canvas with bare curve strings', () => {
    expect(upgradeSpec({ curves: ['x^2', 'sin(x)'] })).toEqual({ curves: ['x^2', 'sin(x)'] })
  })

  it('keeps explicit windows, styling, params, marks and legend', () => {
    const spec = upgradeSpec({
      curves: [{ expr: 'A*sin(x)', color: '#378ADD', dash: 'dashed', width: 3, label: '波' }],
      x: [-2, 2], y: [-1, 1], params: { A: [0, 2, 1] },
      marks: [{ type: 'point', x: 0, y: 0, text: '原点' }], legend: false,
    })
    expect(spec).toEqual({
      curves: [{ expr: 'A*sin(x)', color: '#378ADD', dash: 'dashed', width: 3, label: '波' }],
      x: [-2, 2], y: [-1, 1], params: { A: [0, 2, 1] },
      marks: [{ type: 'point', x: 0, y: 0, text: '原点' }], legend: false,
    })
  })

  it('upgrades an old spec into curves and marks', () => {
    expect(upgradeSpec({ expr: 'x^2', compare: ['2x'], range: { x: [-1, 1] }, mode: 'taylor', order: 3 })).toEqual({
      curves: ['x^2', '2x'],
      x: [-1, 1],
      marks: [{ type: 'poly', center: 0, order: 3 }],
    })
  })

  it('maps old tool arguments onto the canvas', () => {
    expect(upgradeSpec({ expr: 'sin(x)', x_min: 0, x_max: 1, y_min: -2, y_max: 2, probe: 0, mode: 'tangent' })).toEqual({
      curves: ['sin(x)'], x: [0, 1], y: [-2, 2], marks: [{ type: 'tangent', x: 0 }],
    })
  })

  it('splits legacy label lines but preserves commas inside calls', () => {
    expect(upgradeSpec({ expr: 'x^2', compare: ['直线, 2x'] })?.curves[1]).toEqual({ expr: '2x', label: '直线' })
    expect(upgradeSpec({ curves: ['min(x, 1)'] })?.curves[0]).toBe('min(x, 1)')
    expect(upgradeSpec({ compare: ['y=x^2'] })?.curves[0]).toBe('x^2')
  })

  it('refuses the retired data mode and malformed payloads', () => {
    for (const value of [
      { expr: 'chart', data: 'bar' },
      { expr: 'chart', dataset: 'line' },
      { expr: 'x', series: 'A' },
      { mode: 'plain' },
      { curves: [] },
      42,
      null,
    ]) {
      expect(upgradeSpec(value)).toBeNull()
    }
  })

  it('drops unusable fields and caps counts instead of drawing garbage', () => {
    const spec = upgradeSpec({
      curves: ['x', '', 42, 'sin(x)'],
      x: [5, 1],
      params: { A: [1, 2, 9], '1bad': [0, 1, 0] },
      marks: [{ type: 'magic' }, { type: 'point', x: 0, y: 0 }],
    })
    expect(spec).toEqual({ curves: ['x', 'sin(x)'], marks: [{ type: 'point', x: 0, y: 0 }] })
    expect(upgradeSpec({ curves: Array.from({ length: MAX_CANVAS_CURVES + 2 }, () => 'x') })?.curves)
      .toHaveLength(MAX_CANVAS_CURVES)
  })
})

describe('resolveCanvas', () => {
  it('samples every curve in the shared window', () => {
    const geometry = resolveCanvas(upgradeSpec({ curves: ['sin(x)', 'cos(x)'], x: [0, 1] })!)
    expect(geometry.curves).toHaveLength(2)
    expect(geometry.xRange).toEqual([0, 1])
    expect(geometry.curves[0]?.points.length).toBeGreaterThan(100)
  })

  it('applies the preset dash rhythm and explicit style', () => {
    const geometry = resolveCanvas(upgradeSpec({
      curves: [{ expr: 'x', dash: 'dashed', color: 'red', width: 3, label: 'line' }],
    })!)
    expect(geometry.curves[0]?.dash).toEqual(DASH_ARRAYS.dashed)
    expect(geometry.curves[0]?.color).toBe('red')
    expect(geometry.curves[0]?.width).toBe(3)
    expect(geometry.curves[0]?.label).toBe('line')
  })

  it('honours an explicit y-window over the fitted one', () => {
    const geometry = resolveCanvas(upgradeSpec({ curves: ['1000*x'], y: [-2, 2] })!)
    expect(geometry.yRange).toEqual({ yMin: -2, yMax: 2 })
  })

  it('fits y over all curves, not only the first', () => {
    const one = resolveCanvas(upgradeSpec({ curves: ['x'] })!).yRange
    const both = resolveCanvas(upgradeSpec({ curves: ['x', '1000*x'] })!).yRange
    expect(both.yMax).toBeGreaterThan(one.yMax * 100)
  })

  it('resolves tangent, area, poly and note geometry together', () => {
    const geometry = resolveCanvas(upgradeSpec({
      curves: ['sin(x)'],
      x: [-1, 1],
      marks: [
        { type: 'tangent', x: 0 },
        { type: 'area', a: 0, b: 1, n: 4 },
        { type: 'poly', center: 0, order: 3 },
        { type: 'point', x: 0, y: 0, text: '原点' },
        { type: 'text', x: 0.5, y: 0.5, text: '注释' },
      ],
    })!)
    expect(geometry.marks.map((mark) => mark.type)).toEqual(['tangent', 'area', 'poly', 'point', 'text'])
    const tangent = geometry.marks[0]
    expect(tangent?.type === 'tangent' && tangent.slope).toBeCloseTo(1, 2)
    const area = geometry.marks[1]
    expect(area?.type === 'area' && area.bars).toHaveLength(4)
    const poly = geometry.marks[2]
    expect(poly?.type === 'poly' && poly.coefficients[1]).toBeCloseTo(1, 2)
  })
})

describe('vertical guides', () => {
  it('defaults a vline from y=0 to f(x) with the requested stroke', () => {
    const geometry = resolveCanvas(upgradeSpec({
      curves: ['sin(x)'], x: [0, 3],
      marks: [{ type: 'vline', x: 1, label: '0.841', color: 'cyan', dash: 'dotted', width: 3 }],
    })!)
    const mark = geometry.marks[0]
    expect(mark?.type).toBe('vline')
    if (mark?.type !== 'vline') return
    expect(mark.y0).toBe(0)
    expect(mark.y1).toBeCloseTo(Math.sin(1), 5)
    expect(mark.label).toBe('0.841')
    expect(mark.color).toBe('cyan')
    expect(mark.dash).toEqual(DASH_ARRAYS.dotted)
    expect(mark.width).toBe(3)
  })

  it('accepts explicit finite ends and skips undefined values', () => {
    const geometry = resolveCanvas(upgradeSpec({
      curves: ['sqrt(-x)'], marks: [
        { type: 'vline', x: 1, y0: -1, y1: 2 },
        { type: 'vline', x: 1 },
      ],
    })!)
    expect(geometry.marks).toHaveLength(1)
    const mark = geometry.marks[0]
    expect(mark?.type === 'vline' && [mark.y0, mark.y1]).toEqual([-1, 2])
  })
})

describe('canvas helpers', () => {
  it('collects expressions and parameters across every curve', () => {
    const spec = upgradeSpec({ curves: ['sin(x)', { expr: 'A*cos(x)', label: 'cos' }] })!
    expect(canvasExpressions(spec)).toEqual(['sin(x)', 'A*cos(x)'])
    expect(canvasParameters(spec)).toEqual(['A'])
  })
})

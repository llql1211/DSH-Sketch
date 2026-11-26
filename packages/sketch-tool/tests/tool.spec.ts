/**
 * `sketch_function` tool tests.
 *
 * These run the tool through the real registry rather than calling `execute`
 * directly, so schema validation, output snapshotting, and the render path are
 * all exercised the way a live model call would exercise them.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { call, run } from './compat.ts'
import * as sketchTool from '../src/index.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeExecutor)
  await ctx.plugin(sketchTool)
  return ctx
}

/** The rendered text a model would read back. */
function textOf(content: readonly { type: string; text?: string }[]): string {
  return content.map((b) => b.text ?? '').join('')
}

let ctx: Context
beforeEach(async () => {
  ctx = await setup()
})

describe('registration', () => {
  it('registers one model-visible tool named sketch_function', () => {
    expect(ctx.tools.schemas().map((s) => s.name)).toContain('sketch_function')
  })

  it('states the no-HTML rule and the canvas fence in the system prompt', async () => {
    const prompt = renderPrompt(await ctx.systemPrompt.assemble({}))
    expect(prompt).toContain('sketch_function')
    expect(prompt).toContain('do not write HTML')
    expect(prompt).toContain('aisketch-plot')
    expect(prompt).toContain('chart')
  })
})

describe('drawing a canvas', () => {
  it('returns a canonical curve spec and a factual summary', async () => {
    const result = await run(ctx.tools, call('sketch_function', { expr: 'x^2' }))
    expect(result.isError).toBeFalsy()
    expect(result.value).toMatchObject({ spec: { curves: ['x^2'] } })
    expect(textOf(result.content)).toContain('Drew 1 curve(s)')
  })

  it('carries explicit x and y windows in the spec', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'sin(x)', x_min: -1, x_max: 1, y_min: -2, y_max: 2,
    }))
    expect(result.value).toMatchObject({ spec: { x: [-1, 1], y: [-2, 2] } })
    expect(textOf(result.content)).toContain('x ∈ [-1, 1]')
    expect(textOf(result.content)).toContain('y ∈ [-2, 2]')
  })

  it('keeps curve styling as optional fields', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      curves: [{ expr: 'cos(x)', color: 'red', dash: 'dashed', width: 3, label: 'cos' }],
    }))
    expect(result.value).toMatchObject({
      spec: { curves: [{ expr: 'cos(x)', color: 'red', dash: 'dashed', width: 3, label: 'cos' }] },
    })
    expect(result.isError).toBeFalsy()
  })

  it('reports the parameter values it drew with', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'A*sin(w*x)',
      params: { A: [0.2, 2, 1.5], w: [0.5, 4, 2] },
    }))
    const text = textOf(result.content)
    expect(text).toContain('A=1.5')
    expect(text).toContain('w=2')
  })
})

describe('parameter hygiene', () => {
  it('drops a parameter the expression never uses', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'sin(x)', params: { Z: [1, 5, 2] },
    }))
    expect(result.value).toMatchObject({ spec: { curves: ['sin(x)'] } })
    expect(result.value).not.toHaveProperty('spec.params')
  })

  it('collects a parameter used by any curve, not just the first', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      curves: ['sin(x)', 'A*cos(x)'], params: { A: [0, 2, 1] },
    }))
    expect(result.value).toMatchObject({ spec: { params: { A: [0, 2, 1] } } })
  })

  it('rejects a parameter whose bounds are inverted', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'A*x', params: { A: [5, 1, 2] },
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('must exceed min')
  })

  it('rejects a parameter value outside its own bounds', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'A*x', params: { A: [0, 1, 9] },
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('outside')
  })
})

describe('marks', () => {
  it('reports the slope of a tangent mark', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'cos(x)', marks: [{ type: 'tangent', x: Math.PI / 2 }],
    }))
    const slope = Number(/slope f'\(x\)=(-?[\d.]+(?:e-?\d+)?)\./.exec(textOf(result.content))?.[1])
    expect(slope).toBeCloseTo(-1, 3)
  })

  it('reports the sum and exact integral of an area mark', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'sin(x)', marks: [{ type: 'area', a: 0, b: Math.PI, n: 15 }],
    }))
    const text = textOf(result.content)
    expect(text).toContain('exact integral')
    expect(text).toContain('n=15')
    expect(text).toContain('Area mark')
  })

  it('lists Taylor coefficients of a poly mark', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'sin(x)', marks: [{ type: 'poly', center: 0, order: 5 }],
    }))
    const text = textOf(result.content)
    expect(text).toContain('Taylor mark at a=0, degree 5')
    expect(text).toContain('1(x-a)')
  })

  it('draws a finite vertical guide anchored to the curve', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'sin(x)', marks: [{ type: 'vline', x: 1, label: '0.841', color: 'cyan' }],
    }))
    expect(result.isError).toBeFalsy()
    expect(textOf(result.content)).toContain('Drew 1 curve(s)')
  })

  it('allows several marks on one canvas', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'sin(x)',
      marks: [
        { type: 'tangent', x: 0 },
        { type: 'area', a: 0, b: 1, n: 5 },
        { type: 'poly', center: 0, order: 3 },
        { type: 'vline', x: 0.5 },
        { type: 'point', x: 0, y: 0, text: '原点' },
        { type: 'text', x: 1, y: 1, text: '注释' },
      ],
    }))
    expect(result.isError).toBeFalsy()
    const value = result.value
    const spec = typeof value === 'object' && value !== null && !Array.isArray(value) ? value['spec'] : undefined
    const marks = typeof spec === 'object' && spec !== null && !Array.isArray(spec) ? spec['marks'] : undefined
    expect(Array.isArray(marks) && marks.length).toBe(6)
  })
})

describe('legacy spellings', () => {
  it('turns an old mode into a mark, keeping old fences drawable', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'sin(x)', mode: 'tangent', probe: 0,
    }))
    expect(result.value).toMatchObject({ spec: { curves: ['sin(x)'], marks: [{ type: 'tangent', x: 0 }] } })
  })

  it('splits an old "label, expr" curve into a labelled object', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'x^2', curves: ['抛物线, 2x'],
    }))
    expect(result.value).toMatchObject({
      spec: { curves: ['x^2', { expr: '2x', label: '抛物线' }] },
    })
    expect(textOf(result.content)).toContain('抛物线')
  })

  it('keeps a legitimate expression containing a comma intact', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      curves: ['min(x, 1)'],
    }))
    expect(result.value).toMatchObject({ spec: { curves: ['min(x, 1)'] } })
  })

  it('refuses the retired data mode and points to the chart card', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'chart', mode: 'data', dataset: 'bar',
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('show_card')
  })
})

describe('argument validation', () => {
  it('rejects an empty expression', async () => {
    const result = await run(ctx.tools, call('sketch_function', { expr: '   ' }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('non-empty')
  })

  it('rejects an inverted x or y window', async () => {
    for (const args of [{ x_min: 5, x_max: 1 }, { y_min: 5, y_max: 1 }]) {
      const result = await run(ctx.tools, call('sketch_function', { expr: 'x', ...args }))
      expect(result.isError).toBe(true)
      expect(textOf(result.content)).toContain('must be greater than')
    }
  })

  it('rejects an out-of-range mark order and rectangle count', async () => {
    const order = await run(ctx.tools, call('sketch_function', {
      expr: 'sin(x)', marks: [{ type: 'poly', order: 99 }],
    }))
    expect(order.isError).toBe(true)
    expect(textOf(order.content)).toContain('order')

    const count = await run(ctx.tools, call('sketch_function', {
      expr: 'sin(x)', marks: [{ type: 'area', a: 0, b: 1, n: 5000 }],
    }))
    expect(count.isError).toBe(true)
    expect(textOf(count.content)).toContain('n')
  })

  it('rejects too many curves', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      curves: Array.from({ length: 9 }, (_, i) => `x+${i}`),
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('at most')
  })

  it('rejects an unknown mark type', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'x', marks: [{ type: 'magic' }],
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('expected tangent')
  })

  it('rejects an invalid color, dash or width', async () => {
    for (const style of [{ color: 'url(x)' }, { dash: 'striped' }, { width: 99 }]) {
      const result = await run(ctx.tools, call('sketch_function', {
        curves: [{ expr: 'x', ...style }],
      }))
      expect(result.isError).toBe(true)
    }
  })

  it('surfaces a syntax error with its offset so the model can fix it', async () => {
    const result = await run(ctx.tools, call('sketch_function', { expr: 'sin(' }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('cannot parse expression')
    expect(textOf(result.content)).toContain('offset')
  })

  it('rejects an unknown function by name', async () => {
    const result = await run(ctx.tools, call('sketch_function', { expr: 'foo(x)' }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('foo')
  })
})

describe('result shape', () => {
  it('snapshots a lossless JSON value', async () => {
    const result = await run(ctx.tools, call('sketch_function', {
      expr: 'A*x^2', params: { A: [1, 3, 2] },
    }))
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value)
  })

  it('persists the spec in presentation metadata for replay', async () => {
    const result = await run(ctx.tools, call('sketch_function', { expr: 'x^3' }))
    expect(result.meta).toMatchObject({ spec: { curves: ['x^3'] } })
  })
})

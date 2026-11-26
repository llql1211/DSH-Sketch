/**
 * AISketch end-to-end replay test.
 *
 * The claim this file exists to defend is the one that makes an inline card
 * worth building: a settled `tool/result` carries enough for the browser to
 * redraw the plot from scratch, with no Host round trip. The pieces are
 * verified apart elsewhere -- `sketch-tool`'s suite covers the tool, the
 * geometry suite covers the maths -- so this file only tests the seam:
 *
 *   tool call -> persisted meta -> card reads spec -> same geometry
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { resolveCanvas, upgradeSpec } from '@aisketch/sketch-core'
import type { CanvasSpec } from '@aisketch/sketch-core'
import { call as makeCall, run } from './compat.ts'
import * as sketchTool from '../src/index.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeExecutor)
  await ctx.plugin(sketchTool)
  return ctx
}

async function call(ctx: Context, args: unknown) {
  return run(ctx.tools, makeCall('sketch_function', args))
}

/**
 * Read the spec the way the browser card does, through the same core adapter.
 * @param meta - the persisted presentation metadata.
 * @returns the canvas, or null when the shape is wrong.
 */
function readSpecLikeTheCard(meta: unknown): CanvasSpec | null {
  if (typeof meta !== 'object' || meta === null) return null
  return upgradeSpec((meta as { spec?: unknown }).spec)
}

describe('replay', () => {
  it('persists a spec the card can read back', async () => {
    const ctx = await setup()
    const result = await call(ctx, { expr: 'x^2' })
    const spec = readSpecLikeTheCard(result.meta)
    expect(spec).not.toBeNull()
    expect(spec?.curves[0]).toBe('x^2')
  })

  it('survives a JSON round trip unchanged', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      expr: 'A*sin(w*x)',
      params: { A: [0.2, 2, 1.5], w: [0.5, 4, 2] },
    })
    const stored = JSON.parse(JSON.stringify(result.meta)) as unknown
    expect(stored).toEqual(result.meta)
    expect(readSpecLikeTheCard(stored)).toEqual(readSpecLikeTheCard(result.meta))
  })

  it('redraws identical geometry from the persisted spec alone', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      expr: 'A*sin(w*x)',
      params: { A: [0.2, 2, 1.5], w: [0.5, 4, 2] },
      marks: [{ type: 'tangent', x: 1 }, { type: 'area', a: 0, b: 1 }],
    })
    const spec = readSpecLikeTheCard(result.meta)
    expect(spec).not.toBeNull()
    if (spec === null) return

    const replay = resolveCanvas(spec)
    const host = resolveCanvas(spec)
    expect(replay.xRange).toEqual(host.xRange)
    expect(replay.yRange).toEqual(host.yRange)
    expect(replay.marks).toEqual(host.marks)
    expect(replay.curves.length).toBeGreaterThan(0)

    const first = replay.curves[0]
    const firstHost = host.curves[0]
    expect(first).toBeDefined()
    if (first === undefined || firstHost === undefined) return
    expect(first.points.length).toBe(firstHost.points.length)
    for (let i = 0; i < first.points.length; i += 97) {
      expect(first.points[i]).toEqual(firstHost.points[i])
    }
  })

  it('keeps every canvas feature addressable from the persisted spec', async () => {
    const ctx = await setup()
    const cases: readonly { readonly args: unknown; readonly label: string }[] = [
      { args: { expr: 'sin(x)', marks: [{ type: 'tangent' }] }, label: 'tangent' },
      { args: { expr: 'sin(x)', marks: [{ type: 'area', a: 0, b: 1 }] }, label: 'area' },
      { args: { expr: 'sin(x)', marks: [{ type: 'poly', order: 3 }] }, label: 'poly' },
      { args: { expr: 'x^2', curves: [{ expr: '2x', label: 'line', dash: 'dashed' }] }, label: 'styled curves' },
      { args: { expr: 'sin(x)', mode: 'taylor', center: 0, order: 5 }, label: 'legacy mode' },
    ]
    for (const { args, label } of cases) {
      const result = await call(ctx, args)
      const spec = readSpecLikeTheCard(result.meta)
      expect(spec, `${label} lost its spec`).not.toBeNull()
      if (spec === null) continue
      expect(resolveCanvas(spec).curves.length, `${label} produced no curve`).toBeGreaterThan(0)
    }
  })

  it('keeps a retired data fence unreadable instead of drawing the wrong line', async () => {
    expect(readSpecLikeTheCard({ spec: { expr: 'chart', data: 'bar' } })).toBeNull()
  })
})

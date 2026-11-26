/**
 * Model-facing `sketch_function` tool: a function canvas.
 *
 * The tool validates a canvas spec and returns a short computed summary. It
 * draws no pixels: the browser card derives the picture from the same spec with
 * the same core library, so a replayed session renders an identical plot with
 * no Host involvement.
 *
 * A canvas is a window, 1..8 `y = f(x)` curves with optional styling, and
 * optional marks (tangent, area, Taylor polynomial, point and text notes). The
 * old mutually-exclusive modes are gone; data charts live in `show_card`'s
 * `chart` kind because they are not functions.
 *
 * @module @deepseek-ai/dsh-experimental-sketch-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  DASH_PRESETS,
  MAX_CANVAS_CURVES,
  MAX_CANVAS_MARKS,
  ParseError,
  build,
  canvasExpressions,
  canvasParameters,
  isSketchColor,
  resolveCanvas,
  upgradeSpec,
} from '@aisketch/sketch-core'
import type { CanvasParam, CanvasSpec } from '@aisketch/sketch-core'

export const name = 'sketch-tool'
export const inject = ['tools', 'systemPrompt']

/** Upper bounds for the numeric arguments that become marks. */
const MAX_AREA_RECTANGLES = 200
const MAX_TAYLOR_ORDER = 12

/** Parsed tool args; `execute` checks the constraints the schema DSL cannot express. */
interface SketchArgs {
  expr?: string
  curves?: readonly unknown[]
  x_min?: number
  x_max?: number
  y_min?: number
  y_max?: number
  params?: Record<string, unknown>
  marks?: readonly unknown[]
  legend?: boolean
  // Retired spellings, recognised only to produce a useful refusal.
  mode?: string
  dataset?: string
  data?: string
  series?: string
}

/** Whether a value is a finite number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Reject the argument values the parameter schema cannot express. */
function validateArgs(args: SketchArgs): void {
  if (args.data !== undefined || args.dataset !== undefined || args.series !== undefined) {
    throw new Error('data charts are not function plots: use show_card with kind "chart" and a real series instead')
  }
  if (typeof args.expr !== 'string' && !Array.isArray(args.curves)) {
    throw new Error('invalid canvas: provide an `expr` or a `curves` array')
  }
  if (typeof args.expr === 'string' && args.expr.trim().length === 0) {
    throw new Error('invalid expr: expected a non-empty expression string')
  }
  const count = (typeof args.expr === 'string' && args.expr.trim().length > 0 ? 1 : 0)
    + (Array.isArray(args.curves) ? args.curves.length : 0)
  if (count === 0) throw new Error('invalid canvas: at least one curve is required')
  if (count > MAX_CANVAS_CURVES) {
    throw new Error(`invalid curves: at most ${MAX_CANVAS_CURVES} curves (got ${count})`)
  }

  if (Array.isArray(args.curves)) {
    for (const [index, raw] of args.curves.entries()) {
      if (typeof raw === 'string') {
        if (raw.trim().length === 0) throw new Error(`invalid curves[${index}]: empty expression`)
        continue
      }
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`invalid curves[${index}]: expected an expression string or a curve object`)
      }
      const curve = raw as Record<string, unknown>
      if (typeof curve.expr !== 'string' || curve.expr.trim().length === 0) {
        throw new Error(`invalid curves[${index}]: expected a non-empty \`expr\``)
      }
      if (curve.color !== undefined && !isSketchColor(curve.color)) {
        throw new Error(`invalid curves[${index}].color: use a named color or #rgb/#rrggbb`)
      }
      if (curve.dash !== undefined
        && !(typeof curve.dash === 'string' && (DASH_PRESETS as readonly string[]).includes(curve.dash))) {
        throw new Error(`invalid curves[${index}].dash: expected one of ${DASH_PRESETS.join(', ')}`)
      }
      if (curve.width !== undefined && !(isFiniteNumber(curve.width) && curve.width >= 0.5 && curve.width <= 6)) {
        throw new Error(`invalid curves[${index}].width: expected a number in [0.5, 6]`)
      }
      if (curve.label !== undefined && typeof curve.label !== 'string') {
        throw new Error(`invalid curves[${index}].label: expected a string`)
      }
    }
  }

  for (const [axis, lo, hi] of [
    ['x', args.x_min, args.x_max],
    ['y', args.y_min, args.y_max],
  ] as const) {
    if ((lo === undefined) !== (hi === undefined)) {
      throw new Error(`invalid range: ${axis}_min and ${axis}_max must be given together`)
    }
    if (lo !== undefined && hi !== undefined && !(hi > lo)) {
      throw new Error(`invalid range: ${axis}_max (${hi}) must be greater than ${axis}_min (${lo})`)
    }
  }

  for (const [key, raw] of Object.entries(args.params ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`invalid parameter name "${key}": expected an identifier`)
    }
    if (!Array.isArray(raw) || raw.length !== 3 || !raw.every(isFiniteNumber)) {
      throw new Error(`invalid parameter "${key}": expected three finite numbers [min, max, value]`)
    }
    const [lo, hi, value] = raw as unknown[]
    if (!(Number(hi) > Number(lo))) {
      throw new Error(`invalid parameter "${key}": max (${String(hi)}) must exceed min (${String(lo)})`)
    }
    if (Number(value) < Number(lo) || Number(value) > Number(hi)) {
      throw new Error(`invalid parameter "${key}": value ${String(value)} lies outside [${String(lo)}, ${String(hi)}]`)
    }
  }

  if (args.marks !== undefined && !Array.isArray(args.marks)) {
    throw new Error('invalid marks: expected an array')
  }
  const marks = (args.marks ?? []) as readonly unknown[]
  if (marks.length > MAX_CANVAS_MARKS) {
    throw new Error(`invalid marks: at most ${MAX_CANVAS_MARKS} marks (got ${marks.length})`)
  }
  for (const [index, raw] of marks.entries()) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`invalid marks[${index}]: expected an object with a \`type\``)
    }
    const mark = raw as Record<string, unknown>
    const at = `marks[${index}]`
    const curve = mark.curve
    if (curve !== undefined && !(isFiniteNumber(curve) && Number.isInteger(curve) && curve >= 0)) {
      throw new Error(`invalid ${at}.curve: expected a non-negative integer`)
    }
    if (mark.color !== undefined && !isSketchColor(mark.color)) {
      throw new Error(`invalid ${at}.color: use a named color or #rgb/#rrggbb`)
    }
    switch (mark.type) {
      case 'tangent':
        if (mark.x !== undefined && !isFiniteNumber(mark.x)) throw new Error(`invalid ${at}.x: expected a number`)
        break
      case 'area':
        if (!isFiniteNumber(mark.a) || !isFiniteNumber(mark.b) || !(mark.b > mark.a)) {
          throw new Error(`invalid ${at}: \`a\` and \`b\` must be finite numbers with b > a`)
        }
        if (mark.n !== undefined && !(isFiniteNumber(mark.n) && mark.n >= 1 && mark.n <= MAX_AREA_RECTANGLES)) {
          throw new Error(`invalid ${at}.n: expected an integer in [1, ${MAX_AREA_RECTANGLES}]`)
        }
        break
      case 'poly':
        if (mark.center !== undefined && !isFiniteNumber(mark.center)) throw new Error(`invalid ${at}.center: expected a number`)
        if (mark.order !== undefined && !(isFiniteNumber(mark.order) && mark.order >= 1 && mark.order <= MAX_TAYLOR_ORDER)) {
          throw new Error(`invalid ${at}.order: expected an integer in [1, ${MAX_TAYLOR_ORDER}]`)
        }
        break
      case 'vline':
        if (!isFiniteNumber(mark.x)) {
          throw new Error(`invalid ${at}: \`x\` must be a finite number`)
        }
        for (const key of ['y0', 'y1'] as const) {
          if (mark[key] !== undefined && !isFiniteNumber(mark[key])) {
            throw new Error(`invalid ${at}.${key}: expected a number`)
          }
        }
        if (mark.label !== undefined && typeof mark.label !== 'string') {
          throw new Error(`invalid ${at}.label: expected a string`)
        }
        if (mark.dash !== undefined
          && !(typeof mark.dash === 'string' && (DASH_PRESETS as readonly string[]).includes(mark.dash))) {
          throw new Error(`invalid ${at}.dash: expected one of ${DASH_PRESETS.join(', ')}`)
        }
        if (mark.width !== undefined && !(isFiniteNumber(mark.width) && mark.width >= 0.5 && mark.width <= 6)) {
          throw new Error(`invalid ${at}.width: expected a number in [0.5, 6]`)
        }
        break
      case 'point':
        if (!isFiniteNumber(mark.x) || !isFiniteNumber(mark.y)) {
          throw new Error(`invalid ${at}: \`x\` and \`y\` must be finite numbers`)
        }
        if (mark.dx !== undefined && !isFiniteNumber(mark.dx)) throw new Error(`invalid ${at}.dx: expected a number`)
        if (mark.dy !== undefined && !isFiniteNumber(mark.dy)) throw new Error(`invalid ${at}.dy: expected a number`)
        break
      case 'text':
        if (!isFiniteNumber(mark.x) || !isFiniteNumber(mark.y)) {
          throw new Error(`invalid ${at}: \`x\` and \`y\` must be finite numbers`)
        }
        if (typeof mark.text !== 'string' || mark.text.trim().length === 0) {
          throw new Error(`invalid ${at}.text: expected a non-empty string`)
        }
        break
      default:
        throw new Error(`invalid ${at}.type: expected tangent, area, poly, vline, point or text`)
    }
  }
}

/** Compile one expression, returning a model-readable error detail or null. */
function compileError(expr: string): string | null {
  try {
    build(expr)
    return null
  } catch (error) {
    return error instanceof ParseError
      ? `${error.message} (at offset ${error.index})`
      : error instanceof Error ? error.message : String(error)
  }
}

/** Format a number for prose without exponent noise on ordinary values. */
function num(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return String(v)
  if (v !== 0 && Math.abs(v) < 1e-3) return v.toExponential(2)
  return Number(v.toFixed(digits)).toString()
}

/**
 * Describe the canvas in text, which is what the model actually reads.
 * @param spec - the canonical canvas spec.
 * @param geometry - what the card will draw.
 * @returns a short, factual description including computed mark quantities.
 */
function summarize(spec: CanvasSpec, geometry: ReturnType<typeof resolveCanvas>): string {
  const lines: string[] = []
  const window = `x ∈ [${num(geometry.xRange[0])}, ${num(geometry.xRange[1])}]`
  const yWindow = `y ∈ [${num(geometry.yRange.yMin)}, ${num(geometry.yRange.yMax)}]`
  const drawn = geometry.curves.filter((curve) => curve.points.length > 0)
  const skipped = geometry.curves.length - drawn.length

  const paramText = Object.entries(spec.params ?? {})
    .map(([k, v]) => `${k}=${num(v[2])}`)
    .join(', ')
  lines.push(
    `Drew ${drawn.length} curve(s)${paramText.length > 0 ? ` with ${paramText}` : ''} `
    + `(${window}, ${yWindow}).`,
  )

  if (drawn.length > 1) {
    lines.push(`Curves: ${drawn.map((c, i) => c.label ?? `curve ${i + 1}`).join(', ')}.`)
  }
  if (skipped > 0) lines.push(`Warning: ${skipped} curve(s) could not be drawn and were skipped.`)

  for (const mark of geometry.marks) {
    if (mark.type === 'tangent') {
      lines.push(`At x=${num(mark.x)}: f(x)=${num(mark.y)}, slope f'(x)=${num(mark.slope)}.`)
    } else if (mark.type === 'area') {
      const error = Math.abs(mark.sum - mark.exact)
      lines.push(
        `Area mark over [${num(mark.a)}, ${num(mark.b)}] with n=${mark.n}: ${num(mark.sum)}; `
        + `exact integral ${num(mark.exact)}; absolute error ${num(error)}.`,
      )
    } else if (mark.type === 'poly') {
      const terms = mark.coefficients.map((c, k) => {
        if (k === 0) return num(c)
        const power = k === 1 ? '(x-a)' : `(x-a)^${k}`
        return `${num(c)}${power}`
      })
      lines.push(`Taylor mark at a=${num(mark.center)}, degree ${mark.order}: ${terms.join(' + ')}.`)
    }
  }
  return lines.join('\n')
}

/** The pending card for a call: echo the first expression the model asked for. */
function presentSketchCall(args: SketchArgs): ToolCallView {
  const first = typeof args.expr === 'string' ? args.expr : (Array.isArray(args.curves) ? args.curves[0] : undefined)
  const title = typeof first === 'string' ? first : 'function canvas'
  return { card: 'generic', title, kind: 'read' }
}

/** Non-browser surfaces get the computed prose; browsers draw from presentationMeta. */
function presentSketchResult(_args: unknown, result: { content: readonly { type: string; text?: string }[] }): ToolResultView | undefined {
  const block = result.content.length === 1 ? result.content[0] : undefined
  if (block === undefined || block.type !== 'text' || block.text === undefined) return undefined
  return { card: 'generic', content: [{ type: 'text', text: block.text }] }
}

/** The canonical spec as plain JSON, bridged to the schema's JSON record type. */
function asJsonSpec(spec: CanvasSpec): Record<string, JsonValue> {
  return spec as unknown as Record<string, JsonValue>
}

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:sketch_function',
    order: ctx.systemPrompt.getSectionOrder('TOOL_WEB_SEARCH'),
    text: 'When the answer involves a function graph, a curve comparison, a derivative, an area, or a '
      + 'Taylor approximation, put a fenced block tagged aisketch-plot on the opening line (```aisketch-plot) '
      + 'in your answer, containing the canvas spec as JSON. Place the fence right after the sentence it '
      + 'illustrates and continue the explanation in the next paragraph, so the plot sits between text '
      + 'instead of at the end. A canvas is {"curves":["x^2", ...], "x":[min,max], "y":[min,max], '
      + '"params":{"A":[min,max,value]}, "marks":[...], "legend":true}: curves are y=f(x) expressions '
      + '(bare strings or {expr,color,dash,width,label} objects), x/y windows are optional, and every mark '
      + 'is optional. Mark types: tangent {curve?,x?}, area {curve?,a,b,n?}, poly {curve?,center?,order?,label?}, '
      + 'vline {x,curve?,y0?,y1?,label?,color?,dash?,width?} (a finite guide; y1 defaults to f(x), y0 to 0), '
      + 'point {x,y,text?,dx?,dy?,color?}, text {x,y,text}. Colors are names or #rgb/#rrggbb; dash is '
      + 'solid|dashed|dotted. Data charts (bar/pie/scatter) are NOT functions: use show_card with kind '
      + '"chart" and real series data. do not write HTML, SVG, or a plotting script yourself — the client '
      + 'renders a live figure from the JSON. The `sketch_function` tool only validates the spec and '
      + 'returns a short computed summary.',
  })

  ctx.tools.register(defineTool({
    name: 'sketch_function',
    description:
      'Validate a function-canvas spec and return a short computed summary. The public figure goes in '
      + 'the FINAL answer as a fenced ```aisketch-plot block containing this exact JSON spec, placed '
      + 'between the paragraphs it explains. '
      + 'Give 1..8 curves as `curves` (bare "y=f(x)" strings, or {expr,color,dash,width,label} objects) '
      + 'and optionally a single `expr` as the first curve. Expressions use x as the variable (sin, cos, '
      + 'tan, exp, log, sqrt, abs, and pi/e are available; implicit multiplication like `2x` works). '
      + 'Any other identifier becomes a tunable slider — declare bounds in `params` as [min,max,value]. '
      + 'Set `x`/`y` with x_min/x_max/y_min/y_max to fix either window. Optional `marks` add a tangent '
      + 'line, an area sum, a Taylor polynomial, a point or a text note; several marks can share one canvas. '
      + 'Data charts belong to show_card kind "chart", not here. Returns what was drawn plus any computed '
      + 'quantity.',
    parameters: {
      expr: {
        type: 'string',
        description: 'The first curve: a function of x, e.g. "x^2", "A*sin(w*x+p)", "sin(x)/x".',
      },
      curves: {
        type: 'array',
        description:
          'Additional curves, or all curves when no `expr` is given. Each is an expression string '
          + '("sin(x)") or an object {expr, color?, dash?, width?, label?}. dash is solid|dashed|dotted; '
          + 'color is a name or #rgb/#rrggbb; width is 0.5..6. At most 8 curves in total.',
      },
      x_min: { type: 'number', description: 'Left edge of the x-window. Auto-fitted when omitted.' },
      x_max: { type: 'number', description: 'Right edge of the x-window. Auto-fitted when omitted.' },
      y_min: { type: 'number', description: 'Bottom of the y-window. Fitted from all curves when omitted.' },
      y_max: { type: 'number', description: 'Top of the y-window. Fitted from all curves when omitted.' },
      params: {
        type: 'object',
        additionalProperties: true,
        description:
          'Parameters used by any curve, each as [min, max, value], e.g. {"A":[0.2,2,1]}. '
          + 'The first parameter can be swept as an animation; all parameters get sliders.',
      },
      marks: {
        type: 'array',
        description:
          'Optional annotation layers. tangent: {type:"tangent",curve?,x?}; '
          + 'area: {type:"area",curve?,a,b,n?}; poly: {type:"poly",curve?,center?,order?,label?}; '
          + 'vline: {type:"vline",x,curve?,y0?,y1?,label?,color?,dash?,width?} (y1 defaults to f(x), y0 to 0); '
          + 'point: {type:"point",x,y,text?,dx?,dy?,color?}; text: {type:"text",x,y,text}. '
          + 'curve is a zero-based index into the curves list.',
      },
      legend: {
        type: 'boolean',
        description: 'Show a legend for labelled curves. Defaults to true when any curve has a label.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          spec: {
            type: 'object',
            additionalProperties: true,
            required: true,
            description: 'The canonical canvas specification, replayed by the card.',
          },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
      presentationMeta: (_args, value) => ({ spec: value.spec }),
    },
    async execute(rawArgs, exec) {
      if (exec.signal.aborted) throw new Error('tool call aborted')
      const args = rawArgs as unknown as SketchArgs
      validateArgs(args)

      const upgraded = upgradeSpec(args as unknown)
      if (upgraded === null) throw new Error('invalid canvas: no drawable curves')
      // A model that guesses an unused parameter should still get a picture;
      // keep the spec free of sliders that nothing can move.
      const { params: declared, ...rest } = upgraded
      const used = new Set(canvasParameters(upgraded))
      const params: Record<string, CanvasParam> = {}
      for (const [name, tuple] of Object.entries(declared ?? {})) {
        if (used.has(name)) params[name] = tuple
      }
      const spec: CanvasSpec = { ...rest, ...Object.keys(params).length > 0 ? { params } : {} }
      for (const expr of canvasExpressions(spec)) {
        const error = compileError(expr)
        if (error !== null) throw new Error(`cannot parse expression "${expr}": ${error}`)
      }

      const geometry = resolveCanvas(spec)
      if (geometry.curves.every((curve) => curve.points.length === 0)) {
        throw new Error('cannot parse expression: no curve produced finite samples')
      }
      return { spec: asJsonSpec(spec), summary: summarize(spec, geometry) }
    },
    presentCall: presentSketchCall,
    presentResult: presentSketchResult,
  }))
}

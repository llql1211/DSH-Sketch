/**
 * The live function canvas: one card, one Canvas, drawn from a persisted spec.
 *
 * Geometry comes from `@aisketch/sketch-core`, the module the Host tool used, so
 * the picture is derived rather than transported: no live Host call, and a
 * replayed session renders the identical plot.
 *
 * Interaction -- sliders and the readout tracer -- is local to this component.
 * The persisted spec keeps the declared values, so a reload or a replay rests
 * every slider back where the AI put it and no session event is written.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { canvasExpressions, resolveCanvas } from '@aisketch/sketch-core'
import type { CanvasGeometry, CanvasSpec } from '@aisketch/sketch-core'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Viewport,
  chartPaletteFor,
  drawAxes,
  drawBars,
  drawCurve,
  drawLegend,
  drawNote,
  drawPoint,
  drawVLine,
  squareBounds,
} from './render.ts'
import type { ChartPalette, LegendEntry, Sample } from './render.ts'
import { readSurfaceColor, useThemeRefresh } from './theme.ts'
import { NS } from './locales.ts'
import { CLS, ensureStyles } from './styles.ts'
import { compileCurves, freezeWindow, initialValues, stepOf, withValues } from './params.ts'
import type { ParamValues } from './params.ts'
import { formatReadout, pickReadout } from './readout.ts'
import type { ReadoutCurve } from './readout.ts'
import { copyCanvasAsPng, pngFilename, saveCanvasAsPng } from './save-png.ts'

ensureStyles()

/** Card geometry in CSS pixels; the canvas backs itself at device resolution. */
const WIDTH = 620
const HEIGHT = 380

/** The expanded overlay draws at this size, so a dense curve stays readable. */
const EXPANDED_WIDTH = 1000
const EXPANDED_HEIGHT = 600

/** Parameter sweep: how long one animation frame advances the value. */
const SWEEP_STEP = 0.06

/** One arrow-key step of the tracer, as a fraction of the plot width. */
const TRACE_KEYS = 200

/** Convert core points into the renderer's tuple form. */
function toSamples(points: readonly { readonly x: number; readonly y: number | null }[]): Sample[] {
  return points.map((p) => [p.x, p.y] as const)
}

/** The parameter swept by the animation: the first one declared. */
function leadName(spec: CanvasSpec): string | undefined {
  return Object.keys(spec.params ?? {})[0]
}

/** Palette color for one curve, falling back to the cycling series palette. */
function curveColor(index: number, declared: string | undefined, palette: ChartPalette): string {
  return declared ?? palette.curve[index % palette.curve.length] ?? palette.curve[0]
}

/** Draw one frame of canvas geometry into a 2D context. */
function paint(
  ctx: CanvasRenderingContext2D,
  spec: CanvasSpec,
  geometry: CanvasGeometry,
  vp: Viewport,
  palette: ChartPalette,
): void {
  drawAxes(ctx, vp, palette)

  for (const mark of geometry.marks) {
    if (mark.type === 'area') drawBars(ctx, vp, mark.bars, mark.a, mark.b, palette)
  }

  geometry.curves.forEach((curve, i) => {
    drawCurve(ctx, vp, toSamples(curve.points), curveColor(i, curve.color, palette), curve.width, curve.dash)
  })

  for (const mark of geometry.marks) {
    if (mark.type === 'area') continue
    if (mark.type === 'vline') {
      const color = mark.color ?? palette.curve[0]
      drawVLine(ctx, vp, mark.x, mark.y0, mark.y1, color, mark.dash, mark.width)
      if (mark.label !== undefined) {
        drawNote(ctx, vp, {
          x: mark.x, y: mark.y1, text: mark.label,
          dx: 5, dy: -4, color, dot: false,
        })
      }
      continue
    }
    if (mark.type === 'tangent') {
      const span = geometry.xRange[1] - geometry.xRange[0]
      const left = mark.x - span
      const right = mark.x + span
      drawCurve(
        ctx,
        vp,
        [
          [left, mark.y + mark.slope * (left - mark.x)],
          [right, mark.y + mark.slope * (right - mark.x)],
        ],
        palette.tangent,
        1.5,
        [6, 4],
      )
      drawNote(ctx, vp, {
        x: mark.x, y: mark.y, text: `f'(x)=${mark.slope.toFixed(3)}`,
        dx: 8, dy: -6, color: palette.point, dot: true,
      })
      continue
    }
    if (mark.type === 'poly') {
      drawCurve(ctx, vp, toSamples(mark.points), palette.curve[2] ?? palette.curve[0], 2, [5, 4])
      drawPoint(ctx, vp, mark.center, mark.coefficients[0] ?? 0, undefined, palette.point)
      continue
    }
    drawNote(ctx, vp, {
      x: mark.x,
      y: mark.y,
      text: mark.text,
      dx: mark.dx,
      dy: mark.dy,
      color: mark.color ?? palette.point,
      dot: mark.type === 'point',
    })
  }

  if (spec.legend !== false) {
    const entries: LegendEntry[] = []
    geometry.curves.forEach((curve, i) => {
      if (curve.label === undefined) return
      entries.push({
        label: curve.label,
        color: curveColor(i, curve.color, palette),
        dash: curve.dash,
        width: curve.width,
      })
    })
    for (const mark of geometry.marks) {
      if (mark.type !== 'poly') continue
      entries.push({ label: mark.label, color: palette.curve[2] ?? palette.curve[0], dash: [5, 4], width: 2 })
    }
    drawLegend(ctx, vp, entries, palette)
  }
}

/** A spec plus the localized copy seat. */
export type SketchFigureProps = { readonly spec: CanvasSpec } & PropsLocale<typeof NS>

/** One plot surface: the head row, the Canvas with its readout tracer, and sliders. */
interface SketchPlotProps extends SketchFigureProps {
  readonly width: number
  readonly height: number
  readonly equalAspect: boolean
  readonly onEqualAspectChange: (value: boolean) => void
  readonly onExpand?: (() => void) | undefined
  readonly onClose?: (() => void) | undefined
}

/** Render one canvas spec as a live plot. */
function SketchPlot({ spec, t, width, height, equalAspect, onEqualAspectChange, onExpand, onClose }: SketchPlotProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const themeRefresh = useThemeRefresh()

  const [values, setValues] = useState<ParamValues>(() => initialValues(spec))
  const [playing, setPlaying] = useState(false)
  const [cursor, setCursor] = useState<{ px: number; py: number } | null>(null)
  const [pinned, setPinned] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number | null>(null)

  const params = Object.entries(spec.params ?? {})
  const lead = leadName(spec)
  const title = canvasExpressions(spec)[0] ?? t('card.title')

  useEffect(() => {
    setPlaying(false)
    setPinned(false)
    setCursor(null)
    setValues(initialValues(spec))
  }, [spec])

  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
  }, [])

  const copy = useCallback(() => {
    const element = canvas.current
    if (element === null) return
    void copyCanvasAsPng(element).then((ok) => {
      if (!ok) return
      setCopied(true)
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1600)
    })
  }, [])

  // Held over every corner of the parameter box, so dragging any slider changes
  // the curves and never the axes. An explicit y-window in the spec wins.
  const frozenY = useMemo(() => freezeWindow(spec), [spec])

  const geometry = useMemo(
    () => resolveCanvas(withValues(spec, values), { frozenYRange: frozenY }),
    [spec, values, frozenY],
  )

  const evaluators = useMemo(() => compileCurves(spec), [spec])

  const viewport = useMemo(() => {
    const [x0, x1, y0, y1] = equalAspect
      ? squareBounds(geometry.xRange[0], geometry.xRange[1], geometry.yRange.yMin, geometry.yRange.yMax, width, height)
      : [geometry.xRange[0], geometry.xRange[1], geometry.yRange.yMin, geometry.yRange.yMax]
    return new Viewport(x0 as number, x1 as number, y0 as number, y1 as number).fit(width, height)
  }, [geometry.xRange, geometry.yRange, width, height, equalAspect])

  useEffect(() => {
    const element = canvas.current
    if (element === null) return
    const ratio = Math.max(1, globalThis.devicePixelRatio ?? 1)
    element.width = width * ratio
    element.height = height * ratio
    const ctx = element.getContext('2d')
    if (ctx === null) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const palette = chartPaletteFor(readSurfaceColor(element))
    paint(ctx, spec, geometry, viewport, palette)
    if (cursor === null) return
    const curves: ReadoutCurve[] = geometry.curves.flatMap((curve) => {
      const fn = evaluators.get(curve.expr)
      const index = geometry.curves.indexOf(curve)
      return fn === undefined ? [] : [{ fn, color: curveColor(index, curve.color, palette) }]
    })
    const point = pickReadout({ px: cursor.px, py: cursor.py, vp: viewport, curves, values })
    if (point !== null) {
      drawPoint(ctx, viewport, point.x, point.y, `(${formatReadout(point.x)}, ${formatReadout(point.y)})`, point.color)
    }
  }, [spec, geometry, viewport, cursor, evaluators, values, width, height, themeRefresh])

  useEffect(() => {
    if (!playing || lead === undefined) return
    const tuple = spec.params?.[lead]
    if (tuple === undefined) return
    const id = setInterval(() => {
      setValues((current) => {
        const [lo, hi] = tuple
        const span = hi - lo
        const next = (current[lead] ?? tuple[2]) + span * SWEEP_STEP
        return { ...current, [lead]: next > hi ? lo : next }
      })
    }, 50)
    return () => clearInterval(id)
  }, [playing, lead, spec.params])

  const setValue = useCallback((name: string, value: number) => {
    setValues((current) => ({ ...current, [name]: value }))
  }, [])

  const reset = useCallback(() => {
    setPlaying(false)
    setValues(initialValues(spec))
  }, [spec])

  const traceTo = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const element = canvas.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    setCursor({
      px: ((event.clientX - rect.left) * width) / rect.width,
      py: ((event.clientY - rect.top) * height) / rect.height,
    })
  }, [width, height])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    const step = width / TRACE_KEYS
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const at = cursor ?? { px: width / 2, py: height / 2 }
      setCursor({ ...at, px: Math.min(width, Math.max(0, at.px + (event.key === 'ArrowRight' ? step : -step))) })
      return
    }
    if (event.key === 'Escape') {
      setPinned(false)
      setCursor(null)
    }
  }

  return (
    <div className={CLS.card} data-tool="sketch_function" data-state="ok">
      <div className={CLS.head}>
        <span className={CLS.title}>{title}</span>
        <label className={CLS.aspect}>
          <input
            type="checkbox"
            checked={equalAspect}
            onChange={(event) => onEqualAspectChange(event.currentTarget.checked)}
          />
          {t('card.equalAspect')}
        </label>
        <span className={CLS.actions}>
          {lead !== undefined && (
            <button type="button" className={CLS.action} onClick={() => setPlaying((value) => !value)}>
              {playing ? t('card.pause') : t('card.animate')}
            </button>
          )}
          <button type="button" className={CLS.action} aria-label={t('card.copyHint')} title={t('card.copyHint')} onClick={copy}>
            ⧉ {copied ? t('card.copied') : t('card.copy')}
          </button>
          <button
            type="button"
            className={CLS.action}
            aria-label={t('card.saveHint')}
            title={t('card.saveHint')}
            onClick={() => {
              const element = canvas.current
              if (element !== null) saveCanvasAsPng(element, pngFilename(title))
            }}
          >
            ⇩ {t('card.save')}
          </button>
          {onExpand === undefined ? null : (
            <button type="button" className={CLS.action} onClick={onExpand} aria-label={t('card.expand')} title={t('card.expand')}>
              ⤢
            </button>
          )}
          {onClose === undefined ? null : (
            <button type="button" className={CLS.action} onClick={onClose} aria-label={t('card.close')} title={t('card.close')}>
              ✕
            </button>
          )}
        </span>
      </div>
      <canvas
        ref={canvas}
        className={CLS.canvas}
        style={{ width: `${width}px`, height: `${height}px` }}
        role="img"
        tabIndex={0}
        aria-label={title}
        title={t('card.readoutHint')}
        onPointerMove={traceTo}
        onPointerDown={(event) => {
          setPinned((value) => !value)
          traceTo(event)
        }}
        onPointerLeave={() => {
          if (!pinned) setCursor(null)
        }}
        onKeyDown={onKeyDown}
      />
      {params.length > 0 && (
        <div className={CLS.params}>
          <div>
            <span className={CLS.paramsLabel}>{t('card.param')}</span>
            <button type="button" className={CLS.action} onClick={reset}>
              {t('card.reset')}
            </button>
          </div>
          {params.map(([name, tuple]) => {
            const declared = values[name] ?? tuple[2]
            const clamped = Math.min(tuple[1], Math.max(tuple[0], declared))
            return (
              <label key={name} className={CLS.paramRow}>
                <span className={CLS.paramName}>{name}</span>
                <input
                  className={CLS.paramRange}
                  type="range"
                  min={tuple[0]}
                  max={tuple[1]}
                  step={stepOf(tuple)}
                  value={clamped}
                  onChange={(event) => setValue(name, Number(event.currentTarget.value))}
                />
                <span className={CLS.paramValue}>{formatReadout(clamped)}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The plot card and its expand overlay. */
export function SketchFigure({ spec, t }: SketchFigureProps) {
  const [expanded, setExpanded] = useState(false)
  const [equalAspect, setEqualAspect] = useState(false)
  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [expanded])
  return (
    <>
      <SketchPlot
        spec={spec}
        t={t}
        width={WIDTH}
        height={HEIGHT}
        equalAspect={equalAspect}
        onEqualAspectChange={setEqualAspect}
        onExpand={() => setExpanded(true)}
      />
      {expanded && typeof document !== 'undefined'
        ? createPortal(
          <div className={CLS.overlay} onClick={() => setExpanded(false)}>
            <div
              className={CLS.dialog}
              role="dialog"
              aria-modal="true"
              aria-label={canvasExpressions(spec)[0]}
              onClick={(event) => event.stopPropagation()}
            >
              <SketchPlot
                spec={spec}
                t={t}
                width={EXPANDED_WIDTH}
                height={EXPANDED_HEIGHT}
                equalAspect={equalAspect}
                onEqualAspectChange={setEqualAspect}
                onClose={() => setExpanded(false)}
              />
            </div>
          </div>,
          document.body,
        )
        : null}
    </>
  )
}

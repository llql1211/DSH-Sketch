/**
 * The `chart` card: a Canvas picture of data the model actually supplied.
 *
 * The payload is parsed by the same core validator the Host used; this renderer
 * never sees raw numbers until they are known-finite and bounded. The Canvas is
 * then painted by a pure function of that payload, so two cards with the same
 * spec show the same picture -- including after a session replay.
 *
 * A light/dark switch changes no payload; the theme hook supplies a repaint
 * trigger and the palette is chosen from the surface the browser painted.
 */

import { useEffect, useMemo, useRef } from 'react'
import { parseChartPayload } from '@aisketch/cards-core'
import type { ChartPayload } from '@aisketch/cards-core'
import { CardFrame } from './CardFrame.tsx'
import { RawCard } from './RawCard.tsx'
import type { CardRendererProps } from './registry.ts'
import { CHART_HEIGHT, CHART_WIDTH, chartPaletteFor, drawChart } from './chart-canvas.ts'
import { readSurfaceColor, useThemeRefresh } from './chart-theme.ts'
import { CLS, artVars } from './styles.ts'

/** One Canvas surface, repainted only when the payload or the theme changes. */
function ChartCanvas({ chart, label }: { chart: ChartPayload; label: string }) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const themeRefresh = useThemeRefresh()
  useEffect(() => {
    const element = canvas.current
    if (element === null) return
    const ratio = Math.max(1, globalThis.devicePixelRatio ?? 1)
    element.width = CHART_WIDTH * ratio
    element.height = CHART_HEIGHT * ratio
    const ctx = element.getContext('2d')
    if (ctx === null) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawChart(ctx, chart, chartPaletteFor(readSurfaceColor(element)), CHART_WIDTH, CHART_HEIGHT)
  }, [chart, themeRefresh])
  return (
    <canvas
      ref={canvas}
      className={`${CLS.chart} ${CLS.art}`}
      style={artVars(CHART_WIDTH, CHART_HEIGHT)}
      width={CHART_WIDTH}
      height={CHART_HEIGHT}
      role="img"
      aria-label={label}
    />
  )
}

/**
 * Draw a data chart, or the raw fallback when the payload is not one.
 * @param props - the admitted card and this plugin's translate.
 * @returns the chart card.
 */
export function ChartCard({ card, t }: CardRendererProps) {
  const chart = useMemo(() => parseChartPayload(card.payload), [card.payload])
  if (chart === null) {
    return (
      <RawCard
        title={t('broken.title')}
        hint={t('broken.hint')}
        kind={card.kind}
        data={card.payload}
      />
    )
  }
  const points = chart.series.reduce((total, entry) => total + entry.data.length, 0)
  const summary = t('chart.summary', { type: chart.type, series: chart.series.length, points })
  return (
    <CardFrame
      kind={card.kind}
      title={card.title ?? t('chart.title')}
      summary={summary}
      t={t}
    >
      <div className={CLS.chartScroll} data-card-export="">
        <ChartCanvas chart={chart} label={summary} />
      </div>
    </CardFrame>
  )
}

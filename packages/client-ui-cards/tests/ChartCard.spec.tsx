/**
 * The chart renderer as a component.
 *
 * The Canvas image itself is covered by chart-canvas.spec; what belongs here is
 * the card contract: a native card frame with the chart kind, a deterministically
 * sized Canvas seat whose accessible name comes from the parsed payload, and a
 * raw fallback for a payload the Host would have refused.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CardSpec } from '@aisketch/cards-core'
import { ChartCard } from '../src/client/ChartCard.tsx'

/** A translate stand-in; the key is enough to prove a string reached the tree. */
const t = ((key: string) => key) as never

const chart: CardSpec = {
  version: 1,
  kind: 'chart',
  title: '成绩对比',
  payload: {
    type: 'line',
    series: [{ label: '上学期', data: [72, 85, 63] }],
    categories: ['语文', '数学', '英语'],
  },
}

describe('ChartCard', () => {
  it('renders a titled chart card with a Canvas picture seat', () => {
    const html = renderToStaticMarkup(<ChartCard card={chart} t={t} />)
    expect(html).toContain('data-card-kind="chart"')
    expect(html).toContain('成绩对比')
    expect(html).toContain('<canvas')
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="chart.summary"')
    expect(html).toContain('chart.summary')
    expect(html).toContain('cd-chart-scroll')
    expect(html).toContain('data-card-export')
  })

  it('publishes the authored canvas size so the illustration seat stays stable', () => {
    const html = renderToStaticMarkup(<ChartCard card={chart} t={t} />)
    expect(html).toContain('--cd-art-w:620px')
    expect(html).toContain('--cd-art-ratio:1.631578947368421')
    expect(html).toContain('width="620"')
    expect(html).toContain('height="380"')
  })

  it('uses the default title when the card has none', () => {
    const untitled: CardSpec = { version: 1, kind: 'chart', payload: chart.payload }
    const html = renderToStaticMarkup(<ChartCard card={untitled} t={t} />)
    expect(html).toContain('chart.title')
  })

  it('falls back to the raw view for an invalid chart payload', () => {
    const broken: CardSpec = { version: 1, kind: 'chart', payload: { series: [] } }
    const html = renderToStaticMarkup(<ChartCard card={broken} t={t} />)
    expect(html).toContain('cd-raw')
    expect(html).not.toContain('<canvas')
  })
})

/**
 * Data-chart contract tests.
 *
 * A chart is a model-authored payload, so the Host half is the trust boundary:
 * every bad field must come back as a reason the model can correct, and the
 * browser half must be able to parse the very same payload back out of a
 * persisted call. Nothing here asserts pixels; that is the client's job.
 */
import { describe, expect, it } from 'vitest'
import {
  CHART_KIND, MAX_CHART_CATEGORIES, MAX_CHART_LABEL_LENGTH, MAX_CHART_POINTS, MAX_CHART_SERIES,
  MAX_CHART_VALUE, checkChartPayload, parseCardSpec, parseChartPayload, summarizeCard, validateCardArgs,
} from '../src/index.ts'

/** One admissible chart, reused by the cases below. */
const scores = {
  type: 'line',
  series: [
    { label: '上学期', data: [72, 85, 63] },
    { label: '下学期', data: [80, 90, 77] },
  ],
  categories: ['语文', '数学', '英语'],
}

describe('chart payload', () => {
  it('parses series, categories and type with defaults applied', () => {
    expect(parseChartPayload(scores)).toEqual(scores)
    expect(parseChartPayload({ series: [{ label: 'A', data: [1] }] })).toEqual({
      type: 'line', series: [{ label: 'A', data: [1] }], categories: [],
    })
  })

  it('keeps every series for a pie, leaving the "first series only" rule to the renderer', () => {
    const parsed = parseChartPayload({
      type: 'pie',
      series: [{ label: '分布', data: [35, 65] }, { label: 'ignored', data: [1] }],
    })
    expect(parsed?.type).toBe('pie')
    expect(parsed?.series).toHaveLength(2)
  })

  it('accepts negative values, zero and the largest admitted magnitude', () => {
    const parsed = parseChartPayload({ series: [{ label: '差值', data: [-MAX_CHART_VALUE, 0, MAX_CHART_VALUE] }] })
    expect(parsed?.series[0]?.data).toEqual([-MAX_CHART_VALUE, 0, MAX_CHART_VALUE])
  })

  it('accepts an empty category list and short labels', () => {
    expect(parseChartPayload({ type: 'bar', series: [{ label: 'A', data: [1] }], categories: [] })?.categories).toEqual([])
    expect(parseChartPayload({ series: [{ label: 'x'.repeat(MAX_CHART_LABEL_LENGTH), data: [1] }] })).not.toBeNull()
  })

  it.each([
    ['not an object', 'chart'],
    ['null', null],
    ['unknown type', { type: 'area', series: [{ label: 'A', data: [1] }] }],
    ['numeric type', { type: 7, series: [{ label: 'A', data: [1] }] }],
    ['no series', { series: undefined }],
    ['series not an array', { series: {} }],
    ['empty series', { series: [] }],
    ['too many series', { series: Array.from({ length: MAX_CHART_SERIES + 1 }, (_v, i) => ({ label: `S${i}`, data: [1] })) }],
    ['series not an object', { series: ['A'] }],
    ['missing label', { series: [{ data: [1] }] }],
    ['blank label', { series: [{ label: '   ', data: [1] }] }],
    ['numeric label', { series: [{ label: 3, data: [1] }] }],
    ['over-long label', { series: [{ label: 'x'.repeat(MAX_CHART_LABEL_LENGTH + 1), data: [1] }] }],
    ['missing data', { series: [{ label: 'A' }] }],
    ['data not an array', { series: [{ label: 'A', data: 1 }] }],
    ['empty data', { series: [{ label: 'A', data: [] }] }],
    ['too much data', { series: [{ label: 'A', data: Array.from({ length: MAX_CHART_POINTS + 1 }, () => 1) }] }],
    ['string data', { series: [{ label: 'A', data: ['1'] }] }],
    ['null data', { series: [{ label: 'A', data: [null] }] }],
    ['NaN data', { series: [{ label: 'A', data: [Number.NaN] }] }],
    ['infinite data', { series: [{ label: 'A', data: [Number.POSITIVE_INFINITY] }] }],
    ['over-large data', { series: [{ label: 'A', data: [MAX_CHART_VALUE + 1] }] }],
    ['categories not an array', { series: [{ label: 'A', data: [1] }], categories: {} }],
    [
      'too many categories',
      { series: [{ label: 'A', data: [1] }], categories: Array.from({ length: MAX_CHART_CATEGORIES + 1 }, () => 'c') },
    ],
    ['numeric category', { series: [{ label: 'A', data: [1] }], categories: [1] }],
    ['over-long category', { series: [{ label: 'A', data: [1] }], categories: ['x'.repeat(MAX_CHART_LABEL_LENGTH + 1)] }],
  ])('refuses %s', (_label, payload) => {
    expect(parseChartPayload(payload)).toBeNull()
  })

  it('returns the specific reason for a bad field so the model can fix it', () => {
    const missing = checkChartPayload({ series: [{ label: 'A', data: [1] }], categories: [1] })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('chart category 0 must be a string')

    const huge = checkChartPayload({ series: [{ label: 'A', data: [1e10] }] })
    expect(huge.ok).toBe(false)
    if (!huge.ok) expect(huge.error).toContain(String(MAX_CHART_VALUE))

    const type = checkChartPayload({ type: 'area', series: [{ label: 'A', data: [1] }] })
    expect(type.ok).toBe(false)
    if (!type.ok) expect(type.error).toContain('line, bar, scatter, pie')
  })
})

describe('chart cards at the tool boundary', () => {
  it('admits a well-formed chart and stamps the contract version', () => {
    const result = validateCardArgs({ kind: CHART_KIND, title: '成绩', payload: scores })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.card.kind).toBe('chart')
      expect(result.card.version).toBe(1)
    }
  })

  it('refuses a malformed chart with the payload reason', () => {
    const result = validateCardArgs({ kind: CHART_KIND, payload: { series: [{ label: 'A', data: [] }] } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('1..24 data values')
  })

  it('survives the persistence round trip the browser replays', () => {
    const admitted = validateCardArgs({ kind: CHART_KIND, payload: scores })
    expect(admitted.ok).toBe(true)
    if (!admitted.ok) return
    expect(parseCardSpec(JSON.parse(JSON.stringify(admitted.card)) as unknown)).toEqual(admitted.card)
  })

  it('keeps the raw fallback for an unknown kind and for a broken chart payload', () => {
    const unknown = parseCardSpec({ kind: 'gantt', payload: { tasks: [] } })
    expect(unknown).not.toBeNull()
    if (unknown !== null) expect(summarizeCard(unknown)).toBe('Showed a "gantt" card (payload keys: tasks).')

    const broken = parseCardSpec({ kind: CHART_KIND, payload: { series: [] } })
    expect(broken).not.toBeNull()
    if (broken !== null) expect(summarizeCard(broken)).toBe('Showed a "chart" card (payload keys: series).')
  })

  it('summarizes a chart in one factual line', () => {
    const card = parseCardSpec({ kind: CHART_KIND, title: '成绩', payload: scores })
    expect(card).not.toBeNull()
    if (card === null) return
    expect(summarizeCard(card)).toBe(
      'Showed a "chart" card titled "成绩": line chart: 2 series, 6 point(s), categories 语文, 数学, 英语.',
    )
  })

  it('says so when a chart has no category captions', () => {
    const card = parseCardSpec({ kind: CHART_KIND, payload: { type: 'pie', series: [{ label: '分布', data: [1, 2] }] } })
    expect(card).not.toBeNull()
    if (card === null) return
    expect(summarizeCard(card)).toContain('pie chart: 1 series, 2 point(s), no category captions')
  })
})

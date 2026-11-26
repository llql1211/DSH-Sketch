/**
 * The data-chart card.
 *
 * A function plot samples an expression the model writes; a data chart draws
 * numbers the model was actually given. That difference is why this is a card
 * of its own rather than another `sketch_function` mode: the payload carries the
 * real series and categories, and the browser owns every pixel of the axes,
 * bars, slices and legend. Nothing here computes layout or accepts a color, a
 * coordinate or an SVG string.
 *
 * The model supplies at least one named series; `type` and `categories` are
 * optional. Strict Host-side validation with a readable reason keeps the model
 * able to correct a bad call instead of receiving a blank card.
 */

/** Native card kind for a data chart. */
export const CHART_KIND = 'chart'

/** Chart forms this release understands. */
export const CHART_TYPES = ['line', 'bar', 'scatter', 'pie'] as const

/** A supported chart form; `line` when the model omits `type`. */
export type ChartType = typeof CHART_TYPES[number]

/** Series ceiling: eight coloured lines already fill a small legend. */
export const MAX_CHART_SERIES = 8

/** Point ceiling per series: one value per category, with room for 24 categories. */
export const MAX_CHART_POINTS = 24

/** Category ceiling, including an empty label list. */
export const MAX_CHART_CATEGORIES = 24

/** Label ceiling for a series name or a category caption. */
export const MAX_CHART_LABEL_LENGTH = 48

/** Value magnitude ceiling: larger numbers are a mistake, not a chart. */
export const MAX_CHART_VALUE = 1e9

/** One named series of real values, aligned by index with `categories`. */
export interface ChartSeries {
  /** Legend text; non-empty and at most {@link MAX_CHART_LABEL_LENGTH} characters. */
  readonly label: string
  /** One finite number per category; 1..{@link MAX_CHART_POINTS} of them. */
  readonly data: readonly number[]
}

/** Parsed {@link CHART_KIND} payload: defaults applied, geometry untouched. */
export interface ChartPayload {
  /** Chart form; `line` when omitted. */
  readonly type: ChartType
  /** 1..{@link MAX_CHART_SERIES} named series; a pie uses only the first. */
  readonly series: readonly ChartSeries[]
  /** Category captions, or empty when the model supplied none. */
  readonly categories: readonly string[]
}

/** Validation result for a chart payload. */
export type ChartValidation =
  | { readonly ok: true; readonly chart: ChartPayload }
  | { readonly ok: false; readonly error: string }

/** Narrow one unknown value to a non-array, non-null object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow one unknown value to a supported chart form. */
function isChartType(value: unknown): value is ChartType {
  return typeof value === 'string' && (CHART_TYPES as readonly string[]).includes(value)
}

/**
 * Check a chart payload with a reason, so the Host can refuse a malformed chart
 * while the model can still correct it.
 * @param payload - candidate chart payload.
 * @returns normalized series/categories, or the first refusal reason.
 */
export function checkChartPayload(payload: unknown): ChartValidation {
  if (!isRecord(payload)) return { ok: false, error: 'chart payload must be an object' }

  let type: ChartType = 'line'
  const rawType = payload.type
  if (rawType !== undefined && rawType !== null) {
    if (!isChartType(rawType)) {
      return { ok: false, error: `chart type must be one of: ${CHART_TYPES.join(', ')}` }
    }
    type = rawType
  }

  const rawSeries = payload.series
  if (!Array.isArray(rawSeries)) return { ok: false, error: 'chart payload needs a series array' }
  if (rawSeries.length === 0 || rawSeries.length > MAX_CHART_SERIES) {
    return { ok: false, error: `chart payload needs 1..${MAX_CHART_SERIES} series` }
  }
  const series: ChartSeries[] = []
  for (let index = 0; index < rawSeries.length; index += 1) {
    const raw = rawSeries[index]
    if (!isRecord(raw)) return { ok: false, error: `chart series ${index} must be an object with a label and data` }

    const label = raw.label
    if (typeof label !== 'string' || label.trim().length === 0) {
      return { ok: false, error: `chart series ${index} needs a non-empty label` }
    }
    if (label.length > MAX_CHART_LABEL_LENGTH) {
      return { ok: false, error: `chart series ${index} label must be at most ${MAX_CHART_LABEL_LENGTH} characters` }
    }

    const rawData = raw.data
    if (!Array.isArray(rawData)) return { ok: false, error: `chart series ${index} needs a data array` }
    if (rawData.length === 0 || rawData.length > MAX_CHART_POINTS) {
      return { ok: false, error: `chart series ${index} needs 1..${MAX_CHART_POINTS} data values` }
    }
    const data: number[] = []
    for (const value of rawData) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, error: `chart series ${index} data values must be finite numbers` }
      }
      if (Math.abs(value) > MAX_CHART_VALUE) {
        return { ok: false, error: `chart series ${index} data values must have magnitude at most ${MAX_CHART_VALUE}` }
      }
      data.push(value)
    }
    series.push({ label, data })
  }

  const rawCategories = payload.categories ?? []
  if (!Array.isArray(rawCategories)) return { ok: false, error: 'chart categories must be an array' }
  if (rawCategories.length > MAX_CHART_CATEGORIES) {
    return { ok: false, error: `chart payload holds at most ${MAX_CHART_CATEGORIES} categories` }
  }
  const categories: string[] = []
  for (let index = 0; index < rawCategories.length; index += 1) {
    const category = rawCategories[index]
    if (typeof category !== 'string') return { ok: false, error: `chart category ${index} must be a string` }
    if (category.length > MAX_CHART_LABEL_LENGTH) {
      return { ok: false, error: `chart category ${index} must be at most ${MAX_CHART_LABEL_LENGTH} characters` }
    }
    categories.push(category)
  }

  return { ok: true, chart: { type, series, categories } }
}

/**
 * Lenient parse for the browser, which must render a persisted call.
 * @param payload - candidate chart payload.
 * @returns normalized chart, or null when it is not usable.
 */
export function parseChartPayload(payload: unknown): ChartPayload | null {
  const checked = checkChartPayload(payload)
  return checked.ok ? checked.chart : null
}

/**
 * One factual line for the model-facing summary.
 * @param chart - normalized chart.
 * @returns a short description of what the payload holds.
 */
export function summarizeChart(chart: ChartPayload): string {
  const points = chart.series.reduce((total, entry) => total + entry.data.length, 0)
  const categories = chart.categories.length === 0
    ? 'no category captions'
    : `categories ${chart.categories.slice(0, 6).join(', ')}${chart.categories.length > 6 ? ', ...' : ''}`
  return `${chart.type} chart: ${chart.series.length} series, ${points} point(s), ${categories}`
}

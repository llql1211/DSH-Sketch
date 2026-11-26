/**
 * Deterministic layout for the `flowchart` card.
 *
 * The model states *structure* -- ids, labels, connections -- and this module,
 * never the model, decides where every box and arrow goes. Geometry is a pure
 * function of the payload, so a replayed session draws the identical diagram
 * and two identical payloads can never drift apart.
 *
 * There is no DOM measurement here on purpose: text width is *estimated* from
 * the label's code points, which keeps the layout synchronous, testable under
 * `vitest` (no browser), and independent of which font the host happens to
 * ship. An estimate that is a little wide only costs padding; it never breaks
 * the picture.
 *
 * The algorithm is the ordinary layered one: longest-path ranking, one rank per
 * layer (a row in TB, a column in LR), payload order inside a rank. A connection
 * that points backwards -- a retry loop, an early exit -- is drawn in a gutter
 * (right in TB, bottom in LR) instead of breaking the ranking, so a process with
 * a loop still lays out. The direction is payload-declared, the geometry is not.
 */

import type { FlowchartEdge, FlowchartNode, FlowchartPayload, FlowchartShape } from '@aisketch/cards-core'

/** Font size of a node label, in px; the stylesheet declares the same size. */
export const LABEL_FONT_SIZE = 12

/** Baseline-to-baseline distance between wrapped label lines, in px. */
export const LINE_HEIGHT = 16

/** Horizontal padding inside a box, in px. */
const PAD_X = 12

/** Vertical padding inside a box, in px. */
const PAD_Y = 9

/** Widest a wrapped label line may get before it wraps, in px. */
const MAX_TEXT_WIDTH = 150

/** Widest a wrapped decision label may get, in px: a diamond pays for its slant. */
const MAX_DECISION_TEXT_WIDTH = 132

/** Narrowest box, so a one-word step still reads as a step, in px. */
const MIN_BOX_WIDTH = 96

/** Widest ordinary box, in px. */
const MAX_BOX_WIDTH = 260

/** Widest decision box, in px. */
const MAX_DECISION_WIDTH = 320

/** Space between two ranks (rows in TB, columns in LR), in px. */
const RANK_GAP = 72

/** Space between two sibling boxes of one rank, in px. */
const SIBLING_GAP = 30

/** Space between the figure's frame and its content, in px. */
const MARGIN = 16

/** Space between the content and the gutter a backwards connection uses, in px. */
const GUTTER_GAP = 20

/** Horizontal step between two gutter connections, so they never overlap. */
const GUTTER_STEP = 14

/** Arrowhead length, in px. */
const HEAD_LENGTH = 9

/** Half of an arrowhead's base, in px. */
const HEAD_HALF = 4.5

/** One placed node: its frame, its wrapped label, and its shape. */
export interface FlowchartBox {
  readonly id: string
  readonly label: string
  readonly shape: FlowchartShape
  /** Left edge, in figure coordinates. */
  readonly x: number
  /** Top edge, in figure coordinates. */
  readonly y: number
  readonly width: number
  readonly height: number
  /** The label, already wrapped to the box. */
  readonly lines: readonly string[]
}

/** One placed connection: its curve, its arrowhead, and where its label sits. */
export interface FlowchartArrow {
  readonly from: string
  readonly to: string
  readonly label?: string
  /**
   * Path data of the curve. It stops at the midpoint of the arrowhead's base,
   * so the shaft meets the head exactly instead of showing a sloped stub that
   * lands off-centre. The head itself is {@link FlowchartArrow.head}.
   */
  readonly d: string
  /** Arrowhead triangle, as SVG polygon points. */
  readonly head: string
  readonly labelX: number
  readonly labelY: number
}

/** A laid-out diagram: the figure's size and everything drawn inside it. */
export interface FlowchartLayout {
  readonly width: number
  readonly height: number
  /** Boxes in column order, and inside one column in payload order. */
  readonly boxes: readonly FlowchartBox[]
  /** Arrows in payload edge order. */
  readonly arrows: readonly FlowchartArrow[]
}

/**
 * Estimated advance width of one character at {@link LABEL_FONT_SIZE}.
 *
 * CJK ideographs, Hangul, kana and fullwidth forms are about one em wide;
 * Latin, digits and ASCII punctuation about half. Ranges follow the usual
 * East-Asian-Width split rather than a font metric table, because the point is
 * a stable estimate, not a measurement.
 * @param char - one code point, as a string.
 * @returns the estimated width in px.
 */
function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0
  const wide = (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
  return wide ? LABEL_FONT_SIZE : LABEL_FONT_SIZE * 0.55
}

/**
 * Estimated width of a whole label.
 * @param text - the label.
 * @returns the estimated width in px.
 */
export function estimateTextWidth(text: string): number {
  let width = 0
  for (const char of text) width += charWidth(char)
  return width
}

/**
 * Wrap one label into lines that fit `limit`.
 *
 * Breaks between characters and, when the line has one, prefers the last space
 * -- so `retry after 30s` keeps its words while a Chinese label, which has no
 * spaces, still wraps at the edge.
 * @param label - the node label.
 * @param limit - widest line, in px.
 * @returns one or more lines, never empty for a non-empty label.
 */
function wrapLabel(label: string, limit: number): readonly string[] {
  const lines: string[] = []
  let line = ''
  let width = 0
  let lastSpace = -1
  for (const char of label) {
    const advance = charWidth(char)
    if (width + advance > limit && line.length > 0) {
      if (lastSpace > 0) {
        lines.push(line.slice(0, lastSpace))
        line = line.slice(lastSpace + 1)
        width = estimateTextWidth(line)
      } else {
        lines.push(line)
        line = ''
        width = 0
      }
      lastSpace = -1
    }
    if (char === ' ') lastSpace = line.length
    line += char
    width += advance
  }
  if (line.length > 0) lines.push(line)
  return lines
}

/** Bound a value to an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Size one box around its wrapped label.
 *
 * A diamond cannot hold text the way a rectangle can: the room it offers at
 * vertical offset `y` shrinks towards its points. So a decision box grows by
 * the slant its own text height needs, which is why the same label yields a
 * wider, taller decision than process box.
 * @param lines - the wrapped label.
 * @param shape - the node's shape.
 * @returns the box's outer width and height, in px.
 */
function boxSize(lines: readonly string[], shape: FlowchartShape): { width: number; height: number } {
  let longest = 0
  for (const line of lines) longest = Math.max(longest, estimateTextWidth(line))
  const textHeight = Math.max(lines.length, 1) * LINE_HEIGHT
  const textWidth = longest + PAD_X * 2 + PAD_Y

  if (shape === 'decision') {
    const slant = Math.max(16, textHeight * 0.6)
    return {
      width: clamp(textWidth * (1 + textHeight / (2 * slant)), MIN_BOX_WIDTH, MAX_DECISION_WIDTH),
      height: textHeight + slant * 2,
    }
  }
  return {
    width: clamp(textWidth, MIN_BOX_WIDTH, MAX_BOX_WIDTH),
    height: textHeight + PAD_Y * 2,
  }
}

/**
 * Rank every node by longest path from a start.
 *
 * Kahn's algorithm, with one deliberate exception: a cycle leaves the queue
 * empty while nodes remain, so the earliest unplaced node is released and the
 * ranking continues. A loop therefore costs one ignored incoming edge instead
 * of an empty diagram.
 * @param nodes - the declared nodes, in payload order.
 * @param edges - the declared connections.
 * @returns each node id's column index.
 */
function rankNodes(nodes: readonly FlowchartNode[], edges: readonly FlowchartEdge[]): Map<string, number> {
  const rank = new Map<string, number>()
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, readonly string[]>()
  for (const node of nodes) {
    rank.set(node.id, 0)
    incoming.set(node.id, 0)
    outgoing.set(node.id, [])
  }
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    const targets = outgoing.get(edge.from)
    if (targets !== undefined) outgoing.set(edge.from, [...targets, edge.to])
  }

  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id)
  const placed = new Set<string>()
  while (placed.size < nodes.length) {
    if (queue.length === 0) {
      const next = nodes.find((node) => !placed.has(node.id))
      if (next === undefined) break
      queue.push(next.id)
    }
    const id = queue.shift()
    if (id === undefined || placed.has(id)) continue
    placed.add(id)
    for (const target of outgoing.get(id) ?? []) {
      // A placed target means this edge closes a loop. Relaxing it would push
      // the target's column past the source's and turn the loop into a forward
      // arrow, so the ranking ignores it -- the connection is still drawn, just
      // through the gutter.
      if (placed.has(target)) continue
      const candidate = (rank.get(id) ?? 0) + 1
      if (candidate > (rank.get(target) ?? 0)) rank.set(target, candidate)
      incoming.set(target, (incoming.get(target) ?? 0) - 1)
      if ((incoming.get(target) ?? 0) <= 0) queue.push(target)
    }
  }
  return rank
}

/**
 * Lay out one diagram.
 *
 * Nodes keep their payload order inside a column and columns follow the
 * ranking, so the same payload always produces the same picture -- the
 * property the card's replay equivalence rests on.
 * @param payload - the parsed flowchart payload.
 * @returns the figure's size, its boxes, and its arrows.
 */
export function layoutFlowchart(payload: FlowchartPayload): FlowchartLayout {
  const rank = rankNodes(payload.nodes, payload.edges)
  const direction = payload.direction ?? 'TB'

  /** Boxes before placement, in payload order. */
  const drafted = payload.nodes.map((node) => {
    const lines = wrapLabel(node.label, node.shape === 'decision' ? MAX_DECISION_TEXT_WIDTH : MAX_TEXT_WIDTH)
    const size = boxSize(lines, node.shape)
    return { node, lines, width: size.width, height: size.height }
  })

  const columns = new Map<number, typeof drafted>()
  for (const box of drafted) {
    const index = rank.get(box.node.id) ?? 0
    const column = columns.get(index)
    if (column === undefined) columns.set(index, [box])
    else column.push(box)
  }
  const ranks = [...columns.keys()].sort((left, right) => left - right)

  let contentRight = 0
  let contentBottom = 0
  const boxes: FlowchartBox[] = []
  const placed = new Map<string, FlowchartBox>()

  if (direction === 'TB') {
    // One row per rank, siblings spread horizontally and centred on the widest row.
    const rowTop = new Map<number, number>()
    const rowHeight = new Map<number, number>()
    const rowWidth = new Map<number, number>()
    let cursorY = MARGIN
    let widest = 0
    for (const index of ranks) {
      const row = columns.get(index) ?? []
      let height = 0
      let width = 0
      for (const box of row) {
        height = Math.max(height, box.height)
        width += box.width + SIBLING_GAP
      }
      width = Math.max(0, width - SIBLING_GAP)
      rowHeight.set(index, height)
      rowWidth.set(index, width)
      rowTop.set(index, cursorY)
      cursorY += height + RANK_GAP
      widest = Math.max(widest, width)
    }
    contentBottom = cursorY - RANK_GAP
    contentRight = MARGIN + widest

    for (const index of ranks) {
      const row = columns.get(index) ?? []
      const width = rowWidth.get(index) ?? 0
      const top = rowTop.get(index) ?? MARGIN
      const height = rowHeight.get(index) ?? 0
      let x = MARGIN + (widest - width) / 2
      for (const box of row) {
        const drawn: FlowchartBox = {
          id: box.node.id,
          label: box.node.label,
          shape: box.node.shape,
          x,
          y: top + (height - box.height) / 2,
          width: box.width,
          height: box.height,
          lines: box.lines,
        }
        boxes.push(drawn)
        placed.set(drawn.id, drawn)
        x += box.width + SIBLING_GAP
      }
    }
  } else {
    // One column per rank, siblings stacked vertically; the gutter runs below.
    const columnLeft = new Map<number, number>()
    const columnWidth = new Map<number, number>()
    let cursorX = MARGIN
    for (const index of ranks) {
      let widest = 0
      for (const box of columns.get(index) ?? []) widest = Math.max(widest, box.width)
      columnLeft.set(index, cursorX)
      columnWidth.set(index, widest)
      cursorX += widest + RANK_GAP
    }
    contentRight = cursorX - RANK_GAP

    const columnHeight = new Map<number, number>()
    let tallest = 0
    for (const index of ranks) {
      const column = columns.get(index) ?? []
      let height = 0
      for (const box of column) height += box.height + SIBLING_GAP
      height = Math.max(0, height - SIBLING_GAP)
      columnHeight.set(index, height)
      tallest = Math.max(tallest, height)
    }
    contentBottom = MARGIN + tallest

    for (const index of ranks) {
      const column = columns.get(index) ?? []
      const left = columnLeft.get(index) ?? MARGIN
      const width = columnWidth.get(index) ?? 0
      let y = MARGIN + (tallest - (columnHeight.get(index) ?? 0)) / 2
      for (const box of column) {
        const drawn: FlowchartBox = {
          id: box.node.id,
          label: box.node.label,
          shape: box.node.shape,
          x: left + (width - box.width) / 2,
          y,
          width: box.width,
          height: box.height,
          lines: box.lines,
        }
        boxes.push(drawn)
        placed.set(drawn.id, drawn)
        y += box.height + SIBLING_GAP
      }
    }
  }

  let gutter = 0
  const arrows: FlowchartArrow[] = []

  // Two connections sharing an endpoint would land on the same point and read
  // as one line -- a merge would look like a single arrow. Counting endpoints
  // first lets each arrival and departure take its own slot along that edge.
  const outgoingTotal = new Map<string, number>()
  const incomingTotal = new Map<string, number>()
  for (const edge of payload.edges) {
    outgoingTotal.set(edge.from, (outgoingTotal.get(edge.from) ?? 0) + 1)
    incomingTotal.set(edge.to, (incomingTotal.get(edge.to) ?? 0) + 1)
  }
  const outgoingSeen = new Map<string, number>()
  const incomingSeen = new Map<string, number>()

  /**
   * Offset one endpoint of a shared edge.
   * @param index - this connection's place among its siblings.
   * @param total - how many connections share the endpoint.
   * @param width - the box edge the offsets spread along.
   * @returns the horizontal offset in px, zero when nothing is shared.
   */
  function fan(index: number, total: number, width: number): number {
    if (total <= 1) return 0
    const spread = Math.min(24, width / (total + 1))
    return (index - (total - 1) / 2) * spread
  }

  for (const edge of payload.edges) {
    const source = placed.get(edge.from)
    const target = placed.get(edge.to)
    if (source === undefined || target === undefined) continue
    const outIndex = outgoingSeen.get(edge.from) ?? 0
    outgoingSeen.set(edge.from, outIndex + 1)
    const inIndex = incomingSeen.get(edge.to) ?? 0
    incomingSeen.set(edge.to, inIndex + 1)
    const forward = (rank.get(edge.to) ?? 0) > (rank.get(edge.from) ?? 0)
    const label = edge.label === undefined ? {} : { label: edge.label }

    if (direction === 'TB') {
      if (forward) {
        const sx = source.x + source.width / 2 + fan(outIndex, outgoingTotal.get(edge.from) ?? 1, source.width)
        const sy = source.y + source.height
        const tx = target.x + target.width / 2 + fan(inIndex, incomingTotal.get(edge.to) ?? 1, target.width)
        const ty = target.y
        const middle = (sy + ty) / 2
        // Stop the shaft on the head's base, not on its tip: the last pixels
        // would otherwise hide under the triangle and cross its base off-centre.
        const by = ty - HEAD_LENGTH
        arrows.push({
          from: edge.from,
          to: edge.to,
          ...label,
          d: `M ${sx} ${sy} C ${sx} ${middle} ${tx} ${middle} ${tx} ${by}`,
          head: `${tx},${ty} ${tx - HEAD_HALF},${by} ${tx + HEAD_HALF},${by}`,
          labelX: (sx + tx) / 2,
          labelY: middle - 2,
        })
        continue
      }

      // Backwards: leave the right edge, run through the right-hand gutter,
      // and re-enter from the target's right, leaving the rows untouched.
      const lane = contentRight + GUTTER_GAP + gutter * GUTTER_STEP
      gutter += 1
      const sx = source.x + source.width
      const sy = source.y + source.height / 2
      const tx = target.x + target.width
      const ty = target.y + target.height / 2
      // The head points left into the target's right edge; its base faces the
      // gutter the shaft comes from.
      const bx = tx + HEAD_LENGTH
      arrows.push({
        from: edge.from,
        to: edge.to,
        ...label,
        d: `M ${sx} ${sy} C ${lane} ${sy} ${lane} ${ty} ${bx} ${ty}`,
        head: `${tx},${ty} ${bx},${ty - HEAD_HALF} ${bx},${ty + HEAD_HALF}`,
        labelX: (sx + 6 * lane + tx) / 8,
        labelY: (sy + ty) / 2 - 2,
      })
      continue
    }

    if (forward) {
      // LR: leave the source's right edge, enter the target's left edge.
      const sx = source.x + source.width
      const sy = source.y + source.height / 2 + fan(outIndex, outgoingTotal.get(edge.from) ?? 1, source.height)
      const tx = target.x
      const ty = target.y + target.height / 2 + fan(inIndex, incomingTotal.get(edge.to) ?? 1, target.height)
      const middle = (sx + tx) / 2
      // The head points right into the target's left edge; its base faces the
      // shaft, which stops there rather than running under the triangle.
      const bx = tx - HEAD_LENGTH
      arrows.push({
        from: edge.from,
        to: edge.to,
        ...label,
        d: `M ${sx} ${sy} C ${middle} ${sy} ${middle} ${ty} ${bx} ${ty}`,
        head: `${tx},${ty} ${bx},${ty - HEAD_HALF} ${bx},${ty + HEAD_HALF}`,
        labelX: middle,
        labelY: (sy + ty) / 2 - 2,
      })
      continue
    }

    // Backwards: leave the bottom edge, run through the bottom gutter, and
    // re-enter from the target's bottom, leaving the columns untouched.
    const lane = contentBottom + GUTTER_GAP + gutter * GUTTER_STEP
    gutter += 1
    const sx = source.x + source.width / 2
    const sy = source.y + source.height
    const tx = target.x + target.width / 2
    const ty = target.y + target.height
    // The shaft climbs out of the bottom gutter, so the head must point up
    // into the target's bottom edge: its base sits *below* the tip.
    const by = ty + HEAD_LENGTH
    arrows.push({
      from: edge.from,
      to: edge.to,
      ...label,
      d: `M ${sx} ${sy} C ${sx} ${lane} ${tx} ${lane} ${tx} ${by}`,
      head: `${tx},${ty} ${tx - HEAD_HALF},${by} ${tx + HEAD_HALF},${by}`,
      labelX: (sx + tx) / 2,
      labelY: (sy + 6 * lane + ty) / 8,
    })
  }

  return {
    width: contentRight + MARGIN + (direction === 'TB' && gutter > 0 ? GUTTER_GAP + gutter * GUTTER_STEP : 0),
    height: contentBottom + MARGIN + (direction === 'LR' && gutter > 0 ? GUTTER_GAP + gutter * GUTTER_STEP : 0),
    boxes,
    arrows,
  }
}

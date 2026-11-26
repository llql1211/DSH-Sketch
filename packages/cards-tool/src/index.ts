/**
 * Model-facing `show_card` tool: the Host half of the generic card channel.
 *
 * A card costs the model a few dozen tokens of *data* -- `kind`, an optional
 * `title`, and a `payload` object -- instead of the hundreds a generated markup
 * page costs, and the conversation draws it as a native row (host theme, dark
 * mode, locale, real interaction) instead of sandboxed markup.
 *
 * The tool stores no geometry and hides no state: it returns the admitted spec,
 * and the browser projection reads the very same arguments back out of the
 * persisted `tool/call` event. That is what makes a replayed session render the
 * identical card with no Host call.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  CARD_TOOL_NAME, CHART_KIND, DRAW_KIND, FIGURE_KIND, FLOWCHART_KIND, MAX_CHART_CATEGORIES, MAX_CHART_LABEL_LENGTH,
  MAX_CHART_POINTS, MAX_CHART_SERIES, MAX_CHART_VALUE, MAX_DRAW_ELEMENTS, MAX_FLOWCHART_EDGES,
  MAX_FLOWCHART_LABEL_LENGTH, MAX_FLOWCHART_NODES, MAX_KIND_LENGTH, MAX_PAYLOAD_LENGTH,
  MAX_TITLE_LENGTH, analyzeDraw, buildDrawDisplayList, formatDrawDiagnostics, parseDrawPayload,
  summarizeCard, validateCardArgs,
} from '@aisketch/cards-core'
import type { CardSpec } from '@aisketch/cards-core'
import { buildDrawPreview, routeOf } from './preview.ts'
import type { PreviewAttachment } from './preview.ts'

export const name = 'cards-tool'
export const inject = ['tools', 'systemPrompt']

/**
 * The diagram payload, spelled out for the same reason: the model supplies
 * structure only, and the renderer -- not the model -- places every box.
 */
const FLOWCHART_PAYLOAD_HINT =
  `A "${FLOWCHART_KIND}" card takes { nodes: { id, label, shape? }[], edges: { from, to, label? }[], direction? } `
  + `with 1..${MAX_FLOWCHART_NODES} nodes and at most ${MAX_FLOWCHART_EDGES} connections. `
  + 'Ids must be unique and every connection must name declared nodes; shape is "terminal", "process" '
  + `or "decision" (default "process"); labels fit in ${MAX_FLOWCHART_LABEL_LENGTH} characters. `
  + 'direction is "TB" (top-to-bottom, the default) or "LR" (left-to-right); arrows enter and leave '
  + 'the top/bottom edges in TB and the left/right edges in LR. '
  + 'Never send coordinates or SVG: the client lays the diagram out.'

/**
 * Art direction for a draw card.
 *
 * The medium is hand-drawn ink and wash; the genre is chosen by the request.
 * The previous default called every drawing a field-notebook page, which
 * anchored even scenic requests to labels, tape, empty margins and icon-shaped
 * mountains. The workflow also used to invite a visible retry after every
 * self-check; now inspection is a private draft and the user sees one final.
 */
const DRAW_STYLE_GUIDANCE =
  'Art direction for a draw card:\n'
  + '- If the user asks for a picture, scene, illustration, 插画, 风景 or 绘本, make a finished storybook '
  + 'illustration. Set size 1200x800; layer background (sky/mountains), middle ground (water/trees/buildings) '
  + 'and foreground (shore/reeds/rocks) with overlapping masses; draw organic forms with freehand closed paths, '
  + 'not triangle/rect icons; use 3-6 translucent washes (path fill + fillOpacity .25-.6), 6-10 colors within a '
  + 'few families, hatching/scribble texture, varied line weights and one light direction; fade receded ink with '
  + 'strokeOpacity (.35-.7) instead of a paler color, so depth reads as ink rather than as a different palette; '
  + 'for a soft transition use ONE gradient across the whole area (sky, sea, a large mass) instead of stacking '
  + 'bands: never approximate a gradient with rows of translucent strips, and never butt two saturated bands '
  + 'together. A glow is a radial gradient whose last stop has opacity 0, so it dissolves into whatever is behind '
  + 'it; a haze over the horizon is a linear gradient whose far stop is translucent. Keep big washes rough:false '
  + 'so their edges stay clean, and set strokeOpacity 0 on a wash whose outline you do not want (a fill without '
  + 'it still draws its outline). Light is a blend mode, not another color: a screen wash warms everything under '
  + 'it, a multiply wash shades it, so a glow or a sunlit rim is one translucent shape with the right blend rather '
  + 'than another stack of shapes. Both need something darker than white underneath, so set background first. A light shaft, a glow, fog or a shallow depth of field also needs blur (12-40 canvas units): the same beam reads as painted paper with a hard edge and as light with a soft one. '
  + 'When the picture has a light source, draw BOTH halves of it: the shaft (a long shape starting outside the frame, fading along its length, screen + blur 20-40) and the lit patch where it lands (an ellipse or wedge over the surface it hits, screen + blur). A beam that floats in the sky, stops in mid-air, or never lands is the most common way a lit scene reads wrong; a shadow with no light casting it fails the same way. '
  + 'keep the ink inside '
  + 'the canvas; add a few narrative details (lit window, dock, boat, reflection) when appropriate. A finished '
  + 'scene normally needs dozens of overlapping path elements, not five icons; fill empty space with drawing '
  + '(layers, texture, foreground), not labels or tape.\n'
  + '- Never add an in-canvas title, labels, tape, highlighter headings or wide empty margins unless the user '
  + 'asked for a field note, diagram or poster. The card title is metadata, not ink.\n'
  + '- A field-note or annotated-diagram request may use paper, tape, a title and 1-3 short labels. A quick '
  + 'doodle may stay at 640x400.\n'
  + 'Delivery: call show_card with draft:true for a private preview and self-check. If the preview exposes a '
  + 'fault, call it again with the corrected spec. Then publish the drawing exactly once in an ```aisketch '
  + 'fence whose body is {"ref":"<the ref from the last show_card result>"} -- the client reuses that call '
  + 'spec, so do not repeat the JSON. A draft alone is never delivered live; only the fenced card is public. '
  + 'Never paste the self-check or an element list into the reply.\n'
  + '- In the preview image every character appears as a gray width box: the Host rasterizer is font-free, and '
  + 'this happens to English and Chinese alike. The boxes are footprints for checking placement only; the '
  + 'published card renders real glyphs with the system font. Do not translate, transliterate, or trace the '
  + 'text as paths because of the boxes.'

/**
 * The compact semantic schemas for the two teaching-figure templates.
 *
 * Deliberately no coordinates: the model supplies a template and physical
 * parameters, and the renderer owns geometry, arrows and tokens.
 */
const FIGURE_PAYLOAD_HINT =
  `A "${FIGURE_KIND}" card takes { template: "incline_force" | "atom_shell", params: {...} }. `
  + 'incline_force params: { angleDeg: 5..85, massKg: 0.1..100, frictionCoeff: 0..2, gravity?: 1..30 '
  + '(default 9.8), showComponents?: boolean, showValues?: boolean }; it draws a block tending to slide down, '
  + 'with friction up-slope, and computes G/N/f plus optional G components. '
  + 'connected_bodies params: { surfaceMassKg: 0.1..100, hangingMassKg: 0.1..100, frictionCoeff: 0..1.5, '
  + 'gravity?: 1..30 (default 9.8), showValues?: boolean }; it draws a table block tied over a fixed pulley to a '
  + 'hanging block, with T/N/G/f anchors by construction; T is qualitative, weights/normal/max friction are shown. '
  + 'orbital_diagram params: { symbol: "H".."Zn" }; draws the electron configuration and orbital boxes for a '
  + 'neutral atom; Z, subshell electrons and arrow placement are derived from the reference table. '
  + 'atom_shell params: { symbol: "H".."Ca", showShellCounts?: boolean }; atomic number Z and shell counts come '
  + 'from the element table, so the model must not supply electron counts. '
  + 'Use figure for teaching/scientific diagrams (受力分析、斜面、原子结构、电子层示意图), never for freehand '
  + 'art; use draw only for artistic illustrations. A figure is a one-shot deterministic card: no draft loop, '
  + 'no coordinates, no SVG, no style tokens in the payload. '
  + 'Examples: { template: "incline_force", params: { angleDeg: 30, massKg: 2, frictionCoeff: 0.5, showComponents: true } }, '
  + '{ template: "connected_bodies", params: { surfaceMassKg: 2, hangingMassKg: 1.5, frictionCoeff: 0.3 } } '
  + '{ template: "orbital_diagram", params: { symbol: "Zn" } } or { template: "atom_shell", params: { symbol: "Na" } }.'

/**
 * The data-chart payload, spelled out so a first call carries real numbers.
 *
 * Unlike `figure`, this kind is not about derived geometry: the model owns the
 * data, and the renderer owns every axis, bar, slice and legend. The ceiling
 * list is here so a refused call tells the model exactly what to shorten.
 */
const CHART_PAYLOAD_HINT =
  `A "${CHART_KIND}" card takes { type?: "line"|"bar"|"scatter"|"pie", series: [{ label, data: [...] }], `
  + `categories?: [...] }. type defaults to "line"; 1..${MAX_CHART_SERIES} series, each with a non-empty label `
  + `of at most ${MAX_CHART_LABEL_LENGTH} characters and 1..${MAX_CHART_POINTS} `
  + `finite numbers of magnitude at most ${MAX_CHART_VALUE}; categories holds 0..${MAX_CHART_CATEGORIES} strings `
  + `of at most ${MAX_CHART_LABEL_LENGTH} characters. A pie uses only the first series and ignores the rest. `
  + 'Send real data from the request, never hardcoded demo numbers. '
  + 'Example: { "type": "line", "series": [{"label":"上学期","data":[72,85,63]},'
  + '{"label":"下学期","data":[80,90,77]}], "categories":["语文","数学","英语"] }.'

/**
 * The draw payload's syntax, spelled out so a first call is valid. The sample
 * deliberately uses another subject and no labels, tape or title: the previous
 * sample was the same mountain-lake cabin as the screenshot, and models copied
 * its icon composition almost verbatim.
 */
const DRAW_PAYLOAD_HINT =
  `A "${DRAW_KIND}" card takes { size?: { w, h }, background?, paper?: "plain"|"dots"|"grid"|"lined", `
  + `rough?: boolean, elements: [...] } with 1..${MAX_DRAW_ELEMENTS} elements; size defaults to 640x400 (use `
  + '1200x800 for a full scene), rough defaults to true. background is the canvas color under the paper and '
  + 'the ink (a name or #rrggbb; omit for the card surface) -- set it instead of spending an element on a '
  + 'full-canvas rect, and pick colors that stay legible on it. Element shapes: '
  + '{ type: "path", d, pen?, color?, width?, fill?, fillOpacity?, strokeOpacity?, dash?, blur? } where d is the SVG path grammar '
  + '(M/L/H/V/C/S/Q/T/A/Z, absolute or relative, no exponent numbers), pen is "ball", "fountain", "marker", '
  + '"pencil", "calligraphy", "brush" or "highlighter", fill paints the closed subpaths, and fillOpacity is 0..1 '
  + '(default 1; use .25-.6 for a wash); strokeOpacity 0..1 fades that pen\'s ink without changing its shape '
  + '(receded background, a ghost line under the final one); dash "solid"|"dashed"|"dotted" works on the stroke '
  + 'pens (ball, marker, pencil, highlighter) only, so use one of those for a hidden edge or a leader line; '
  + 'blend "normal"|"multiply"|"screen"|"overlay"|"soft-light" decides how this element\'s ink combines '
  + 'with what is already painted (default normal); '
  + 'fill accepts a flat color, or a gradient object -- linear {"type":"linear","from":"#f5a15a","to":"#232a4d",'
  + '"angle":180} (angle is the CSS linear-gradient angle: 0 up, 90 right, 180 down, the default) or a multi-stop '
  + 'ramp {"type":"linear","stops":[{"offset":0,"color":"#232a4d"},{"offset":.55,"color":"#c2568a"},{"offset":1,'
  + '"color":"#ffb26b"}],"angle":180}, or a glow {"type":"radial","stops":[{"offset":0,"color":"#ffd27a"},'
  + '{"offset":1,"color":"#ffd27a","opacity":0}],"center":{"x":980,"y":420},"radius":260}; a radial ramp defaults '
  + 'to the box centre and half its diagonal. Gradients are resolved from the element\'s own box, so no coordinates '
  + 'are needed for a linear one; '
  + '{ type: "shape", shape: "rect"|"ellipse"|"line"|"arrow"|"triangle"|"diamond", x, y, w, h, color?, fill?, '
  + 'fillOpacity?, width?, dash?: "solid"|"dashed"|"dotted", strokeOpacity?, blend?, blur?, arrowStart? } -- fill takes the same '
  + 'color or gradient; use shapes for genuinely geometric objects, never as a substitute for an organic contour; '
  + '{ type: "text", x, y, text, size?, color?, anchor? ("start"|"middle"|"end"), bold?, hand? } (only when the '
  + 'user asked for words or a field-note/diagram); { type: "tape", x, y, w, h?, color?, angle? } (note paper '
  + 'only); { type: "pixels", x, y, cell?, rows: string[], palette: { "<character>": color }, blend? } for pixel art. '
  + 'Colors are names (black, gray, red, orange, yellow, green, teal, cyan, blue, purple, pink, brown, white) or '
  + '#rgb/#rrggbb; omit color for theme ink. Paper defaults to plain; do not add tape, a title or labels to an '
  + 'illustration unless requested. List highlighter strokes before text if you use them. '
  + 'Example (syntax only; never copy its subject): { paper: "plain", rough: true, size: { w: 1200, h: 800 }, '
  + 'elements: ['
  + '{ type: "path", pen: "fountain", color: "#6b4a2f", width: 2.4, '
  + 'fill: { type: "linear", from: "#d9b45b", to: "#8a5a22", angle: 180 }, '
  + 'd: "M 560 560 C 520 500 540 440 600 430 C 660 440 680 520 640 570 C 610 605 580 590 560 560 Z" }, '
  + '{ type: "path", pen: "pencil", color: "#7d5c3d", width: 1.2, '
  + 'd: "M 570 520 C 600 500 630 510 650 540" }, '
  + '{ type: "path", pen: "brush", color: "#5c7a4b", width: 7, '
  + 'd: "M 610 430 C 615 405 640 390 665 392" } ] }'

/**
 * The pending row: name the kind the model is about to draw, so a long call
 * shows what it is doing before the card exists.
 * @param args - the model's raw arguments.
 * @returns the generic row view.
 */
function presentCardCall(args: unknown): ToolCallView {
  const kind = typeof args === 'object' && args !== null && typeof (args as { kind?: unknown }).kind === 'string'
    ? (args as { kind: string }).kind
    : 'card'
  return { card: 'generic', title: kind, kind: 'read' }
}

/**
 * The settled row for non-browser surfaces.
 *
 * The browser draws the card from the persisted spec; this Host-side view keeps
 * a CLI or a text transcript meaningful by echoing the model-facing text,
 * including the drawing self-check that rides beside a preview image.
 * @param _args - unused arguments.
 * @param result - the settled result content.
 * @returns the generic text card, or undefined when the result carries no text.
 */
function presentCardResult(
  _args: unknown,
  result: { content: readonly { type: string; text?: string }[] },
): ToolResultView | undefined {
  const texts = result.content
    .filter(block => block.type === 'text' && block.text !== undefined)
    .map(block => block.text as string)
  if (texts.length === 0) return undefined
  return { card: 'generic', content: [{ type: 'text', text: texts.join('\n') }] }
}

/** The spec as plain JSON, matching the output schema's open record. */
function asJsonCard(card: CardSpec): Record<string, JsonValue> {
  return card as unknown as Record<string, JsonValue>
}

/**
 * Register the tool and its system-prompt rule.
 * @param ctx - Host context carrying the Tool registry and the system prompt.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: `tool:${CARD_TOOL_NAME}`,
    order: ctx.systemPrompt.getSectionOrder('TOOL_WEB_SEARCH'),
    text: 'Tables belong in the answer as ordinary Markdown, not in a card. Graphics belong in a fence '
      + 'inside the answer, so the picture sits between the paragraphs that explain it. Write a fenced '
      + 'block with the language tag aisketch on the opening line (```aisketch) containing a JSON card '
      + 'spec { "kind": ..., "title"?: ..., "payload": ... } for '
      + 'a flowchart, a hand-drawn illustration, a teaching figure, or a real-data chart. Supported kinds: '
      + '"flowchart", "draw", "figure", "chart". never write HTML, SVG, or a plotting script yourself: '
      + 'the client renders the card natively from the JSON. Write tables as Markdown in the answer, '
      + 'function graphs in a fenced ```aisketch-plot block containing {"expr":"x^2", ...}, and '
      + 'real-data charts as a "chart" card. Place each fence right after the sentence it illustrates and follow it with '
      + 'the next paragraph, so text and picture alternate instead of stacking all pictures at the end. '
      + 'When the user asks for a picture (画一张 / 画个图 / 手绘 / 素描 / doodle / pixel art) use kind "draw" '
      + 'and list its elements -- pen paths, shapes, text, tape, pixels. For a teaching or scientific '
      + 'diagram (受力分析、斜面、原子结构、电子层、示意图), use kind "figure" with a template and semantic '
      + 'params; the renderer owns the geometry, so never send coordinates or SVG. Do not emulate a '
      + 'picture with a table, emoji, ASCII art, or colored squares: a freehand picture is a "draw" card, '
      + 'while a teaching/scientific diagram is a "figure" card. '
      + `${CHART_PAYLOAD_HINT} `
      + `Keep every payload under ${MAX_PAYLOAD_LENGTH} characters. `
      + 'A "draw" card comes back with a picture of what you sent plus a machine self-check. '
      + `${DRAW_STYLE_GUIDANCE} `
      + 'For a non-trivial drawing, call show_card with draft:true to get a private preview and self-check. '
      + 'If the drawing needs a correction, call show_card again with the corrected spec. Then put the '
      + 'finished drawing once in an ```aisketch fence whose body is {"ref":"<the ref in the last show_card '
      + 'result>"}; the client resolves that spec from the persisted tool call, so do not repeat the JSON. '
      + 'A draft is private and does not appear in the conversation. Never publish intermediate versions '
      + 'and do not paste the self-check or an element list into the reply; a short lead-in, the fenced '
      + 'card, and the next paragraph are enough. If the request is a trivial mark you are sure about, '
      + 'write the full spec inline in the fence instead.',
  })

  ctx.tools.register(defineTool({
    name: CARD_TOOL_NAME,
    description:
      'Validate a graphics card spec and, for drawings, get a private rasterized preview for your own '
      + 'inspection. Pass `kind` ("flowchart", "figure", "chart" or "draw"), an optional `title`, and a `payload` '
      + 'object. Write tables as Markdown in the reply, function graphs in an aisketch-plot fence, and '
      + 'real-data charts with kind "chart". For a freehand doodle, '
      + 'illustration or pixel art use kind "draw"; for a teaching or scientific diagram (forces, atomic '
      + 'shells) use kind "figure" with a template and semantic params; never emulate a picture with a '
      + 'table, emoji, ASCII art, or colored squares. '
      + `${FLOWCHART_PAYLOAD_HINT} ${FIGURE_PAYLOAD_HINT} ${CHART_PAYLOAD_HINT} ${DRAW_PAYLOAD_HINT} Unknown kinds are accepted `
      + 'for validation but have no client renderer. A drawing can be returned as a private draft '
      + '(draft:true): you get a rendered preview plus a machine self-check, but no card is shown. '
      + 'The result carries a ref handle. The public picture goes in the FINAL answer as a fenced ```aisketch '
      + 'block whose body is {"ref":"<ref>"}, which reuses this call spec without repeating the JSON; writing '
      + 'the full spec inline in that fence is also accepted. Place it between the paragraphs it explains. '
      + 'In the preview every character is drawn as a gray width box (font-free raster) for English and Chinese '
      + 'alike; the published card renders real glyphs, so do not rewrite or trace the text because of the '
      + 'boxes. Do not publish intermediate revisions.',
    parameters: {
      kind: {
        type: 'string',
        required: true,
        description: `Renderer key: "${FLOWCHART_KIND}", "${FIGURE_KIND}", "${CHART_KIND}" or "${DRAW_KIND}". Tables are not supported; write them as Markdown in the reply, function graphs in an aisketch-plot fence, and real-data charts with kind "${CHART_KIND}". Letters, digits, ".", "_" or "-", at most ${MAX_KIND_LENGTH} characters.`,
      },
      title: {
        type: 'string',
        description: `Optional heading for the card, at most ${MAX_TITLE_LENGTH} characters.`,
      },
      payload: {
        type: 'object',
        additionalProperties: true,
        required: true,
        description: `Kind-owned JSON object. ${FLOWCHART_PAYLOAD_HINT} ${FIGURE_PAYLOAD_HINT} ${CHART_PAYLOAD_HINT} ${DRAW_PAYLOAD_HINT}`,
      },
      preview: {
        type: 'boolean',
        description: 'Draw cards only: return a rendered preview of the drawing for your own inspection (default true). The preview is private; use draft:true when it is an uncommitted draft. A preview you never look at is worse than none.',
      },
      draft: {
        type: 'boolean',
        description: 'Draw cards only: submit this as a private draft. The preview and self-check come back to you, but no card is shown to the user. Inspect it, then publish the drawing once with the ref from the result in an aisketch fence; do not repeat the JSON. Do not publish intermediate revisions.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: {
            type: 'string',
            required: true,
            description: 'Short handle for this call. Put {"ref":"<ref>"} in an aisketch fence to render the same spec without repeating its JSON.',
          },
          card: {
            type: 'object',
            additionalProperties: true,
            required: true,
            description: 'The admitted, versioned CardSpec; the conversation renders this and a replay re-renders it.',
          },
          summary: { type: 'string', required: true },
          selfCheck: {
            type: 'string',
            description: 'Present for "draw" cards: the machine self-check of the drawing (extent, coverage, balance, palette) and any structural faults. It reports geometry, not a prescribed art style.',
          },
          preview: {
            type: 'object',
            additionalProperties: false,
            description: 'Present when the drawing was rasterized and attached as a preview image. The image block beside this text is the picture itself.',
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => {
        const body = value.selfCheck === undefined ? value.summary : `${value.summary}\n${value.selfCheck}`
        // The ref rides in the model-visible text so the model can paste a tiny
        // {"ref":...} fence instead of regenerating the whole spec a second time.
        const text = `${body}\n- ref: ${value.ref} -> fence: {"ref":"${value.ref}"}`
        const blocks: ContentBlock[] = [{ type: 'text', text }]
        // The attachment is committed before the value is returned, so this block
        // references durable bytes and a replay renders the same picture.
        if (value.preview !== undefined) blocks.push({ type: 'image', attachment: value.preview } as unknown as ContentBlock)
        return blocks
      },
      presentationMeta: (_args, value) => ({ card: value.card }),
    },
    async execute(rawArgs, exec) {
      if (exec.signal.aborted) throw new Error('tool call aborted')
      const admitted = validateCardArgs(rawArgs)
      if (!admitted.ok) throw new Error(`invalid card: ${admitted.error}`)

      let selfCheck: string | undefined
      let preview: PreviewAttachment | undefined
      if (admitted.card.kind === DRAW_KIND) {
        const draw = parseDrawPayload(admitted.card.payload)
        if (draw !== null) {
          selfCheck = formatDrawDiagnostics(analyzeDraw(buildDrawDisplayList(draw)))
          if (rawArgs.draft === true) {
            selfCheck += '\n- private draft: not shown to the user; publish this spec once with the ref below in an aisketch fence.'
          }
          if (rawArgs.preview !== false && !exec.signal.aborted) {
            const outcome = await buildDrawPreview(ctx, draw, routeOf(exec), exec.signal)
            if (outcome.ok) {
              preview = outcome.preview.attachment
              selfCheck = `${selfCheck}\n- preview text is drawn as gray per-character boxes (font-free raster); the published card renders real glyphs, so do not rewrite or trace CJK text because of the boxes.`
            } else selfCheck = `${selfCheck}\n- preview skipped: ${outcome.skipped}`
          }
        }
      }

      return {
        ref: String(exec.callId),
        card: asJsonCard(admitted.card),
        summary: summarizeCard(admitted.card),
        ...selfCheck === undefined ? {} : { selfCheck },
        ...preview === undefined ? {} : { preview },
      }
    },
    presentCall: presentCardCall,
    presentResult: presentCardResult,
  }))
}
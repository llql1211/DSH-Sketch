import type { CSSProperties } from 'react'

/**
 * Card styling, carried as a plain stylesheet instead of a CSS module.
 *
 * The browser half ships as one prebuilt bundle that the client module system
 * reads off disk and serves verbatim (`packages/client/modules` reads `./client`
 * with `readFileSync`); there is no CSS-modules pipeline on that path, so an
 * `import styles from '*.module.css'` would never resolve at runtime. Injecting
 * a real stylesheet keeps the cascade, the `:hover` rule and the
 * `--dsw-alias-*` design tokens, all of which plain inline styles would lose.
 *
 * Class names are `cd-` prefixed because they are global once injected.
 */

/** The injected `<style>` id, so the sheet is appended exactly once. */
const STYLE_ID = 'cards-node-styles'

/**
 * Display caps for self-contained illustrations (draw / figure), in CSS px.
 *
 * The host's chat column is 680..920px wide and the card chrome used to give
 * every picture a full-width, 460px-tall scroll box. A wide-but-not-wide-enough
 * picture therefore needed an inner scroll, and a full-width picture swallowed
 * the prose around it. Capping both axes and centring keeps the picture whole
 * and leaves the surrounding text visible.
 */
export const ART_MAX_WIDTH = 760
export const ART_MAX_HEIGHT = 456

/** Expanded illustrations get the dialog's width and almost its full height. */
export const ART_DIALOG_MAX_WIDTH = 1200
export const ART_DIALOG_MAX_HEIGHT_VH = 86

/**
 * Publish a picture's authored size and ratio to the stylesheet.
 *
 * The caps need to know when a picture is smaller than them (never upscale a
 * doodle) and how tall it becomes once the width is clamped (never scroll a
 * tall scene). Both are pure functions of the canvas size.
 */
export function artVars(w: number, h: number): CSSProperties {
  return { '--cd-art-w': `${w}px`, '--cd-art-ratio': String(w / h) } as CSSProperties
}

/** Plain class names, keyed by role. */
export const CLS = {
  card: 'cd-card',
  head: 'cd-head',
  title: 'cd-title',
  kind: 'cd-kind',
  summary: 'cd-summary',
  scroll: 'cd-scroll',
  chartScroll: 'cd-chart-scroll',
  table: 'cd-table',
  th: 'cd-th',
  td: 'cd-td',
  num: 'cd-num',
  empty: 'cd-empty',
  hint: 'cd-hint',
  raw: 'cd-raw',
  chart: 'cd-chart',
  edge: 'cd-edge',
  edgeHead: 'cd-edge-head',
  edgeLabel: 'cd-edge-label',
  edgeLabelBackground: 'cd-edge-label-bg',
  terminalNode: 'cd-node-terminal',
  processNode: 'cd-node-process',
  decisionNode: 'cd-node-decision',
  nodeLabel: 'cd-node-label',
  art: 'cd-art',
  drawScroll: 'cd-draw-scroll',
  drawSvg: 'cd-draw-svg',
  drawCanvas: 'cd-draw-canvas',
  drawText: 'cd-draw-text',
  drawHand: 'cd-draw-hand',
  figureScroll: 'cd-figure-scroll',
  figureSvg: 'cd-figure-svg',
  saveBody: 'cd-save-body',
  save: 'cd-save',
  expand: 'cd-expand',
  overlay: 'cd-overlay',
  dialog: 'cd-dialog',
} as const

const SHEET = `
.${CLS.card} {
  /* Inherit the host's text stack so card chrome matches DSH prose. The
     fallbacks mirror DSH's own body font, including its CJK faces, so a
     missing token still cannot fall back to SimSun (宋体) on Windows. */
  --cd-font-body: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Helvetica, Arial, sans-serif);
  --cd-font-mono: var(--ds-font-family-code, "SF Mono", "JetBrains Mono", Consolas, Menlo, Courier, "Microsoft YaHei", monospace);
  font-family: var(--cd-font-body);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
  min-width: 0;
}
.${CLS.head} {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.${CLS.title} {
  font-size: calc(13px + var(--dsh-content-font-delta, 0px));
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1f1f1f);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${CLS.kind} {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 80%, #378add);
  color: var(--dsw-alias-label-secondary, #5f6368);
  font-family: inherit;
  font-size: calc(11px + var(--dsh-content-font-delta, 0px));
}
.${CLS.summary} {
  margin-left: auto;
  flex: none;
  font-size: calc(11px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-secondary, #5f6368);
}
.${CLS.scroll},
.${CLS.chartScroll} {
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #fff);
}
.${CLS.scroll} {
  max-height: 320px;
}
/* A flowchart is read as a whole: give a tall TB diagram more room before it
   scrolls, without letting it swallow the chat column. */
.${CLS.chartScroll} {
  max-height: 480px;
}
.${CLS.table} {
  width: 100%;
  border-collapse: collapse;
  font-size: calc(12px + var(--dsh-content-font-delta, 0px));
}
.${CLS.th} {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 6px 10px;
  text-align: left;
  font-weight: 600;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, #1f1f1f);
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 94%, #378add);
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
}
.${CLS.td} {
  padding: 5px 10px;
  color: var(--dsw-alias-label-secondary, #5f6368);
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08)) 60%, transparent);
}
.${CLS.num} {
  text-align: right;
  font-family: var(--cd-font-mono);
  font-variant-numeric: tabular-nums;
}
.${CLS.empty} {
  padding: 10px;
  font-size: calc(12px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-secondary, #5f6368);
}
.${CLS.hint} {
  font-size: calc(11px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-secondary, #5f6368);
}
.${CLS.raw} {
  margin: 0;
  padding: 8px 10px;
  max-height: 260px;
  overflow: auto;
  font-family: var(--cd-font-mono);
  font-size: calc(11px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-secondary, #5f6368);
  white-space: pre-wrap;
  word-break: break-word;
}
.${CLS.chart} {
  display: block;
}
.${CLS.edge} {
  fill: none;
  stroke: var(--dsw-alias-label-secondary, #5f6368);
  stroke-width: 1.5;
}
.${CLS.edgeHead} {
  fill: var(--dsw-alias-label-secondary, #5f6368);
}
.${CLS.edgeLabel} {
  font-size: calc(11px + var(--dsh-content-font-delta, 0px));
  fill: var(--dsw-alias-label-secondary, #5f6368);
}
.${CLS.edgeLabelBackground} {
  fill: var(--dsw-alias-bg-base, #fff);
}
.${CLS.terminalNode} {
  fill: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 86%, #378add);
  stroke: #378add;
  stroke-width: 1.5;
}
.${CLS.processNode} {
  fill: var(--dsw-alias-bg-base, #fff);
  stroke: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  stroke-width: 1.5;
}
.${CLS.decisionNode} {
  fill: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 92%, #378add);
  stroke: #378add;
  stroke-width: 1.5;
}
.${CLS.nodeLabel} {
  font-size: calc(12px + var(--dsh-content-font-delta, 0px));
  fill: var(--dsw-alias-label-primary, #1f1f1f);
}
/* The seats hug the picture instead of filling the column, so a small sketch
   is not blown up and a centred illustration leaves the prose visible. */
.${CLS.drawScroll},
.${CLS.figureScroll} {
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
}
/*
 * Keep the authored ratio, but cap both axes. The capH*ratio term is what
 * replaces the old scroll box: display width =
 *   min(container, 760px, authored w, 456px * w / h)
 * so a tall picture shrinks to fit instead of overflowing a fixed-height frame.
 */
.${CLS.art} {
  display: block;
  width: min(100%, ${ART_MAX_WIDTH}px, var(--cd-art-w, ${ART_MAX_WIDTH}px),
             calc(${ART_MAX_HEIGHT}px * var(--cd-art-ratio, 1.5)));
  height: auto;
  margin: 0 auto;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #fff);
}
.${CLS.drawSvg},
.${CLS.drawCanvas} {
  display: block;
}
.${CLS.drawText} {
  font-family: inherit;
}
.${CLS.drawHand} {
  font-family: 'Segoe Script', 'Comic Sans MS', 'KaiTi', '楷体', 'Kaiti SC', 'STKaiti', cursive;
}
.${CLS.figureSvg} {
  background: #ffffff;
}
.${CLS.saveBody} {
  width: 100%;
  min-width: 0;
}
.${CLS.save},
.${CLS.expand} {
  flex: none;
  padding: 1px 7px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #5f6368);
  font-size: calc(12px + var(--dsh-content-font-delta, 0px));
  line-height: 1.4;
  cursor: pointer;
}
.${CLS.save}:hover,
.${CLS.expand}:hover {
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 92%, #378add);
}
.${CLS.overlay} {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3vh 3vw;
  background: rgba(20, 20, 24, 0.42);
}
.${CLS.dialog} {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(96vw, 1280px);
  max-height: 94vh;
  overflow: auto;
  padding: 14px 18px 18px;
  border-radius: 14px;
  background: var(--dsw-alias-bg-base, #fff);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.3);
}
.${CLS.dialog} .${CLS.scroll},
.${CLS.dialog} .${CLS.chartScroll} {
  max-height: none;
}
/* Keep the authored pixel size: stretching a tall TB chart to dialog width
   inflates its height and shrinks its labels. The dialog itself scrolls. */
.${CLS.dialog} .${CLS.chart} {
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 88vh;
}
/* The expanded copy trades the inline caps for the dialog's much larger seat. */
.${CLS.dialog} .${CLS.art} {
  width: min(100%, ${ART_DIALOG_MAX_WIDTH}px, var(--cd-art-w, ${ART_DIALOG_MAX_WIDTH}px),
             calc(${ART_DIALOG_MAX_HEIGHT_VH}vh * var(--cd-art-ratio, 1.5)));
}
.${CLS.dialog} .${CLS.table} {
  font-size: calc(14px + var(--dsh-content-font-delta, 0px));
}
`

/**
 * Append the sheet to `document.head` once per page.
 * Runs at import time; safe to call repeatedly because of the id guard.
 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = SHEET
  document.head.appendChild(element)
}
/**
 * PNG export wiring and file naming.
 *
 * Rasterization itself needs a browser, but the two things that break quietly
 * are pure or static: a model-authored title turning into an unsafe file name,
 * and a card kind forgetting to carry the control. The frame is shared by all
 * four native kinds, so one static-markup assertion covers the whole set.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CardSpec } from '@aisketch/cards-core'
import { CardFrame } from '../src/client/CardFrame.tsx'
import { TableCard } from '../src/client/TableCard.tsx'
import { FlowchartCard } from '../src/client/FlowchartCard.tsx'
import { FigureCard } from '../src/client/FigureCard.tsx'
import { DrawCard } from '../src/client/DrawCard.tsx'
import { copyElementAsPng, pngFilename, soleCanvas, soleDataImage } from '../src/client/save-png.ts'

/** The translate stand-in returns the key, so the copy is visible in the markup. */
const t = ((key: string) => key) as never

describe('pngFilename', () => {
  it('keeps a readable title and appends the png extension', () => {
    expect(pngFilename('二次函数', 'sketch')).toBe('二次函数.png')
  })

  it('replaces path separators and other unsafe characters', () => {
    expect(pngFilename('a/b\\c:d*e?f"g<h>i|j', 'table')).toBe('a_b_c_d_e_f_g_h_i_j.png')
  })

  it('falls back to the kind when the title has nothing usable', () => {
    expect(pngFilename('  ', 'flowchart')).toBe('flowchart.png')
    expect(pngFilename('///', 'draw')).toBe('draw.png')
  })

  it('caps a long title so the download name stays sane', () => {
    const name = pngFilename('图'.repeat(200), 'figure')
    expect(name.endsWith('.png')).toBe(true)
    expect(name.length).toBe(60 + 4)
  })
})

describe('soleCanvas', () => {
  /** Minimal `querySelectorAll` stub: the helper only needs the canvas count. */
  const seat = (count: number): Element => ({
    querySelectorAll: (selector: string) => {
      expect(selector).toBe('canvas')
      return Array.from({ length: count }, () => ({ tagName: 'CANVAS' }))
    },
  }) as unknown as Element

  it('claims a canvas-backed picture so Save can download it directly', () => {
    expect(soleCanvas(seat(1))).not.toBeNull()
  })

  it('leaves SVG/DOM-only cards to the serialization route', () => {
    expect(soleCanvas(seat(0))).toBeNull()
    expect(soleCanvas(seat(2))).toBeNull()
  })
})

describe('soleDataImage', () => {
  /** Minimal `querySelectorAll` stub returning images with a `src` attribute. */
  const seat = (sources: readonly (string | null)[]): Element => ({
    querySelectorAll: (selector: string) => {
      expect(selector).toBe('img')
      return sources.map(src => ({
        getAttribute: (name: string) => {
          expect(name).toBe('src')
          return src
        },
      }))
    },
  }) as unknown as Element

  it('claims a data-URL picture so Save reuses the bytes the reader copied', () => {
    expect(soleDataImage(seat(['data:image/png;base64,AAAA']))).not.toBeNull()
  })

  it('leaves remote images, multiple images and SVG-only cards to serialization', () => {
    expect(soleDataImage(seat(['blob:http://local/1']))).toBeNull()
    expect(soleDataImage(seat([]))).toBeNull()
    expect(soleDataImage(seat(['data:image/png;base64,AA', 'data:image/png;base64,BB']))).toBeNull()
  })
})

describe('copyElementAsPng', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('puts a data-URL picture on the clipboard without downloading it', async () => {
    const writes: unknown[] = []
    class FakeClipboardItem {
      constructor(readonly data: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    vi.stubGlobal('navigator', {
      clipboard: { write: async (items: unknown[]) => { writes.push(items) } },
    })
    const body = {
      querySelector: () => null,
      querySelectorAll: (selector: string) => selector === 'img'
        ? [{ getAttribute: () => 'data:image/png;base64,iVBORw0KGgo=' }]
        : [],
    } as unknown as Element

    expect(await copyElementAsPng(body)).toBe(true)
    expect(writes).toHaveLength(1)
  })

  it('reports an unsupported clipboard instead of throwing', async () => {
    vi.stubGlobal('navigator', {})
    const body = { querySelector: () => null, querySelectorAll: () => [] } as unknown as Element
    expect(await copyElementAsPng(body)).toBe(false)
  })
})

describe('the save control on cards', () => {
  it('renders the button and a body wrapper that can be photographed', () => {
    const html = renderToStaticMarkup(
      <CardFrame kind="figure" title="受力分析" summary={null} t={t}>
        <svg />
      </CardFrame>,
    )
    expect(html).toContain('cd-save')
    expect(html).toContain('⧉ card.copy')
    expect(html).toContain('card.copyHint')
    expect(html).toContain('⇩ card.save')
    expect(html).toContain('card.saveHint')
    expect(html).toContain('cd-save-body')
    expect(html).toContain('<svg')
  })

  /** Every native kind goes through CardFrame, so each must expose the control. */
  const cards: readonly CardSpec[] = [
    { version: 1, kind: 'table', payload: { columns: ['列'], rows: [[1]] } },
    { version: 1, kind: 'flowchart', payload: { nodes: [{ id: 'a', label: '开始' }], edges: [] } },
    { version: 1, kind: 'figure', payload: { template: 'atom_shell', params: { symbol: 'Na' } } },
    { version: 1, kind: 'draw', payload: { elements: [{ type: 'path', d: 'M 0 0 L 10 10' }] } },
  ]
  for (const card of cards) {
    it(`exposes the save button on ${card.kind} cards`, () => {
      const html = card.kind === 'table'
        ? renderToStaticMarkup(<TableCard card={card} t={t} />)
        : card.kind === 'flowchart'
          ? renderToStaticMarkup(<FlowchartCard card={card} t={t} />)
          : card.kind === 'figure'
            ? renderToStaticMarkup(<FigureCard card={card} t={t} />)
            : renderToStaticMarkup(<DrawCard card={card} t={t} />)
      expect(html).toContain('cd-save')
      expect(html).toContain('⧉ card.copy')
      expect(html).toContain('cd-save-body')
    })
  }
})

/**
 * The bitmap-to-image step that gives a draw card its native "Copy image".
 *
 * Encoding needs a real canvas, which a node test does not have, but the two
 * ways it can fail quietly are pure: asking for the wrong MIME type, and a
 * tainted canvas throwing instead of returning a URL. Both are pinned here so
 * the card falls back to a painted canvas rather than losing the picture.
 */
import { describe, expect, it } from 'vitest'
import { pngDataUrl } from '../src/client/copyable-image.ts'

/** A canvas stub that records the requested MIME type. */
function canvas(encode: (type: string) => string): HTMLCanvasElement {
  return { toDataURL: encode } as unknown as HTMLCanvasElement
}

describe('pngDataUrl', () => {
  it('encodes a readable canvas as a PNG data URL', () => {
    expect(pngDataUrl(canvas((type) => {
      expect(type).toBe('image/png')
      return 'data:image/png;base64,AAAA'
    }))).toBe('data:image/png;base64,AAAA')
  })

  it('returns null when the canvas cannot be read', () => {
    const tainted = canvas(() => { throw new Error('Tainted canvases may not be exported') })
    expect(pngDataUrl(tainted)).toBeNull()
  })

  it('rejects a non-image result so a broken encoder cannot become the src', () => {
    expect(pngDataUrl(canvas(() => 'data:,'))).toBeNull()
  })
})

/**
 * Export a rendered card as a PNG image.
 *
 * The four native kinds reach the page in three different shapes: a table is
 * live DOM, a flowchart/figure is SVG, and a draw card is a canvas snapshot of
 * hidden SVG. Rasterizing the mounted body covers all three without a second
 * renderer, so the exported picture is exactly what the user saw.
 *
 * Two things do not survive being serialized into an image document: the
 * injected stylesheet (which carries the host's CSS tokens) and a canvas's
 * pixels. Computed styles are inlined from the live nodes before serialization,
 * and canvases are swapped for `<img>` of their own data URL. The result is a
 * self-contained SVG that any browser can decode, which is then painted into a
 * canvas at device resolution and downloaded.
 *
 * The pure helpers at the top are exported so the naming and the markup
 * preparation can be tested without a browser; only `saveElementAsPng` needs
 * the DOM.
 */

/** File-name characters that are unsafe or reserved on common filesystems. */
const UNSAFE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g

/** Keep a title from producing an absurdly long file name. */
const MAX_NAME_LENGTH = 60

/** A hard ceiling on export size, so a very tall table cannot exhaust memory. */
const MAX_EXPORT_EDGE = 3000

/**
 * Build a safe PNG file name from a card title.
 *
 * A title is model-authored, so it can contain path separators or control
 * characters; the kind is the fallback when nothing readable remains.
 * @param title - the card's heading, possibly empty.
 * @param kind - the card kind, used when the title has no usable characters.
 * @returns a `.png` file name.
 */
export function pngFilename(title: string, kind: string): string {
  const cleaned = title
    .replace(UNSAFE_NAME, '_')
    .replace(/_+/gu, '_')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s_]+|[\s_]+$/gu, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[\s_]+$/gu, '')
  return `${cleaned === '' ? kind : cleaned}.png`
}

/**
 * CSS properties copied from a live node onto its serialized copy.
 *
 * A curated list keeps the markup small. It covers the ink, type and box
 * properties the native cards actually style, including the SVG presentation
 * properties a flowchart relies on.
 */
const STYLE_PROPERTIES = [
  'display', 'position', 'box-sizing',
  'width', 'height', 'max-width', 'min-width',
  'margin', 'padding',
  'color', 'background-color', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-numeric',
  'line-height', 'text-align', 'text-anchor', 'text-overflow', 'white-space',
  'vertical-align', 'dominant-baseline',
  'border', 'border-bottom', 'border-radius',
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'mix-blend-mode', 'filter', 'overflow',
] as const

/**
 * Resolve the stylesheet-dependent properties of a subtree onto its clone.
 *
 * `getComputedStyle` resolves both `var(--token)` and `calc()` against the live
 * page, which is what an image document cannot do on its own. Existing inline
 * style is kept: the draw card carries payload-specific paint there.
 * @param source - the mounted subtree.
 * @param clone - its detached copy, mutated in place.
 */
export function inlineComputedStyles(source: Element, clone: Element): void {
  const view = source.ownerDocument?.defaultView
  if (view == null) return
  const sources = [source, ...Array.from(source.querySelectorAll('*'))]
  const clones = [clone, ...Array.from(clone.querySelectorAll('*'))]
  for (let index = 0; index < sources.length; index += 1) {
    const target = clones[index]
    if (target === undefined) break
    const computed = view.getComputedStyle(sources[index]!)
    let css = ''
    for (const property of STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property)
      if (value !== '') css += `${property}:${value};`
    }
    const existing = target.getAttribute('style') ?? ''
    target.setAttribute('style', `${existing};${css}`)
  }
}

/**
 * Replace every canvas in a clone with an image of the original's pixels.
 *
 * A serialized `<canvas>` is an empty rectangle in an image document; the
 * draw card's visible bitmap would vanish without this.
 * @param source - the mounted subtree holding the real canvases.
 * @param clone - the detached copy whose canvases get replaced.
 */
function replaceCanvases(source: Element, clone: Element): void {
  const originals = Array.from(source.querySelectorAll('canvas'))
  const copies = Array.from(clone.querySelectorAll('canvas'))
  for (let index = 0; index < copies.length; index += 1) {
    const canvas = originals[index]
    const copy = copies[index]
    if (canvas === undefined || copy === undefined) continue
    const document = copy.ownerDocument
    if (document === null) continue
    let data: string
    try {
      data = (canvas as HTMLCanvasElement).toDataURL('image/png')
    } catch {
      continue // a tainted canvas cannot be exported; leave the original in place
    }
    const image = document.createElement('img')
    image.setAttribute('src', data)
    image.setAttribute('width', String(canvas.getAttribute('width') ?? ''))
    image.setAttribute('height', String(canvas.getAttribute('height') ?? ''))
    image.setAttribute('style', copy.getAttribute('style') ?? '')
    copy.replaceWith(image)
  }
}

/**
 * Find the first opaque painted background behind a node.
 *
 * A transparent foreignObject would put dark-theme ink on a white PNG. Walking
 * up to the first concrete background keeps the export readable in either theme.
 * @param source - the mounted subtree.
 * @returns a concrete CSS color.
 */
function paintedBackground(source: Element): string {
  const view = source.ownerDocument?.defaultView
  if (view == null) return '#ffffff'
  let node: Element | null = source
  while (node !== null) {
    const color = view.getComputedStyle(node).backgroundColor
    if (color !== '' && color !== 'transparent' && !/^rgba\([^)]*,\s*0\)$/u.test(color)) return color
    node = node.parentElement
  }
  return '#ffffff'
}

/**
 * Build a self-contained SVG document for a mounted card body.
 * @param element - the body to export.
 * @param width - export width in CSS pixels.
 * @param height - export height in CSS pixels.
 * @returns serialized SVG markup.
 */
export function markupFor(element: Element, width: number, height: number): string {
  const clone = element.cloneNode(true) as Element
  inlineComputedStyles(element, clone)
  replaceCanvases(element, clone)
  // On-screen scroll caps must not clip the exported picture.
  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    const style = node.getAttribute('style')
    if (style === null) continue
    node.setAttribute('style', `${style};max-height:none;overflow:visible;position:static`)
  }
  if (clone.namespaceURI === 'http://www.w3.org/2000/svg') {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    return new XMLSerializer().serializeToString(clone)
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  const background = paintedBackground(element)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${background}"/>`,
    '<foreignObject x="0" y="0" width="100%" height="100%">',
    new XMLSerializer().serializeToString(clone),
    '</foreignObject></svg>',
  ].join('')
}

/** Decode an SVG document into a device-resolution canvas. */
async function rasterize(markup: string, width: number, height: number, scale: number): Promise<HTMLCanvasElement> {
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('card SVG did not decode'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('no 2d context')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Hand a canvas to the browser's PNG download. */
function download(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (blob === null) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Revoke on the next turn: some browsers start the download asynchronously.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}

/**
 * The single canvas that is a draw card's whole picture, if there is one.
 *
 * A draw card's snapshot is already a clean, device-resolution canvas -- the
 * picture the reader sees. It must not go through {@link markupFor}: embedding
 * it as a data-URL `<img>` inside a `<foreignObject>` makes Chromium treat the
 * rasterized SVG as tainted, so the final `toBlob()` throws a SecurityError and
 * no download is ever started. The card's save handler swallows that error,
 * which is why clicking Save appeared to do nothing.
 * @param element - the export seat (the marked picture wrapper, or the body).
 * @returns the canvas when it is the seat's only picture, else null.
 */
export function soleCanvas(element: Element): HTMLCanvasElement | null {
  const canvases = element.querySelectorAll('canvas')
  return canvases.length === 1 ? canvases[0] as HTMLCanvasElement : null
}

/**
 * Export one mounted card body as a downloaded PNG.
 * @param element - the body to photograph.
 * @param filename - the suggested download name.
 */
export async function saveElementAsPng(element: Element, filename: string): Promise<void> {
  // Illustration cards centre their picture inside the card body. Photographing
  // the full-width body would bake those side gutters into the PNG, so export
  // the picture's own seat when the renderer marks one.
  const target = element.querySelector<HTMLElement>('[data-card-export]') ?? element
  // A canvas-backed picture takes the direct route: the canvas is the pixels,
  // and serializing it through SVG is what taints the export in Chromium.
  const canvas = soleCanvas(target)
  if (canvas !== null) {
    download(canvas, filename)
    return
  }
  const rect = target.getBoundingClientRect()
  const scrollable = target as Element & { scrollWidth?: number; scrollHeight?: number }
  const width = Math.max(1, Math.ceil(Math.max(rect.width, scrollable.scrollWidth ?? 0)))
  const height = Math.max(1, Math.ceil(Math.max(rect.height, scrollable.scrollHeight ?? 0)))
  const dpr = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1)
  const scale = Math.max(1, Math.min(2, dpr, MAX_EXPORT_EDGE / Math.max(width, height)))
  download(await rasterize(markupFor(target, width, height), width, height, scale), filename)
}

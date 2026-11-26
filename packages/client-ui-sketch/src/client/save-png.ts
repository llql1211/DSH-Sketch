/**
 * Save or copy a live plot canvas as a PNG.
 *
 * Unlike the card kinds, a `sketch_function` plot is already painted into a
 * 2D canvas, so no DOM serialization is needed: the canvas is the picture. The
 * only care required is a safe file name -- the expression in the card title is
 * model-authored and can contain path separators or control characters.
 *
 * A plot cannot simply be shown as an `<img>` like a finished draw card: the
 * tracer and sliders need the live canvas. The clipboard API is its route to
 * the same result the native "Copy image" menu gives a static picture.
 */

/** File-name characters that are unsafe or reserved on common filesystems. */
const UNSAFE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g

/** Keep an expression from producing an absurdly long file name. */
const MAX_NAME_LENGTH = 60

/**
 * Build a safe PNG file name from a plot expression.
 * @param title - the expression shown in the card head.
 * @returns a `.png` file name.
 */
export function pngFilename(title: string): string {
  const cleaned = title
    .replace(UNSAFE_NAME, '_')
    .replace(/_+/gu, '_')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s_]+|[\s_]+$/gu, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[\s_]+$/gu, '')
  return `${cleaned === '' ? 'function-plot' : cleaned}.png`
}

/**
 * Hand a canvas to the browser's PNG download.
 * @param canvas - the mounted plot canvas.
 * @param filename - the suggested download name.
 */
export function saveCanvasAsPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (blob === null) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Some browsers start the download asynchronously, so revoke on the next turn.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}

/**
 * Copy the plot's current pixels to the system clipboard as a PNG.
 *
 * A failed copy -- no permission, an older browser, a tainted canvas -- is
 * reported as false rather than thrown: Save is still available, and a card
 * must never break over a clipboard prompt.
 * @param canvas - the mounted plot canvas.
 * @returns whether the browser accepted the copy.
 */
export async function copyCanvasAsPng(canvas: HTMLCanvasElement): Promise<boolean> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false
  if (typeof ClipboardItem === 'undefined') return false
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (blob === null) return false
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

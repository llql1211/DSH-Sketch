/**
 * Save a live plot canvas as a PNG download.
 *
 * Unlike the card kinds, a `sketch_function` plot is already painted into a
 * 2D canvas, so no DOM serialization is needed: the canvas is the picture. The
 * only care required is a safe file name -- the expression in the card title is
 * model-authored and can contain path separators or control characters.
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

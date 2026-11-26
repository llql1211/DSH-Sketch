/**
 * Make a finished bitmap copyable with the browser's native right-click menu.
 *
 * A `<canvas>` has no source URL, so the context menu never offers "Copy
 * image": a reader who wants the picture into a document has to Save it and
 * then hunt for the downloaded file. An `<img>` carrying a PNG data URL has a
 * real source, so "Copy image" appears exactly where it is expected, and the
 * bytes travel with the page -- there is no blob URL to revoke and the Save
 * control can download the very same URL.
 */

/**
 * Encode a canvas as a PNG data URL, or null when its pixels cannot be read.
 *
 * A tainted canvas makes `toDataURL` throw; returning null lets the caller keep
 * the bitmap on screen as a drawn canvas instead of losing the picture.
 * @param canvas - the already-rasterized picture.
 * @returns a `data:image/png;base64,...` URL, or null.
 */
export function pngDataUrl(canvas: HTMLCanvasElement): string | null {
  try {
    const url = canvas.toDataURL('image/png')
    return url.startsWith('data:image/png') ? url : null
  } catch {
    return null
  }
}

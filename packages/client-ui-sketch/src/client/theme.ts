/**
 * Theme awareness for the Canvas plot.
 *
 * A 2D context is painted once and then forgotten; unlike the SVG cards, it
 * cannot inherit a CSS color because `ctx.fillStyle` does not resolve `var()`.
 * So when the host switches light/dark the canvas must be repainted, and it must
 * read the *resolved* surface color to know which ink to use.
 *
 * Nothing here assumes how the host expresses its theme — a class on `<html>`,
 * an inline token or the OS preference all end up in the computed background of
 * the mounted canvas. The hook only watches for the DOM changes that could
 * alter that result and hands the plot a refresh counter.
 */

import { useEffect, useState } from 'react'

/** Token the canvas uses for its background; read as a fallback off a real surface. */
const SURFACE_TOKEN = '--dsw-alias-bg-base'

/** Attributes whose change can swap a theme without touching this component. */
const THEME_ATTRIBUTES = ['class', 'style', 'data-theme', 'data-color-scheme', 'data-mode']

/**
 * The color the canvas is actually painted on.
 *
 * Reading the element's computed `background-color` resolves the token the same
 * way the browser did when it painted the border and fill, so the palette can
 * never disagree with the pixels. The token and a white fallback cover the
 * cases where the element is detached or the browser reports `transparent`.
 * @param element - the mounted canvas, or null before the ref attaches.
 * @returns a CSS color string.
 */
export function readSurfaceColor(element: HTMLElement | null): string {
  if (element === null || typeof window === 'undefined') return '#ffffff'
  const computed = window.getComputedStyle(element).backgroundColor.trim()
  if (computed !== '' && computed !== 'transparent' && !computed.endsWith(', 0)')) return computed
  const token = window.getComputedStyle(document.documentElement).getPropertyValue(SURFACE_TOKEN).trim()
  return token === '' ? '#ffffff' : token
}

/**
 * A counter that advances whenever the host theme could have changed.
 *
 * The plot effect lists it as a dependency, so a light/dark switch repaints the
 * canvas with the matching palette without any prop or session event changing.
 * Listeners cover both an app-level theme toggle (attributes on the root
 * elements) and the OS color scheme. Server and test renders are safe: they
 * simply never advance the counter.
 * @returns an integer that changes when the theme may have changed.
 */
export function useThemeRefresh(): number {
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const bump = (): void => setRefresh((value) => value + 1)

    const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(bump)
    if (observer !== undefined) {
      const options: MutationObserverInit = { attributes: true, attributeFilter: THEME_ATTRIBUTES }
      observer.observe(document.documentElement, options)
      if (document.body !== null) observer.observe(document.body, options)
    }

    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener?.('change', bump)

    return () => {
      observer?.disconnect()
      media?.removeEventListener?.('change', bump)
    }
  }, [])
  return refresh
}

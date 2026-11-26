/**
 * Theme awareness for the chart's Canvas surface.
 *
 * A 2D context cannot inherit CSS colors: `ctx.fillStyle` does not resolve
 * `var()`. So when the host switches light/dark the chart must repaint, and it
 * must read the *resolved* surface color to choose the matching ink. This is a
 * local port of the plotter's helper; the cards package does not import across
 * to the sketch package.
 */

import { useEffect, useState } from 'react'

/** Token used as a fallback when the mounted element reports no background. */
const SURFACE_TOKEN = '--dsw-alias-bg-base'

/** Attributes whose change can swap a theme without touching this component. */
const THEME_ATTRIBUTES = ['class', 'style', 'data-theme', 'data-color-scheme', 'data-mode']

/**
 * The color the canvas is actually painted on.
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
 * The chart effect lists it as a dependency, so a switch repaints with the
 * matching palette without any payload or session event changing.
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

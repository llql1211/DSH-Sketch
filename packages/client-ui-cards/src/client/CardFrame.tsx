/**
 * The card frame: the head row, the body, and the expand overlay.
 *
 * Every native kind draws into this frame, so "show this bigger" is one
 * behaviour instead of one per kind. Expanding renders the body a second time
 * inside a portal: the overlay sits above the chat's scroll containers, and a
 * card body is a pure function of its payload, so the copy cannot disagree
 * with the inline one.
 *
 * A table that used to need its own 320px scroll box is exactly the case this
 * exists for: in the overlay the same table gets the whole viewport, and the
 * scroll container's height cap is lifted.
 *
 * The frame also owns the PNG export control. Because it wraps the body rather
 * than living inside each kind, the button needs no per-card wiring: it
 * photographs the mounted body, which is already the exact picture the reader
 * sees. The inline copy and the overlay copy each keep their own ref, so the
 * button always exports the surface clicked.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { NS } from './locales.ts'
import { pngFilename, saveElementAsPng } from './save-png.ts'
import { CLS } from './styles.ts'

/** What the frame needs to draw the head and manage the overlay. */
export interface CardFrameProps {
  /** Card kind, shown as the chip and stamped on the root for diagnostics. */
  readonly kind: string
  /** Heading text the kind supplies (its own title or the card's). */
  readonly title: string
  /** Right-aligned summary text, or null when the kind has none. */
  readonly summary: string | null
  /** This plugin's translate, bound to the `cards` dictionary. */
  readonly t: TranslateNS<typeof NS>
  /** The kind-owned body, rendered inline and again in the overlay. */
  readonly children: ReactNode
}

/**
 * Render one card frame.
 * @param props - head copy, the translate seat, and the body.
 * @returns the card, plus its overlay once expanded.
 */
export function CardFrame({ kind, title, summary, t, children }: CardFrameProps) {
  const [expanded, setExpanded] = useState(false)
  const inlineBody = useRef<HTMLDivElement | null>(null)
  const overlayBody = useRef<HTMLDivElement | null>(null)

  // Escape closes the overlay, matching every other modal surface in the shell.
  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [expanded])

  /** Photograph one body and offer it as a PNG download. */
  const save = (body: RefObject<HTMLDivElement>): void => {
    const node = body.current
    if (node === null) return
    // A failed rasterization must never take the card down; the picture on
    // screen is untouched either way.
    void saveElementAsPng(node, pngFilename(title, kind)).catch(() => {})
  }

  const body = (target: RefObject<HTMLDivElement>) => (
    <div ref={target} className={CLS.saveBody}>
      {children}
    </div>
  )

  const head = (close: (() => void) | null, target: RefObject<HTMLDivElement>) => (
    <div className={CLS.head}>
      <span className={CLS.title}>{title}</span>
      <span className={CLS.kind}>{kind}</span>
      {summary === null ? null : <span className={CLS.summary}>{summary}</span>}
      <button
        type="button"
        className={CLS.save}
        aria-label={t('card.saveHint')}
        title={t('card.saveHint')}
        onClick={() => save(target)}
      >
        ⇩ {t('card.save')}
      </button>
      {close === null
        ? (
          <button
            type="button"
            className={CLS.expand}
            aria-label={t('card.expand')}
            title={t('card.expand')}
            onClick={() => setExpanded(true)}
          >
            ⤢
          </button>
        )
        : (
          <button
            type="button"
            className={CLS.expand}
            aria-label={t('card.close')}
            title={t('card.close')}
            onClick={close}
          >
            ✕
          </button>
        )}
    </div>
  )

  return (
    <div className={CLS.card} data-card-kind={kind}>
      {head(null, inlineBody)}
      {body(inlineBody)}
      {expanded && typeof document !== 'undefined'
        ? createPortal(
          <div className={CLS.overlay} onClick={() => setExpanded(false)}>
            <div
              className={CLS.dialog}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              onClick={(event) => event.stopPropagation()}
            >
              {head(() => setExpanded(false), overlayBody)}
              {body(overlayBody)}
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}

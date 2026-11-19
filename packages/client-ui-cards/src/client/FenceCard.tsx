/**
 * Inline card fence: the answer's text and its graphics live in the same stream.
 *
 * A language-keyed fence layer renders where the Markdown fence sits, so a card
 * written between two paragraphs appears between them -- no process row, no
 * turn tail, no whole-Turn fold. The fence body is the model's own JSON text and
 * is part of the persisted assistant message, so replay redraws the identical
 * card with no Host call.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { HocShare, PropsLocale, PropsRuntime, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import { parseCardSpec } from '@aisketch/cards-core'
import { CardView } from './CardView.tsx'
import type { NS } from './locales.ts'

/** Props of the `aisketch` fence layer. */
export type FenceCardProps =
  PropsRuntime<'conversation.chat.markdown.fence'>
  & HocShare<SlotMap['conversation.chat.markdown.fence']>
  & PropsLocale<typeof NS>

/**
 * Render one `aisketch` fence as a card in place, falling back to the raw code
 * while streaming or when the payload cannot be parsed.
 * @param props - fence code, streaming state, inner code block and locale.
 * @returns the card, or the inner code block.
 */
export function FenceCard({ code, streaming, children, t }: FenceCardProps): ReactNode {
  const card = useMemo(() => {
    if (streaming || code.trim() === '') return null
    try {
      return parseCardSpec(JSON.parse(code) as unknown)
    } catch {
      return null
    }
  }, [code, streaming])

  if (card === null) return <>{children}</>
  return <CardView card={card} raw={code} t={t} />
}

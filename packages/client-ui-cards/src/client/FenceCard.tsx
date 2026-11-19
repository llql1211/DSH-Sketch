/**
 * Inline card fence: the answer's text and its graphics live in the same stream.
 *
 * The layer is registered as a wildcard over `conversation.chat.markdown.fence`:
 * a model that writes bare ``` fences or ```json instead of ```aisketch still
 * gets its picture. Any fence whose body parses as a CardSpec is replaced by
 * the card; every other fence renders its inner code block untouched, so math,
 * diff and ordinary code fences keep working.
 *
 * The fence body is part of the persisted assistant message, so replay redraws
 * the identical card with no Host round trip and no second source of truth.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { HocShare, PropsLocale, PropsRuntime, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import { parseCardSpec } from '@aisketch/cards-core'
import type { CardSpec } from '@aisketch/cards-core'
import { CardView } from './CardView.tsx'
import type { NS } from './locales.ts'

/** Props of the card fence layer. */
export type FenceCardProps =
  PropsRuntime<'conversation.chat.markdown.fence'>
  & HocShare<SlotMap['conversation.chat.markdown.fence']>
  & PropsLocale<typeof NS>

/**
 * Narrow a fence body to a public card spec.
 * @param code - the fence body as written in the assistant message.
 * @returns the spec, or null when this fence is not a card for the user.
 */
export function readFenceCard(code: string): CardSpec | null {
  if (code.trim() === '') return null
  try {
    const parsed = JSON.parse(code) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    // A private draft is for the model's own inspection; never publish it.
    if ((parsed as { draft?: unknown }).draft === true) return null
    return parseCardSpec(parsed)
  } catch {
    return null
  }
}

/**
 * Render a card-shaped fence in place, leaving every other fence as raw code.
 * @param props - fence code, streaming state, inner code block and locale.
 * @returns the card, or the inner code block.
 */
export function FenceCard({ code, streaming, children, t }: FenceCardProps): ReactNode {
  const card = useMemo(
    () => streaming ? null : readFenceCard(code),
    [code, streaming],
  )

  if (card === null) return <>{children}</>
  return <CardView card={card} raw={code} t={t} />
}

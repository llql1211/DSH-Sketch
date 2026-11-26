/**
 * Inline card fence: the answer's text and its graphics live in the same stream.
 *
 * The layer is registered as a wildcard over `conversation.chat.markdown.fence`:
 * a model that writes bare ``` fences or ```json instead of ```aisketch still
 * gets its picture. Any fence whose body parses as a CardSpec is replaced by
 * the card; every other fence renders its inner code block untouched, so math,
 * diff and ordinary code fences keep working.
 *
 * A fence body may also be {"ref":"..."}, the handle echoed by `show_card`.
 * The spec then comes from the persisted call arguments instead of a second copy
 * in the answer, so a long drawing is authored once. Inline specs keep working
 * and remain the replay-safe choice when the tool call may leave the loaded
 * window.
 */
import { useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { HocShare, PropsLocale, PropsRuntime, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import { parseCardSpec } from '@aisketch/cards-core'
import type { CardSpec } from '@aisketch/cards-core'
import { cardByRef, cardRefsVersion, subscribeCardRefs } from './card-refs.ts'
import { CardView } from './CardView.tsx'
import type { NS } from './locales.ts'

/** Props of the card fence layer. */
export type FenceCardProps =
  PropsRuntime<'conversation.chat.markdown.fence'>
  & HocShare<SlotMap['conversation.chat.markdown.fence']>
  & PropsLocale<typeof NS>

/**
 * Narrow a fence body to a public card spec, resolving a tool-call ref when
 * the model chose the compact form.
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
    const ref = (parsed as { ref?: unknown }).ref
    // A ref-only body points at the spec already persisted in a tool call.
    if (typeof ref === 'string' && (parsed as { kind?: unknown }).kind === undefined) {
      return cardByRef(ref) ?? null
    }
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
  // A ref resolves against events that may arrive after this row first renders;
  // subscribing makes the card appear as soon as its call is indexed.
  const revision = useSyncExternalStore(subscribeCardRefs, cardRefsVersion, cardRefsVersion)
  const card = useMemo(
    () => streaming ? null : readFenceCard(code),
    // The revision changes only when the ref index changes; it is a change
    // signal, not an input to the parse itself.
    [code, streaming, revision],
  )

  if (card === null) return <>{children}</>
  return <CardView card={card} raw={code} t={t} />
}

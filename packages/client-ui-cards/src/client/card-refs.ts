/**
 * Specs remembered from persisted `show_card` calls, keyed by the call ref.
 *
 * The Host echoes the tool call id as `ref` in every `show_card` result. A model
 * can therefore publish a drawing with a two-word fence -- {"ref":"..."} --
 * instead of generating the whole JSON payload a second time. This Definition
 * reads the very `tool/call` arguments the tool validated, so the public card and
 * the private preview are the same spec; there is no second copy to drift.
 *
 * The store is a tiny external store rather than React state because the fence
 * layer that consumes it has no Cordis context and cannot see session events.
 * It is a cache, not a source of truth: the durable bytes stay in the transcript,
 * and a replay rebuilds the same index by replaying the same events in order.
 * A fence whose ref is not in the index simply renders as raw code.
 */

import type {
  ConversationMatch,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { CARD_TOOL_NAME, parseCardSpec } from '@aisketch/cards-core'
import type { CardSpec } from '@aisketch/cards-core'
import { readCallArguments } from './card-definition.ts'

interface RefEntry {
  readonly card: CardSpec
  readonly seq: number
}

const specs = new Map<string, RefEntry>()
const listeners = new Set<() => void>()
let version = 0

/** Publish a store change to every subscribed fence. */
function notify(): void {
  version += 1
  for (const listener of [...listeners]) listener()
}

/**
 * Index one card by the ref the model will put in its fence.
 *
 * Repeated delivery of the same call is a no-op, so replaying a session cannot
 * churn subscribers or replace a spec with an older copy.
 * @param ref - the tool call id echoed by `show_card`.
 * @param card - the admitted spec read back from the call arguments.
 * @param seq - the call's event sequence, used only to keep redelivery stable.
 */
export function rememberCardRef(ref: string, card: CardSpec, seq: number): void {
  const previous = specs.get(ref)
  if (previous !== undefined && previous.card === card && previous.seq === seq) return
  specs.set(ref, { card, seq })
  notify()
}

/**
 * Resolve one fence ref to the spec the tool already admitted.
 * @param ref - the ref from a `show_card` result.
 * @returns the spec, or undefined when that call is not in the loaded window.
 */
export function cardByRef(ref: string): CardSpec | undefined {
  return specs.get(ref)?.card
}

/**
 * Subscribe to ref-index changes.
 * @param listener - called after a new or changed call is indexed.
 * @returns the unsubscribe function.
 */
export function subscribeCardRefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** @returns the store revision, for `useSyncExternalStore`. */
export function cardRefsVersion(): number {
  return version
}

/** State-only Definition: it indexes calls and publishes no chat node. */
interface CardRefsState {
  readonly indexed: number
}

/** Record the spec carried by one accepted tool/call match. */
function indexMatch(match: ConversationMatch): void {
  if (match.event.type !== 'tool/call') return
  const data = match.event.data as { readonly callId?: unknown; readonly arguments?: unknown }
  if (typeof data.callId !== 'string') return
  const card = parseCardSpec(readCallArguments(data.arguments).parsed)
  if (card === null) return
  rememberCardRef(data.callId, card, match.event.seq)
}

/**
 * Index every `show_card` call, draft or final, draw or diagram: the fence may
 * refer to any of them, and the draft flag controls delivery, not identity.
 */
export const cardRefDefinition: ConversationNodeDefinition<CardRefsState> = {
  kind: 'card-ref',
  match: (event) => {
    if (event.type !== 'tool/call') return null
    const data = event.data as { readonly name?: unknown; readonly callId?: unknown }
    if (data.name !== CARD_TOOL_NAME || typeof data.callId !== 'string') return null
    return { id: data.callId, role: 'start' }
  },
  start: (_context, match) => {
    indexMatch(match)
    return { indexed: 1 }
  },
  update: (context, match) => {
    indexMatch(match)
    return context.state
  },
}

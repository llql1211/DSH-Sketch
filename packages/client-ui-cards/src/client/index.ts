/**
 * Cards client plugin, browser half.
 *
 * A card now lives in the assistant's own Markdown: a language-keyed fence
 * layer draws it exactly where the model wrote it, between explanatory
 * paragraphs. That replaces the old two-face design (a process-row node plus a
 * turn-tail copy): process rows fold away in every default display mode, and
 * the duplicate tail put every card at the end of the answer. Fences are part
 * of the persisted assistant text, so replay redraws the same card with no
 * Host round trip and no second source of truth.
 *
 * All card kinds share one renderer registry: `CardView` dispatches on the
 * spec's own `kind`, so adding a card type is a registration rather than a new
 * chat node contract.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the service merge for ctx.locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DRAW_KIND, FIGURE_KIND, FLOWCHART_KIND } from '@aisketch/cards-core'
import { FenceCard } from './FenceCard.tsx'
import { DrawCard } from './DrawCard.tsx'
import { FigureCard } from './FigureCard.tsx'
import { FlowchartCard } from './FlowchartCard.tsx'
import { registerCardRenderer } from './registry.ts'
import { en, NS, zh } from './locales.ts'

/** This implementation's identity in the renderer registry and fence slot. */
export const CARD_RENDERER_ID = '@aisketch/client-ui-cards'

/** Cordis service dependencies of this plugin. */
export const inject = ['locale', 'slots']

/**
 * Client plugin body: dictionaries, renderers, and the inline fence layer.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-cards: dictionaries')
  // Registered before the fence can render any card, and idempotent so a
  // re-applied plugin re-claims its kinds without a conflict.
  ctx.effect(
    () => registerCardRenderer(FLOWCHART_KIND, { id: CARD_RENDERER_ID, trust: 'native', component: FlowchartCard }),
    'client-ui-cards: flowchart renderer',
  )
  ctx.effect(
    () => registerCardRenderer(DRAW_KIND, { id: CARD_RENDERER_ID, trust: 'native', component: DrawCard }),
    'client-ui-cards: draw renderer',
  )
  ctx.effect(
    () => registerCardRenderer(FIGURE_KIND, { id: CARD_RENDERER_ID, trust: 'native', component: FigureCard }),
    'client-ui-cards: figure renderer',
  )
  // The only public face: a wildcard fence layer renders any JSON card spec in
  // place, so a bare ``` fence or ```json still draws. Non-card fences pass
  // through as their inner code block.
  ctx.slots.inject('conversation.chat.markdown.fence', () => ctx.slots.register({
    name: 'conversation.chat.markdown.fence', id: CARD_RENDERER_ID, locale: NS,
  }, FenceCard))
}

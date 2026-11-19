/**
 * AISketch client plugin, browser half.
 *
 * A plot is an inline `aisketch-plot` fence in the assistant's answer, so it
 * appears exactly where the model placed it between explanatory paragraphs.
 * The old toolview + turn-tail faces are gone: process rows fold away in the
 * default display modes and the tail detached every plot from its explanation.
 * The fence body is part of the persisted assistant message, so replay draws
 * the identical figure with no Host call.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the service merge for ctx.locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { NS, en, zh, type SketchKey } from './locales.ts'
import { FencePlot } from './FencePlot.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The AISketch plot card's copy. */
    sketch: SketchKey
  }
}

/** Cordis service dependencies of this plugin. */
export const inject = ['locale', 'slots']

/**
 * Client plugin body: dictionaries and the inline plot fence.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-sketch: dictionaries')
  ctx.slots.inject('conversation.chat.markdown.fence', () => ctx.slots.register({
    name: 'conversation.chat.markdown.fence', key: 'aisketch-plot', id: '@aisketch/client-ui-sketch',
  }, FencePlot))
}

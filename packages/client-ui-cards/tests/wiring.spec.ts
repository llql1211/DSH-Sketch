/**
 * Plugin wiring.
 *
 * This channel's failure mode is structural: a renderer claimed a kind but no
 * fence layer rendered the spec in the answer, so the picture never appeared in
 * the prose. Unit tests over either half stay green when the seam is missing,
 * so this spec drives the real `apply()` against a stub context and pins the
 * registration set itself.
 */
import { describe, expect, it } from 'vitest'
import { apply, CARD_RENDERER_ID, inject } from '../src/client/index.ts'
import { cardRendererKinds } from '../src/client/registry.ts'

/** Everything one `apply()` run registered, by kind. */
interface Wiring {
  readonly effects: readonly string[]
  readonly dictionaries: readonly string[]
  readonly eventKinds: readonly string[]
  readonly injectedSlots: readonly string[]
  readonly registeredSlots: readonly string[]
  readonly rendererKinds: readonly string[]
}

/** A stub client context that records every registration instead of performing it. */
function wire(): Wiring {
  const effects: string[] = []
  const dictionaries: string[] = []
  const eventKinds: string[] = []
  const injectedSlots: string[] = []
  const registeredSlots: string[] = []
  const ctx = {
    effect: (run: () => unknown, label: string) => {
      effects.push(label)
      const dispose = run()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale: {
      register: (namespace: string) => {
        dictionaries.push(namespace)
        return () => {}
      },
    },
    uiConversation: {
      events: {
        register: (definition: { readonly kind: string }) => {
          eventKinds.push(definition.kind)
          return () => {}
        },
      },
    },
    slots: {
      inject: (name: string, run: () => unknown) => {
        injectedSlots.push(name)
        run()
        return () => {}
      },
      register: (options: { readonly name: string; readonly key?: string; readonly id?: string; readonly locale?: string }) => {
        registeredSlots.push(`${options.name}/${options.key ?? options.id ?? '?'}`)
        // A component that reads `t` without a locale seat throws, and the
        // fence slot silently falls back to the raw code block.
        expect(options.locale).toBe('cards')
        return () => {}
      },
    },
  }
  apply(ctx as never)
  return { effects, dictionaries, eventKinds, injectedSlots, registeredSlots, rendererKinds: cardRendererKinds() }
}

describe('the inline fence is the only public face', () => {
  it('registers a wildcard fence layer so bare JSON fences still draw', () => {
    const wiring = wire()
    expect(wiring.registeredSlots).toContain(`conversation.chat.markdown.fence/${CARD_RENDERER_ID}`)
    expect(wiring.injectedSlots).toEqual(['conversation.chat.markdown.fence'])
  })

  it('does not register process-row or turn-tail duplicates', () => {
    const wiring = wire()
    expect(wiring.registeredSlots).not.toContain('conversation.chat.node/card')
    expect(wiring.registeredSlots).not.toContain(`conversation.chat.turnTail/${CARD_RENDERER_ID}`)
    expect(wiring.eventKinds).toEqual([])
  })
})

describe('the service gate', () => {
  it('declares every service the body reads', () => {
    expect([...inject].sort()).toEqual(['locale', 'slots'])
  })

  it('registers dictionaries and graphic renderers as effects', () => {
    const wiring = wire()
    expect(wiring.dictionaries).toEqual(['cards'])
    expect(wiring.effects).toEqual([
      'client-ui-cards: dictionaries',
      'client-ui-cards: flowchart renderer',
      'client-ui-cards: draw renderer',
      'client-ui-cards: figure renderer',
    ])
    expect(wiring.rendererKinds).toContain('flowchart')
    expect(wiring.rendererKinds).toContain('draw')
    expect(wiring.rendererKinds).toContain('figure')
    expect(wiring.rendererKinds).not.toContain('table')
  })
})

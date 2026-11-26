/**
 * The ref index behind compact `{"ref":...}` fences.
 *
 * A fence holds no copy of the card, so this Definition is the only bridge from
 * a persisted `tool/call` to the spec the public card renders. These tests drive
 * synthetic events through `match`/`start`/`update` exactly as the assembler
 * does, with arguments as the JSON text the event really carries.
 */
import { describe, expect, it } from 'vitest'
import { CARD_TOOL_NAME } from '@aisketch/cards-core'
import { cardByRef, cardRefDefinition } from '../src/client/card-refs.ts'

type SessionEventLike = Parameters<typeof cardRefDefinition.match>[0]
type StartMatch = Parameters<typeof cardRefDefinition.start>[1]

/** A synthetic session event. */
function event(type: string, seq: number, data: Record<string, unknown>): SessionEventLike {
  return { type, seq, time: seq, data } as unknown as SessionEventLike
}

/** A synthetic `tool/call` carrying JSON-text arguments. */
function callEvent(ref: string, args: unknown, seq = 7, name: string = CARD_TOOL_NAME): SessionEventLike {
  return event('tool/call', seq, {
    name, callId: ref, turn: 1, arguments: JSON.stringify(args),
  })
}

const drawArgs = { kind: 'draw', draft: true, payload: { elements: [{ type: 'path', d: 'M 0 0 L 10 10' }] } }

/** Index one event the way the assembler would. */
function index(source: SessionEventLike): void {
  const matched = cardRefDefinition.match(source)
  if (matched === null) throw new Error('the event was not claimed')
  const match = { event: source, role: matched.role } as unknown as StartMatch
  const context = { key: `card-ref:${matched.id}`, kind: 'card-ref', id: matched.id, matches: [match] } as unknown as Parameters<typeof cardRefDefinition.start>[0]
  const state = cardRefDefinition.start(context, match, {} as never)
  cardRefDefinition.update({ ...context, state } as never, match)
}

describe('the card ref definition', () => {
  it('claims only show_card tool calls, keyed on the call id', () => {
    expect(cardRefDefinition.match(callEvent('ref-match', drawArgs))).toEqual({ id: 'ref-match', role: 'start' })
    expect(cardRefDefinition.match(callEvent('ref-other', drawArgs, 7, 'sketch_function'))).toBeNull()
    expect(cardRefDefinition.match(event('tool/result', 8, { name: CARD_TOOL_NAME, callId: 'ref-match' }))).toBeNull()
  })

  it('indexes a private drawing draft so a fence can reuse its spec', () => {
    index(callEvent('ref-draft', drawArgs))
    expect(cardByRef('ref-draft')).toMatchObject({ kind: 'draw', version: 1 })
  })

  it('ignores a call whose arguments are not a card', () => {
    index(callEvent('ref-invalid', { hello: 'world' }))
    expect(cardByRef('ref-invalid')).toBeUndefined()
  })
})

/** Inline `aisketch` fence: parses a card spec and falls back to raw code. */
import { createElement } from 'react'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FenceCard } from '../src/client/FenceCard.tsx'
import { rememberCardRef } from '../src/client/card-refs.ts'
import { registerCardRenderer } from '../src/client/registry.ts'
import type { CardRendererProps } from '../src/client/registry.ts'

const t = ((key: string) => `[${key}]`) as unknown as CardRendererProps['t']
const View = FenceCard as unknown as ComponentType<Record<string, unknown>>
const claims: Array<() => void> = []

beforeEach(() => {
  claims.push(registerCardRenderer('note', {
    id: 'fence-test',
    trust: 'native',
    component: props => createElement('div', { 'data-kind': props.card.kind }),
  }))
})

afterEach(() => {
  for (const dispose of claims.splice(0)) dispose()
})

/** Render one fence body through the real layer. */
function render(code: string, streaming = false): string {
  return renderToStaticMarkup(createElement(View, {
    code, streaming, t, lang: 'aisketch', children: createElement('pre', null, code),
  }))
}

describe('an aisketch fence', () => {
  it('renders a valid spec as a card in place', () => {
    expect(render('{"kind":"note","payload":{}}')).toContain('data-kind="note"')
  })

  it('never publishes a private draft', () => {
    expect(render('{"kind":"note","payload":{},"draft":true}')).toContain('<pre>')
  })

  it('renders a ref-only fence from the spec remembered for that call', () => {
    rememberCardRef('fence-ref-1', { version: 1, kind: 'note', payload: {} }, 1)
    expect(render('{"ref":"fence-ref-1"}')).toContain('data-kind="note"')
  })

  it('leaves an unresolved ref as raw code', () => {
    expect(render('{"ref":"no-such-call"}')).toContain('<pre>')
  })

  it('still renders a full inline spec without any remembered call', () => {
    expect(render('{"kind":"note","payload":{}}')).toContain('data-kind="note"')
  })

  it('leaves an unrelated JSON fence as code', () => {
    expect(render('{"hello":"world"}')).toContain('<pre>')
  })

  it('keeps the raw code while the message streams', () => {
    expect(render('{"kind":"note"', true)).toContain('<pre>')
  })

  it('keeps the raw code when the body is malformed', () => {
    expect(render('{oops')).toContain('<pre>')
  })
})

/**
 * Inline function-plot fence: a plot sits exactly where the model wrote it in
 * the answer, between surrounding explanatory text. The payload is the same
 * compact spec the tool used, carried in the assistant message itself, so a
 * replayed session redraws it without a Host round trip.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { HocShare, PropsLocale, PropsRuntime, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import { SketchFigure } from './SketchFigure.tsx'
import { NS } from './locales.ts'
import { readFenceSpec } from './spec.ts'

/** Props of the `aisketch-plot` fence layer. */
export type FencePlotProps =
  PropsRuntime<'conversation.chat.markdown.fence'>
  & HocShare<SlotMap['conversation.chat.markdown.fence']>
  & PropsLocale<typeof NS>

/**
 * Render one `aisketch-plot` fence as a live plot in place.
 * @param props - fence code, streaming state, inner code block and locale.
 * @returns the figure, or the inner code block while streaming / on bad input.
 */
export function FencePlot({ code, streaming, children, t }: FencePlotProps): ReactNode {
  const spec = useMemo(
    () => streaming ? null : readFenceSpec(code),
    [code, streaming],
  )

  if (spec === null) return <>{children}</>
  return <SketchFigure spec={spec} t={t} />
}

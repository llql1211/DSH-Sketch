/** Test-only bridge from the DSH 0.1 single-call API to the 0.2 batch API. */
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolCallBlock } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

export function call(name: string, args: unknown): ToolCallBlock {
  return { type: 'tool-call', id: ToolCallId('c1'), name, arguments: JSON.stringify(args) }
}

export async function run(tools: unknown, input: ToolCallBlock, agent?: unknown): Promise<ToolExecutionResult> {
  const batch = await (tools as {
    execute(input: Record<string, unknown>): Promise<{
      results: readonly { readonly result: ToolExecutionResult }[]
    }>
  }).execute({
    calls: [input],
    signal: new AbortController().signal,
    ...agent === undefined ? {} : { agent },
  })
  const first = batch.results[0]
  if (first === undefined) throw new Error('tool batch returned no result')
  return first.result
}

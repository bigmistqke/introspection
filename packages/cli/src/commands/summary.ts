import type { TraceFile, TraceEvent } from '@introspection/types'

export function buildSummary(trace: TraceFile): string {
  const lines: string[] = []
  const { test, events } = trace

  lines.push(`Test: "${test.title}" — ${test.status.toUpperCase()} [${test.status}] (${test.duration}ms)`)
  if (test.error) lines.push(`Error: ${test.error}`)
  lines.push('')

  const actions = events.filter(e => e.type === 'playwright.action') as Array<{ data: { method: string; args: unknown[] } } & TraceEvent>
  if (actions.length) {
    lines.push(`Actions taken (${actions.length}):`)
    for (const a of actions) lines.push(`  ${a.data.method}(${a.data.args[0] ?? ''})`)
    lines.push('')
  }

  const responses = events.filter(e => e.type === 'network.response') as Array<{ data: { url: string; status: number } } & TraceEvent>
  const failed = responses.filter(r => r.data.status >= 400)
  if (failed.length) {
    lines.push(`Failed network requests (${failed.length}):`)
    for (const r of failed) lines.push(`  ${r.data.status} ${r.data.url}`)
    lines.push('')
  }

  const errors = events.filter(e => e.type === 'js.error') as Array<{ data: { message: string } } & TraceEvent>
  if (errors.length) {
    lines.push(`JS errors (${errors.length}):`)
    for (const e of errors) lines.push(`  ${e.data.message}`)
  }

  return lines.join('\n')
}

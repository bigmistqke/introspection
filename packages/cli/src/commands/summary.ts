import type { TraceFile, TraceEvent } from '@introspection/types'

export function buildSummary(trace: TraceFile): string {
  const lines: string[] = []
  const { session, events } = trace

  const label = session.label ?? session.id
  const duration = session.endedAt != null ? `${session.endedAt - session.startedAt}ms` : 'ongoing'
  lines.push(`Session: "${label}" (${duration})`)
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

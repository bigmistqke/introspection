import type { TraceFile, TraceEvent } from '../types.js'

export function buildSummary(trace: TraceFile): string {
  const lines: string[] = []
  const { session, events } = trace

  const label = session.label ?? session.id
  const duration = session.endedAt != null ? `${session.endedAt - session.startedAt}ms` : 'ongoing'
  lines.push(`Session: "${label}" (${duration})`)
  lines.push('')

  const actions = events.filter(event => event.type === 'playwright.action') as Array<{ data: { method: string; args: unknown[] } } & TraceEvent>
  if (actions.length) {
    lines.push(`Actions taken (${actions.length}):`)
    for (const action of actions) lines.push(`  ${action.data.method}(${action.data.args[0] ?? ''})`)
    lines.push('')
  }

  const responses = events.filter(event => event.type === 'network.response') as Array<{ data: { url: string; status: number } } & TraceEvent>
  const failed = responses.filter(response => response.data.status >= 400)
  if (failed.length) {
    lines.push(`Failed network requests (${failed.length}):`)
    for (const response of failed) lines.push(`  ${response.data.status} ${response.data.url}`)
    lines.push('')
  }

  const errors = events.filter(event => event.type === 'js.error') as Array<{ data: { message: string } } & TraceEvent>
  if (errors.length) {
    lines.push(`JS errors (${errors.length}):`)
    for (const error of errors) lines.push(`  ${error.data.message}`)
  }

  return lines.join('\n')
}

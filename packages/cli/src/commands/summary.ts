import type { TraceEvent } from '@introspection/types'
import type { SessionSummary } from '@introspection/read'

export function buildSummary(session: SessionSummary, events: TraceEvent[]): string {
  const lines: string[] = []

  const label = session.label ?? session.id
  const duration = session.endedAt != null ? `${session.endedAt - session.startedAt}ms` : 'ongoing'
  lines.push(`Session: "${label}" (${duration})`)
  lines.push('')

  const actions = events.filter((event): event is TraceEvent & { type: 'playwright.action' } => event.type === 'playwright.action')
  if (actions.length) {
    lines.push(`Actions taken (${actions.length}):`)
    for (const action of actions) lines.push(`  ${action.metadata.method}(${action.metadata.args[0] ?? ''})`)
    lines.push('')
  }

  const responses = events.filter((event): event is TraceEvent & { type: 'network.response' } => event.type === 'network.response')
  const failed = responses.filter(response => response.metadata.status >= 400)
  if (failed.length) {
    lines.push(`Failed network requests (${failed.length}):`)
    for (const response of failed) lines.push(`  ${response.metadata.status} ${response.metadata.url}`)
    lines.push('')
  }

  const errors = events.filter((event): event is TraceEvent & { type: 'js.error' } => event.type === 'js.error')
  if (errors.length) {
    lines.push(`JS errors (${errors.length}):`)
    for (const error of errors) lines.push(`  ${error.metadata.message}`)
  }

  return lines.join('\n')
}

import type { SessionSummary } from '@introspection/read'

/** Renders a plain-text table of sessions within a run, newest first. */
export function formatSessionsTable(sessions: SessionSummary[]): string {
  return sessions
    .map(session => {
      const project = session.project ?? '-'
      const status = session.status ?? 'running'
      const duration = session.duration != null ? `${session.duration}ms` : 'ongoing'
      return `${session.id.padEnd(40)}  ${project.padEnd(16)}  ${status.padEnd(10)}  ${duration}`
    })
    .join('\n')
}

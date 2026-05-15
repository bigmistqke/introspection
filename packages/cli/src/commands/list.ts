import type { TraceSummary } from '@introspection/read'

/** Renders a plain-text table of traces within a run, newest first. */
export function formatTracesTable(traces: TraceSummary[]): string {
  return traces
    .map(trace => {
      const project = trace.project ?? '-'
      const status = trace.status ?? 'running'
      const duration = trace.duration != null ? `${trace.duration}ms` : 'ongoing'
      return `${trace.id.padEnd(40)}  ${project.padEnd(16)}  ${status.padEnd(10)}  ${duration}`
    })
    .join('\n')
}

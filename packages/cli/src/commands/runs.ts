import type { RunSummary } from '@introspection/read'

/** Renders a plain-text table of runs, newest first (caller passes them pre-sorted). */
export function formatRunsTable(runs: RunSummary[]): string {
  return runs
    .map(run => {
      const status = run.status ?? 'running'
      const branch = run.branch ?? '-'
      const started = new Date(run.startedAt).toISOString()
      const count = `${run.sessionCount} session${run.sessionCount === 1 ? '' : 's'}`
      return `${run.id.padEnd(28)}  ${status.padEnd(8)}  ${branch.padEnd(16)}  ${started}  ${count}`
    })
    .join('\n')
}

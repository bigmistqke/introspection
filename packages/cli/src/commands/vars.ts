import type { TraceFile } from '@introspection/types'

export function formatVars(trace: TraceFile): string {
  const snapshot = trace.snapshots?.['on-error']
  if (!snapshot) return '(no error snapshot — test may have passed, or snapshot was not captured)'
  const lines: string[] = [`Scope chain at ${snapshot.trigger} (${snapshot.url}):\n`]
  for (const scope of snapshot.scopes) {
    lines.push(`  ${scope.frame}`)
    for (const [k, v] of Object.entries(scope.vars)) {
      lines.push(`    ${k} = ${JSON.stringify(v)}`)
    }
  }
  if (Object.keys(snapshot.globals).length) {
    lines.push('\nGlobals:')
    for (const [k, v] of Object.entries(snapshot.globals)) lines.push(`  ${k} = ${JSON.stringify(v)}`)
  }
  return lines.join('\n')
}

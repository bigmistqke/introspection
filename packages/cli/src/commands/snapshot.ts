import type { TraceFile, AssetEvent } from '@introspection/types'

export function formatSnapshot(trace: TraceFile): string {
  const assetEvents = trace.events.filter((e): e is AssetEvent => e.type === 'asset' && e.data.kind === 'snapshot')
  const preferred = assetEvents.find(e => e.data.trigger === 'js.error') ?? assetEvents[0]
  const snapshot = preferred ? trace.snapshots?.[preferred.data.path.replace(/\.snapshot\.json$/, '')] : undefined
  if (!snapshot) return '(no snapshot — session may have ended cleanly, or snapshot was not captured)'
  const lines: string[] = [`Scope chain at ${snapshot.trigger} (${snapshot.url}):\n`]
  for (const scope of snapshot.scopes) {
    lines.push(`  ${scope.frame}`)
    for (const [k, v] of Object.entries(scope.locals)) {
      lines.push(`    ${k} = ${JSON.stringify(v)}`)
    }
  }
  if (Object.keys(snapshot.globals).length) {
    lines.push('\nGlobals:')
    for (const [k, v] of Object.entries(snapshot.globals)) lines.push(`  ${k} = ${JSON.stringify(v)}`)
  }
  return lines.join('\n')
}

import type { TraceFile } from '@introspection/types'

export function formatDom(trace: TraceFile): string {
  const snapshot = trace.snapshots.find(s => s.trigger === 'js.error') ?? trace.snapshots[0]
  if (!snapshot?.dom) return '(no DOM snapshot available)'
  return snapshot.dom
}

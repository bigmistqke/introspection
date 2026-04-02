import type { TraceFile } from '@introspection/types'

export function formatDom(trace: TraceFile): string {
  const snapshot = trace.snapshots?.['on-error']
  if (!snapshot?.dom) return '(no DOM snapshot available)'
  return snapshot.dom
}

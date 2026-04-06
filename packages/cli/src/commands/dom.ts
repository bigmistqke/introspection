import type { TraceFile } from '@introspection/types'
import { selectSnapshot } from '../format.js'

export function formatDom(trace: TraceFile, filter?: string): string {
  const snapshot = selectSnapshot(trace.snapshots, filter)
  if (!snapshot?.dom) return '(no DOM snapshot available)'
  return snapshot.dom
}

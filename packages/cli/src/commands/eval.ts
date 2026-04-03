import { runInNewContext } from 'vm'
import type { TraceFile } from '@introspection/types'

export function evalExpression(trace: TraceFile, expression: string): string {
  const ctx = { events: trace.events, snapshots: trace.snapshots, session: trace.session }
  const raw = runInNewContext(expression, ctx)
  return JSON.stringify(raw ?? null, null, 2)
}

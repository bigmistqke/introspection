import { use, useRef } from 'react'
import { createTraceReader, type StorageAdapter } from '@introspection/read'
import type { TraceReader, TraceEvent } from '@introspection/types'

export function useTraceReader(adapter: StorageAdapter, traceId: string) {
  // Use refs to keep promises stable across Suspense re-mounts. useMemo is
  // not guaranteed to survive when React unmounts/remounts inside a Suspense
  // boundary, which would create new fetch chains and cause infinite suspense.
  const traceRef = useRef<{ id: string; promise: Promise<TraceReader> } | null>(null)
  if (traceRef.current === null || traceRef.current.id !== traceId) {
    traceRef.current = { id: traceId, promise: createTraceReader(adapter, { traceId }) }
  }
  const trace = use(traceRef.current.promise)

  const eventsRef = useRef<{ trace: TraceReader; promise: Promise<TraceEvent[]> } | null>(null)
  if (eventsRef.current === null || eventsRef.current.trace !== trace) {
    eventsRef.current = { trace, promise: trace.events.ls() }
  }
  const events = use(eventsRef.current.promise)

  return { trace, events }
}

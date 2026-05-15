import { use, useRef } from 'react'
import { createSessionReader, type StorageAdapter } from '@introspection/read'
import type { SessionReader, TraceEvent } from '@introspection/types'

export function useSessionReader(adapter: StorageAdapter, sessionId: string) {
  // Use refs to keep promises stable across Suspense re-mounts. useMemo is
  // not guaranteed to survive when React unmounts/remounts inside a Suspense
  // boundary, which would create new fetch chains and cause infinite suspense.
  const sessionRef = useRef<{ id: string; promise: Promise<SessionReader> } | null>(null)
  if (sessionRef.current === null || sessionRef.current.id !== sessionId) {
    sessionRef.current = { id: sessionId, promise: createSessionReader(adapter, { sessionId }) }
  }
  const session = use(sessionRef.current.promise)

  const eventsRef = useRef<{ session: SessionReader; promise: Promise<TraceEvent[]> } | null>(null)
  if (eventsRef.current === null || eventsRef.current.session !== session) {
    eventsRef.current = { session, promise: session.events.ls() }
  }
  const events = use(eventsRef.current.promise)

  return { session, events }
}

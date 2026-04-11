import { use, useMemo } from 'react'
import { createSessionReader, type StorageAdapter } from '@introspection/read'
import type { TraceEvent } from '@introspection/types'

export function useSessionReader(adapter: StorageAdapter, sessionId: string) {
  const sessionPromise = useMemo(() => createSessionReader(adapter, { sessionId }), [sessionId])
  const session = use(sessionPromise)

  const eventsPromise = useMemo(() => session.events.ls(), [session])
  const events = use(eventsPromise)

  return { session, events }
}

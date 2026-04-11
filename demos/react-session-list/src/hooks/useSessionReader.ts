import { useState, useEffect } from 'react'
import { createSessionReader, type StorageAdapter, type SessionReader } from '@introspection/read'
import type { TraceEvent } from '@introspection/types'

export function useSessionReader(adapter: StorageAdapter, sessionId: string) {
  const [session, setSession] = useState<SessionReader | null>(null)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    createSessionReader(adapter, sessionId).then(async (reader) => {
      setSession(reader)
      const allEvents = await reader.events.ls()
      setEvents(allEvents)
      setLoading(false)
    })
  }, [sessionId])

  return { session, events, loading }
}

import { createSignal, onCleanup, createEffect, on, type Accessor } from 'solid-js'
import type { TraceEvent, SessionReader } from '@introspection/types'

/**
 * Connects an EventSource (SSE) to a SessionReader, pushing events as they arrive.
 * Automatically connects when the session becomes available.
 */
export function useEventSource(
  url: string,
  getSession: Accessor<SessionReader | undefined>,
) {
  const [status, setStatus] = createSignal<'connecting' | 'connected' | 'done' | 'error'>('connecting')
  let source: EventSource | null = null

  function connect() {
    if (source) source.close()
    setStatus('connecting')

    source = new EventSource(url)

    source.addEventListener('open', () => {
      setStatus('connected')
    })

    source.addEventListener('message', (message) => {
      const event = JSON.parse(message.data) as TraceEvent
      getSession()?.events.push(event)
    })

    source.addEventListener('done', () => {
      setStatus('done')
      source?.close()
      source = null
    })

    source.addEventListener('error', () => {
      setStatus('error')
      source?.close()
      source = null
    })
  }

  // Auto-connect when session is available
  createEffect(on(getSession, (session) => {
    if (session) connect()
  }))

  onCleanup(() => {
    source?.close()
  })

  return { status, connect }
}

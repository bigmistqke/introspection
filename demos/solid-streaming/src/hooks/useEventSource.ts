import { createSignal, onCleanup, type Accessor } from 'solid-js'
import type { TraceEvent, SessionReader } from '@introspection/types'

/**
 * Connects an EventSource (SSE) to a SessionReader, pushing events as they arrive.
 */
export function useEventSource(
  url: string,
  getSession: Accessor<SessionReader | undefined>,
) {
  const [status, setStatus] = createSignal<'idle' | 'connected' | 'done' | 'error'>('idle')
  let source: EventSource | null = null

  function connect() {
    if (source) source.close()
    setStatus('connected')

    source = new EventSource(url)

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

  onCleanup(() => {
    source?.close()
  })

  return { status, connect }
}

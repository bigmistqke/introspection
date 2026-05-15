import { createSignal, onCleanup, createEffect, on, type Accessor } from 'solid-js'
import type { TraceEvent, TraceReader } from '@introspection/types'

/**
 * Connects an EventSource (SSE) to a TraceReader, pushing events as they arrive.
 * Automatically connects when the trace becomes available.
 */
export function useEventSource(
  getUrl: Accessor<string | null>,
  getTrace: Accessor<TraceReader | undefined>,
) {
  const [status, setStatus] = createSignal<'connecting' | 'connected' | 'done' | 'error'>('connecting')
  let source: EventSource | null = null

  function connect() {
    const url = getUrl()
    if (!url) return
    if (source) source.close()
    setStatus('connecting')

    source = new EventSource(url)

    source.addEventListener('open', () => {
      setStatus('connected')
    })

    source.addEventListener('message', (message) => {
      const event = JSON.parse(message.data) as TraceEvent
      getTrace()?.events.push(event)
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

  // Auto-connect when trace is available
  createEffect(on(getTrace, (trace) => {
    if (trace) connect()
  }))

  onCleanup(() => {
    source?.close()
  })

  return { status, connect }
}

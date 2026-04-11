import { createSignal, For, Show, onCleanup } from 'solid-js'
import type { TraceEvent } from '@introspection/types'

const COLORS: Record<string, string> = {
  'playwright.action': '#6c9cfc',
  'network.request': '#8bc38b',
  'network.response': '#59a359',
  'network.error': '#fc6c6c',
  'js.error': '#fc6c6c',
  'console': '#fcb86c',
  'playwright.result': '#c084fc',
  'browser.navigate': '#e0e0e0',
}

function formatEvent(event: TraceEvent): string {
  const data = (event as Record<string, unknown>).data as Record<string, unknown>
  switch (event.type) {
    case 'playwright.action':
      return `${data.method}(${(data.args as unknown[]).map(argument => JSON.stringify(argument)).join(', ')})`
    case 'network.request':
    case 'network.response':
      return `${data.method ?? data.status ?? ''} ${data.url}`
    case 'js.error':
      return String(data.message ?? '')
    case 'console':
      return `[${data.level}] ${data.message}`
    case 'playwright.result':
      return `${data.status} (${data.duration}ms)`
    case 'browser.navigate':
      return `${data.from} → ${data.to}`
    default:
      return ''
  }
}

function useEventStream(url: string) {
  const [events, setEvents] = createSignal<TraceEvent[]>([])
  const [status, setStatus] = createSignal<'idle' | 'connected' | 'done' | 'error'>('idle')
  let source: EventSource | null = null

  function connect() {
    if (source) source.close()
    setEvents([])
    setStatus('connected')

    source = new EventSource(url)

    source.addEventListener('message', (message) => {
      const event = JSON.parse(message.data) as TraceEvent
      setEvents(previous => [...previous, event])
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

  return { events, status, connect }
}

export default function App() {
  const { events, status, connect } = useEventStream('/events')
  const [selected, setSelected] = createSignal<TraceEvent | null>(null)

  return (
    <>
      <div class="controls">
        <button onClick={connect}>
          {status() === 'idle' ? 'Connect' : 'Reconnect'}
        </button>
        <span class="status" classList={{ live: status() === 'connected' }}>
          {status()}
        </span>
        <span class="count">{events().length} events</span>
      </div>
      <div class="layout">
        <div class="timeline">
          <For each={events()}>
            {(event) => (
              <div
                class="event"
                classList={{ selected: selected() === event }}
                onClick={() => setSelected(event)}
              >
                <span class="timestamp">{event.timestamp}ms</span>
                <span>
                  <span class="type" style={{ color: COLORS[event.type] ?? '#888' }}>
                    {event.type}
                  </span>
                  <span class="summary"> {formatEvent(event)}</span>
                </span>
              </div>
            )}
          </For>
        </div>
        <div class="detail">
          <Show when={selected()} fallback={<span class="empty">Select an event</span>}>
            {(event) => {
              const data = (event() as Record<string, unknown>).data
              return (
                <>
                  <h3>{event().type}</h3>
                  <div class="field">
                    <div class="label">Timestamp</div>
                    <div class="value">{event().timestamp}ms</div>
                  </div>
                  <div class="field">
                    <div class="label">Source</div>
                    <div class="value">{event().source}</div>
                  </div>
                  <Show when={event().initiator}>
                    <div class="field">
                      <div class="label">Initiator</div>
                      <div class="value">{event().initiator}</div>
                    </div>
                  </Show>
                  <div class="field">
                    <div class="label">Data</div>
                    <pre>{JSON.stringify(data, null, 2)}</pre>
                  </div>
                </>
              )
            }}
          </Show>
        </div>
      </div>
    </>
  )
}

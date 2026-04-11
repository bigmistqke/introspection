import { createSignal, For, Show, onCleanup, createResource, Suspense, createEffect, on, type Accessor } from 'solid-js'
import type { TraceEvent, SessionReader, EventsFilter } from '@introspection/types'
import { createSessionReader } from '@introspection/read'
import { createFetchAdapter } from '@introspection/demo-shared/fetch-adapter'

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
  switch (event.type) {
    case 'playwright.action':
      return `${event.data.method}(${event.data.args.map(argument => JSON.stringify(argument)).join(', ')})`
    case 'network.request':
      return `${event.data.method} ${event.data.url}`
    case 'network.response':
      return `${event.data.status} ${event.data.url}`
    case 'js.error':
      return event.data.message
    case 'console':
      return `[${event.data.level}] ${event.data.message}`
    case 'playwright.result':
      return `${event.data.status ?? 'unknown'} (${event.data.duration}ms)`
    case 'browser.navigate':
      return `${event.data.from} → ${event.data.to}`
    default:
      return ''
  }
}

/**
 * Bridges a SessionReader's query.watch() AsyncIterable into a Solid signal.
 * Re-subscribes when the session accessor changes.
 */
function useWatchedQuery(
  getSession: Accessor<SessionReader | undefined>,
  filter?: EventsFilter,
) {
  const [events, setEvents] = createSignal<TraceEvent[]>([])

  createEffect(on(getSession, (session) => {
    if (!session) {
      setEvents([])
      return
    }

    const iterable = filter
      ? session.events.query.watch(filter)
      : session.events.ls.watch()

    const iterator = iterable[Symbol.asyncIterator]()
    let stopped = false

    async function consume() {
      while (!stopped) {
        const result = await iterator.next()
        if (result.done) break
        setEvents(result.value)
      }
    }
    consume()

    onCleanup(() => {
      stopped = true
      iterator.return?.()
    })
  }))

  return events
}

/**
 * Connects an EventSource (SSE) to a SessionReader, pushing events as they arrive.
 */
function useEventSource(
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

export default function App() {
  const adapter = createFetchAdapter('/__introspect')
  const [session] = createResource(() => createSessionReader(adapter))

  return (
    <Suspense fallback={<p style={{ color: '#666' }}>Loading session...</p>}>
      <SessionView session={session()} />
    </Suspense>
  )
}

function SessionView(props: { session?: SessionReader }) {
  const [selected, setSelected] = createSignal<TraceEvent | null>(null)
  const getSession = () => props.session

  const { status, connect } = useEventSource('/events', getSession)

  const allEvents = useWatchedQuery(getSession)
  const errors = useWatchedQuery(getSession, { type: 'js.error' })
  const networkEvents = useWatchedQuery(getSession, { type: ['network.request', 'network.response'] })

  return (
    <>
      <div class="controls">
        <button onClick={connect}>
          {status() === 'idle' ? 'Connect' : 'Reconnect'}
        </button>
        <span class="status" classList={{ live: status() === 'connected' }}>
          {status()}
        </span>
        <span class="count">{allEvents().length} events</span>
        <span class="count">{networkEvents().length} network</span>
        <Show when={errors().length > 0}>
          <span class="count error-count">{errors().length} errors</span>
        </Show>
      </div>
      <div class="layout">
        <div class="timeline">
          <For each={allEvents()}>
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
            {(event) => (
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
                    <pre>{JSON.stringify(event().data, null, 2)}</pre>
                  </div>
                </>
              )}
          </Show>
        </div>
      </div>
    </>
  )
}

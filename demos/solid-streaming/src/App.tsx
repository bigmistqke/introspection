import { createSignal, For, Show, createResource, Suspense } from 'solid-js'
import type { TraceEvent, SessionReader } from '@introspection/types'
import { createSessionReader } from '@introspection/read'
import { createFetchAdapter } from '@introspection/demo-shared/fetch-adapter'
import { useWatchedQuery } from './hooks/useWatchedQuery.js'
import { useEventSource } from './hooks/useEventSource.js'
import { useAssetContent } from './hooks/useAssetContent.js'

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

export default function App() {
  const adapter = createFetchAdapter('/__introspect')
  const [session] = createResource(async () => {
    try {
      return await createSessionReader(adapter, { verbose: true })
    } catch {
      return null
    }
  })

  return (
    <Suspense fallback={<p style={{ color: '#666' }}>Loading session...</p>}>
      <Show when={session() !== null} fallback={
        <p style={{ color: '#fc6c6c' }}>
          No sessions found in .introspect/ — run a test first to generate session data.
        </p>
      }>
        <SessionView session={session()!} />
      </Show>
    </Suspense>
  )
}

function SessionView(props: { session?: SessionReader }) {
  const [selected, setSelected] = createSignal<TraceEvent | null>(null)

  const { status, connect } = useEventSource('/events', () => props.session)

  const allEvents = useWatchedQuery(() => props.session)
  const errors = useWatchedQuery(() => props.session, { type: 'js.error' })
  const networkEvents = useWatchedQuery(() => props.session, { type: ['network.request', 'network.response'] })
  const assets = useAssetContent(() => props.session)

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
        <Show when={assets().length > 0}>
          <span class="count">{assets().length} assets</span>
        </Show>
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
      <Show when={assets().length > 0}>
        <div class="assets">
          <h3>Assets ({assets().length})</h3>
          <For each={assets()}>
            {(asset) => (
              <div class="asset-card">
                <div class="asset-header">
                  <span class="asset-kind">{asset.event.data.kind}</span>
                  <span class="asset-path">{asset.event.data.path}</span>
                  <Show when={asset.event.data.size}>
                    <span class="asset-size">{((asset.event.data.size ?? 0) / 1024).toFixed(1)}KB</span>
                  </Show>
                </div>
                <Show when={asset.loading}>
                  <span class="asset-loading">Loading...</span>
                </Show>
                <Show when={!asset.loading && asset.content !== null}>
                  <pre class="asset-content">{asset.content}</pre>
                </Show>
                <Show when={!asset.loading && asset.content === null && asset.event.data.contentType === 'image'}>
                  <span class="asset-binary">Binary asset ({asset.event.data.kind})</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  )
}

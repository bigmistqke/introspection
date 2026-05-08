import { createFetchAdapter } from "@introspection/demo-shared/fetch-adapter";
import { createSessionReader } from "@introspection/read";
import type { PayloadRef, SessionReader, TraceEvent } from "@introspection/types";
import { createResource, createSignal, For, Show } from "solid-js";
import { useAssetContent } from "./hooks/useAssetContent.js";
import { useEventSource } from "./hooks/useEventSource.js";
import { useWatchedQuery } from "./hooks/useWatchedQuery.js";

const VERBOSE = false;

const COLORS: Record<string, string> = {
  "playwright.action": "#6c9cfc",
  "playwright.result": "#c084fc",
  "playwright.screenshot": "#c084fc",
  "network.request": "#8bc38b",
  "network.response": "#59a359",
  "network.error": "#fc6c6c",
  "js.error": "#fc6c6c",
  "console": "#fcb86c",
  "browser.navigate": "#e0e0e0",
  "page.attach": "#888",
  "page.detach": "#888",
  "solid.detected": "#4c8dff",
  "solid.structure": "#4c8dff",
  "solid.warning": "#fcb86c",
};

function formatEvent(event: TraceEvent): string {
  switch (event.type) {
    case "playwright.action":
      return `${event.metadata.method}(${event.metadata.args.map((argument) => JSON.stringify(argument)).join(", ")})`;
    case "network.request":
      return `${event.metadata.method} ${event.metadata.url}`;
    case "network.response":
      return `${event.metadata.status} ${event.metadata.url}`;
    case "js.error":
      return event.metadata.message;
    case "console":
      return `[${event.metadata.level}] ${event.metadata.args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
    case "playwright.result":
      return `${event.metadata.status ?? "unknown"} (${event.metadata.duration}ms)`;
    case "browser.navigate":
      return `${event.metadata.from} → ${event.metadata.to}`;
    default:
      return "";
  }
}

const adapter = createFetchAdapter("/__introspect");

export default function App() {
  const [session] = createResource(() =>
    createSessionReader(adapter, { verbose: VERBOSE }),
  );

  return (
    <Show
      when={session()}
      fallback={<p style={{ color: "#666" }}>Connecting...</p>}
    >
      <SessionView session={session()} />
    </Show>
  );
}

function SessionView(props: { session?: SessionReader }) {
  const [selected, setSelected] = createSignal<TraceEvent | null>(null);

  const { status } = useEventSource(
    () => props.session ? `/__introspect/${props.session.id}/events?sse` : null,
    () => props.session,
  );

  const allEvents = useWatchedQuery(() => props.session, undefined, {
    verbose: VERBOSE,
  });
  const errors = useWatchedQuery(
    () => props.session,
    { type: "js.error" },
    { verbose: VERBOSE },
  );
  const networkEvents = useWatchedQuery(
    () => props.session,
    { type: ["network.request", "network.response"] },
    { verbose: VERBOSE },
  );
  const assets = useAssetContent(() => props.session);

  return (
    <>
      <div class="controls">
        <span class="status" classList={{ live: status() === "connected" }}>
          {status()}
        </span>
        <span class="count">{allEvents.length} events</span>
        <span class="count">{networkEvents.length} network</span>
        <Show when={assets().length > 0}>
          <span class="count">{assets().length} assets</span>
        </Show>
        <Show when={errors.length > 0}>
          <span class="count error-count">{errors.length} errors</span>
        </Show>
      </div>
      <div class="layout">
        <div class="timeline">
          <For each={[...allEvents].reverse()}>
            {(event) => (
              <div
                class="event"
                classList={{ selected: selected() === event }}
                onClick={() => setSelected(event)}
              >
                <span class="timestamp">{event.timestamp}ms</span>
                <span>
                  <span
                    class="type"
                    style={{ color: COLORS[event.type] ?? "#888" }}
                  >
                    {event.type}
                  </span>
                  <span class="summary"> {formatEvent(event)}</span>
                  <Show when={event.payloads && Object.keys(event.payloads).length > 0}>
                    <span class="event-assets">
                      <For each={Object.entries(event.payloads ?? {})}>
                        {([name, ref]) => (
                          <span class="event-asset-chip">
                            {name}: {ref.kind === 'asset' ? ref.path : 'inline'}
                          </span>
                        )}
                      </For>
                    </span>
                  </Show>
                  <span class="event-id">{event.id.slice(0, 8)}</span>
                </span>
              </div>
            )}
          </For>
        </div>
        <div class="detail">
          <Show
            when={selected()}
            fallback={<span class="empty">Select an event</span>}
          >
            {(event) => (
              <>
                <h3>{event().type}</h3>
                <div class="field">
                  <div class="label">ID</div>
                  <div class="value">{event().id}</div>
                </div>
                <div class="field">
                  <div class="label">Timestamp</div>
                  <div class="value">{event().timestamp}ms</div>
                </div>
                <Show when={event().initiator}>
                  <div class="field">
                    <div class="label">Initiator</div>
                    <div class="value">{event().initiator}</div>
                  </div>
                </Show>
                <Show when={event().metadata}>
                  <div class="field">
                    <div class="label">Metadata</div>
                    <pre>{JSON.stringify(event().metadata, null, 2)}</pre>
                  </div>
                </Show>
                <Show when={event().payloads && Object.keys(event().payloads!).length > 0}>
                  <For each={Object.entries(event().payloads ?? {})}>
                    {([name, ref]) => <AssetPreview session={props.session} name={name} ref={ref} />}
                  </For>
                </Show>
              </>
            )}
          </Show>
        </div>
      </div>
    </>
  );
}

function AssetPreview(props: { session?: SessionReader; name: string; ref: PayloadRef }) {
  const assetUrl = () =>
    props.ref.kind === 'asset'
      ? `/__introspect/${props.session?.id}/${props.ref.path}`
      : null

  const isImage = () => props.ref.kind === 'asset' && props.ref.format === 'image'

  const [content] = createResource(
    () => props.ref,
    (ref) => {
      if (!props.session) return null
      if (ref.kind === 'inline') return String(ref.value)
      if (ref.format === 'image') return null
      return props.session.resolvePayload(ref) as Promise<string>
    },
  )

  return (
    <div class="field">
      <div class="label">{props.name} ({props.ref.kind === 'asset' ? props.ref.format : 'inline'})</div>
      <Show when={isImage() && assetUrl()}>
        <img src={assetUrl()!} class="asset-image" />
      </Show>
      <Show when={content.loading}>
        <span class="asset-loading">Loading asset...</span>
      </Show>
      <Show when={content()}>
        {(text) => <pre class="asset-content">{text()}</pre>}
      </Show>
    </div>
  )
}

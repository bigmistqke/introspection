import { createFetchAdapter } from "@introspection/demo-shared/fetch-adapter";
import { createSessionReader } from "@introspection/read";
import type { AssetRef, SessionReader, TraceEvent } from "@introspection/types";
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
      return `${event.data.method}(${event.data.args.map((argument) => JSON.stringify(argument)).join(", ")})`;
    case "network.request":
      return `${event.data.method} ${event.data.url}`;
    case "network.response":
      return `${event.data.status} ${event.data.url}`;
    case "js.error":
      return event.data.message;
    case "console":
      return `[${event.data.level}] ${event.data.message}`;
    case "playwright.result":
      return `${event.data.status ?? "unknown"} (${event.data.duration}ms)`;
    case "browser.navigate":
      return `${event.data.from} → ${event.data.to}`;
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

  const { status } = useEventSource("/events", () => props.session);

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
                <Show when={event().assets && event().assets!.length > 0}>
                  <For each={event().assets}>
                    {(asset) => <AssetPreview session={props.session} asset={asset} />}
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

function AssetPreview(props: { session?: SessionReader; asset: AssetRef }) {
  const assetUrl = () => `/__introspect/stream/${props.asset.path}`

  const [content] = createResource(
    () => props.asset.path,
    (path) => {
      if (!props.session) return null
      if (props.asset.contentType === 'image') return null
      return props.session.assets.readText(path)
    },
  )

  return (
    <div class="field">
      <div class="label">{props.asset.kind} ({props.asset.contentType})</div>
      <Show when={props.asset.contentType === 'image'}>
        <img src={assetUrl()} class="asset-image" />
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

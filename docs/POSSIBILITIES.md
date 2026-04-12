# Future Plugin Possibilities

## Performance Event Processing / Summarization

Post-processing layer that takes raw `plugin-performance` events and produces structured diagnostics — e.g. "LCP was 4.2s, LCP element was `<img src="hero.jpg">`, blocked by 3 render-blocking scripts totaling 1.8s". Could be a CLI command or a separate analysis step.

## plugin-network: capture bodies we currently miss

The two-phase emit (`network.response` always, `network.response.body` when `Network.loadingFinished` fires) leaves several classes of responses without a body event. Each has a different fix.

### Streaming responses (SSE, long-polling, chunked-no-end)

For responses that never terminate, `Network.getResponseBody` isn't usable — but we could emit body *chunks* as they arrive.

- Listen to `Network.dataReceived` (fires per chunk with byte counts) plus `Network.streamResourceContent` (returns the received buffer on demand) or `Network.getResponseBodyForInterception`.
- Emit `network.response.body.chunk` events as data arrives, each linked to the response via `initiator`, with a sequence number.
- On `loadingFinished` (if it ever fires), emit a final `network.response.body` marking completion.
- Requires thinking about backpressure: a 1GB download shouldn't buffer 1GB of events in memory. Cap chunk emission (e.g. first N bytes, or first N chunks) and set a `truncated: true` flag.

### Routed requests (Playwright `route.fulfill` / Fetch.fulfillRequest)

`Network.getResponseBody` returns "No data found" because the body was supplied at the Fetch layer. Options:

- **Enable Fetch domain alongside Network**: `Fetch.enable` + listen to `Fetch.requestPaused` and `Fetch.responseReceived`. Call `Fetch.getResponseBody` on the pausedRequestId. Requires careful coordination with Playwright, which already uses Fetch for routing — taking over `Fetch.enable` on the same CDP session might break `page.route()`. Probably needs a second CDP session.
- **Intercept at the Playwright layer**: hook into `page.route` / `request.postData` / `response.body()` to capture fulfilled bodies directly. Simpler but couples plugin-network to Playwright semantics.

### Cached responses (304, disk cache hits)

Some cached responses don't fire `loadingFinished`, or fire it with no retrievable body. Detection: check `response.fromDiskCache`, `response.fromServiceWorker`, `response.fromPrefetchCache` in `responseReceived.params`. For these, we could emit a `network.response.body` with `metadata: { fromCache: true }` and no asset, so readers know the response has no body to fetch.

### Unread bodies (fetch without consume)

If page code does `fetch(url)` and never reads the body, Chromium may keep the stream open and never fire `loadingFinished`. This hit us in our own tests — we had to rewrite `.evaluate(() => fetch(url))` to `.evaluate(async () => { await fetch(url).then(r => r.text()) })` to make the test pass.

Possible mitigation: treat this the same as streaming (emit what we have via `dataReceived` / `streamResourceContent`). Or document more prominently that user code must consume bodies for full capture. Or — most invasive — inject a page-side wrapper around `fetch` / `XMLHttpRequest.onload` that forces a body read when the consumer doesn't.

### WebSocket upgrades

HTTP 101 Switching Protocols — the request completes successfully but the connection is now a WebSocket. `plugin-network` currently emits a `network.response` for the upgrade (status 101, no body event, correct). Consider a companion `plugin-websocket` that picks up where `plugin-network` stops: listens to `Network.webSocketFrameSent` / `webSocketFrameReceived` and emits them as trace events linked to the upgrade response via `initiator`.

### Request body: large uploads

`Network.requestWillBeSent` only includes `postData` if the body is under 64KB. For larger uploads (`hasPostData: true` with no `postData`), call `Network.getRequestPostData` — async, gives the full payload. Same two-phase pattern as responses: emit `network.request` immediately, emit `network.request.body` when we've fetched the payload.

## Observability: silent failures hide bugs

Several hot paths catch-and-swallow errors so aggressively that real bugs look like "just nothing captured." Consider emitting a structured warning event (e.g. `introspect.warning`) when these fall through, so readers can distinguish "the feature didn't exist" from "it broke":

- **CDP command failures** — `packages/playwright/src/attach.ts` has `.catch(() => {})` around subscription re-apply, unwatch, and `cdp.detach()`. A transient CDP disconnect after navigation silently loses all plugin subscriptions.
- **Write queue swallowed errors** — `packages/write/src/session.ts:18` turns write failures into `Promise.resolve()`. `ENOSPC`/`EACCES` during `appendEvent` disappears; `session.flush()` returns "successfully."
- **Plugin push parse errors** — `packages/playwright/src/attach.ts` (push bridge) does `catch { /* malformed push — ignore */ }`. A plugin emitting bad JSON produces no events with no clue why.
- **Redux serialization** — `plugin-redux/src/index.ts` silently drops `stateBefore`/`stateAfter`/`payload` if `JSON.stringify` throws (circular refs, BigInt, etc.).
- **Debugger scope collection** — `plugin-debugger/src/index.ts` silently skips scopes where `Runtime.getProperties` fails, so partial capture looks identical to full capture.

## Hard limits and backpressure

Several plugins buffer or emit data with no upper bound. Fine for small tests, hazardous for long/complex sessions:

- **Debugger scope truncation is hardcoded** — `plugin-debugger` captures max 5 frames, 3 scopes/frame, 20 properties/scope with no options. Complex call stacks silently truncate.
- **No asset size limit** — `packages/write/src/session-writer.ts` writes any buffer to disk. A plugin emitting a 1GB response body as one asset blows up the session directory.
- **Console args unbounded** — `plugin-console` concats args without limits; `console.log(hugeObject)` produces a multi-megabyte event.
- **WebGL event firehose** — `plugin-webgl` pushes every uniform/draw call synchronously via `__introspect_push__`. A shader doing thousands of draws per frame DoSes the event stream.
- **`summariseBody` with huge JSON** — `packages/utils/src/summarise-body.ts` does `JSON.parse(raw)` without a size check; 100MB of valid JSON hangs the main thread.

Shared primitive worth considering: `maxAssetSize`/`maxEventBytes` in `CreateSessionWriterOptions`, with a standard `metadata: { truncated: true; reason: string }` marker on overflowing events.

## Schema gaps: `initiator` and `truncated`

- `BaseEvent.initiator?: string` is marked "best-effort" in `packages/types/src/index.ts` but isn't typed as a discriminated link. `network.response.body` documents in a comment that `initiator` points to a response event id; `debugger.capture` and `snapshot` have no such convention. Readers can't tell at the type level what kind of event an `initiator` points at. Consider `initiator?: { type: TraceEvent['type']; id: string }` or a per-event-type subinterface.
- There's no standard way to mark "this event is incomplete" — needed for backpressure, body truncation, scope truncation, partial snapshots. Adding an optional `truncated?: { reason: string; limit?: number }` to `BaseEvent` would give readers a uniform signal.

## Reader / CLI gaps

- **No `--follow` / tail mode** — running CLI against a live session shows the state at invocation; there's no way to stream events as they arrive. For a 10-minute test, that's painful.
- **No `pageId` filter** — `attach()` stamps `pageId` on every event, but `EventsFilter` doesn't accept it and the CLI has no `--page` flag. Multi-context tests produce a merged, unsortable stream.
- **Invalid `--filter` syntax is silent** — `packages/cli/src/events.ts` runs the filter in a sandbox and treats thrown errors as "false." A typo in the expression returns zero matches with no indication of why.
- **Time-range querying isn't documented** — reader supports `after`/`before` in ms, but the CLI only exposes mark-based `--since`. Ad-hoc "everything in the 5 seconds before the failure" is harder than it should be.
- **`getLatestSessionId` race** — the session-resolution code reads all session metas to pick the newest. A test currently writing to the latest session can produce a partial `meta.json`; worst case: CLI/reader picks a *different* session than the one the test thinks it's in.
- **NDJSON parsing is line-split on `\n`** — fine on Unix; Windows traces with `\r\n` produce empty lines (currently filtered out, but fragile).

## Plugin-specific follow-ups

- **plugin-cdp has no README** — the plugin exists with non-trivial config surface (`captureResults`) but is undocumented; users who turn it on without reading the code will capture megabytes of Runtime.evaluate payloads per test.
- **plugin-redux assumes a single `window.__REDUX_STORE__`** — apps with dynamic or multiple stores (per-tenant, per-feature) aren't captured.
- **plugin-solid's 3s detection window** — if the Solid debugger hasn't attached within 3 seconds, the plugin emits a warning and gives up. Slow initial loads hit false positives.
- **plugin-performance INP downgrade is silent** — falls back from `PerformanceObserver('event')` to `first-input` when the former doesn't fire (common in headless). The emitted event looks identical to a real-INP measurement. Consider a `{ source: 'event' | 'first-input' }` field.
- **plugin-debugger exception message extraction** — `String(params.data?.description)` assumes a string-like description; non-Error throws (Symbols, bare objects) can produce empty or unhelpful messages.

## Infra

- **`createDebug` writes to stdout unconditionally** — in test runners that capture stdout, plugin `debug()` spam pollutes assertions. Consider `process.stderr` and/or a `DEBUG=plugin-network` env-var check instead of a boolean parameter.

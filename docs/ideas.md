# Introspection Ideas

A jam doc — directions we might take the library, plus audit-style gaps in what already exists. Not prioritised, not committed. Add freely.

---

## Framework / State Management Plugins

Browser-side plugins that hook into app internals and emit framework-specific events.

| Plugin | What it captures |
|--------|-----------------|
| `plugin-tanstack-query` | Query cache state per key (status, data shape, error, staleTime), in-flight fetches, cache invalidations, optimistic updates |
| `plugin-mobx` | Observable mutations, computed re-evaluations, reaction triggers, action calls with before/after state |
| `plugin-xstate` | State machine transitions (from → event → to), current state node, context diff on every transition |
| `plugin-jotai` | Atom reads/writes with derivation graph, reset events |
| `plugin-recoil` | Atom/selector state, suspense transitions |
| `plugin-valtio` | Proxy mutation events, snapshot diffs |
| `plugin-pinia` | Vue's Pinia store state + mutations |
| `plugin-vue` | Vue Devtools hook — component tree, reactive effect graph, on-error component hierarchy |
| `plugin-svelte` | Svelte store updates via `subscribe()` interception |
| `plugin-apollo` | GraphQL operation name, variables, cache hits/misses, errors |
| `plugin-urql` | Same for urql — operation lifecycle events |
| `plugin-swr` | SWR cache state, dedupe windows, revalidation triggers |
| `plugin-router` | Route transitions with params/query (React Router, Vue Router, TanStack Router) |

---

## Browser API Capture

Framework-agnostic browser facilities capturable via CDP or injected code.

### Performance & Timing

- **User Timing** — intercept `performance.mark()` / `performance.measure()` from app code. Emit as `perf.mark` / `perf.measure`. Free semantic annotations.
- **Animation frame jank** — track `requestAnimationFrame` callback durations; emit `perf.frame` with actual vs. budgeted time. Identify dropped frames correlated with user interactions.
- **Memory pressure** — `performance.memory` (Chrome only) polled on each snapshot. Trend `usedJSHeapSize` / `totalJSHeapSize` over time.

(Web Vitals, long tasks, resource timing, layout shifts, and paint events are already covered by `plugin-performance`.)

### WebSocket / Realtime

- **WebSocket frames** — CDP `Network.webSocketFrameSent` / `webSocketFrameReceived`. Emit as `ws.send` / `ws.receive` with truncatable payload. Inspect realtime protocol alongside HTTP traffic.
- **EventSource / SSE** — intercept SSE streams; emit each server-sent event as `sse.message`.
- **BroadcastChannel** — intercept `.postMessage()` between tabs (auth sync, shared workers).
- **Web Workers** — intercept `worker.postMessage()` / `onmessage` on both ends. Emit `worker.post` / `worker.message` with transferred data.
- **WebTransport** — HTTP/3 streams, when relevant.

### Storage

- **IndexedDB snapshots** — read full IDB state via CDP `IndexedDB` domain on each snapshot. Attach alongside `localStorage`. "What was in the cart DB when checkout failed?"
- **localStorage / sessionStorage diffs** — emit `storage.set` / `storage.remove` per Storage API call. Full snapshot on error.
- **Cookie mutations** — CDP `Network.setCookie` / `Network.deleteCookies` → `cookie.set` / `cookie.remove`. Track auth state implicitly.
- **Cache API** — Service Worker cache `.put()` / `.match()` / `.delete()` calls.

### Service Workers

- **SW lifecycle** — installing, waiting, active, redundant. Emit as `sw.state`.
- **Fetch intercept** — which requests the SW handled vs. hit the network (cache hit? stale-while-revalidate?). Emit as `sw.fetch`.
- **Push messages** — received push payloads.
- **Background sync** — sync events triggered and their outcome.

### Accessibility

- **ARIA tree snapshot** — CDP Accessibility domain on every error snapshot (and optionally navigation). Role/name/state for every interactive element without needing eyes.
- **Focus tracking** — `document.activeElement` changes emitted as `a11y.focus`. Keyboard navigation bug diagnosis.
- **ARIA live region updates** — intercept screen-reader announcements.
- **axe-core integration** — run axe on every DOM snapshot; emit violations as `a11y.violation`.

### DOM / Rendering

- **`dom()`** — reactive DOM snapshot plugin. Listens to bus events (`js.error`, `manual`, `detach`) and writes full serialized DOM trees as assets. Decouples DOM capture from error detection.

### Console

- **Call-site info on `console` events** — capture `file:line:column` per call so spam is attributable (`"30× [APP] rendering from App.tsx:15"`). CDP `Runtime.consoleAPICalled` exposes a `stackTrace` field whose top frame gives it cheaply. Gate behind an option if overhead matters.

### Media

- **Video/audio playback** — `HTMLMediaElement` events (`play`, `pause`, `seeking`, `stalled`, `error`, `ended`) with `currentTime` / `networkState`.
- **Media Session API** — metadata the app sets (title, artist, artwork).
- **WebRTC** — peer connection state, ICE candidates, data channel messages, track events.
- **Web Audio** — AudioContext state transitions, node graph changes, audio errors.

### Input & Interaction

- **Pointer events beyond click** — `pointermove`, `pointerdown`, `pointerup`, `pointercancel` with coordinates. Reconstruct drag paths.
- **Touch events** — multi-touch sequences for mobile simulation.
- **Clipboard** — `copy` / `cut` / `paste` events + transferred data.
- **Drag and drop** — `dragstart` / `drop` / `dragend` with `dataTransfer`.
- **Gamepad API** — button presses, axis values for game testing.

### Permissions & APIs

- **Permission requests** — intercept `navigator.permissions.query()` and grants.
- **Geolocation** — `getCurrentPosition` / `watchPosition` calls.
- **Notifications API** — `Notification` constructor calls.
- **Web Share** — what the app tried to share.
- **Payment Request** — payment sheet invocations and outcomes.

---

## CDP Profiling

Heavier captures beyond the event stream.

- **CPU profile** — start CDP Profiler at test start, stop at end. Sidecar `.cpuprofile`; `introspect profile` opens it in Chrome DevTools format.
- **Heap snapshot** — CDP HeapProfiler on-demand or at error. `introspect heap` gives top retained objects for leak tests.
- **Coverage** — CDP Coverage domain captures JS/CSS coverage. Which code paths executed? Which CSS rules were used? Attach as `coverage.json`.

---

## Network Intelligence

### Capture edge-cases `plugin-network` currently misses

The two-phase emit (`network.response` always, `network.response.body` when `Network.loadingFinished` fires) leaves several classes of responses without a body event.

- **Streaming responses (SSE, long-polling, chunked-no-end)** — `Network.getResponseBody` isn't usable. Listen to `Network.dataReceived` + `Network.streamResourceContent`; emit `network.response.body.chunk` with sequence numbers, linked via `initiator`. Backpressure: cap chunk emission (first N bytes / N chunks) and mark `truncated: true`.
- **Routed requests (`route.fulfill` / `Fetch.fulfillRequest`)** — body supplied at Fetch layer, `Network.getResponseBody` returns "No data found." Either enable `Fetch` on a second CDP session (Playwright already uses Fetch for routing on the primary), or hook into Playwright's `page.route` / `response.body()` directly. Latter couples plugin-network to Playwright.
- **Cached responses (304, disk cache hits)** — sometimes `loadingFinished` fires with no retrievable body. Detect via `fromDiskCache` / `fromServiceWorker` / `fromPrefetchCache`; emit `network.response.body` with `metadata: { fromCache: true }` and no asset.
- **Unread bodies (fetch without consume)** — if the page does `fetch(url)` and never reads the body, Chromium may keep the stream open and never fire `loadingFinished`. Hit us in our own tests. Mitigations: treat as streaming (emit what we have), document that user code must consume bodies, or page-side wrapper around `fetch` / `XHR` that forces a read.
- **WebSocket upgrades (HTTP 101)** — currently emits `network.response` with status 101 and no body event (correct). A companion `plugin-websocket` could pick up from there, listening to frame events and linking via `initiator`.
- **Large request uploads** — `Network.requestWillBeSent` only includes `postData` under 64KB. For `hasPostData: true` with no `postData`, call `Network.getRequestPostData` async; emit `network.request.body` in a second phase.

### Protocol parsing

- **GraphQL operation parsing** — parse request bodies for `query` / `mutation` / `subscription` + `operationName`. Emit as `gql.operation`. `introspect gql` lists all operations in order.
- **tRPC call parsing** — parse tRPC batch requests into individual procedure calls.
- **Beacon API** — `navigator.sendBeacon()` calls. Analytics events that fire on page unload.
- **Redirect chains** — follow 301/302 chains and present them as a linked sequence.
- **CORS error classification** — detect CORS failures in network errors; annotate with likely cause.
- **HAR export** — `introspect export har` writes a standard `.har` from the trace.

---

## Visual Capture

- **`plugin-canvas`** — `HTMLCanvasElement.toDataURL()` on demand or at error. Pixel-level evidence for rendering test failures. Sidecar images.
- **Frame diff** — compare canvas pixel content between frames; highlight changed regions. Animation tests: "nothing changed between frame 10 and 11, which is wrong."
- **Screenshot on assertion failure** — auto-`page.screenshot()` when a Playwright assertion throws. Different from DOM snapshot — what the user would have seen.
- **Full-page screenshot sequence** — one per navigation; visual breadcrumb.
- **Visual diff against baseline** — compare screenshots to reference image. Emit `visual.regression` if diff exceeds threshold.

---

## Multi-Trace / Cross-Test Analysis

- **`introspect compare <trace-a> <trace-b>`** — side-by-side diff: which events appear in one but not the other, timing differences, state at corresponding marks.
- **`introspect flaky`** — given multiple traces of the same test (passing and failing), show differing events. Surface the discriminating factor automatically.
- **`introspect search <pattern>`** — grep across all traces. "Which tests produced a 401?" "Which tests had a `redux.dispatch` with type `CHECKOUT_FAILED`?"
- **SQLite backend** — natural migration from per-file JSON when cross-test querying becomes important. CLI surface stays the same; storage layer swaps.
- **CI metadata attachment** — embed PR number, commit SHA, branch name, CI run URL into the trace `test` object. "Show all traces from this PR that had JS errors."
- **Trace aggregation** — stats across a suite run: most common error types, slowest tests by network time, flakiest tests by variance.

---

## Trace Viewing

- **`introspect view`** — local web UI with a Perfetto / DevTools-style swimlane timeline. Rows per event family; click an event for details; zoom and pan.
- **VS Code extension** — open a `.trace.json` and see the timeline inline. Click `js.error` to jump to the source file (source maps already resolved at capture time).
- **Trace embedding in test reports** — `introspect report` generates a self-contained HTML with embedded viewer; attach to GitHub Actions as an artifact.
- **AI-readable trace summary format** — `introspect summary --format json` outputs a structured object the AI can parse without text-scanning. Optimised token count.

---

## AI-Powered Analysis

- **`introspect analyze`** — pipes the trace (or compressed version) to Claude. Returns narrative: "The test failed because the login request returned 401. Auth state at error time shows `auth.token` was null, so the token was never stored after the previous navigation…"
- **`introspect suggest`** — given trace + test source, suggests a fix as a diff.
- **Root cause ranking** — AI receives the full event stream and ranks hypotheses by likelihood, each linked to specific events as evidence.
- **Natural language trace queries** — `introspect ask "did the cart state update after the add-to-cart click?"` — translates to filters and answers plainly.
- **Regression explanation** — given a passing trace and a failing trace, the AI explains what changed in plain language.

---

## Developer Experience / Ergonomics

### Dev-mode / live companion

(Base `introspect debug [url] [--serve <path>]` is shipped. The items below extend it.)

- **Vite plugin for fixture-aware tracing** — `@introspection/vite` middleware auto-injects the browser-side machinery into every served page. Removes the `attach()` step for ad-hoc debugging; generic HTTP middleware for non-Vite servers.
- **`debug` duration / auto-exit** — `--duration 5s` flag for non-interactive capture ("run this page for 5s and give me the trace").
- **Auto-reattach watch mode** — `introspect debug <url> --watch --watch-files 'src/**/*.ts'` re-runs capture on source change, writing a fresh session each time. Fixture dev, intermittent-bug chasing.
- **Live mode dashboard** — `introspect watch` tails `events.ndjson` in real time. Structured and filterable tail-f.

### CLI sugar

- **Error-first sugar commands** — `introspect errors`, `introspect last-error`, `--with-console` (surrounding console), `--with-stack` (debugger scope at throw). Typed shortcuts for `events --type js.error`.
- **Interactive REPL** — `introspect repl [session-id]` loads a session in memory and exposes the existing subcommands without per-command CLI overhead.
- **`introspect perf` aggregate query** — summary of slowest network requests, longest JS tasks, largest DOM snapshots, layout-shift totals. Derived from existing events; no new capture.
- **Structured export formats** — beyond HAR: `--format junit` (CI fails if trace has errors), `--format html` (self-contained report), `--format console` (markdown summary for PRs).
- **`introspect summary` header disambiguation** — show each session's start time / test label / duration so "latest session" is unambiguously the run the dev just finished. Reduces the `rm -rf .introspect/` reflex between runs.
- **`introspect init`** — interactive setup wizard. Detects framework and test runner; installs `@introspection/playwright`; writes a minimal `playwright.config.ts` fixture.
- **`introspect doctor`** — validates setup. `@introspection/playwright` installed? Traces being written? Session directory healthy?

### Plugin testing

- **Shared test helpers across plugin specs.** Each plugin spec currently reimplements `readEvents()` / NDJSON parsing independently. A `@introspection/test-utils` package (or a `test/` helper in the monorepo root) with `readEvents(outDir)`, `tmpDir()`, and common `attach`/`detach` wrappers would eliminate the duplication and make specs easier to write.

### Plugin DX

- **`introspect plugin add <name>`** — detect package manager (via `nypm` / `package-manager-detector`); install the `@introspection/plugin-*` package. `introspect plugin ls` lists known plugins with install status.
- **Plugin-contributed CLI commands** — plugins register their own `introspect <plugin>` subcommands (e.g. `introspect webgl uniforms --name u_time`). Discovery: scan `node_modules/@introspection/plugin-*` at startup, or explicit config. Lets agents interact with plugin data directly.
- **Auto-detect context** — for `plugin-webgl`, instead of requiring `plugin.track(gl)`, optionally patch `HTMLCanvasElement.prototype.getContext` globally so any context is captured automatically (opt-in).

### Capture ergonomics

- **Mark API sugar** — `introspect.mark(label)` is shipped (`packages/playwright/src/attach.ts:151`). Missing: `introspect.time('label')` / `introspect.timeEnd('label')` that emits a paired mark with duration. Lightweight perf instrumentation from test code.
- **Conditional capture** — capture config driven by env vars. `INTROSPECT_LEVEL=verbose` turns on response bodies; `minimal` captures only errors and actions. Good for CI vs. local.
- **Redaction profiles** — named presets for `capture.network.ignoreHeaders` and response body — e.g. `redaction: 'pci'` strips card numbers, CVVs, auth tokens.

### Dogfood loop

- **Dogfood reflections as a committed artifact** — *shipped*: `introspect-reflect` writes retros to `docs/analysis/<date>-<slug>.md`. Same folder also holds code-quality reviews and the failure-handling catalog. Open: decide whether this grows well as one flat folder or wants sub-structure (`docs/analysis/reviews/`, `docs/analysis/reflections/`) once we accumulate more.

---

## Observability: silent failures hide bugs

Hot paths catch-and-swallow errors aggressively enough that real bugs look like "just nothing captured." Consider a structured `introspect.warning` event when these fall through, so readers can distinguish "feature didn't exist" from "it broke."

- **CDP command failures** — `packages/playwright/src/attach.ts` has `.catch(() => {})` around subscription re-apply, unwatch, and `cdp.detach()`. Transient CDP disconnect after navigation silently loses all plugin subscriptions.
- **Write queue swallowed errors** — `packages/write/src/session.ts` turns write failures into `Promise.resolve()`. `ENOSPC`/`EACCES` during `appendEvent` disappears; `session.flush()` returns "successfully."
- **Plugin push parse errors** — `packages/playwright/src/attach.ts` push bridge: `catch { /* malformed push — ignore */ }`. A plugin emitting bad JSON produces no events with no clue why.
- **Redux serialisation** — `plugin-redux/src/index.ts` silently drops `stateBefore` / `stateAfter` / `payload` if `JSON.stringify` throws (circular refs, BigInt, etc.).
- **Debugger scope collection** — `plugin-debugger/src/index.ts` silently skips scopes where `Runtime.getProperties` fails, so partial capture looks identical to full capture.

---

## Hard limits and backpressure

Several plugins buffer or emit data with no upper bound. Fine for small tests, hazardous for long/complex sessions.

- **Debugger scope truncation is hardcoded** — `plugin-debugger` caps at 5 frames / 3 scopes per frame / 20 properties per scope with no options.
- **No asset size limit** — `packages/write/src/session-writer.ts` writes any buffer to disk. A 1GB response-body asset blows up the session directory.
- **Console args unbounded** — `plugin-console` concats args without limits; `console.log(hugeObject)` produces a multi-megabyte event.
- **WebGL event firehose** — `plugin-webgl` pushes every uniform/draw call synchronously via `__introspect_push__`. A shader doing thousands of draws per frame DoSes the event stream.
- **`summariseBody` with huge JSON** — `packages/utils/src/summarise-body.ts` does `JSON.parse(raw)` without a size check; 100MB of valid JSON hangs the main thread.

Shared primitive worth considering: `maxAssetSize` / `maxEventBytes` in `CreateSessionWriterOptions`, with a standard `metadata: { truncated: true; reason: string }` marker on overflowing events.

---

## Schema gaps

- **Named assets (`Record<string, AssetRef>`) on `BaseEvent`.** Currently `assets` is `AssetRef[]`. For plugins that emit multiple semantically distinct assets per event (e.g. `stateBefore` / `stateAfter` on `redux.dispatch`), callers must rely on array index conventions. A `Record<string, AssetRef>` would make the relationship explicit and self-documenting. Breaking change — worth revisiting once more plugins emit multi-asset events.
- **`BaseEvent.initiator` isn't a typed link.** Marked "best-effort" in `packages/types/src/index.ts`. `network.response.body` documents in a comment that `initiator` points to a response-event id; `debugger.capture` and `snapshot` have no such convention. Readers can't tell at the type level what kind of event an `initiator` points at. Consider `initiator?: { type: TraceEvent['type']; id: string }` or per-event-type subinterface.
- **No standard way to mark "this event is incomplete."** Needed for backpressure, body truncation, scope truncation, partial snapshots. Adding optional `truncated?: { reason: string; limit?: number }` to `BaseEvent` gives readers a uniform signal.

---

## Reader / CLI gaps

- **No `--follow` / live-tail mode.** CLI queries a session at invocation time; no way to stream events as they arrive. Painful for long tests. (Complementary to the "Live mode dashboard" bullet above.)
- **No `pageId` filter.** `attach()` stamps `pageId` on every event, but `EventsFilter` doesn't accept it and the CLI has no `--page` flag. Multi-context tests produce a merged unsortable stream.
- **Invalid `--filter` syntax is silent.** `packages/cli/src/commands/events.ts` runs the filter in a sandbox and treats thrown errors as "false." Typo → zero matches with no indication why.
- **`getLatestSessionId` race.** Session-resolution reads all session metas to pick the newest. A currently-writing session can produce a partial `meta.json`; worst case: CLI/reader picks a *different* session than the test thinks it's in.
- **NDJSON line-split on `\n`.** Windows traces with `\r\n` produce empty lines (currently filtered, but fragile).

---

## Plugin-specific follow-ups

- **`plugin-redux` assumes a single `window.__REDUX_STORE__`.** Apps with dynamic or multiple stores (per-tenant, per-feature) aren't captured.
- **`plugin-solid-devtools` has a 3s detection window.** If the Solid debugger hasn't attached within 3 seconds, the plugin warns and gives up. Slow initial loads hit false positives.
- **`plugin-performance` INP downgrade is silent.** Falls back from `PerformanceObserver('event')` to `first-input` when the former doesn't fire (common in headless). Emitted event looks identical to real-INP measurement. Add a `{ source: 'event' | 'first-input' }` field.
- **`plugin-debugger` exception message extraction.** `String(params.data?.description)` assumes a string-like description; non-Error throws (Symbols, bare objects) can produce empty or unhelpful messages.
- **Performance summarisation layer.** Post-processing that takes raw `plugin-performance` events and produces structured diagnostics — e.g. "LCP was 4.2s, LCP element was `<img src='hero.jpg'>`, blocked by 3 render-blocking scripts totalling 1.8s." CLI command or separate step.

---

## Protocol / Architecture

- **Live query cache in `TraceReader`.** Every CLI query reloads and re-parses the full `events.ndjson` from disk. For large sessions this is wasteful on repeated queries. A simple mtime-based cache would make rapid successive queries cheap.
  - *Why not a Unix domain socket server?* We had one (`eval-socket.ts`), removed it. IPC overhead, persistent server tied to test-runner lifetime, serialised concurrent reads that don't actually conflict (ndjson is append-only). For a dev tool with infrequent queries the reload-per-query cost is negligible. If the cache lands and latency still matters, reconsider.
- **Bidirectional plugin events.** Node → browser RPCs. Let the test process ask the browser "give me the current Redux state" on demand, not just on error. Needs a browser-side agent and a protocol on top of core.
- **Trace compression.** gzip trace files. For long tests with high-frequency events (WebGL frames, Redux actions), traces can be large.
- **Sampling.** For high-frequency event types, emit only every Nth event or aggregate over a window. Config: `capture.sample: { 'plugin.webgl.frame': 10 }`.
- **Remote trace collection.** Emit traces to an HTTP endpoint instead of (or in addition to) local files. Useful for distributed CI.
- **OpenTelemetry export.** Emit spans and attributes to an OTLP endpoint. Plug introspection into existing observability infrastructure.

---

## Infra

- **`createDebug` writes to stdout unconditionally.** In test runners that capture stdout, plugin `debug()` spam pollutes assertions. Consider `process.stderr` and/or a `DEBUG=plugin-network` env-var check instead of a boolean parameter.

---

## Framework / Tool Integrations

- **Storybook** — instrument stories the same way Playwright tests are. Capture component state changes as you interact.
- **Vitest browser mode** — `attach()` works with Vitest's browser mode, not just Playwright.
- **Cypress** — a Cypress equivalent of `@introspection/playwright`.
- **WebdriverIO** — same idea.
- **Next.js** — server-side rendering events: which pages were SSR'd, RSC payload sizes, hydration timing.
- **Remix** — loader/action timing, deferred data, revalidation triggers.
- **Astro** — island hydration events.
- **MSW (Mock Service Worker)** — emit which mock handler intercepted each request. Distinguishes "mock returned wrong data" from "real server returned wrong data."

---

## Ideas that don't fit neatly

- **Trace as test** — `introspect assert 'events.filter(e => e.type === "js.error").length === 0'` — exit non-zero if the expression is falsy. Assertions against the trace, not just the app.
- **Replay** — feed a trace back to a fresh browser session to reproduce the exact event sequence. Time-travel debugging as a CLI command.
- **Plugin hot-reload** — swap plugin config during a running test session without restarting the runner.
- **Multi-page / iframe tracking** — attach to multiple pages / frames in the same test. Events tagged with `pageId`.
- **Electron support** — attach to Electron's main and renderer processes separately.
- **React Native / Expo** — Metro bundler plugin, CDP over USB / ADB.
- **AI agent as a plugin** — on every error, automatically run `introspect analyze` and append the AI's diagnosis to the trace as a `plugin.ai.diagnosis` event. Self-healing test reports.

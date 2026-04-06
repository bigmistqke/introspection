# Introspection Possibilities

A jam doc — every direction the library could grow. Not prioritised, not committed. Add freely.

---

## Framework / State Management Plugins

More plugins following the same `IntrospectionPlugin` shape. Browser-side hooks into app internals; server-side snapshots into the trace.

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
| `plugin-router` | Route transitions with params/query (React Router, Vue Router, TanStack Router) — already shown as a custom plugin example |

---

## Browser API Capture (no framework needed, CDP or PerformanceObserver)

Things the browser exposes that aren't tied to any framework. All can be captured via CDP or injected browser-side code.

### Performance & Timing

- **Web Vitals** — LCP, INP, CLS, TTFB, FCP via PerformanceObserver. Emit each as a `perf.vital` event with the value and the element/interaction that triggered it. The AI can see "LCP was 4.2s, caused by `img.hero`".
- **Long tasks** — PerformanceObserver `longtask` entries. Each task > 50ms emitted as `perf.longtask` with duration and attribution (which script/frame blocked). Correlatable with `playwright.action` events to explain sluggishness.
- **Resource timing** — every asset load (script, style, image, font, fetch) with DNS/TCP/request/response breakdown. Emit as `perf.resource`. Let the AI see "the 800ms before the error was this 780ms font load".
- **User Timing** — intercept `performance.mark()` and `performance.measure()` calls from app code. Emit as `perf.mark` / `perf.measure`. Free semantic annotations from devs who already added them.
- **Animation frame jank** — track `requestAnimationFrame` callback durations. Emit `perf.frame` with actual vs. budgeted time. Identify dropped frames correlated with user interactions.
- **Memory pressure** — `performance.memory` (Chrome only) polled on each snapshot: `usedJSHeapSize`, `totalJSHeapSize`. Trend over time.

### WebSocket / Realtime

- **WebSocket frames** — CDP `Network.webSocketFrameSent` / `webSocketFrameReceived`. Emit as `ws.send` / `ws.receive` events with the payload (truncated by same `maxSize` config). Let the AI inspect the realtime protocol alongside HTTP traffic.
- **EventSource / SSE** — CDP can intercept SSE streams. Emit individual server-sent events as `sse.message`.
- **BroadcastChannel** — intercept `.postMessage()` calls between tabs (useful for auth token sync, shared workers).
- **WebTransport** — HTTP/3 streams, when relevant.

### Storage

- **IndexedDB snapshots** — on each snapshot, read the full IDB state via CDP `IndexedDB` domain. Emit as part of the on-error snapshot alongside `localStorage`. The AI often needs to know "what was in the cart DB when checkout failed?".
- **localStorage / sessionStorage diffs** — emit `storage.set` / `storage.remove` events when the Storage API is called. Full snapshot on error.
- **Cookie mutations** — CDP `Network.setCookie` / `Network.deleteCookies` — emit as `cookie.set` / `cookie.remove`. Track auth state implicitly.
- **Cache API** — Service Worker cache `.put()` / `.match()` / `.delete()` calls.

### Service Workers

- **SW lifecycle** — installing, waiting, active, redundant. Emit as `sw.state`.
- **Fetch intercept** — which requests were handled by the SW vs. went to the network. Was it a cache hit or a stale-while-revalidate? Emit as `sw.fetch`.
- **Push messages** — received push payloads.
- **Background sync** — sync events triggered and their outcome.

### Accessibility

- **Accessibility tree snapshot** — CDP Accessibility domain exports the full ARIA tree. Capture on every error snapshot (and optionally on navigation). Gives the AI role/name/state for every interactive element without needing eyes.
- **Focus tracking** — `document.activeElement` as a sequence of events. Emit `a11y.focus` on every focus change. Useful for keyboard navigation bugs.
- **ARIA live region updates** — intercept announcements made to screen readers.
- **axe-core integration** — run axe on every DOM snapshot. Emit violations as `a11y.violation` events. Catch regressions automatically.

### Media

- **Video/audio playback** — `HTMLMediaElement` events: `play`, `pause`, `seeking`, `stalled`, `error`, `ended`. Emit with `currentTime` and `networkState`. Useful for media player testing.
- **Media Session API** — track what metadata the app sets (title, artist, artwork).
- **WebRTC** — peer connection state, ICE candidates gathered, data channel messages, track events.
- **Web Audio** — AudioContext state transitions, node graph changes, audio errors.

### Input & Interaction

- **Pointer events** beyond click — `pointermove`, `pointerdown`, `pointerup`, `pointercancel` with coordinates. Reconstruct drag paths.
- **Touch events** — multi-touch sequences for mobile simulation.
- **Clipboard** — `copy`, `cut`, `paste` events and the transferred data (if accessible).
- **Drag and drop** — `dragstart`, `drop`, `dragend` with `dataTransfer` payload.
- **Gamepad API** — button presses, axis values for game testing.

### Permissions & APIs

- **Permission requests** — intercept `navigator.permissions.query()` and `navigator.requestPermission()`. Emit what the app asked for and what it was granted.
- **Geolocation** — when the app calls `getCurrentPosition` / `watchPosition`. Useful for location-gated feature testing.
- **Notifications API** — `Notification` constructor calls with title/body/options.
- **Web Share** — what the app tried to share.
- **Payment Request** — payment sheet invocations and outcomes.

---

## CDP Profiling (deeper than events)

Heavier captures that go beyond the event stream.

- **CPU profile** — start CDP Profiler at test start, stop at end. Attach as a sidecar `.cpuprofile` file. `introspect profile` opens it in a format compatible with Chrome DevTools. Let the AI identify hot functions during a failing interaction.
- **Heap snapshot** — CDP HeapProfiler on-demand or at error. `introspect heap` gives the AI top retained objects. Useful for memory leak tests.
- **Coverage** — CDP Coverage domain captures JS and CSS coverage. Which code paths were actually executed? Which CSS rules were used? Attach as `coverage.json`.

---

## Network Intelligence

Going deeper on the existing network capture.

- **GraphQL operation parsing** — parse request bodies for `query`/`mutation`/`subscription` + `operationName`. Emit as `gql.operation` with operation type and name. `introspect gql` lists all GraphQL operations in order.
- **tRPC call parsing** — parse tRPC batch requests into individual procedure calls.
- **HAR export** — `introspect export har` writes a standard `.har` file from the trace. Import into Chrome DevTools, Charles, or Fiddler.
- **Beacon API** — `navigator.sendBeacon()` calls. Useful for tracking analytics events that fire on page unload.
- **Redirect chains** — follow 301/302 chains and present them as a linked sequence rather than separate events.
- **CORS error classification** — detect CORS failures from network errors and annotate with likely cause.

---

## Visual Capture

Canvas and screenshots as trace artifacts.

- **`plugin-canvas`** (already referenced in WebGL design) — `HTMLCanvasElement.toDataURL()` on demand or at error. Pixel-level evidence for rendering test failures. Sidecar image files like response bodies.
- **Frame diff** — compare canvas pixel content between frames. Highlight changed regions. Useful for animation testing: "nothing changed between frame 10 and frame 11, which is wrong".
- **Screenshot on assertion failure** — auto-trigger `page.screenshot()` (Playwright) when a Playwright assertion throws. Attach as a sidecar `.png`. Different from DOM snapshot — you see what the user would have seen.
- **Full-page screenshot sequence** — one screenshot per navigation. Visual breadcrumb trail through the test.
- **Visual diff against baseline** — compare screenshots to a reference image. Emit `visual.regression` if diff exceeds threshold. Pixel diff image as sidecar.

---

## Multi-Trace / Cross-Test Analysis

Today traces are isolated. Once there are many of them:

- **`introspect list`** — enumerate trace files with test title, status, duration (already suggested in ANALYSIS.md as a low-severity missing affordance)
- **`introspect compare <trace-a> <trace-b>`** — side-by-side diff: which events appear in one but not the other, timing differences, state differences at corresponding marks
- **`introspect flaky`** — given multiple traces for the same test (passing and failing), show the events that differ. Automatically surfaces the discriminating factor.
- **`introspect search <pattern>`** — grep across all traces. "Which tests produced a 401 response?" "Which tests had a `redux.action` with type `CHECKOUT_FAILED`?"
- **SQLite backend** — natural migration from per-file JSON when cross-test querying becomes important. `introspect` CLI stays the same; storage layer swaps.
- **CI metadata attachment** — embed PR number, commit SHA, branch name, CI run URL into the trace `test` object. Queries like "show me all traces from this PR that had JS errors".
- **Trace aggregation** — aggregate stats across a test suite run: most common error types, slowest tests by network time, flakiest tests by variance.

---

## Trace Viewing

Beyond the CLI.

- **`introspect view`** — opens a local web UI with a Perfetto/Chrome-DevTools-style swimlane timeline. Rows for: network, JS errors, Playwright actions, plugin events (one row per plugin). Click an event to see its data. Zooms and pans.
- **VS Code extension** — open a `.trace.json` and see the timeline inline. Click a `js.error` to jump to the source file (source maps already resolved at capture time).
- **Trace embedding in test reports** — `introspect report` generates a self-contained HTML file with an embedded viewer. Attach to GitHub Actions as an artifact.
- **AI-readable trace summary format** — `introspect summary --format json` outputs a structured object the AI can parse without text-scanning. Optimized token count — no repeated field names, abbreviated timestamps.

---

## AI-Powered Analysis

Using the trace as input to an LLM.

- **`introspect analyze`** — pipes the trace (or a compressed version of it) to Claude. Returns a narrative: "The test failed because the login request returned 401. Looking at the Redux state at error time, `auth.token` was null, suggesting the token was never stored after the previous navigation. The most likely cause is…"
- **`introspect suggest`** — given the trace and the test source, suggests a fix. Outputs a diff.
- **Root cause ranking** — the AI gets the full event stream and ranks hypotheses by likelihood, each linked to specific events as evidence.
- **Natural language trace queries** — `introspect ask "did the cart state update after the add-to-cart click?"`. Translates to `eval` or filters and answers in plain English.
- **Regression explanation** — given a passing trace and a failing trace, the AI explains what changed between them in plain language.

---

## Developer Experience / Ergonomics

Things that make the existing system nicer to use.

- **`introspect init`** — interactive setup wizard. Detects framework (React, Vue, Svelte), Vite config, test runner. Writes the minimal config and installs the right plugins automatically.
- **Zero-config mode** — `introspection()` with no arguments infers sensible defaults: detect Redux/React/Zustand from `node_modules`, auto-register their plugins.
- **`introspect doctor`** — validates setup. Checks that the Vite plugin is configured, the socket file exists, test traces are being written, source maps are resolving correctly.
- **Live mode dashboard** — `introspect watch` streams events from the live socket in real time as a test runs. Like `tail -f` but for structured introspection events.
- **Mark API sugar** — `introspect.time('label')` starts a timer; `introspect.timeEnd('label')` emits a `mark` event with the duration. Lightweight perf instrumentation from test code.
- **Conditional capture** — capture config driven by environment variables. `INTROSPECT_LEVEL=verbose` turns on response bodies; `INTROSPECT_LEVEL=minimal` captures only errors and actions. Good for CI vs. local.
- **Redaction profiles** — named presets for `capture.network.ignoreHeaders` and `responseBody` — e.g. `redaction: 'pci'` automatically strips card numbers, CVVs, auth tokens.
- **Plugin DX: auto-detect context** — for `plugin-webgl`, instead of requiring `plugin.track(gl)`, optionally patch `HTMLCanvasElement.prototype.getContext` globally so any context is captured automatically (opt-in via `autotrack: true`).

---

## Protocol / Architecture

Infrastructure that enables future capabilities.

- **Bidirectional plugin events** — server → browser RPCs via the typed RPC protocol. Let the Vite plugin ask the browser "give me the current Redux state" on demand, not just on error.
- **Streaming trace writes** — write events incrementally to the trace file as they happen, not only at test end. Survive Playwright crashes without losing data.
- **Trace compression** — gzip the trace files. For long tests with high-frequency events (WebGL frames, Redux actions), traces can be large.
- **Sampling** — for high-frequency event types (WebGL frames, RAF jank), emit only every Nth event or aggregate over a window. Config: `capture.sample: { 'plugin.webgl.frame': 10 }`.
- **Remote trace collection** — emit traces to an HTTP endpoint instead of (or in addition to) local files. Useful for distributed CI where workers run on separate machines.
- **OpenTelemetry export** — emit spans and attributes to an OTLP endpoint. Plug introspection traces into existing observability infrastructure.

---

## Specific Framework / Tool Integrations

- **Storybook** — instrument stories the same way Playwright tests are instrumented. Capture component state changes as you interact with a story.
- **Vitest browser mode** — `attach()` works with Vitest's browser mode, not just Playwright.
- **Cypress** — a Cypress plugin equivalent of `@introspection/playwright`.
- **WebdriverIO** — same idea.
- **Next.js** — server-side rendering events: which pages were SSR'd, RSC payload sizes, hydration timing.
- **Remix** — loader/action timing, deferred data, revalidation triggers.
- **Astro** — island hydration events.
- **MSW (Mock Service Worker)** — emit which mock handler intercepted each request. Let the AI see "this request was mocked, not real". The AI can distinguish "the mock returned wrong data" from "the real server returned wrong data".

---

## Ideas That Don't Fit Neatly

- **Trace as test** — `introspect assert 'events.filter(e => e.type === "js.error").length === 0'` — exit non-zero if the expression is falsy. Write assertions against the trace, not just the app.
- **Replay** — feed a trace back to a fresh browser session to reproduce the exact sequence of events. Time-travel debugging as a CLI command.
- **Plugin hot-reload** — swap plugin config during a running test session without restarting Vite.
- **Multi-page / iframe tracking** — attach to multiple pages or frames in the same test. Events tagged with `pageId`.
- **Electron support** — attach to Electron's main and renderer processes separately.
- **React Native / Expo** — Metro bundler plugin, CDP over USB/ADB.
- **AI agent as a plugin** — a plugin that, on every error, automatically runs `introspect analyze` and appends the AI's diagnosis to the trace as a `plugin.ai.diagnosis` event. Self-healing test reports.

# Capture Strategy Trade-offs

Three approaches to capturing browser data for introspection. Not mutually exclusive — the right answer is probably a combination.

---

## The Three Approaches

### A. Real CDP (current)
Playwright opens a CDP session to the browser's DevTools endpoint. Events are captured at the protocol level — below JavaScript, in the browser engine itself.

### B. Chobitsu (browser-injected CDP mock)
A library injected into the page that patches browser APIs (XHR, fetch, `window.onerror`) and emits CDP-shaped events from within JavaScript.

### C. Vite plugin instrumentation
Transform source files at build time. Rewrite AST to inject tracking calls at the call site — inside the application code itself, before it runs.

---

## Capture Coverage Comparison

| Signal | Real CDP | Chobitsu | Vite instrumentation |
|--------|----------|----------|----------------------|
| XHR / fetch | ✅ Protocol-level | ✅ JS patch | ✅ Call-site rewrite |
| Service worker fetches | ⚠️ Only with separate SW target attachment | ❌ | ✅ (SW file is transformed too) |
| Preload / prefetch requests | ✅ | ❌ | ❌ |
| Web Worker network activity | ⚠️ Only with separate worker target attachment | ❌ Main thread only | ✅ Worker files are transformed |
| WebSocket frames | ✅ | ❌ | ✅ (if `new WebSocket` is rewritten) |
| Request timing (DNS, TCP, TLS, TTFB) | ✅ Accurate | ⚠️ JS-only (no pre-JS timing) | ⚠️ JS-only |
| JS errors + stack traces | ✅ | ✅ | ✅ (can add try/catch at call site) |
| Console output | ✅ | ✅ | ✅ (rewrite `console.*`) |
| DOM mutations | ✅ | ✅ MutationObserver | ✅ (instrument DOM API calls) |
| DOM snapshot (full HTML) | ✅ | ✅ | ✅ |
| Component lifecycle (React, Vue…) | ❌ | ❌ | ✅ render, mount, unmount |
| State management (Redux, Zustand…) | ❌ | ❌ | ✅ middleware injection at import time |
| Which component triggered a fetch | ❌ | ❌ | ✅ call-site has full context |
| Custom app code (any function) | ❌ | ❌ | ✅ arbitrary transform |
| Works without Playwright | ❌ | ✅ | ✅ |
| Works in Firefox / WebKit | ⚠️ Via Playwright only | ✅ | ✅ |
| Works outside of tests | ❌ | ✅ | ✅ |

---

## Deep Dive

### A. Real CDP

CDP operates at the V8/Blink engine level. The browser streams events directly from its internals — no JS involved on the capture path. This means:

**Strengths:**
- Captures everything that crosses the network stack, including requests JavaScript never sees (preloads, SW fetches, CSP violations, `<img src>` loads)
- Request timing includes pre-JS phases: DNS lookup, TCP handshake, TLS negotiation, queuing
- Stack frames come from V8 directly — structured, not parsed from `error.stack` strings
- Cannot be bypassed by application code (a library that monkey-patches `fetch` won't affect CDP)
- `Debugger` domain gives you live variable inspection, breakpoints, paused execution

**Weaknesses:**
- Requires a DevTools endpoint — today that means Playwright (or `--remote-debugging-port` and a raw WebSocket connection to Chrome)
- Chromium-only unless proxied through Playwright's abstraction layer
- Has no visibility inside JavaScript — can see that a fetch happened, not which component triggered it or what the local variable state was at that moment
- Ties the data collection layer to the test runner lifecycle
- Workers (Web Workers, Shared Workers, Service Workers) are separate CDP targets and require explicit attachment via `page.on('worker', ...)` / `context.on('serviceworker', ...)`. Our current implementation attaches to the page only — worker activity is invisible without additional work.

**What it can't do:**
CDP sees the network and the runtime, but it doesn't understand your application. It can tell you a `POST /api/checkout` happened with a 500 response. It can't tell you that the Redux `CHECKOUT_SUBMIT` action was dispatched 3ms earlier with an empty cart because `items` was `undefined` due to a selector bug.

---

### B. Chobitsu

Chobitsu patches global browser APIs inside the page. It wraps `XMLHttpRequest`, `fetch`, `console.*`, and installs `window.onerror` + `unhandledRejection` listeners. Events are emitted as CDP-shaped JSON via a message callback.

**Strengths:**
- No external tooling needed — inject the script, point it at a WebSocket server, done
- Works in any browser, any test runner (Cypress, Vitest browser, Playwright, manual)
- Works outside of tests — inject into a dev server and capture during development
- Can be injected via a `<script>` tag, `page.addInitScript`, a Vite plugin transform, or a service worker

**Weaknesses:**
- JS-level only. Anything that bypasses the JS layer is invisible: preloads, `<link rel="preconnect">`, native browser requests
- **Workers are out of reach.** Web Workers, Shared Workers, and Service Workers each run in an isolated scope with their own `fetch` and `XMLHttpRequest`. Chobitsu patches the main thread only — worker network activity is invisible.
- Timing is imprecise — no DNS/TCP breakdown, `performance.now()` only from JS execution
- Stack traces are parsed from `error.stack` strings — same content as CDP but slightly less structured (no `scriptId`)
- Can be accidentally bypassed: if application code caches a reference to `window.fetch` before chobitsu injects, those calls won't be intercepted
- Patching global APIs can interfere with application code in rare edge cases

**What it adds over CDP:**
Nothing that CDP doesn't already cover for the same signals. Chobitsu is a compatibility shim, not a capability expansion.

---

### C. Vite Plugin Instrumentation

As a Vite plugin, we can run a `transform` hook on every module before it's served to the browser. We receive the source AST, rewrite it, and return the modified code. The application never knows it's instrumented.

This is qualitatively different from the other two approaches. CDP and chobitsu observe the browser from the outside. Vite instrumentation rewrites the application from the inside.

**What this unlocks:**

**Call-site attribution.** When we rewrite `fetch(url, opts)` at the call site, we have access to everything in scope at that moment — the component name (from the surrounding function), the variable that holds `url`, the stack at instrumentation time. We can emit `{ type: 'network.request', component: 'CheckoutForm', trigger: 'handleSubmit', url }`. CDP cannot produce this.

**Worker coverage.** Vite transforms Web Workers, Shared Workers, and Service Workers with the same `transform` hook as main-thread code. We can inject instrumentation into every worker file — their `fetch`, `XMLHttpRequest`, and `WebSocket` calls become visible. The instrumented code inside a worker reports events back to the introspection server via `fetch` or WebSocket directly from the worker scope, no main-thread proxy needed. Chobitsu patches the main thread's globals at runtime and cannot reach worker scopes. CDP requires explicitly attaching a separate CDP session to each worker target as it spawns.

**Framework integration without explicit plugins.** Today Redux capture requires a user to add `plugin-redux` and wire it into their store. With AST transforms, we could detect `createStore` / `configureStore` imports and automatically inject our middleware — zero user configuration. Same for Zustand, Pinia, XState.

**Internal function tracing.** Wrap any function at import time. `routeLoader`, `authMiddleware`, `checkoutService` — emit enter/exit events with arguments and return values. This is what distributed tracing tools do; we'd be doing it at the Vite layer.

**Error boundaries with context.** Wrap render functions in try/catch, emit `js.error` with the component tree and props at the time of failure — not just the stack trace.

**Weaknesses:**
- Source transformation is complex and fragile. AST rewrites can produce incorrect code, break source maps, or interact badly with other transforms (e.g. SWC, esbuild, other Vite plugins).
- Build-time only — can't instrument code that was already compiled (node_modules, CDN scripts, inline `<script>` tags without processing).
- Slower builds. More transform work per module.
- Vite-only. Doesn't work with webpack, esbuild standalone, or non-bundled scripts.
- Instrumentation is always on in dev mode — requires careful feature-flagging for production.
- Node modules are typically excluded from transforms, so third-party library internals remain opaque unless explicitly included.

**What it can't do:**
Can't see below JavaScript. Network-level events (preloads, SW fetches, native browser requests) are still invisible. Source maps become more complex when the code has been double-transformed (your rewrite + the app's own transforms).

---

## Hybrid Approaches

The approaches are complementary, not competing.

### CDP + Vite instrumentation (recommended path)
Use CDP (via Playwright) for network and runtime events — it's accurate and reliable for those. Use Vite instrumentation for application-level signals: component lifecycle, state management, call-site attribution. The current plugin system (`plugin-redux`, `plugin-react`) is already doing this manually; instrumentation automates it.

### Chobitsu + Vite instrumentation (standalone path)
Drop the Playwright dependency entirely. Chobitsu handles network/error capture; Vite instrumentation handles application signals. Loses accurate request timing and service worker capture. Gains: works with any test runner, works in development sessions, no Playwright required.

### All three
Use CDP where Playwright is available (tests), fall back to chobitsu where it isn't (dev mode, other test runners). Vite instrumentation runs in both cases. The event schema is identical — the capture backend is an implementation detail.

---

## Decision Factors

**If the primary use case is Playwright test debugging:**
CDP is the right choice for network/runtime. Accurate timing, complete coverage, no JS interference. Vite instrumentation adds application context on top.

**If you want the library to work outside of Playwright tests:**
Chobitsu unlocks that. A dev server session, a Cypress test, a Vitest browser test — all become first-class citizens. The trade-off is losing sub-JS network visibility.

**If you want zero-config framework integration:**
Vite instrumentation is the only path. Auto-detecting Redux/Zustand/React and injecting capture without any user configuration is only possible at the transform layer.

**If you're building toward a standalone server:**
Chobitsu + Vite instrumentation gets you there. The standalone server receives WebSocket events from the browser; it doesn't need to speak CDP at all. Playwright becomes optional — useful when you have it, not required.

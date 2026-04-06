# Introspection Debug Sessions

Imagined debugging sessions — the AI investigator, the commands it runs, what introspection reveals, and how it gets to the answer. Each scenario is designed to show a different slice of the system.

---

## 1. The Login Loop

**Test:** `auth > login redirects to dashboard on success`
**Symptom:** Test fails on `expect(page).toHaveURL('/dashboard')` — URL is still `/login`.

```
introspect summary
```

```
Test:    auth > login redirects to dashboard on success  [FAILED]
File:    tests/auth.spec.ts
Status:  failed after 4.2s
Error:   expect(url).toBe('/dashboard') → received '/login'

Timeline (condensed):
  00:00  playwright.action  goto /login
  00:12  network.request    POST /api/auth/login  200
  00:14  playwright.action  fill [name=email]
  00:15  playwright.action  fill [name=password]
  00:16  playwright.action  click [type=submit]
  00:18  network.request    POST /api/auth/session  401
  00:20  browser.navigate   /login → /login  (no change)
  04:20  assertion failed
```

> Something got a 401. The login POST returned 200, but a second request to `/api/auth/session` returned 401. Let me look at the bodies.

```
introspect network
```

```
METHOD  URL                   STATUS  DURATION  EVENT
POST    /api/auth/login        200     84ms      evt_003
POST    /api/auth/session      401     12ms      evt_007
```

```
introspect body evt_003
```

```json
{
  "token": "eyJhbGci...",
  "expiresIn": 3600
}
```

```
introspect body evt_007
```

```json
{
  "error": "invalid_token",
  "message": "Authorization header missing or malformed"
}
```

> The login succeeded and returned a JWT. The second request to `/api/auth/session` didn't include it — "Authorization header missing". Let me check what happened in the Redux store between those two events.

```
introspect eval 'events.filter(e => e.type === "redux.action" && e.ts > 150 && e.ts < 200)'
```

```json
[
  {
    "type": "redux.action",
    "ts": 183,
    "data": {
      "action": { "type": "AUTH/LOGIN_SUCCESS" },
      "changedKeys": []
    }
  }
]
```

> `changedKeys` is empty. `AUTH/LOGIN_SUCCESS` was dispatched but nothing in the store changed — the reducer isn't handling it. The token was never saved, so the next request went out without an Authorization header.

**Root cause:** Redux reducer missing a case for `AUTH/LOGIN_SUCCESS`. The action type string in the action creator doesn't match the one in the reducer.

---

## 2. The Phantom Cart Item

**Test:** `cart > adding an item increments the count badge`
**Symptom:** Test clicks "Add to cart", then `expect(page.getByTestId('cart-count')).toHaveText('1')` fails — it still shows `0`.

```
introspect summary
```

```
Test:    cart > adding an item increments the count badge  [FAILED]
Error:   expect(locator).toHaveText('1') → received '0'

Timeline (condensed):
  00:00  playwright.action  goto /products/42
  00:80  playwright.action  click [data-testid=add-to-cart]
  00:82  network.request    POST /api/cart  200
  00:84  redux.action       CART/ADD_ITEM  changedKeys: [items]
  00:86  redux.action       CART/ADD_ITEM  changedKeys: [items]   ← duplicate!
  00:88  redux.action       CART/REMOVE_ITEM  changedKeys: [items]
  04:00  assertion failed
```

> Three Redux actions fired from one click. An add, then another add, then a remove? Let me see the full action payloads.

```
introspect eval 'events.filter(e => e.type === "redux.action").map(e => ({ ts: e.ts, action: e.data.action, after: e.data.stateAfter?.cart?.items?.length }))'
```

```json
[
  { "ts": 84, "action": { "type": "CART/ADD_ITEM", "payload": { "id": 42 } }, "after": 1 },
  { "ts": 86, "action": { "type": "CART/ADD_ITEM", "payload": { "id": 42 } }, "after": 2 },
  { "ts": 88, "action": { "type": "CART/REMOVE_ITEM", "payload": { "id": 42 } }, "after": 1 }
]
```

> The item count reaches 2 then drops back to 1. But the badge shows 0. That's a separate problem — the UI isn't reading the right slice.

```
introspect vars
```

```
Frame: CartBadge (CartBadge.tsx:12)
  count  →  0
  items  →  undefined
  (reading from props.cartItems, not store.cart.items)
```

> Two bugs: (1) the click handler fires twice — likely a React StrictMode double-invocation in dev, plus an `onClick` on both the button and its parent. (2) the badge reads from a stale prop instead of the store directly.

**Root cause:** Event bubbling causing double dispatch. Badge component receiving stale prop instead of subscribing to store.

---

## 3. The Silent Form Error

**Test:** `checkout > shows validation error on invalid card number`
**Symptom:** Test submits a form with `"1234"` as card number, expects an error message to appear. It doesn't.

```
introspect summary
```

```
Test:    checkout > shows validation error on invalid card number  [FAILED]
Error:   expect(locator).toBeVisible() → locator: [data-testid=card-error]

Timeline (condensed):
  00:00  playwright.action  goto /checkout
  00:40  playwright.action  fill [name=card], value: 1234
  00:42  playwright.action  click [type=submit]
  00:43  network.request    POST /api/payment/validate  422
  00:45  (nothing)
  04:00  assertion failed
```

> A 422 came back — the server did reject it. But nothing happened in the UI. Let me see the response.

```
introspect body evt_005 --path ".errors"
```

```json
[{ "field": "card_number", "message": "Must be 16 digits" }]
```

> The errors are in the body. Let me check what the Redux store did with them.

```
introspect eval 'events.filter(e => e.type === "redux.action" && e.ts > 43)'
```

```json
[]
```

> No Redux actions after the 422. The response handler isn't dispatching anything. Let me check if there was a JS error.

```
introspect errors
```

```
js.error  ts: 44ms
  TypeError: Cannot read properties of undefined (reading 'errors')
  at handlePaymentResponse (checkout.ts:87)
  at processTicksAndRejections (node:internal/process/task_queues:96)
```

```
introspect vars
```

```
Frame: handlePaymentResponse (checkout.ts:87)
  response  →  { status: 422, data: undefined }
```

> The response `data` is `undefined`. The fetch wrapper is only parsing the body on 2xx responses. A 422 falls through with `data: undefined`, then `response.data.errors` throws, the error is swallowed by an unhandled promise rejection, and the UI never updates.

**Root cause:** HTTP wrapper not parsing response body on 4xx. Unhandled promise rejection silently swallowing the error display path.

---

## 4. The Race Condition

**Test:** `dashboard > shows user profile after login`
**Symptom:** Flaky — passes 7/10 times. When it fails, the profile shows a previous user's data.

```
introspect compare passing-run.trace.json failing-run.trace.json
```

```
Differing event sequences around ts 200–350:

PASSING                              FAILING
─────────────────────────────────── ──────────────────────────────────
200  network.request  GET /api/me    200  network.request  GET /api/me
210  redux.action     SET_USER_ID    210  redux.action     SET_USER_ID
220  network.response /api/me 200    350  network.response /api/me 200  ← 130ms later
230  redux.action     LOAD_PROFILE
240  redux.action     LOAD_PROFILE   220  network.request  GET /profile (stale userId)
                                     240  network.response /profile 200 (wrong user)
                                     260  redux.action     LOAD_PROFILE  (wrong data)
                                     350  redux.action     LOAD_PROFILE  (correct data, ignored)
```

> In the failing run, `/api/me` was slow (350ms vs 220ms). A second request to `/profile` fired before `/api/me` resolved, using a stale `userId`. When `/api/me` finally came back, `LOAD_PROFILE` fired a second time but the first response had already set the wrong profile data.

```
introspect eval 'events.filter(e => e.type === "redux.action" && e.data.action.type === "LOAD_PROFILE")' --trace failing-run
```

```json
[
  { "ts": 260, "data": { "action": { "type": "LOAD_PROFILE", "payload": { "userId": "usr_old" } } } },
  { "ts": 350, "data": { "action": { "type": "LOAD_PROFILE", "payload": { "userId": "usr_new" } } } }
]
```

> Two `LOAD_PROFILE` dispatches with different user IDs, ~90ms apart. The first wins because it resolved first and the second dispatch doesn't overwrite correctly (reducer merges instead of replaces).

**Root cause:** Profile fetch initiated before `userId` is confirmed from `/api/me`. Race condition — the faster request wins. Fix: gate the profile fetch on the resolved userId, or abort in-flight requests when userId changes.

---

## 5. The Black Canvas

**Test:** `renderer > WebGL scene renders after data load`
**Symptom:** The canvas is black. Screenshot shows nothing.

```
introspect summary
```

```
Test:    renderer > WebGL scene renders after data load  [FAILED]
Error:   expect(canvas).toMatchScreenshot() → pixel diff 100% (entirely black)

Timeline (condensed):
  00:00  playwright.action  goto /scene/42
  00:50  network.request    GET /api/scene/42  200
  00:55  plugin.webgl.frame  drawCalls: 0  glErrors: []  primitiveCount: 0
  00:60  plugin.webgl.frame  drawCalls: 0  glErrors: []  primitiveCount: 0
  00:65  plugin.webgl.frame  drawCalls: 0  glErrors: []  primitiveCount: 0
  00:70  mark  'scene-data-loaded'
  00:75  plugin.webgl.frame  drawCalls: 0  glErrors: []  primitiveCount: 0
  02:00  assertion failed
```

> The scene data loaded but every frame has zero draw calls. Something's preventing rendering from starting. Let me check the WebGL state at the last snapshot.

```
introspect eval 'events.findLast(e => e.type === "plugin.webgl.stateSnapshot")?.data'
```

```json
{
  "shaders": [
    { "type": "VERTEX_SHADER",   "compiled": true,  "log": "" },
    { "type": "FRAGMENT_SHADER", "compiled": false, "log": "ERROR: 0:12: 'vTexCoord' : undeclared identifier" }
  ],
  "programs": [
    { "linked": false, "log": "Fragment shader compilation failed." }
  ],
  "textures": [],
  "frames": { "total": 58, "last": { "drawCalls": 0, "glErrors": [], "primitiveCount": 0 } }
}
```

> Fragment shader failed to compile. The render loop checks `program.linked` before issuing draw calls, so it silently skips. No `glError` because the draw calls never happen.

```
introspect eval 'events.findLast(e => e.type === "plugin.webgl.stateSnapshot")?.data.shaders[1].log'
```

```
"ERROR: 0:12: 'vTexCoord' : undeclared identifier\nERROR: 0:12: 'texture2D' : no matching overloaded function found"
```

> `vTexCoord` is undeclared — the varying from the vertex shader isn't reaching the fragment shader, probably a name mismatch or missing declaration.

**Root cause:** Fragment shader references `vTexCoord` but vertex shader outputs `vUV`. Shader compilation silently fails; render loop guards on `program.linked` and emits nothing.

---

## 6. The Slow Dashboard

**Test:** `perf > dashboard LCP under 2500ms`
**Symptom:** LCP is 3800ms. No obvious error.

```
introspect summary
```

```
Test:    perf > dashboard LCP under 2500ms  [FAILED]
Error:   expect(lcp).toBeLessThan(2500) → received 3847

Timeline (condensed):
  00:00  playwright.action  goto /dashboard
  00:10  perf.resource      GET /dashboard  (document)  TTFB: 42ms
  00:15  perf.resource      GET /bundle.js              load: 380ms
  00:40  perf.resource      GET /fonts/inter.woff2      load: 1240ms  ← !
  00:80  perf.vital         FCP  ts: 820ms
  00:82  perf.longtask      duration: 620ms  attribution: bundle.js
  38:47  perf.vital         LCP  ts: 3847ms  element: img.avatar
```

> A 1.24s font load and a 620ms long task before FCP. LCP is a `img.avatar` loading at 3847ms. Let me check what network activity happened around that time.

```
introspect network --url avatar
```

```
METHOD  URL                              STATUS  DURATION
GET     /api/user/profile                200     34ms
GET     /storage/avatars/usr_42.png      200     2890ms   ← !
```

> 2.89 seconds for an avatar image. Let me check the response headers.

```
introspect body evt_031
```

```json
{
  "bodySummary": {
    "keys": [],
    "scalars": {},
    "arrays": {}
  }
}
```

```
introspect eval 'events.find(e => e.id === "evt_031")?.data.headers'
```

```json
{
  "content-type": "image/png",
  "content-length": "4821032",
  "cache-control": "no-cache"
}
```

> 4.8MB avatar image, no caching. That's the LCP element. The font and long task explain the late FCP but the avatar dominates. Two independent problems.

**Root cause:** (1) 4.8MB unoptimised avatar image is the LCP element. (2) No `cache-control` on a static asset. Secondary: Google Fonts-style render-blocking font not preloaded. Fix: resize/compress avatar server-side, add cache headers, add `<link rel="preload">` for the font.

---

## 7. The Invisible A11y Regression

**Test:** `a11y > keyboard navigation reaches all interactive elements`
**Symptom:** Test passes but a CI a11y check flags a new violation.

```
introspect eval 'events.filter(e => e.type === "a11y.violation")'
```

```json
[
  {
    "type": "a11y.violation",
    "ts": 420,
    "data": {
      "id": "color-contrast",
      "impact": "serious",
      "nodes": [
        {
          "html": "<button class=\"btn-ghost\">Cancel</button>",
          "failureSummary": "Fix any of the following: Element has insufficient color contrast of 1.89 (foreground: #aaaaaa, background: #ffffff, expected: 4.5)"
        }
      ]
    }
  },
  {
    "type": "a11y.violation",
    "ts": 420,
    "data": {
      "id": "button-name",
      "impact": "critical",
      "nodes": [
        {
          "html": "<button class=\"icon-btn\"><svg>...</svg></button>",
          "failureSummary": "Fix any of the following: Element does not have an accessible name"
        }
      ]
    }
  }
]
```

> Two violations at the same timestamp (both from a single axe-core scan on page load): a contrast failure on the Cancel button and an icon button with no accessible name.

```
introspect a11y --trace feature-branch-run --diff main-run
```

```
New violations introduced (not present in main):
  [critical]  button-name     <button class="icon-btn"> — 1 node
  [serious]   color-contrast  <button class="btn-ghost"> — 1 node

Resolved violations (present in main, gone now):
  (none)
```

> Both violations are new in this branch. The icon button and the grey cancel button were likely added or restyled in this PR.

```
introspect dom --at 420
```

```html
<!-- ... -->
<button class="icon-btn" data-action="close">
  <svg aria-hidden="true">...</svg>
</button>
<!-- ... -->
<button class="btn-ghost" style="color: #aaa">Cancel</button>
```

> Confirmed: icon button has no `aria-label` or `title`. Cancel button has inline grey colour override.

**Root cause:** New close button added without accessible name. Cancel button colour changed to `#aaa` which fails WCAG AA contrast ratio against white.

---

## 8. The Optimistic Update That Wasn't

**Test:** `todos > deleting an item removes it immediately from the list`
**Symptom:** The item disappears then reappears. Test fails because the item is still visible at assertion time.

```
introspect timeline --type redux.action,network.request,network.response
```

```
  00:00  playwright.action  click [data-testid=delete-42]
  00:02  redux.action       TODOS/DELETE_OPTIMISTIC  id: 42  → items: 11
  00:04  network.request    DELETE /api/todos/42
  00:06  redux.action       TODOS/FETCH_ALL          → items: 12   ← !!
  00:08  network.response   DELETE /api/todos/42  204
  00:12  redux.action       TODOS/DELETE_SUCCESS  id: 42  → items: 11
```

> The optimistic delete fired correctly (items: 12 → 11). But at ts:06, two milliseconds later, `TODOS/FETCH_ALL` fired and re-fetched all 12 items — including the one being deleted. The delete response came back at ts:08 and the success action put the store back to 11, but by then the test assertion had already run.

```
introspect eval 'events.filter(e => e.type === "redux.action" && e.data.action.type === "TODOS/FETCH_ALL")'
```

```json
[{ "ts": 6, "data": { "action": { "type": "TODOS/FETCH_ALL", "trigger": "focus" } } }]
```

> `trigger: "focus"`. The window focus listener is triggering a full re-fetch. The Playwright click focused the browser window just before the delete request resolved, which fired the focus handler, which fetched the full stale list and overwrote the optimistic state.

**Root cause:** `window.addEventListener('focus', fetchAllTodos)` races with in-flight mutations. The focus fetch doesn't check for pending mutations before overwriting the store.

---

## 9. The Token That Expired Mid-Test

**Test:** `session > user can complete a multi-step checkout`
**Symptom:** Test fails at step 3 of 4 with a 401. Steps 1–2 pass fine.

```
introspect network --failed
```

```
METHOD  URL                     STATUS  ERROR
POST    /api/checkout/payment    401     —
```

```
introspect body evt_089 --path ".error"
```

```
"token_expired"
```

```
introspect eval 'events.filter(e => e.type === "cookie.set" || e.type === "cookie.remove")'
```

```json
[
  { "ts": 12,   "type": "cookie.set",    "data": { "name": "session", "expires": "+30s" } },
  { "ts": 31842,"type": "cookie.remove", "data": { "name": "session", "reason": "expired" } }
]
```

> The session cookie was set with a 30-second TTL and expired at ts:31842. Step 3 started at ts:32100 — 258ms after expiry.

```
introspect eval 'events.filter(e => e.type === "playwright.action").map(e => ({ ts: e.ts, action: e.data.method, args: e.data.args[0] }))'
```

```json
[
  { "ts": 200,   "action": "fill",  "args": "[name=address]" },
  { "ts": 18000, "action": "click", "args": "[data-testid=step-2-next]" },
  { "ts": 30000, "action": "fill",  "args": "[name=card]" },
  { "ts": 32100, "action": "click", "args": "[data-testid=pay-now]" }
]
```

> Steps are spread across 32 seconds. The test fills in form fields slowly (likely due to `waitForSelector` timeouts between fields). The session TTL in the test environment is 30s — too short for a multi-step flow.

**Root cause:** Test session cookie TTL (30s) shorter than the test execution time (32s). Test environment uses a different TTL than production. Fix: extend the test session TTL or mock time in the test.

---

## 10. The WebSocket That Stopped Talking

**Test:** `realtime > new messages appear without refresh`
**Symptom:** First message appears, then nothing. Test times out waiting for the second.

```
introspect timeline --type ws.send,ws.receive,js.error
```

```
  00:00  playwright.action  goto /chat/room-1
  00:10  ws.receive  {"type":"connected","userId":"usr_1"}
  00:12  ws.receive  {"type":"message","id":1,"text":"Hello"}
  00:14  mark        'first-message-visible'
  00:16  ws.send     {"type":"subscribe","channel":"room-1"}
  00:18  js.error    TypeError: Cannot set properties of undefined (setting 'lastMessage')
              at MessageStore.handleMessage (store/messages.ts:34)
  00:18  (WebSocket connection drops — no further ws.receive events)
  30:00  timeout
```

> An unhandled error in `MessageStore.handleMessage` at ts:18. Let me see the error detail.

```
introspect vars
```

```
Frame: MessageStore.handleMessage (store/messages.ts:34)
  msg       →  { type: "message", id: 2, text: "World", roomId: "room-1" }
  this      →  MessageStore { rooms: Map(0) {} }
  room      →  undefined
```

> `room` is undefined because `rooms` is an empty Map. The store received a message for `room-1` but the room wasn't initialised. The `subscribe` message went out at ts:16 but the room initialisation that should happen before that never ran.

```
introspect eval 'events.filter(e => e.type === "ws.receive").map(e => e.data.payload)'
```

```json
[
  { "type": "connected", "userId": "usr_1" },
  { "type": "message", "id": 1, "text": "Hello" },
  { "type": "message", "id": 2, "text": "World" }
]
```

> The first message (id:1) arrived before the subscribe acknowledgement — the server is pushing messages before the client is ready. The subscribe handler initialises the room map, but messages are arriving before subscribe fires.

**Root cause:** Server pushes messages immediately on connection before the client has sent `subscribe`. `MessageStore` expects the room to exist (created in the subscribe handler) before messages arrive. Fix: initialise the room map on `connected`, not on `subscribe`.

---

## 11. The Memory Leak

**Test:** `perf > memory stays stable across 50 navigation cycles`
**Symptom:** Heap grows ~2MB per cycle. After 50 cycles it's 100MB over baseline.

```
introspect eval 'events.filter(e => e.type === "perf.memory").map(e => ({ ts: e.ts, used: e.data.usedJSHeapSize }))'
```

```json
[
  { "ts": 100,   "used": 24500000 },
  { "ts": 2100,  "used": 26700000 },
  { "ts": 4100,  "used": 28800000 },
  { "ts": 6100,  "used": 30900000 },
  ...
  { "ts": 100100,"used": 124200000 }
]
```

> Steady 2.1MB growth per cycle, perfectly linear. That's a leak with a consistent per-navigation cost, not random GC noise.

```
introspect eval 'events.filter(e => e.type === "redux.action" && e.data.action.type.includes("SUBSCRIBE")).length'
```

```
50
```

```
introspect eval 'events.filter(e => e.type === "redux.action" && e.data.action.type.includes("UNSUBSCRIBE")).length'
```

```
0
```

> 50 subscriptions, zero unsubscriptions. Something is subscribing on every navigation and never cleaning up.

```
introspect eval 'events.filter(e => e.type === "redux.action" && e.data.action.type.includes("SUBSCRIBE")).map(e => e.data.action)'
```

```json
[
  { "type": "ANALYTICS/SUBSCRIBE_TO_EVENTS", "payload": { "component": "DashboardPage" } },
  { "type": "ANALYTICS/SUBSCRIBE_TO_EVENTS", "payload": { "component": "DashboardPage" } },
  ...
]
```

> `DashboardPage` subscribes to an analytics event bus on mount and never unsubscribes on unmount. Each navigation creates a new closure over the component instance.

**Root cause:** `DashboardPage` calls `analytics.subscribe()` in a `useEffect` without a cleanup return. Each mount adds a listener; dismounts don't remove them. Fix: `return () => analytics.unsubscribe(handler)` in the effect.

---

## 12. The Stale Service Worker Cache

**Test:** `deploy > updated pricing shows after hard refresh`
**Symptom:** Old prices still visible after navigation. Network shows the correct data.

```
introspect network --url pricing
```

```
METHOD  URL                    STATUS  DURATION  SOURCE
GET     /api/pricing           200     4ms       service-worker (cache hit)
GET     /api/pricing           200     84ms      network
```

> Two requests to `/api/pricing`. The first was served by the Service Worker from cache (4ms). The second was a network fetch.

```
introspect eval 'events.filter(e => e.type === "sw.fetch")'
```

```json
[
  {
    "ts": 45,
    "type": "sw.fetch",
    "data": {
      "url": "/api/pricing",
      "strategy": "cache-first",
      "cacheHit": true,
      "cachedAt": "2026-03-28T10:00:00Z"   ← 6 days ago
    }
  }
]
```

> Cache-first strategy, 6-day-old cached response. The SW is serving stale pricing data before the network response arrives. The network fetch at 84ms returned the correct data but by then the component had already rendered with the cached value and the update wasn't triggering a re-render.

```
introspect eval 'events.filter(e => e.type === "redux.action" && e.data.action.type === "PRICING/LOADED")'
```

```json
[
  { "ts": 46, "data": { "action": { "type": "PRICING/LOADED", "payload": { "monthly": 29 } } } },
  { "ts": 89, "data": { "action": { "type": "PRICING/LOADED", "payload": { "monthly": 39 } } } }
]
```

> Two `PRICING/LOADED` dispatches. First at ts:46 (stale: $29/mo), second at ts:89 (fresh: $39/mo). The second dispatch should update the UI. Let me check if it does.

```
introspect eval 'events.filter(e => e.type === "redux.action" && e.data.action.type === "PRICING/LOADED").map(e => e.data.stateAfter.pricing)'
```

```json
[
  { "monthly": 29, "source": "cache" },
  { "monthly": 39, "source": "network" }
]
```

> The store updated correctly to $39. But the test assertion runs before the component re-renders after the second update.

**Root cause:** Two issues: (1) SW `cache-first` strategy serving 6-day-old data before network response. (2) Test assertion runs before the network-updated value renders. Fix SW to `stale-while-revalidate` with a cache TTL, and await the correct value in the test.

---

## 13. The XState Trap

**Test:** `upload > shows progress then success screen`
**Symptom:** Progress bar appears but "success" screen never shows. Test times out.

```
introspect timeline --type plugin.xstate.transition,network.request,network.response
```

```
  00:00  playwright.action       goto /upload
  00:10  playwright.action       click [data-testid=file-input]  (file selected via CDP)
  00:12  plugin.xstate.transition  idle → uploading  (event: SELECT_FILE)
  00:14  network.request         POST /api/upload/start   200
  00:16  plugin.xstate.transition  uploading → uploading  (event: CHUNK_SENT)
  00:18  plugin.xstate.transition  uploading → uploading  (event: CHUNK_SENT)
  ...×48 more CHUNK_SENT transitions...
  02:20  network.response        POST /api/upload/complete  200
  02:22  plugin.xstate.transition  uploading → uploading  (event: CHUNK_SENT)   ← still!
  30:00  timeout
```

> 50 `CHUNK_SENT` transitions and the machine never left `uploading`. The `complete` response arrived at ts:2220 but no transition fired.

```
introspect eval 'events.find(e => e.type === "plugin.xstate.transition" && e.data.event === "UPLOAD_COMPLETE")'
```

```
null
```

> No `UPLOAD_COMPLETE` event was ever sent to the machine. The network response handler isn't dispatching it.

```
introspect eval 'events.filter(e => e.type === "network.response" && e.data.url.includes("upload")).map(e => ({ ts: e.ts, url: e.data.url, status: e.data.status }))'
```

```json
[
  { "ts": 14, "url": "/api/upload/start",    "status": 200 },
  { "ts": 2220,"url": "/api/upload/complete", "status": 200 }
]
```

```
introspect body evt_112
```

```json
{ "uploadId": "upl_99", "url": "/files/upl_99", "size": 2048000 }
```

> The complete response returned correctly. Let me check for a JS error around ts:2220.

```
introspect errors
```

```
js.error  ts: 2221ms
  TypeError: send is not a function
  at handleUploadComplete (upload-machine.ts:89)
```

> `send is not a function`. The `handleUploadComplete` callback lost its reference to the XState `send` function. Likely captured in a closure before the actor was started, or the callback was passed as a plain function reference and `this` was lost.

**Root cause:** XState actor's `send` function passed by reference into a promise callback. By the time the promise resolves, the closure reference is stale (actor was restarted). Fix: use the actor reference directly, or use XState's `fromPromise` actor pattern instead of manual callbacks.

---

## 14. The GraphQL Cascade

**Test:** `team > loading team members shows avatars`
**Symptom:** Some avatars load, some show broken images. Flaky — different avatars fail each time.

```
introspect gql
```

```
OPERATION       TYPE   STATUS  DURATION  ERRORS
GetTeamMembers  query  200     45ms      —
GetAvatarUrl    query  200     12ms      —
GetAvatarUrl    query  200     14ms      —
GetAvatarUrl    query  500     —         "upstream_timeout"
GetAvatarUrl    query  200     18ms      —
GetAvatarUrl    query  500     —         "upstream_timeout"
```

> Two `GetAvatarUrl` queries are returning 500. These are per-member queries — N+1 style, one per team member. Some hit an upstream timeout.

```
introspect eval 'events.filter(e => e.type === "gql.operation" && e.data.errors).map(e => ({ id: e.id, variables: e.data.variables, errors: e.data.errors }))'
```

```json
[
  { "id": "evt_045", "variables": { "userId": "usr_14" }, "errors": [{ "message": "upstream_timeout" }] },
  { "id": "evt_051", "variables": { "userId": "usr_27" }, "errors": [{ "message": "upstream_timeout" }] }
]
```

```
introspect network --url avatar
```

```
METHOD  URL                              STATUS  DURATION
GET     /internal/avatar-service/usr_14   —       3001ms  (timeout)
GET     /internal/avatar-service/usr_27   —       3001ms  (timeout)
```

> Both timed out at exactly 3001ms — a hard timeout limit in the avatar service. Two specific user IDs are consistently slow; the rest are fast.

```
introspect compare failing-run-1.trace.json failing-run-2.trace.json --focus gql.operation
```

```
Consistent across both failing runs:
  GetAvatarUrl { userId: "usr_14" }  → upstream_timeout
  GetAvatarUrl { userId: "usr_27" }  → upstream_timeout
```

> The same two user IDs fail every time — not random. These users likely have a data issue in the avatar service (missing record, corrupt entry, infinite loop).

**Root cause:** N+1 GraphQL query pattern + two specific user IDs that hit a slow path in the upstream avatar service. Fix: (1) batch `GetAvatarUrl` into a single `GetAvatarUrls(userIds: [ID!]!)` query. (2) Investigate why `usr_14` and `usr_27` cause timeouts in the avatar service.

---

## 15. The First Paint That Never Comes

**Test:** `ssr > page is interactive in under 3s on slow 3G`
**Symptom:** FCP is 7.2s. The page appears but nothing is interactive.

```
introspect timeline --type perf.vital,perf.resource,perf.longtask,js.error
```

```
  00:00  playwright.action  goto /  (3G throttled)
  00:80  perf.resource      /  (HTML document)  TTFB: 78ms  transfer: 220ms
  00:90  perf.resource      /bundle.js           transfer: 4800ms  ← 4.8s!
  58:50  perf.vital         FCP  7200ms
  58:52  perf.longtask      duration: 4200ms  attribution: bundle.js (eval)
  58:56  perf.longtask      duration: 1800ms  attribution: bundle.js (eval)
  72:00  assertion failed
```

> The HTML arrived in 300ms but the JS bundle took 4.8s to transfer on 3G and another 6s to evaluate. FCP is gated on JS execution.

```
introspect eval 'events.filter(e => e.type === "perf.resource" && e.data.name.endsWith(".js")).map(e => ({ name: e.data.name, size: e.data.transferSize }))'
```

```json
[
  { "name": "/bundle.js",         "size": 2840000 },
  { "name": "/vendor.js",         "size": 1920000 },
  { "name": "/chunk-react.js",    "size": 143000  },
  { "name": "/chunk-lodash.js",   "size": 71000   }
]
```

> 2.8MB main bundle + 1.9MB vendor bundle = 4.7MB of JS on the critical path. Nothing is split or deferred. The page is fully blocked on parse+eval.

```
introspect eval 'events.filter(e => e.type === "perf.longtask").reduce((sum, e) => sum + e.data.duration, 0)'
```

```
6000
```

> 6 seconds of long tasks, all from bundle evaluation. No async loading, no code splitting, no streaming SSR suspense boundaries.

**Root cause:** Monolithic JS bundles (4.7MB) with no code splitting. Everything on the critical path. Fix: route-based code splitting, dynamic imports for below-fold components, defer non-critical vendor libs, consider streaming SSR with Suspense boundaries.

---

*Add more scenarios here. Good candidates: IndexedDB corruption, CSS animation regression caught by visual diff, multi-tab auth sync via BroadcastChannel, Electron IPC failure, Remix loader race, React Suspense deadlock.*

# Introspection Debug Sessions

Imagined debugging sessions using the current system. Every event type, CLI command, and output shown here is real and working.

Real event types: `network.request`, `network.response`, `network.error`, `js.error`, `browser.navigate`, `mark`, `playwright.action`, `asset`, `webgl.context-created`, `webgl.uniform`, `webgl.draw-arrays`, `webgl.draw-elements`, `webgl.texture-bind`.

Real commands: `summary`, `timeline`, `errors`, `snapshot`, `network`, `body`, `dom`, `events`, `eval`, `list`.

---

## 1. The Login Loop

**Test:** `auth > login redirects to dashboard on success`
**Symptom:** Test fails on `expect(page).toHaveURL('/dashboard')` — URL is still `/login`.

```
introspect summary
```

```
Test:    auth > login redirects to dashboard on success  [FAILED]
Status:  failed after 4.2s
Error:   expect(url).toBe('/dashboard') → received '/login'

Timeline (condensed):
  00:00  playwright.action  goto /login
  00:12  playwright.action  fill [name=email]
  00:14  playwright.action  fill [name=password]
  00:16  playwright.action  click [type=submit]
  00:18  network.request    POST /api/auth/login       200
  00:20  network.request    POST /api/auth/session     401
  00:22  browser.navigate   /login → /login  (no change)
  04:20  assertion failed
```

> Something got a 401. The login POST returned 200 but a second request to `/api/auth/session` returned 401. Let me look at the bodies.

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

> The login succeeded and returned a JWT. The session request says "Authorization header missing". Let me check what headers were sent.

```
introspect eval 'events.find(e => e.id === "evt_007")?.data.headers'
```

```json
{
  "content-type": "application/json",
  "accept": "*/*"
}
```

> No `Authorization` header. The token came back from login but was never attached to the follow-up request. The client received the JWT but didn't store it before firing the session request.

**Root cause:** The session request fires before the login response handler stores the JWT. The auth flow doesn't wait for the token to be persisted before continuing.

---

## 2. The Silent Form Error

**Test:** `checkout > shows validation error on invalid card number`
**Symptom:** Form submitted with `"1234"` as card number. Expected an error message. Nothing appears.

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
  00:45  js.error           TypeError: Cannot read properties of undefined (reading 'errors')
  04:00  assertion failed
```

> A 422 came back and then a JS error. Let me see both.

```
introspect body evt_005 --path "$.errors"
```

```json
[{ "field": "card_number", "message": "Must be 16 digits" }]
```

```
introspect errors
```

```
js.error  ts: 45ms
  TypeError: Cannot read properties of undefined (reading 'errors')
  at handlePaymentResponse (checkout.ts:87)
  at processTicksAndRejections (node:internal/process/task_queues:96)
```

> The server returned the validation errors correctly, but a JS error fired in the response handler. Let me see the scope.

```
introspect snapshot
```

```
Frame: handlePaymentResponse (checkout.ts:87)
  response  →  { status: 422, data: undefined }
  errors    →  undefined
```

> `response.data` is `undefined`. The HTTP wrapper only parses the body on 2xx responses. A 422 falls through unparsed, then `response.data.errors` throws, the promise rejects silently, and the UI never shows the error.

**Root cause:** HTTP wrapper not parsing response body on 4xx. The error is caught by an outer promise handler that swallows it instead of dispatching to the UI.

---

## 3. The Black Canvas

**Test:** `renderer > WebGL scene renders after data load`
**Symptom:** Canvas is entirely black.

```
introspect summary
```

```
Test:    renderer > WebGL scene renders after data load  [FAILED]
Error:   expect(canvas).toMatchScreenshot() → pixel diff 100% (entirely black)

Timeline (condensed):
  00:00  playwright.action    goto /scene/42
  00:50  network.request      GET /api/scene/42  200
  00:55  mark                 'scene-data-loaded'
  00:60  webgl.draw-arrays    primitive: TRIANGLES  count: 0
  00:65  webgl.draw-arrays    primitive: TRIANGLES  count: 0
  02:00  assertion failed
```

> Draw calls are firing but with `count: 0`. The geometry isn't being submitted. Let me check what uniform values were set around scene load.

```
introspect events --type webgl.uniform --since scene-data-loaded
```

```json
[]
```

> No uniforms set after the mark. The scene data loaded but nothing was handed to the shaders. Let me check if any uniforms were set at all.

```
introspect events --type webgl.uniform
```

```json
[]
```

> Zero uniform events across the whole session. The geometry buffer may be empty but let me check what the JS error says — there might be a silent failure earlier.

```
introspect errors
```

```
js.error  ts: 52ms
  TypeError: Cannot read properties of null (reading 'position')
  at SceneLoader.buildGeometry (scene-loader.ts:134)
```

```
introspect snapshot
```

```
Frame: SceneLoader.buildGeometry (scene-loader.ts:134)
  scene     →  { nodes: [], meshes: [] }
  mesh      →  null
```

> The scene loaded but `meshes` is empty — `mesh` is null. `buildGeometry` throws immediately, the geometry is never built, and `drawArrays` fires with a zero-length buffer.

**Root cause:** API response parsed successfully but mesh data is under a different key than expected (`scene.geometry` instead of `scene.meshes`). The error was swallowed; draw calls fired against an uninitialised buffer.

---

## 4. The Uniform That Stopped Updating

**Test:** `renderer > animation plays at correct speed`
**Symptom:** Scene renders but animation appears frozen after ~2 seconds.

The test uses `plugin.watch({ event: 'uniform', name: 'u_time', valueChanged: true })`.

```
introspect summary
```

```
Test:    renderer > animation plays at correct speed  [FAILED]
Error:   visual diff — frame at t=3000ms identical to frame at t=2000ms

Timeline (condensed):
  00:00  playwright.action   goto /scene
  00:10  webgl.context-created  contextId: ctx_1
  00:16  mark                'animation-start'
  00:16  webgl.uniform       u_time = 0.016  (changed)
  00:32  webgl.uniform       u_time = 0.032  (changed)
  ...
  02:000 webgl.uniform       u_time = 2.000  (changed)
  02:016 js.error            TypeError: Cannot read properties of undefined (reading 'now')
  (no further webgl.uniform events)
```

> `u_time` was updating correctly until a JS error at t=2016ms. After that, nothing. The error killed the animation loop.

```
introspect errors
```

```
js.error  ts: 2016ms
  TypeError: Cannot read properties of undefined (reading 'now')
  at AnimationLoop.tick (animation.ts:28)
```

```
introspect snapshot
```

```
Frame: AnimationLoop.tick (animation.ts:28)
  this        →  AnimationLoop { clock: undefined, running: true }
  timestamp   →  2016.4
```

> `this.clock` is `undefined`. The clock was destroyed (likely in a cleanup handler that fired prematurely) while the loop was still running. `tick` then throws, the RAF callback stops scheduling itself, and `u_time` freezes.

**Root cause:** Component unmount handler calls `clock.destroy()` while animation loop is still active. The loop doesn't check for a destroyed clock before calling `clock.now()`.

---

## 5. The Texture Bind Storm

**Test:** `renderer > frame renders in under 16ms`
**Symptom:** Frame time is 34ms. Profiler shows GPU stalls.

The test uses `plugin.watch({ event: 'texture-bind' })` and `plugin.watch({ event: 'draw' })`.

```
introspect events --type webgl.texture-bind,webgl.draw-arrays
```

```json
[
  { "ts": 16, "type": "webgl.texture-bind", "data": { "unit": 0, "target": "TEXTURE_2D" } },
  { "ts": 16, "type": "webgl.texture-bind", "data": { "unit": 0, "target": "TEXTURE_2D" } },
  { "ts": 16, "type": "webgl.texture-bind", "data": { "unit": 0, "target": "TEXTURE_2D" } },
  { "ts": 17, "type": "webgl.draw-arrays",  "data": { "primitive": "TRIANGLES", "count": 6 } },
  { "ts": 17, "type": "webgl.texture-bind", "data": { "unit": 0, "target": "TEXTURE_2D" } },
  { "ts": 17, "type": "webgl.texture-bind", "data": { "unit": 0, "target": "TEXTURE_2D" } },
  ...
]
```

> Multiple `texture-bind` calls before every draw. Let me count the ratio.

```
introspect eval '
  const binds = events.filter(e => e.type === "webgl.texture-bind").length
  const draws = events.filter(e => e.type === "webgl.draw-arrays").length
  ({ binds, draws, ratio: (binds / draws).toFixed(1) })
'
```

```json
{ "binds": 847, "draws": 94, "ratio": "9.0" }
```

> 9 texture binds per draw call. That's the entire texture atlas being rebound on every draw. Texture binds are expensive GPU state changes — batching by texture would eliminate most of them.

**Root cause:** Renderer sorts draw calls by mesh, not by texture. Each draw call rebinds all 9 textures from scratch. Fix: sort draw calls by texture to minimise state changes, or pack into a texture atlas with a single bind.

---

## 6. The Race Condition

**Test:** `dashboard > shows user profile after login`
**Symptom:** Flaky — passes 8/10 times. When it fails, the profile name is wrong.

```
introspect timeline --type network.request,network.response,playwright.action
```

**Passing run:**
```
  00:00  playwright.action  goto /login
  00:80  playwright.action  fill + click (login form)
  00:90  network.request    POST /api/auth/login   200
  00:95  network.request    GET /api/me             200  (ts: 95ms)
  00:105 network.response   GET /api/me             →  userId: usr_new
  00:110 network.request    GET /api/profile/usr_new  200
  00:150 network.response   GET /api/profile/usr_new → name: "Alice"
```

**Failing run:**
```
  00:00  playwright.action  goto /login
  00:80  playwright.action  fill + click (login form)
  00:90  network.request    POST /api/auth/login   200
  00:95  network.request    GET /api/me             200  (ts: 95ms)
  00:96  network.request    GET /api/profile/usr_old  200  ← fired before /api/me resolved
  00:120 network.response   GET /api/profile/usr_old → name: "Bob"  (stale)
  00:340 network.response   GET /api/me             →  userId: usr_new  (slow)
  00:345 network.request    GET /api/profile/usr_new  200
  00:380 network.response   GET /api/profile/usr_new → name: "Alice"  (ignored — component already rendered)
```

> In the failing run `/api/me` took 245ms longer. The profile fetch used a stale userId from the previous session because the component didn't wait for `/api/me` to resolve before initiating it.

```
introspect eval 'events.filter(e => e.type === "network.request" && e.data.url.includes("/api/profile")).map(e => ({ ts: e.ts, url: e.data.url }))'
```

```json
[
  { "ts": 96,  "url": "/api/profile/usr_old" },
  { "ts": 345, "url": "/api/profile/usr_new" }
]
```

> Two profile requests. The first wins the render race with stale data. The second request resolves correctly but by then the component has already rendered and isn't re-fetching.

**Root cause:** Profile fetch initiates on mount using whatever userId is in storage — without waiting for the `/api/me` confirmation. When `/api/me` is slow the stale userId wins.

---

## 7. The Overloaded Response

**Test:** `dashboard > renders in under 2 seconds`
**Symptom:** Test times out at 2s. The dashboard itself appears to load fine visually.

```
introspect network
```

```
METHOD  URL                        STATUS  DURATION
GET     /api/dashboard/summary      200     1840ms   ←
GET     /api/user/me                200     34ms
GET     /api/notifications          200     12ms
```

> One request dominating at 1840ms. Let me check the response.

```
introspect body evt_002 --jq '.data | length'
```

```
4821
```

```
introspect body evt_002 --jq '.data[0] | keys'
```

```json
["id", "userId", "title", "body", "metadata", "tags", "history", "attachments", "permissions"]
```

> 4821 items, each with `history`, `attachments`, and `permissions`. That's the full dataset with all relations. The dashboard only displays a summary card — it doesn't need any of this.

```
introspect eval 'events.find(e => e.id === "evt_002")?.data.headers["content-length"]'
```

```
"6291840"
```

> 6MB response for a summary view. The endpoint returns the full records with all nested relations instead of a projected summary.

**Root cause:** Dashboard calls a general-purpose endpoint designed for the detail view, not a summary projection. Fix: add a `/api/dashboard/summary?fields=id,title` endpoint or add pagination and field selection to the existing one.

---

## 8. The JS Error That Ate the Navigation

**Test:** `settings > saving preferences navigates to confirmation`
**Symptom:** Form save appears to succeed (200 response) but no navigation occurs. Test times out.

```
introspect timeline
```

```
  00:00  playwright.action  goto /settings
  00:50  playwright.action  fill [name=display-name], value: Alice
  00:52  playwright.action  click [type=submit]
  00:53  network.request    POST /api/settings  200
  00:55  js.error           ReferenceError: router is not defined
  00:55  (no browser.navigate event)
  30:00  timeout
```

> The save succeeded but a JS error fired immediately after. The navigation never happened.

```
introspect errors
```

```
js.error  ts: 55ms
  ReferenceError: router is not defined
  at SettingsForm.handleSuccess (settings.tsx:91)
  at processTicksAndRejections (node:internal/process/task_queues:96)
```

```
introspect snapshot
```

```
Frame: SettingsForm.handleSuccess (settings.tsx:91)
  response  →  { ok: true, userId: "usr_42" }
  this      →  SettingsForm {}
  router    →  undefined
```

> `router` is undefined in `handleSuccess`. The component uses `router.push('/confirmation')` to navigate after a successful save, but `router` was never passed as a prop or obtained from the hook.

```
introspect dom
```

```html
<form data-testid="settings-form">
  <input name="display-name" value="Alice" />
  <button type="submit">Save</button>
</form>
```

> No error state in the DOM — the error was silently swallowed by the fetch wrapper's `.then()` chain. The user sees nothing wrong; the test just times out.

**Root cause:** `router` not injected into the component. The save succeeds, `handleSuccess` throws immediately, the `.then()` chain swallows it, and navigation never happens.

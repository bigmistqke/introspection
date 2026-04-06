# WebGL Plugin Design (`@introspection/plugin-webgl`)

**Date:** 2026-04-06
**Status:** Draft
**Depends on:** `2026-04-06-plugin-system-design.md`

## Overview

The first plugin built on the introspection plugin system. Captures WebGL activity — uniform updates, draw calls, texture binds, context lifecycle — via monkey-patching browser APIs. Pushes discrete events via the push bridge; pulls full GL state on error or manual snapshot.

---

## Usage

```ts
import { webgl } from '@introspection/plugin-webgl'
import { attach } from '@introspection/playwright'

const webglPlugin = webgl({ capture: 'full' })
const handle = await attach(page, { plugins: [webglPlugin] })

// watch a specific uniform
const wh = await webglPlugin.watch({ event: 'uniform', name: 'u_time' })

// later
await wh.unwatch()
await handle.detach()
```

---

## Context Tracking

WebGL contexts are detected by intercepting `HTMLCanvasElement.prototype.getContext`. This interceptor is **always active** — it runs unconditionally regardless of any subscriptions, because context tracking is required for all other instrumentation.

Each context receives a stable ID generated **browser-side** using `crypto.randomUUID()` at the moment `getContext` is called. The UUID is globally unique across the entire session including navigations — no Node-side mapping table, no coordination, no race conditions.

Context loss and restoration are pushed as discrete events:

```
{ type: 'webgl.context-created',  data: { contextId: 'ctx_0' }, ts, source: 'plugin' }
{ type: 'webgl.context-lost',     data: { contextId: 'ctx_0' }, ts, source: 'plugin' }
{ type: 'webgl.context-restored', data: { contextId: 'ctx_0' }, ts, source: 'plugin' }
```

On context loss, the `location → name` map for that context is cleared. On restoration, the application must re-link programs and call `getUniformLocation` again — the map is rebuilt from those calls.

---

## Always-Active Interceptors

Four interceptors run unconditionally regardless of subscriptions:

- `HTMLCanvasElement.prototype.getContext` — for context ID assignment and tracking
- `WebGLRenderingContext.prototype.getUniformLocation` and `WebGL2RenderingContext.prototype.getUniformLocation` — to build the `WebGLUniformLocation → name` map per context
- `WebGLRenderingContext.prototype.createTexture` and `WebGL2RenderingContext.prototype.createTexture` — to assign stable numeric IDs to opaque `WebGLTexture` objects. The interceptor wraps `createTexture`, stores the result in a `WeakMap<WebGLTexture, number>` with a per-context incrementing counter, and returns the original object unmodified. `textureId` in push events and captures is read from this map.

These are low-call-frequency methods and their overhead is negligible.

**Unknown uniform names:** If a `uniform*` call fires for a location not in the map (i.e., `getUniformLocation` was called before the interceptor was active, or the location is from a deleted program), the pushed event uses `name: "<unknown:N>"` where `N` is the numeric location handle, rather than suppressing the event.

---

## `watch()` API

All `watch()` calls return `Promise<WatchHandle>` (defined in `2026-04-06-plugin-system-design.md`). All push events include `{ contextId }` in `data`. The `contextId` filter scopes a watch to a specific canvas; omitting it matches all contexts.

### `uniform`

```ts
webglPlugin.watch({
  event: 'uniform',
  contextId?: string,
  name?: string | { source: string; flags: string },  // string = exact match; object = RegExp pattern
  valueChanged?: boolean,  // only push when value differs from last push for this uniform+context pair
})
```

`RegExp` filters are serialised as `{ source, flags }` (since `JSON.stringify(RegExp)` produces `{}`) and reconstructed browser-side as `new RegExp(source, flags)`.

`valueChanged` comparison is reset when a context is lost — after restoration, the first push for each uniform always fires regardless of previous value.

Pushed events — two variants depending on intercepted method:

```
{ type: 'webgl.uniform', data: { contextId, name, value, glType }, ts, source: 'plugin' }
```

`glType` is a string identifying the uniform type (`'float'`, `'vec2'`, `'mat4'`, etc.), derived from the method called.

Intercepted methods on both `WebGLRenderingContext.prototype` and `WebGL2RenderingContext.prototype`: `uniform1f`, `uniform1fv`, `uniform2f`, `uniform2fv`, `uniform3f`, `uniform3fv`, `uniform4f`, `uniform4fv`, `uniform1i`, `uniform1iv`, `uniform2i`, `uniform2iv`, `uniform3i`, `uniform3iv`, `uniform4i`, `uniform4iv`, `uniformMatrix2fv`, `uniformMatrix3fv`, `uniformMatrix4fv`.

### `draw`

Two distinct event types — one per intercepted method:

```ts
webglPlugin.watch({
  event: 'draw',
  contextId?: string,
  primitive?: 'TRIANGLES' | 'LINES' | 'POINTS' | 'LINE_STRIP' | 'LINE_LOOP' | 'TRIANGLE_STRIP' | 'TRIANGLE_FAN',
})
```

Pushed events:

```
// drawArrays(mode, first, count)
{ type: 'webgl.draw-arrays',    data: { contextId, primitive, first, count }, ts, source: 'plugin' }

// drawElements(mode, count, type, offset)
{ type: 'webgl.draw-elements',  data: { contextId, primitive, count, indexType, offset }, ts, source: 'plugin' }
```

`primitive` is the string name of the GL constant (e.g. `'TRIANGLES'`), not the numeric value. `indexType` is `'UNSIGNED_BYTE'`, `'UNSIGNED_SHORT'`, or `'UNSIGNED_INT'`.

### `texture-bind`

```ts
webglPlugin.watch({
  event: 'texture-bind',
  contextId?: string,
  unit?: number,  // texture unit index; omit = all units
})
```

Pushed event:

```
{ type: 'webgl.texture-bind', data: { contextId, unit, target, textureId }, ts, source: 'plugin' }
```

`textureId` is the numeric ID assigned by the always-active `createTexture` interceptor (see Always-Active Interceptors), or `null` if unbinding.

---

## Interceptor Lifecycle (browser-side)

`getContext`, `getUniformLocation`, and `createTexture` are always intercepted (see above). All other interceptors (`uniform*`, `drawArrays`, `drawElements`, `bindTexture`) are **lazy** — installed when the first subscription for that event type is active, removed when the last subscription is removed. All lazy interceptors patch both `WebGLRenderingContext.prototype` and `WebGL2RenderingContext.prototype`. Each event type has its own ref count.

```js
window.__introspect_plugins__.webgl = {
  watch(spec) { ... },    // installs interceptor if ref count was 0; returns ID string
  unwatch(id) { ... },    // calls cleanup; removes interceptor if ref count reaches 0
}
```

---

## Capture Schema

```ts
webgl({
  capture?: 'full' | {
    uniforms?: boolean | string[]   // true = all, string[] = specific names only
    textures?: boolean
    viewport?: boolean
    blendState?: boolean
    depthState?: boolean
  }
})
// default: 'full'
```

`'full'` is equivalent to `{ uniforms: true, textures: true, viewport: true, blendState: true, depthState: true }`.

`capture()` is called on `js.error`, `handle.snapshot()`, and `detach()`. It pulls state per active context via `page.evaluate()` and returns one `CaptureResult` per active context (the array may be empty if no contexts exist).

Asset kind: `'webgl-state'`

Inline `asset` event summary per context:

```ts
{
  contextId: string
  uniformCount: number          // number of uniforms in the snapshot
  boundTextureCount: number     // number of texture units with a non-null texture bound
  viewport: [x, y, width, height]
}
```

---

## Full GL State Shape (per context)

```ts
interface WebGLStateSnapshot {
  contextId: string
  uniforms: Record<string, { value: unknown; glType: string }>
  textures: Array<{ unit: number; target: string; textureId: number | null }>  // all units with non-null binding
  viewport: [number, number, number, number]
  blendState: {
    enabled: boolean
    srcRgb: number; dstRgb: number
    srcAlpha: number; dstAlpha: number
    equation: number
  }
  depthState: {
    testEnabled: boolean
    func: number
    writeMask: boolean
  }
}
```

`textures` contains only units with a non-null texture bound. `boundTextureCount` in the asset summary equals `textures.length`.

---

## Event Types

```ts
type WebGLContextCreatedEvent  = BaseEvent & { type: 'webgl.context-created';  source: 'plugin'; data: { contextId: string } }
type WebGLContextLostEvent     = BaseEvent & { type: 'webgl.context-lost';     source: 'plugin'; data: { contextId: string } }
type WebGLContextRestoredEvent = BaseEvent & { type: 'webgl.context-restored'; source: 'plugin'; data: { contextId: string } }
type WebGLUniformEvent         = BaseEvent & { type: 'webgl.uniform';          source: 'plugin'; data: { contextId: string; name: string; value: unknown; glType: string } }
type WebGLDrawArraysEvent      = BaseEvent & { type: 'webgl.draw-arrays';      source: 'plugin'; data: { contextId: string; primitive: string; first: number; count: number } }
type WebGLDrawElementsEvent    = BaseEvent & { type: 'webgl.draw-elements';    source: 'plugin'; data: { contextId: string; primitive: string; count: number; indexType: string; offset: number } }
type WebGLTexBindEvent         = BaseEvent & { type: 'webgl.texture-bind';     source: 'plugin'; data: { contextId: string; unit: number; target: string; textureId: number | null } }
```

All seven are added to the `PluginEvent` union in `@introspection/types` (or as a `WebGLEvent` sub-union added to `TraceEvent`).

---

## Package Structure

```
packages/plugin-webgl/
  src/
    index.ts        ← webgl() factory, IntrospectionPlugin impl, typed watch() API
    browser.ts      ← browser-side script source
  test/
    webgl.test.ts
  package.json
  tsup.config.ts
```

`browser.ts` is bundled independently targeting browser globals (no Node built-ins, no external deps). The bundle output is embedded as a string literal in the Node.js build of `index.ts` using a tsup custom plugin that reads the browser bundle file and replaces a `BROWSER_SCRIPT` placeholder with the bundled string. The build runs in two passes: browser bundle first, then the Node bundle that embeds it.

No runtime dependencies beyond `@introspection/types`.

---

## Key Design Decisions

- **Context ID generated browser-side via `crypto.randomUUID()`** — globally unique across the session including navigations, no Node-side mapping table, no race between context-created and subsequent events.
- **`getContext` and `getUniformLocation` always intercepted** — required for context tracking and name resolution regardless of subscriptions. Low overhead (rare calls).
- **Unknown uniform name fallback is `"<unknown:N>"`** — event is never suppressed; the numeric location is surfaced for debuggability.
- **Location map cleared on context loss** — locations from a lost context are invalid; the map is rebuilt from `getUniformLocation` calls after restoration.
- **`valueChanged` reset on context loss** — after restoration, all uniforms are treated as fresh.
- **`RegExp` serialised as `{ source, flags }`** — `JSON.stringify` cannot round-trip `RegExp`; browser-side reconstructs via `new RegExp(source, flags)`.
- **`capture()` returns array** — one `CaptureResult` per active context; empty array if no contexts.
- **Separate event types for `draw-arrays` and `draw-elements`** — they have different fields (`first` vs `offset`/`indexType`); a single `draw` type with optional fields would be ambiguous.
- **`'full'` is explicitly `{ uniforms: true, textures: true, viewport: true, blendState: true, depthState: true }`** — no implicit expansion.

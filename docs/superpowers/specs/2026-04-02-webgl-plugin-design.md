# WebGL Introspection Plugin Design

**Package:** `@introspection/plugin-webgl`
**Date:** 2026-04-02

---

## Goal

A browser-side introspection plugin for WebGL/WebGL2 that gives an AI agent (and human developers) visibility into rendering state, draw call activity, shader programs, texture uploads, and frame-level error aggregation.

Pixel-level canvas captures are out of scope here — they are handled by `plugin-canvas` (Plan 5), which uses `HTMLCanvasElement.toDataURL()` and works for any renderer.

---

## Architecture

### Package structure

Follows the same `IntrospectionPlugin` shape as `plugin-redux` and `plugin-zustand`:

```
packages/plugin-webgl/
  src/index.ts          — createWebGLPlugin(), browser-side interception
  test/plugin-webgl.test.ts
  package.json          — no devDependencies (hoisted from workspace root)
  tsconfig.json         — extends ../../tsconfig.base.json
```

No server-side changes required — this plugin is browser-only. All WebGL events are plain `PluginEvent` objects that flow through the existing `EVENT` handler unchanged.

### System flow overview

```
Browser page                     Vite server (Node.js)
────────────────────             ────────────────────────────
WebGL proxy intercepts calls ──► server.ts EVENT handler
plugin.frame() ──────────────►  stores event in session.events
plugin.stateSnapshot() ───────► stores stateSnapshot event
                                 in session.events
```

### In-memory state (browser-side)

The plugin maintains inside the browser page:

```ts
shaders:          Map<WebGLShader,  { type, source, compiled, log }>
programs:         Map<WebGLProgram, { linked, log, uniforms, attributes }>
textures:         Map<WebGLTexture, { width, height, format, internalFormat }>
contexts:         Map<WebGLRenderingContext | WebGL2RenderingContext, HTMLCanvasElement | OffscreenCanvas>
frameAccumulator: { drawCalls: number; glErrors: string[]; primitiveCount: number }
totalFrames:      number
lastFrame:        { drawCalls, glErrors, primitiveCount } | null
```

### Context tracking

Rather than patching `HTMLCanvasElement.prototype.getContext` globally, the plugin uses **explicit opt-in**: the user calls `plugin.track(rawGl)` with the context they want to observe. `track()` wraps the context in a `Proxy` and returns the wrapped version. The user uses this returned reference for all rendering. No global prototype is mutated.

```ts
// User code — in browser page setup:
const rawGl = canvas.getContext('webgl2')!
const gl = plugin.track(rawGl)   // wrap and register this context
// use gl for all rendering
```

This works identically for `WebGLRenderingContext`, `WebGL2RenderingContext`, contexts from `OffscreenCanvas`, WebXR framebuffers — any context the user has a reference to. Multiple contexts are tracked by calling `track()` once per context.

`browser.setup(agent)` stores the agent reference. It performs no global patching — all interception is installed on the specific contexts registered via `track()`.

Calls to `plugin.frame()` and `plugin.stateSnapshot()` before `browser.setup()` has been called (i.e., before the plugin is wired into a session) are **silently dropped** — no error is thrown.

Intercepted WebGL methods (applied to each Proxy):

| Method | Action |
|---|---|
| `shaderSource(shader, src)` | Store `src` in `shaders` map |
| `compileShader(shader)` | After call: read `COMPILE_STATUS`, `getShaderInfoLog` → store in `shaders` |
| `linkProgram(program)` | After call: read `LINK_STATUS`, `getProgramInfoLog`, enumerate uniforms + attributes via `getProgramParameter` + `getActiveUniform`/`getActiveAttrib` → store in `programs` |
| `texImage2D` / `texImage3D` | Capture `width`, `height`, `format`, `internalFormat` → store in `textures` |
| `drawArrays` / `drawElements` | Increment `frameAccumulator.drawCalls`, add `count` to `frameAccumulator.primitiveCount` (raw vertex/index count — not adjusted by topology); call `getError()` after — if non-zero, emit `plugin.webgl.error` immediately AND add to `frameAccumulator.glErrors` |
| `drawArraysInstanced` / `drawElementsInstanced` (WebGL2) | Same as above |

Context loss: `canvas.addEventListener('webglcontextlost', ...)` for each tracked context's canvas (where accessible) — emits `plugin.webgl.contextlost` and calls `plugin.stateSnapshot()` automatically.

### Frame boundary

Frame stats are **not** inferred automatically. The user calls `plugin.frame()` at the point in their render loop they consider a frame boundary. This emits `plugin.webgl.frame` with the accumulated stats and resets `frameAccumulator`. No wrapping of `requestAnimationFrame`, `flush()`, or `finish()`.

### WebGL state snapshots

Because `browser.snapshot()` runs in the Playwright process (not the browser page), it cannot reach browser-side WebGL state. Instead, the plugin exposes `plugin.stateSnapshot()` — a method the user calls explicitly in their page code at meaningful moments (after rendering a frame, before an assertion, on context loss). It emits a `plugin.webgl.stateSnapshot` event containing the full in-memory state. The agent queries it from the eval socket:

`WebGLPlugin.browser.snapshot()` (the `IntrospectionPlugin` interface method called at SNAPSHOT time) returns a lightweight summary only: `{ contextCount, totalFrames, lastFrame }`. The full state is not included there — it lives in `plugin.webgl.stateSnapshot` events instead.

```ts
// via eval socket:
events.findLast(e => e.type === 'plugin.webgl.stateSnapshot')?.data.shaders
```

---

## Events

All events are `PluginEvent` with `source: 'plugin'`.

### `plugin.webgl.frame`

Emitted by `plugin.frame()`. Aggregates all draw-call-level errors into `glErrors`.

```ts
{
  type: 'plugin.webgl.frame'
  data: {
    drawCalls: number
    glErrors: string[]       // aggregated GL errors this frame, e.g. ['INVALID_OPERATION']
    primitiveCount: number
    contextCount: number
  }
}
```

### `plugin.webgl.error`

Emitted immediately when `gl.getError()` returns non-zero after a draw call. Also included in the next `plugin.webgl.frame`'s `glErrors` array (so errors appear both as immediate events and in the frame summary — consumers should be aware of this duplication).

```ts
{
  type: 'plugin.webgl.error'
  data: {
    error: string            // e.g. 'INVALID_OPERATION'
    canvas: string           // canvas id attribute if present, else 'canvas[N]' where N is the 0-based index of the context in the tracked contexts map
  }
}
```

### `plugin.webgl.contextlost`

Emitted on `webglcontextlost` DOM event. Automatically calls `plugin.stateSnapshot()` to capture the state at the moment of loss.

```ts
{
  type: 'plugin.webgl.contextlost'
  data: { canvas: string }
}
```

### `plugin.webgl.stateSnapshot`

Emitted by `plugin.stateSnapshot()` (called explicitly or on context loss).

```ts
{
  type: 'plugin.webgl.stateSnapshot'
  data: {
    shaders: Array<{ type: 'VERTEX_SHADER' | 'FRAGMENT_SHADER'; source: string; compiled: boolean; log: string }>
    programs: Array<{ linked: boolean; log: string; uniforms: Array<{ name: string; type: string; value: unknown }>; attributes: Array<{ name: string; location: number }> }>
    textures: Array<{ width: number; height: number; format: string; internalFormat: string }>
    frames: { total: number; last: { drawCalls: number; glErrors: string[]; primitiveCount: number } | null }
  }
}
```

---

## Public API

```ts
import { createWebGLPlugin } from '@introspection/plugin-webgl'

const plugin = createWebGLPlugin()

// In page setup — explicitly opt a context into tracking:
const rawGl = canvas.getContext('webgl2')!
const gl = plugin.track(rawGl)   // returns Proxy-wrapped context
// use gl for all rendering (not rawGl)

// For OffscreenCanvas, WebXR, or any other context — same pattern:
const offscreenGl = plugin.track(offscreenCanvas.getContext('webgl2')!)

// In render loop — explicit frame boundary:
plugin.frame()

// Dump full WebGL state as a queryable event:
plugin.stateSnapshot()

// Pass to introspection:
const handle = await attach(page, { plugins: [plugin] })
```

`createWebGLPlugin()` returns a `WebGLPlugin`:

```ts
export interface WebGLPlugin extends IntrospectionPlugin {
  track<T extends WebGLRenderingContext | WebGL2RenderingContext>(gl: T): T
  frame(): void
  stateSnapshot(): void
}
```

`track()` is generic and preserves the exact context type, so TypeScript callers retain full type safety on the returned `gl`.

---

## Dependencies

| Package | Side | Purpose |
|---|---|---|
| `@introspection/types` | browser | shared event/plugin types |

No server-side dependencies added. No changes to `packages/vite`.

---

## Changes to Existing Files

None. This plugin is entirely self-contained in `packages/plugin-webgl/`.

---

## Testing

**Browser plugin unit tests** (`packages/plugin-webgl/test/`) — vitest with a minimal WebGL mock (plain object with spied methods, no real browser needed). Tests call `plugin.browser!.setup(mockAgent)` where `mockAgent = { emit: vi.fn() }` and assert calls on `mockAgent.emit`:
- `plugin.track(mockGl)` returns a Proxy; calling methods on the returned proxy calls through to the original
- `drawArrays` on the tracked context increments frame accumulator
- `getError()` non-zero emits `plugin.webgl.error` and adds to accumulator
- `compileShader` failure recorded in shader registry
- `plugin.frame()` emits correct stats and resets accumulator
- `plugin.stateSnapshot()` emits full state event
- `webglcontextlost` event emits context-lost and triggers stateSnapshot
- calls before `browser.setup()` do not throw

---

## Out of Scope

- Pixel-level canvas captures — handled by `plugin-canvas` (Plan 5) using `HTMLCanvasElement.toDataURL()`
- GPU timing via `EXT_disjoint_timer_query_webgl2` (deferred — async query API adds significant complexity)
- Web Workers with WebGL (deferred)
- Replace `agent.emit()` with `@bigmistqke/rpc` stream module for typed browser↔server RPC (future exploration)

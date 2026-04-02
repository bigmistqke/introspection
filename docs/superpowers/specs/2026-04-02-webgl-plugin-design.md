# WebGL Introspection Plugin Design

**Package:** `@introspection/plugin-webgl`
**Date:** 2026-04-02

---

## Goal

A browser-side introspection plugin for WebGL/WebGL2 that gives an AI agent (and human developers) visibility into rendering state, draw call activity, shader programs, texture uploads, and pixel-level canvas output.

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

Server-side additions (PNG writing) go into `packages/vite/src/trace-writer.ts` and the `Session` interface in `packages/vite/src/server.ts`.

### System flow overview

```
Browser page                     Vite server (Node.js)              Eval socket
────────────────────             ────────────────────────────       ─────────────────
WebGL proxy intercepts calls ──► server.ts EVENT handler           session.captureBuffers
plugin.frame() ──────────────►  stores event in session.events ──► captures.pixel(x,y)
plugin.capture(label) ────────► decodes Base64, stores buffer
                                 in session.captureBuffers
plugin.stateSnapshot() ───────► stores stateSnapshot event
                                 in session.events
                                 (at END_SESSION) ──────────────►  writeTrace writes PNGs
                                                                    via pngjs
```

### In-memory state (browser-side)

The plugin maintains inside the browser page:

```ts
shaders:          Map<WebGLShader,  { type, source, compiled, log }>
programs:         Map<WebGLProgram, { linked, log, uniforms, attributes }>
textures:         Map<WebGLTexture, { width, height, format, internalFormat }>
contexts:         Set<WebGLRenderingContext | WebGL2RenderingContext>
canvases:         Map<WebGLRenderingContext, HTMLCanvasElement>
frameAccumulator: { drawCalls: number; glErrors: string[]; primitiveCount: number }
totalFrames:      number
lastFrame:        { drawCalls, glErrors, primitiveCount } | null
```

### Server-side state (Vite process)

A new field is added to the `Session` interface:

```ts
captureBuffers?: Map<string, {
  label: string
  captureRef: string    // filename of the PNG sidecar
  width: number
  height: number
  pixels: Buffer        // raw RGBA, decoded from Base64
}>
```

`captureBuffers` is populated when the server receives `plugin.webgl.capture` events. It is used by `writeTrace` to write PNG files and by the eval socket to provide `pixel()` helpers.

### Context interception

`browser.setup(agent)` patches `HTMLCanvasElement.prototype.getContext`. Every call to `getContext('webgl')` or `getContext('webgl2')` returns a `Proxy`-wrapped context. The original `getContext` is preserved and called through. All created contexts are tracked.

**Known limitation:** The patch is applied once at `setup()` and remains active for the lifetime of the browser context — there is no teardown mechanism in the `IntrospectionPlugin` interface. The plugin should be set up once per page.

**Known limitation:** Contexts acquired via `canvas.transferControlToOffscreen()` use `OffscreenCanvas.getContext`, which is not patched. These contexts are not tracked.

Intercepted WebGL methods:

| Method | Action |
|---|---|
| `shaderSource(shader, src)` | Store `src` in `shaders` map |
| `compileShader(shader)` | After call: read `COMPILE_STATUS`, `getShaderInfoLog` → store in `shaders` |
| `linkProgram(program)` | After call: read `LINK_STATUS`, `getProgramInfoLog`, enumerate uniforms + attributes via `getProgramParameter` + `getActiveUniform`/`getActiveAttrib` → store in `programs` |
| `texImage2D` / `texImage3D` | Capture `width`, `height`, `format`, `internalFormat` → store in `textures` |
| `drawArrays` / `drawElements` | Increment `frameAccumulator.drawCalls`, add primitive count; call `getError()` after — if non-zero, emit `plugin.webgl.error` immediately AND add to `frameAccumulator.glErrors` |
| `drawArraysInstanced` / `drawElementsInstanced` (WebGL2) | Same as above |

Context loss: `canvas.addEventListener('webglcontextlost', ...)` for each tracked canvas — emits `plugin.webgl.contextlost` and calls `agent.emit` to trigger a state snapshot.

### Frame boundary

Frame stats are **not** inferred automatically. The user calls `plugin.frame()` at the point in their render loop they consider a frame boundary. This emits `plugin.webgl.frame` with the accumulated stats and resets `frameAccumulator`. No wrapping of `requestAnimationFrame`, `flush()`, or `finish()`.

### Named captures

`plugin.capture(label)` calls `gl.readPixels` on each tracked canvas. For each canvas:

1. Reads raw RGBA pixels into a `Uint8Array`
2. Base64-encodes the pixel data (`btoa` / `Buffer.from().toString('base64')`)
3. Calls `agent.emit({ type: 'plugin.webgl.capture', data: { label: safeLabel, pixelsBase64, width, height, canvas: canvasId } })`

Labels are slugified (`label.toLowerCase().replace(/[^a-z0-9]+/g, '-')`) before emission to produce safe sidecar filenames. If multiple canvases are tracked, each gets its own event with labels `${slugLabel}` (first), `${slugLabel}-1`, `${slugLabel}-2`, etc.

On the server, the `EVENT` handler (already `async`) processes `plugin.webgl.capture` events:
1. Decodes `pixelsBase64` → `Buffer`
2. Stores in `session.captureBuffers` with key = label
3. Stores a cleaned event (without `pixelsBase64`, with `captureRef`) in `session.events`

The `transformEvent` interface method is **not used** for this — capture processing is handled directly in `server.ts`'s `EVENT` case before the plugin `transformEvent` loop, since it requires access to the `Session` object.

At `END_SESSION`, `writeTrace` iterates `session.captureBuffers` and writes PNG files using `pngjs` before writing the trace JSON.

### WebGL state snapshots

Because `browser.snapshot()` is called in the Playwright process (not the browser page), it cannot access browser-side WebGL state. Instead, the plugin exposes `plugin.stateSnapshot()` — a user-callable method that emits a `plugin.webgl.stateSnapshot` event containing the full in-memory state (shaders, programs, textures, frame summary).

The agent can trigger this from the eval socket indirectly (by calling `handle.snapshot()` which triggers a TAKE_SNAPSHOT round-trip), or the user can call it explicitly in their code. The emitted event is queryable via:

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
    canvas: string           // canvas id or 'canvas[0]' if no id
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

### `plugin.webgl.capture`

Emitted by `plugin.capture(label)`. By the time it reaches `session.events`, `pixelsBase64` has been stripped and replaced with `captureRef`.

```ts
{
  type: 'plugin.webgl.capture'
  data: {
    label: string
    captureRef: string       // e.g. 'capture-<sessionId>-after-bloom.png'
    width: number
    height: number
    canvas: string           // canvas id or index
  }
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

## Eval Socket

Captures are exposed as a top-level variable in the eval socket VM context alongside `events`, `snapshot`, and `test`. This is built from `session.captureBuffers` when the eval context is constructed:

```ts
// in eval-socket.ts, ctx construction:
const captures: Record<string, { captureRef: string; width: number; height: number; pixel(x: number, y: number): [number, number, number, number] }> = {}
for (const [label, buf] of session.captureBuffers ?? []) {
  captures[label] = {
    captureRef: buf.captureRef,
    width: buf.width,
    height: buf.height,
    pixel(x, y) {
      const i = (y * buf.width + x) * 4
      return [buf.pixels[i], buf.pixels[i + 1], buf.pixels[i + 2], buf.pixels[i + 3]]
    }
  }
}
ctx.captures = captures
```

Usage in eval expressions:

```ts
// compare pixels between two passes:
captures['after-bloom'].pixel(320, 240)          // → [255, 0, 128, 255]
captures['after-tonemapping'].pixel(320, 240)    // → [240, 10, 100, 255]

// query state:
events.findLast(e => e.type === 'plugin.webgl.stateSnapshot')?.data.shaders[0].source

// find frame anomalies:
events.filter(e => e.type === 'plugin.webgl.frame' && e.data.drawCalls === 0)
```

---

## Public API

```ts
import { createWebGLPlugin } from '@introspection/plugin-webgl'

const plugin = createWebGLPlugin()

// In render loop — explicit frame boundary:
plugin.frame()

// At meaningful visual checkpoints (emits event + writes PNG sidecar):
plugin.capture('after-bloom')
plugin.capture('after-tonemapping')

// Dump full WebGL state as a queryable event:
plugin.stateSnapshot()

// Pass to introspection:
const handle = await attach(page, { plugins: [plugin] })
```

`createWebGLPlugin()` returns a `WebGLPlugin`:

```ts
export interface WebGLPlugin extends IntrospectionPlugin {
  frame(): void
  capture(label: string): void
  stateSnapshot(): void
}
```

---

## Dependencies

| Package | Side | Purpose |
|---|---|---|
| `@introspection/types` | browser | shared event/plugin types |
| `pngjs` | server (`packages/vite`) | encode raw RGBA → PNG for human-viewable captures |

`pngjs` is added to `packages/vite/package.json` dependencies. It is pure JS (~200KB), no native binaries.

---

## Changes to Existing Files

| File | Change |
|---|---|
| `packages/vite/src/server.ts` | Add `captureBuffers?: Map<string, CaptureBuffer>` to `Session`; handle `plugin.webgl.capture` events in the `EVENT` case |
| `packages/vite/src/trace-writer.ts` | Write PNG sidecar files for `session.captureBuffers` using `pngjs` |
| `packages/vite/src/eval-socket.ts` | Add `captures` to VM context built from `session.captureBuffers` |
| `packages/vite/package.json` | Add `pngjs` dependency |

---

## Sidecar File Layout

```
.introspect/
  <test-slug>--w0.trace.json
  bodies/
    <id>.json                          ← existing (response body)
  capture-<sessionId>-<label>.png      ← new (WebGL capture, human-viewable)
```

---

## Testing

**Browser plugin unit tests** (`packages/plugin-webgl/test/`) — vitest with a minimal WebGL mock (plain object with spied methods):
- `getContext` interception registers contexts
- `drawArrays` increments frame accumulator
- `getError()` non-zero emits `plugin.webgl.error` and adds to accumulator
- `compileShader` failure recorded in shader registry
- `plugin.frame()` emits correct stats and resets accumulator
- `plugin.capture(label)` emits capture event with Base64 pixel data, slugified label
- `plugin.stateSnapshot()` emits full state event
- `webglcontextlost` event emits context-lost and triggers stateSnapshot

**Server-side tests** (`packages/vite/test/webgl-capture.test.ts`):
- `plugin.webgl.capture` event processing: Base64 → Buffer stored in `session.captureBuffers`, cleaned event in `session.events`
- PNG sidecar file written by `writeTrace` using `pngjs`
- `captures.pixel(x, y)` returns correct RGBA from buffer

---

## Out of Scope

- GPU timing via `EXT_disjoint_timer_query_webgl2` (deferred — async query API adds significant complexity)
- WebXR / OffscreenCanvas acquired via `OffscreenCanvas.getContext` (deferred — different context acquisition path). Note: canvases transferred via `transferControlToOffscreen()` silently bypass the `HTMLCanvasElement.prototype.getContext` patch.
- Web Workers with WebGL (deferred — Plan 5)
- Diff/comparison helpers between captures (the eval socket's `captures.pixel()` provides enough for the agent to compare values directly)
- Replace `agent.emit()` with `@bigmistqke/rpc` stream module for typed browser↔server RPC (future exploration — would allow browser plugins to call server methods like `server.writeCapture(pixels)` directly, eliminating the Base64 transport hack)

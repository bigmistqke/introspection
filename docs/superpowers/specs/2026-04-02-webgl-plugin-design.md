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

The Vite server side (PNG encoding, sidecar file writing) is added to `packages/vite/src/server.ts` via `server.transformEvent()`.

### In-memory state store

The plugin maintains:

```ts
shaders:  Map<WebGLShader,  { type, source, compiled, log }>
programs: Map<WebGLProgram, { linked, log, uniforms, attributes }>
textures: Map<WebGLTexture, { width, height, format, internalFormat }>
captures: Map<string, { width, height, pixels: Uint8Array }>  // keyed by label
contexts: Set<WebGLRenderingContext | WebGL2RenderingContext>
frameAccumulator: { drawCalls: number; glErrors: string[]; primitiveCount: number }
totalFrames: number
lastFrame: typeof frameAccumulator | null
```

### Context interception

`browser.setup(agent)` patches `HTMLCanvasElement.prototype.getContext`. Every call to `getContext('webgl')` or `getContext('webgl2')` returns a `Proxy`-wrapped context. All created contexts are tracked. The original `getContext` is preserved and called through.

Intercepted methods:

| Method | Action |
|---|---|
| `compileShader(shader)` | After call: read `source`, `COMPILE_STATUS`, `getShaderInfoLog` → store in `shaders` |
| `linkProgram(program)` | After call: read `LINK_STATUS`, `getProgramInfoLog`, enumerate uniforms + attributes → store in `programs` |
| `texImage2D` / `texImage3D` | Capture `width`, `height`, `format`, `internalFormat` → store in `textures` |
| `drawArrays` / `drawElements` | Increment `frameAccumulator.drawCalls`, add primitive count; call `getError()` after and record any errors |
| `drawArraysInstanced` / `drawElementsInstanced` (WebGL2) | Same as above |

Context loss is handled via `canvas.addEventListener('webglcontextlost', ...)` for each tracked canvas — emits `plugin.webgl.contextlost` and triggers a snapshot.

### Frame boundary

Frame stats are **not** inferred automatically. The user calls `plugin.frame()` at the point in their render loop they consider a frame boundary. This emits `plugin.webgl.frame` with the accumulated stats and resets `frameAccumulator`.

No wrapping of `requestAnimationFrame`, `flush()`, or `finish()`.

### Named captures

`plugin.capture(label)` calls `gl.readPixels` on each tracked canvas and emits a `plugin.webgl.capture` event containing the raw RGBA pixel data, canvas dimensions, and the label. The Vite server intercepts this event in `server.transformEvent()`, encodes the pixel data as PNG using `pngjs`, writes it as a sidecar file, replaces the raw pixel data with a `captureRef` filename, and stores the cleaned event in the trace.

Sidecar file path: `<outDir>/capture-<sessionId>-<label>.png`

---

## Events

All events are `PluginEvent` with `source: 'plugin'`.

### `plugin.webgl.frame`

Emitted by `plugin.frame()`.

```ts
{
  type: 'plugin.webgl.frame'
  data: {
    drawCalls: number
    glErrors: string[]       // e.g. ['INVALID_OPERATION']
    primitiveCount: number
    contextCount: number     // number of active WebGL contexts
  }
}
```

### `plugin.webgl.error`

Emitted when `gl.getError()` returns non-zero after a draw call.

```ts
{
  type: 'plugin.webgl.error'
  data: {
    error: string            // e.g. 'INVALID_OPERATION'
    canvas: string           // canvas selector or 'canvas[0]' if no id
  }
}
```

### `plugin.webgl.contextlost`

Emitted on `webglcontextlost` DOM event. Auto-triggers a snapshot.

```ts
{
  type: 'plugin.webgl.contextlost'
  data: {
    canvas: string
  }
}
```

### `plugin.webgl.capture`

Emitted by `plugin.capture(label)`. After server-side processing, `pixels` is replaced by `captureRef`.

```ts
{
  type: 'plugin.webgl.capture'
  data: {
    label: string
    captureRef: string       // e.g. 'capture-<sessionId>-after-bloom.png'
    width: number
    height: number
    // raw pixels present in-flight, removed by server.transformEvent()
  }
}
```

---

## Snapshot Shape

`browser.snapshot()` returns under `plugins.webgl`:

```ts
{
  shaders: Array<{
    type: 'VERTEX_SHADER' | 'FRAGMENT_SHADER'
    source: string
    compiled: boolean
    log: string
  }>
  programs: Array<{
    linked: boolean
    log: string
    uniforms: Array<{ name: string; type: string; value: unknown }>
    attributes: Array<{ name: string; location: number }>
  }>
  textures: Array<{
    width: number
    height: number
    format: string
    internalFormat: string
  }>
  captures: Record<string, {
    captureRef: string
    width: number
    height: number
    // pixel() helper attached server-side for eval socket access:
    pixel(x: number, y: number): [number, number, number, number]
  }>
  frames: {
    total: number
    last: {
      drawCalls: number
      glErrors: string[]
      primitiveCount: number
    } | null
  }
}
```

The `pixel(x, y)` helper reads from the raw RGBA buffer kept in memory alongside the snapshot (not from disk). It is attached by the Vite server when building the eval socket VM context, so it works naturally in eval expressions:

```ts
// via eval socket:
snapshot.plugins.webgl.captures['after-bloom'].pixel(320, 240)   // → [255, 0, 128, 255]
```

---

## Public API

```ts
import { createWebGLPlugin } from '@introspection/plugin-webgl'

const plugin = createWebGLPlugin()

// In render loop — explicit frame boundary:
plugin.frame()

// At meaningful visual checkpoints:
plugin.capture('after-bloom')
plugin.capture('after-tonemapping')

// Pass to introspection:
const handle = await attach(page, { plugins: [plugin] })
```

`createWebGLPlugin()` returns a `WebGLPlugin`:

```ts
export interface WebGLPlugin extends IntrospectionPlugin {
  frame(): void
  capture(label: string): void
}
```

`frame()` and `capture()` are browser-side methods. `capture()` triggers a `plugin.webgl.capture` event which the Vite server processes into a PNG sidecar file.

---

## Dependencies

| Package | Side | Purpose |
|---|---|---|
| `@introspection/types` | browser + server | shared types |
| `pngjs` | server (vite) | encode raw RGBA → PNG for human-viewable captures |

`pngjs` is added to `packages/vite/package.json` dependencies. It is pure JS (~200KB), no native binaries.

---

## Testing

**Browser plugin unit tests** (`packages/plugin-webgl/test/`) — vitest with a minimal WebGL mock:
- `getContext` interception registers contexts
- `drawArrays` increments frame accumulator
- `getError()` non-zero triggers `plugin.webgl.error` event
- `compileShader` failure is recorded in shader registry
- `plugin.frame()` emits correct stats and resets accumulator
- `plugin.capture(label)` emits capture event with pixel data
- `webglcontextlost` event triggers snapshot

**Server-side tests** (`packages/vite/test/`) — test `server.transformEvent()` for `plugin.webgl.capture`:
- PNG is written to disk via `pngjs`
- Raw pixel data is removed from stored event
- `captureRef` is set to correct filename

---

## Sidecar File Layout

```
.introspect/
  trace-<sessionId>.json
  body-<requestId>.bin             ← existing (response body)
  capture-<sessionId>-<label>.png  ← new (WebGL capture)
```

---

## Out of Scope

- GPU timing via `EXT_disjoint_timer_query_webgl2` (deferred — async query API adds significant complexity)
- WebXR / OffscreenCanvas (deferred — different context acquisition paths)
- Web Workers with WebGL (deferred — Plan 5)
- Diff/comparison helpers between captures (the eval socket provides enough flexibility for the agent to compare `pixel()` values directly)

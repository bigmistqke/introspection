# @introspection/plugin-webgl

Introspection plugin that intercepts WebGL calls in the browser. Tracks uniforms, draw calls, and texture binds as they happen. On snapshot it serializes full GL state and captures each canvas as a PNG.

Works with both `HTMLCanvasElement` and `OffscreenCanvas`. WebGL 1 and WebGL 2 contexts are both intercepted. `preserveDrawingBuffer` is forced to `true` so canvas captures always reflect actual render output.

## Install

```bash
pnpm add -D @introspection/plugin-webgl
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { webgl } from '@introspection/plugin-webgl'

const plugin = webgl()
const handle = await attach(page, { plugins: [plugin] })

await handle.page.goto('/demo')

const wh = await plugin.watch({ event: 'uniform', name: 'u_time', valueChanged: true })
await plugin.watch({ event: 'draw' })
await plugin.watch({ event: 'texture-bind' })

// interact with the page...

await handle.snapshot()  // writes webgl-state.json + webgl-canvas.png per context
await wh.unwatch()       // stop watching u_time
await handle.detach()
```

---

## `webgl()`

Returns a `WebGLPlugin` instance. Pass it to `attach()` via `opts.plugins`. A single plugin instance tracks all WebGL contexts on the page.

---

## `plugin.captureCanvas(opts?)`

Captures all WebGL canvases as PNG assets immediately, without capturing the full GL state. Useful when you want a pixel snapshot at a specific moment without the overhead of serializing uniforms, textures, and blend state.

```ts
await plugin.captureCanvas()                          // all contexts
await plugin.captureCanvas({ contextId: 'abc123' })   // one specific context
```

Writes one `webgl-canvas` PNG asset per matching context and emits an `asset` event for each. Does not trigger `getState()`.

---

## `plugin.watch(opts)`

Subscribes to a WebGL event. Returns a `Promise<WatchHandle>` — the subscription is established asynchronously in the browser. Subscriptions are automatically re-applied after navigation.

```ts
const wh = await plugin.watch({ event: 'uniform', name: 'u_time' })
await wh.unwatch()  // stop receiving events for this subscription
```

### `event: 'uniform'`

Fires on every `gl.uniform*()` call that matches the filter.

```ts
plugin.watch({
  event: 'uniform',
  name?: string | RegExp,    // filter by uniform name; omit to watch all
  valueChanged?: boolean,    // if true, suppress events when value hasn't changed
  contextId?: string,        // restrict to a specific GL context
})
```

Emits `webgl.uniform` events with:

```ts
{
  type: 'webgl.uniform',
  source: 'plugin',
  data: {
    contextId: string,
    name: string,
    value: number | number[],   // scalar or vector
    glType: string,             // 'float', 'vec2', 'vec3', 'vec4', 'int', 'mat4', etc.
  }
}
```

### `event: 'draw'`

Fires on every `gl.drawArrays()` or `gl.drawElements()` call.

```ts
plugin.watch({
  event: 'draw',
  primitive?: 'TRIANGLES' | 'LINES' | 'POINTS' | 'LINE_STRIP' | 'LINE_LOOP' | 'TRIANGLE_STRIP' | 'TRIANGLE_FAN',
  contextId?: string,
})
```

Emits `webgl.draw-arrays` or `webgl.draw-elements` events with:

```ts
{
  type: 'webgl.draw-arrays',
  source: 'plugin',
  data: {
    contextId: string,
    primitive: string,   // e.g. 'TRIANGLES'
    first: number,
    count: number,
  }
}
// or
{
  type: 'webgl.draw-elements',
  source: 'plugin',
  data: {
    contextId: string,
    primitive: string,
    count: number,
    offset: number,
  }
}
```

### `event: 'texture-bind'`

Fires on every `gl.bindTexture()` call.

```ts
plugin.watch({
  event: 'texture-bind',
  unit?: number,       // filter by texture unit (0-based)
  contextId?: string,
})
```

Emits `webgl.texture-bind` events with:

```ts
{
  type: 'webgl.texture-bind',
  source: 'plugin',
  data: {
    contextId: string,
    unit: number,       // active texture unit at time of bind
    target: string,     // 'TEXTURE_2D', 'TEXTURE_CUBE_MAP', etc.
  }
}
```

---

## Events emitted automatically (no watch needed)

| Type | Trigger |
|---|---|
| `webgl.context-created` | Any `canvas.getContext('webgl')` or `getContext('webgl2')` call |

```ts
{
  type: 'webgl.context-created',
  source: 'plugin',
  data: { contextId: string, type: 'webgl' | 'webgl2' }
}
```

---

## Assets captured on snapshot

Capture runs on `handle.snapshot()` (trigger: `'manual'`), on uncaught JS errors (trigger: `'js.error'`), and on `handle.detach()` (trigger: `'detach'`). One asset is written per active GL context.

### `webgl-state` (JSON)

Full GL state snapshot:

```ts
interface WebGLStateSnapshot {
  contextId: string
  uniforms: Record<string, { value: unknown; glType: string }>
  textures: Array<{ unit: number; target: string; textureId: number | null }>
  viewport: [x: number, y: number, width: number, height: number]
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

### `webgl-canvas` (PNG)

Pixel content of the canvas at the time of capture. Written as a binary PNG file. `preserveDrawingBuffer: true` is forced when the context is created so the framebuffer is always readable.

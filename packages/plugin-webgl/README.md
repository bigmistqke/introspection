# @introspection/plugin-webgl

Introspection plugin that intercepts WebGL calls in the browser. Tracks uniforms, draw calls, texture binds, and GL context state. On snapshot it serializes full GL state and captures each canvas as a PNG.

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

// interact with the page...

await handle.snapshot()  // writes webgl-state.json + webgl-canvas.png per context
await wh.unwatch()       // stop watching u_time
await handle.detach()
```

## `plugin.watch(opts)`

Returns a `WatchHandle` with an `unwatch()` method. Subscriptions survive navigation.

### `uniform`

```ts
plugin.watch({ event: 'uniform', name?: string | RegExp, valueChanged?: boolean, contextId?: string })
```

Emits `webgl.uniform` events. `valueChanged: true` suppresses duplicate values.

### `draw`

```ts
plugin.watch({ event: 'draw', primitive?: 'TRIANGLES' | 'LINES' | 'POINTS' | ..., contextId?: string })
```

Emits `webgl.draw-arrays` / `webgl.draw-elements` events.

### `texture-bind`

```ts
plugin.watch({ event: 'texture-bind', unit?: number, contextId?: string })
```

Emits `webgl.texture-bind` events.

## Events emitted

| Type | Source | Description |
|---|---|---|
| `webgl.context-created` | plugin | A new WebGL context was created |
| `webgl.uniform` | plugin | A uniform was set |
| `webgl.draw-arrays` | plugin | `gl.drawArrays()` call |
| `webgl.draw-elements` | plugin | `gl.drawElements()` call |
| `webgl.texture-bind` | plugin | `gl.bindTexture()` call |

All events include a `contextId` field to correlate with a specific canvas/context.

## Assets captured on snapshot

| Kind | Format | Contents |
|---|---|---|
| `webgl-state` | JSON | Uniforms, bound textures, viewport, blend state, depth state |
| `webgl-canvas` | PNG | Pixel content of each WebGL canvas |

Capture runs on `snapshot()`, on JS errors, and on `detach()`.

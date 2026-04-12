---
name: introspect-plugin
description: Use when writing a custom introspection plugin to capture framework-specific data alongside the standard trace
---

# Writing a custom introspection plugin

A plugin is a **factory function** returning an `IntrospectionPlugin`. At session startup, `attach()` calls `install(ctx)` once per plugin. The plugin wires up CDP subscriptions or browser-side code and emits trace events via `ctx.emit()`.

## The IntrospectionPlugin interface

```ts
interface IntrospectionPlugin {
  name: string                              // 'my-plugin'
  description?: string                      // one-line summary (shown in `introspect plugins`)
  events?: Record<string, string>           // { 'my-plugin.thing': 'Fires when a thing happens' }
  options?: Record<string, { description: string; value: unknown }>
  script?: string                           // browser-side IIFE — see below
  install(ctx: PluginContext): Promise<void>
}

interface PluginContext {
  page: PluginPage                          // minimal { evaluate } page abstraction
  cdpSession: {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>
    on(event: string, handler: (params: unknown) => void): void
  }
  rawCdpSession: CDPSession                 // escape hatch — instrumentation plugins only
  emit(event: EmitInput): Promise<void>     // emit a trace event (id + timestamp auto-filled)
  writeAsset(opts: { kind: AssetKind; content: string | Buffer; ext?: string }): Promise<AssetRef>
  timestamp(): number                       // ms since session start
  track(operation: () => Promise<unknown>): void   // flush() waits on tracked work
  bus: {
    on<T extends BusTrigger>(trigger: T, handler: (payload: BusPayloadMap[T]) => void | Promise<void>): void
    emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]): Promise<void>
  }
  addSubscription(pluginName: string, spec: unknown): Promise<WatchHandle>
}
```

Every `TraceEvent` type is a valid bus trigger (the payload is the event itself). Lifecycle triggers are `'manual'`, `'detach'`, and `'snapshot'`. `ctx.emit()` already fires on the bus — don't double-emit.

Plugins are always factories (never singletons) so callers can pass per-instance options:

```ts
export function myPlugin(options?: { verbose?: boolean }): IntrospectionPlugin { ... }
```

## Register event types

Event types live centrally in `packages/types/src/index.ts` and are merged into `TraceEventMap`. In-repo: edit the file directly. Third-party: use declaration merging:

```ts
import type { BaseEvent } from '@introspection/types'

export interface MyThingEvent extends BaseEvent {
  type: 'my-plugin.thing'
  metadata: { value: number }
}

declare module '@introspection/types' {
  interface TraceEventMap { 'my-plugin.thing': MyThingEvent }
}
```

## Emitting events and assets

```ts
await ctx.emit({ type: 'my-plugin.thing', metadata: { value: 42 } })
```

For large or binary payloads, write an asset and attach its ref to an event:

```ts
const asset = await ctx.writeAsset({ kind: 'json', content: JSON.stringify(body) })
await ctx.emit({ type: 'my-plugin.thing', metadata: { ... }, assets: [asset] })
```

To correlate two events from the same logical operation, set `initiator: otherEvent.id` on the follow-up event.

## Browser script (optional)

When capture needs to run in the page (e.g. `PerformanceObserver`, framework detection), provide `script: string` — a self-contained IIFE that runs on every navigation via `page.addInitScript`. Browser code sends events back via `window.__introspect_push__(JSON.stringify(payload))`.

```ts
// browser.ts — built to an IIFE, then imported as raw text
(function () {
  const push = (window as Window & { __introspect_push__?: (event: string) => void }).__introspect_push__
  if (!push) return

  window.__introspect_plugins__ ??= {}
  window.__introspect_plugins__['my-plugin'] = {
    watch(spec: { threshold: number }) {
      const id = setInterval(() => {
        const value = (window as unknown as { __myCounter?: number }).__myCounter ?? 0
        if (value >= spec.threshold) {
          push(JSON.stringify({ type: 'my-plugin.thing', metadata: { value } }))
        }
      }, 500)
      return id
    },
    unwatch(id: number) { clearInterval(id) },
  }
})()
```

For browser-side subscriptions that must survive navigation, use `ctx.addSubscription(pluginName, spec)`. The runtime replays registered subscriptions to the `window.__introspect_plugins__[name]` registry after each navigation. `plugins/plugin-webgl` is the canonical example.

## Node-side plugin object

```ts
import BROWSER_SCRIPT from '../dist/browser.iife.js'    // loaded as raw text by tsup/esbuild
import type { IntrospectionPlugin } from '@introspection/types'

export function myPlugin(): IntrospectionPlugin {
  return {
    name: 'my-plugin',
    description: 'Captures my-plugin counter values',
    events: { 'my-plugin.thing': 'Fires when counter crosses threshold' },
    script: BROWSER_SCRIPT,

    async install(ctx) {
      // React to another plugin's events without coupling to it:
      ctx.bus.on('js.error', async () => {
        const value = await ctx.page.evaluate(() =>
          (window as unknown as { __myCounter?: number }).__myCounter ?? 0
        )
        const asset = await ctx.writeAsset({
          kind: 'json',
          content: JSON.stringify({ value }),
        })
        await ctx.emit({
          type: 'my-plugin.thing',
          metadata: { value },
          assets: [asset],
        })
      })

      // Wrap async work the framework can't see on its own — flush() waits on it.
      ctx.track(async () => { /* ... */ })
    },
  }
}
```

## Build setup

Use tsup (or esbuild) to produce the IIFE bundle separately from the node entry, and load the IIFE as raw text from the node entry:

```ts
// tsup.browser.config.ts
export default defineConfig({
  entry: { browser: 'src/browser.ts' },
  format: ['iife'],
  globalName: '__unused',
  outDir: 'dist',
})

// tsup.node.config.ts — loads the IIFE as raw text
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  esbuildOptions(opts) {
    opts.loader = { ...opts.loader, '.iife.js': 'text' }
  },
})
```

## Reference implementations

- `plugins/plugin-webgl` — browser IIFE + `addSubscription` + canvas capture as binary assets + GL state on `bus.on('snapshot')`.
- `plugins/plugin-redux` — minimal browser-only plugin (no node-side CDP work).
- `plugins/plugin-network` — pure CDP-side plugin (no browser script), with `ctx.track` for out-of-band body fetches.

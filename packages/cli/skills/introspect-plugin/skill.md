---
name: introspect-plugin
description: Use when writing a custom introspection plugin to capture framework-specific data alongside the standard trace
---

# Writing a custom introspection plugin

Plugins have two parts: a browser-side IIFE script that runs in the page, and a node-side object that coordinates with it via `PluginContext`.

## The IntrospectionPlugin interface

```ts
interface IntrospectionPlugin {
  name: string        // identifies the plugin; used in event source fields
  script: string      // browser IIFE — injected into every page on attach and navigation

  install(ctx: PluginContext): Promise<void>
}

interface PluginContext {
  page: Page
  cdpSession: { send(method: string, params?: Record<string, unknown>): Promise<unknown> }
  emit(event: Omit<TraceEvent, 'id' | 'ts'> & { id?: string; ts?: number }): void
  writeAsset(opts: { kind: string; content: string | Buffer; ext?: string; metadata: Record<string, unknown> }): Promise<string>
  timestamp(): number
  addSubscription(pluginName: string, spec: unknown): Promise<WatchHandle>
}
```

## Browser script

The `script` field is a self-contained IIFE that registers the plugin on `window.__introspect_plugins__['name']`. It must not import anything — bundle it before use (e.g. with tsup/esbuild targeting IIFE format).

```ts
// browser.ts — built to an IIFE, then imported as raw text
(function () {
  const push = (window as Window & { __introspect_push__?: (event: string) => void }).__introspect_push__
  if (!push) return

  window.__introspect_plugins__ ??= {}
  window.__introspect_plugins__['my-plugin'] = {
    watch(spec: { threshold: number }) {
      // set up browser-side observation
      const id = setInterval(() => {
        const value = (window as unknown as { __myCounter?: number }).__myCounter ?? 0
        if (value >= spec.threshold) {
          push(JSON.stringify({ type: 'plugin', source: 'plugin', data: { name: 'my-plugin', value } }))
        }
      }, 500)
      return id  // return an ID so unwatch can clean up
    },
    unwatch(id: number) {
      clearInterval(id)
    },
  }
})()
```

## Node-side plugin object

```ts
import BROWSER_SCRIPT from '../dist/browser.iife.js'  // loaded as raw text by esbuild
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'

export function myPlugin(): IntrospectionPlugin {
  let ctx: PluginContext | null = null

  return {
    name: 'my-plugin',
    script: BROWSER_SCRIPT,

    async install(pluginCtx) {
      ctx = pluginCtx

      ctx.bus.on('js.error', async (trigger, ts) => {
        if (!ctx) return
        const value = await ctx.page.evaluate(() =>
          (window as unknown as { __myCounter?: number }).__myCounter ?? 0
        )
        await ctx.writeAsset({
          kind: 'my-plugin-state',
          content: JSON.stringify({ value }),
          metadata: { timestamp: ts, value },
        })
      })
    },
  }
}
```

## Build setup

Use tsup or esbuild to produce the IIFE bundle separately from the node entry:

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

## Reference implementation

`packages/plugin-webgl` is the canonical example. It shows: browser IIFE registration, subscription/unwatch via `addSubscription`, canvas capture as binary assets, and GL state serialization triggered via `ctx.bus.on(trigger, handler)` inside `install()`.

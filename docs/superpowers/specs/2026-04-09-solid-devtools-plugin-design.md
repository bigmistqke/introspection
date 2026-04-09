# SolidJS Devtools Plugin Design (`@introspection/plugin-solid`)

**Date:** 2026-04-09
**Status:** Draft

## Overview

Captures SolidJS reactive state — component tree structure, reactive node updates, and dependency graphs — by running the `@solid-devtools/debugger` against the app's existing devtools setup hooks. The plugin bundles the debugger (same approach as the Chrome extension) and injects it into the browser, where it connects to the `SolidDevtools$$` global that the user's app exposes via `solid-devtools/setup`.

---

## Prerequisites

The user must have `solid-devtools` configured in their SolidJS app:

1. `solid-devtools` Vite plugin in `vite.config.ts`
2. `import 'solid-devtools'` in app entry

This is the standard solid-devtools setup. No additional app-side configuration is required for the introspection plugin.

---

## Usage

```ts
import { solidDevtools } from '@introspection/plugin-solid'
import { attach } from '@introspection/playwright'

const handle = await attach(page, {
  plugins: [
    solidDevtools({
      structureUpdates: 'stream',   // 'stream' | 'trigger' | 'off' (default: 'stream')
      nodeUpdates: 'off',           // 'stream' | 'trigger' | 'off' (default: 'off')
      dependencyGraph: 'trigger',   // 'stream' | 'trigger' | 'off' (default: 'trigger')
    })
  ]
})
```

---

## Configuration

Each event type is independently configurable with three modes:

| Mode | Behavior |
|------|----------|
| `'stream'` | Log every occurrence as a trace event immediately |
| `'trigger'` | Capture current state only on bus events (`js.error`, `detach`) |
| `'off'` | Don't capture |

Defaults:

| Event type | Default | Rationale |
|------------|---------|-----------|
| `structureUpdates` | `'stream'` | Low volume, essential context for understanding component tree changes |
| `nodeUpdates` | `'off'` | High volume, mostly useful for performance debugging |
| `dependencyGraph` | `'trigger'` | Expensive to serialize, most useful as a snapshot at the moment of failure |

---

## Architecture

Follows the same dual-build pattern as `plugin-webgl`: a browser-side IIFE + server-side orchestration.

### Dependency strategy

`@solid-devtools/debugger` is a **dependency** of `@introspection/plugin-solid`, bundled into the browser IIFE at build time. This mirrors how the Chrome extension works — it ships its own copy of the debugger, fully decoupled from the user's app. The app only provides the setup hooks (`SolidDevtools$$`); the debugger is our responsibility.

If a breaking change occurs in the `SolidDevtools$$` setup API, both the Chrome extension and our plugin would need to update — same risk profile.

### Browser script (`browser.ts` → IIFE)

1. **Detect `SolidDevtools$$`** — Use `Object.defineProperty` interception on `globalThis` to detect when the setup API appears (same technique the Chrome extension uses). If not found, push a `solid.warning` event.

2. **Initialize debugger** — Call `useDebugger()` from the bundled `@solid-devtools/debugger` with the detected setup API. This produces a running debugger instance that walks the reactive tree and emits serialized output.

3. **Subscribe to debugger output** — Listen to the debugger's output messages:
   - `StructureUpdates` — component/owner tree changes
   - `NodeUpdates` — reactive node update batches
   - `DgraphUpdate` — serialized dependency graph

4. **Filter by config** — For `'stream'` mode events, push immediately via `window.__introspect_push__()`. For `'trigger'` mode events, buffer the latest state in memory.

5. **Expose snapshot API** — `window.__introspect_plugins__.solid.getState()` returns the latest buffered state for trigger-mode event types. Called by the server on bus triggers.

### Server side (`index.ts`)

1. **Plugin factory** — `solidDevtools(options)` returns an `IntrospectionPlugin` with:
   - `name: 'solid'`
   - `script`: the built browser IIFE (loaded via text import, same as WebGL plugin)

2. **`install(ctx)`**:
   - Pass config to browser script via `ctx.page.evaluate()` after script injection.
   - Listen for pushed events from the browser script — emit as trace events.
   - Register bus listeners for `'js.error'` and `'detach'` triggers. On trigger, call `ctx.page.evaluate()` to invoke `getState()`, then emit/write assets for any trigger-mode event types.

---

## Trace events

All events use `source: 'plugin'`.

### Streamed events

| Type | Data | When |
|------|------|------|
| `solid.structure` | `{ partial: boolean, removed: NodeID[], updated: Record<NodeID, Record<NodeID, MappedOwner>> }` | Component tree changes (stream mode) |
| `solid.updates` | `{ nodeIds: NodeID[] }` | Reactive node updates (stream mode) |
| `solid.dgraph` | `{ graph: SerializedDGraph }` | Dependency graph (stream mode) |

### Trigger events

Same types as above, emitted on bus triggers (`js.error`, `detach`) for event types configured as `'trigger'`.

### Diagnostic events

| Type | Data | When |
|------|------|------|
| `solid.warning` | `{ message: string }` | `SolidDevtools$$` not detected (setup missing) |

---

## Build

Dual tsup configuration (same pattern as `plugin-webgl`):

- **`tsup.browser.config.ts`** — Builds `browser.ts` as IIFE to `dist/browser.iife.js`. Bundles `@solid-devtools/debugger` into the IIFE.
- **`tsup.node.config.ts`** — Builds `index.ts` as ESM to `dist/index.js` + `dist/index.d.ts`. Uses esbuild text-loader to import `browser.iife.js` as a string.

---

## Package structure

```
packages/plugin-solid/
  src/
    index.ts           # Plugin factory, server-side orchestration
    browser.ts         # Browser IIFE: detection, debugger init, event forwarding
  tsup.browser.config.ts
  tsup.node.config.ts
  tsconfig.json
  package.json
```

### Dependencies

```json
{
  "dependencies": {
    "@solid-devtools/debugger": "^x.y.z"
  },
  "devDependencies": {
    "@introspection/types": "workspace:*"
  }
}
```

---

## Open questions

1. **Debugger output subscription** — The exact API for subscribing to the debugger's output messages needs to be verified by reading the `@solid-devtools/debugger` source. The Chrome extension uses a message bridge; we need to confirm there's a direct programmatic subscription path.

2. **Navigation handling** — When the page navigates, `SolidDevtools$$` may be re-created. The browser script needs to re-detect and re-initialize the debugger. The `addInitScript` mechanism handles re-injection, but the debugger state will reset.

3. **Performance** — Streaming `structureUpdates` on apps with large component trees may produce significant event volume. May need to add debouncing or batching in a future iteration.

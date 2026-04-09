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
| `'trigger'` | Capture current state only on bus events (`manual`, `js.error`, `detach`) |
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

4. **Receive config** — Expose `window.__introspect_plugins__.solid.configure(options)` for the server to call after script injection. Until called, the browser script buffers all events.

5. **Filter by config** — For `'stream'` mode events, push immediately via `window.__introspect_push__()`. For `'trigger'` mode events, buffer the latest state in memory.

6. **Expose snapshot API** — `window.__introspect_plugins__.solid.getState()` returns the latest buffered state for trigger-mode event types. Called by the server on bus triggers.

### Server side (`index.ts`)

Requires a side-effect import of `@introspection/plugin-js-errors` for the `'js.error'` bus trigger type (same pattern as `plugin-webgl`).

1. **Plugin factory** — `solidDevtools(options)` returns an `IntrospectionPlugin` with:
   - `name: 'solid'`
   - `script`: the built browser IIFE (loaded via text import, same as WebGL plugin)

2. **`install(ctx)`**:
   - Pass config to browser script via `ctx.page.evaluate(() => window.__introspect_plugins__.solid.configure(options))`.
   - Listen for pushed events from the browser script — emit streamed events via `ctx.emit()`.
   - Register bus listeners for `'manual'`, `'js.error'`, and `'detach'` triggers. On trigger, call `ctx.page.evaluate()` to invoke `getState()`, then write trigger-mode captures via `ctx.writeAsset()`.

---

## Trace events

All events use `source: 'plugin'`.

### Streamed events (via `ctx.emit()`)

| Type | Data | When |
|------|------|------|
| `solid.structure` | `{ partial: boolean, removed: NodeID[], updated: Record<NodeID, Record<NodeID, MappedOwner>> }` | Component tree changes (stream mode) |
| `solid.updates` | `{ nodeIds: NodeID[] }` | Reactive node updates (stream mode) |
| `solid.dgraph` | `{ graph: SerializedDGraph }` | Dependency graph (stream mode) |

Data types (`NodeID`, `MappedOwner`, `SerializedDGraph`) come from `@solid-devtools/debugger`. The plugin re-exports them for consumers who need to parse trace data.

### Trigger events (via `ctx.writeAsset()`)

Captured on `manual`, `js.error`, and `detach` bus triggers for event types configured as `'trigger'`.

| Asset kind | Extension | Content |
|------------|-----------|---------|
| `solid-structure` | `.json` | Latest component tree state |
| `solid-dgraph` | `.json` | Latest dependency graph |
| `solid-updates` | `.json` | Latest reactive node update batch |

### Diagnostic events

| Type | Data | When |
|------|------|------|
| `solid.warning` | `{ message: string }` | `SolidDevtools$$` not detected (setup missing) |

---

## Build

Dual tsup configuration (same pattern as `plugin-webgl`):

- **`tsup.browser.config.ts`** — Builds `browser.ts` as IIFE to `dist/browser.iife.js`. Bundles `@solid-devtools/debugger` into the IIFE (requires `noExternal: [/.*/]` to inline all dependencies).
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
    "@solid-devtools/debugger": "^x.y.z",
    "@introspection/types": "workspace:*",
    "@introspection/plugin-js-errors": "workspace:*"
  }
}
```

---

## Scope exclusions (v1)

- **No `watch()` API** — Unlike the WebGL plugin, v1 does not expose a `watch()` method for test code to subscribe to specific SolidJS events. The plugin is a passive recorder. Test code that needs to assert on reactive state should use Playwright's built-in waiting mechanisms against the DOM. A `watch()` API can be added in a future version if needed.

---

## Open questions

1. **Debugger output subscription** — RESOLVED. Direct programmatic subscription is confirmed and straightforward.

   **Initialization:** Call `useDebugger()` from `@solid-devtools/debugger`. This is a singleton — repeated calls return the same instance. It requires `globalThis.SolidDevtools$$` to exist (the setup API exposed by `solid-devtools/setup`), otherwise it throws. The function must be called within a SolidJS reactive root (`createRoot`) because `createDebugger()` internally uses `createMemo`, `createEffect`, and `createSignal`.

   **Subscription:** The returned `Debugger` object exposes a `listen(listener: OutputListener) => (() => void)` method. The listener receives `OutputMessage` objects with shape `{ kind: string, data: T }` where `kind` is one of the `OutputChannels` keys. The return value is an unsubscribe function.

   **Enabling the debugger:** After calling `useDebugger()`, the debugger starts disabled. Call `debugger.toggleEnabled(true)` to activate structure tracking. For dependency graph output, also send a `ToggleModule` input: `debugger.emit({ kind: 'ToggleModule', data: { module: 'dgraph', enabled: true } })`.

   **Relevant output message kinds for our plugin:**
   - `StructureUpdates` — `{ partial: boolean, removed: NodeID[], updated: Record<NodeID, Record<NodeID, Mapped.Owner>> }` — component/owner tree changes, emitted automatically when the debugger is enabled
   - `NodeUpdates` — `NodeID[]` — batched reactive node update IDs, emitted via `setTimeout` debouncing
   - `DgraphUpdate` — `SerializedDGraph.Graph | null` where `Graph = Record<NodeID, { name, depth, type, sources, observers, graph }>` — emitted when the dgraph module is enabled and an inspected node is set

   **Input messages (for controlling the debugger):**
   - `ToggleModule` — `{ module: 'structure' | 'dgraph' | 'locator', enabled: boolean }` — enable/disable modules
   - `ResetState` — void — reset all inspected state
   - `TreeViewModeChange` — `'owners' | 'components' | 'dom'` — change tree walker mode (default: `'components'`)

   **Key implementation note:** The `DgraphUpdate` output requires both the dgraph module to be enabled AND an `InspectedState` with a non-null `ownerId` to be set (via `InspectNode` input). For our trigger-mode snapshot use case, we may need to inspect a specific node to get its dependency graph. Structure updates flow automatically once the debugger is enabled.

   **Types to re-export:** `NodeID` (template literal `#${string}`), `Mapped.Owner`, `StructureUpdates`, `SerializedDGraph`, `DGraphUpdate`, `NodeType` enum — all from `@solid-devtools/debugger/types`.

2. **Navigation handling** — When the page navigates, `SolidDevtools$$` may be re-created. The browser script is re-injected via the framework's `script` property mechanism (same as other plugins), but the debugger state will reset. The config must be re-applied; the server should re-call `configure()` after navigation.

3. **Performance** — Streaming `structureUpdates` on apps with large component trees may produce significant event volume. May need to add debouncing or batching in a future iteration.

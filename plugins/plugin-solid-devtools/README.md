# @introspection/plugin-solid-devtools

Introspection plugin that captures SolidJS component structure, reactive updates, and dependency graph changes via `@solid-devtools/debugger`.

Requires `solid-devtools` to be installed and initialized in your SolidJS app. Records component tree structure, reactive signal updates, and the dependency graph. Useful for understanding component lifecycle, tracking reactive computations, and debugging reactive state issues in SolidJS applications.

## Table of Contents

- [Install](#install)
- [Requirements](#requirements)
- [Usage](#usage)
- [What it captures](#what-it-captures)
- [solidDevtools(options?)](#soliddevtoolsoptions)
- [Re-exported types](#re-exported-types)

## Install

```bash
pnpm add -D @introspection/plugin-solid-devtools
```

## Requirements

- The app must be running with `solid-devtools` installed (either as a Vite plugin or via the browser extension API)
- `SolidDevtools$$` must be present on the global scope before the page loads

## Usage

```ts
import { attach } from '@introspection/playwright'
import { solidDevtools } from '@introspection/plugin-solid-devtools'

const plugin = solidDevtools()
const handle = await attach(page, { plugins: [plugin] })

await handle.page.goto('/app')

await handle.snapshot()  // capture structure, updates, and dgraph on demand
await handle.detach()
```

## What it captures

| Asset kind | Description |
|---|---|
| `solid-structure` | Component tree and reactive owner hierarchy |
| `solid-updates` | Reactive computations that ran during the capture window |
| `solid-dgraph` | Dependency graph mapping signals to their consumers |

Capture runs on `handle.snapshot()`, on uncaught JS errors, and on `handle.detach()`.

---

## `solidDevtools(options?)`

```ts
solidDevtools({
  structureUpdates?: 'stream' | 'trigger' | 'off'  // default: 'stream'
  nodeUpdates?: 'stream' | 'trigger' | 'off'       // default: 'off'
  dependencyGraph?: 'stream' | 'trigger' | 'off'   // default: 'trigger'
})
```

### Capture modes

- **`stream`** — Emits events to the event log as they happen. High volume, full history.
- **`trigger`** — Collects state until `snapshot()` is called, then writes all assets. Low overhead, point-in-time snapshot.
- **`off`** — Disabled.

### Default behavior

| Option | Default | Reason |
|---|---|---|
| `structureUpdates` | `stream` | Most useful for understanding component lifecycle |
| `nodeUpdates` | `off` | High volume, rarely needed in production tests |
| `dependencyGraph` | `trigger` | Stable snapshot of signal→effect relationships |

---

## Re-exported types

The plugin re-exports types from `@solid-devtools/debugger` for parsing the captured JSON:

```ts
import type { NodeID, NodeType, StructureUpdates, DGraphUpdate, SerializedDGraph } from '@introspection/plugin-solid-devtools'
```

# Contributing

## Type system philosophy

All event and asset types are centralized in `@introspection/types`. This is deliberate — the monorepo is the source of truth for what types exist.

Both `TraceEventMap` (event types) and `AssetDataMap` (asset kinds) are TypeScript interfaces designed to be **augmentable via declaration merging**. This means:

- **In-repo plugins** define their types directly in `packages/types/src/index.ts`. No module augmentation, no indirection.
- **Third-party plugins** augment the interfaces from their own packages using declaration merging.

### Adding a new event type (in-repo)

1. Define the event interface in `packages/types/src/index.ts`:

```ts
export interface MyPluginEvent extends BaseEvent {
  type: 'my-plugin.thing'
  data: { value: string }
}
```

2. Add it to `TraceEventMap`:

```ts
export interface TraceEventMap {
  // ...existing entries
  'my-plugin.thing': MyPluginEvent
}
```

That's it. The type is now available everywhere — in the CLI, the reader, the writer, and all plugins.

### Adding a new event type (third-party)

```ts
import type { BaseEvent } from '@introspection/types'

export interface MyCustomEvent extends BaseEvent {
  type: 'custom.metric'
  data: { name: string; value: number }
}

declare module '@introspection/types' {
  interface TraceEventMap {
    'custom.metric': MyCustomEvent
  }
}
```

The augmented type automatically flows into `TraceEvent`, `EventsFilter`, `query.watch()`, and everywhere else that consumes the event union.

### Adding a new asset kind (in-repo)

Add an entry to `AssetDataMap` in `packages/types/src/index.ts`:

```ts
export interface AssetDataMap {
  // ...existing entries
  'my-capture': { path: string; size?: number; contentType: 'image' }
}
```

The `AssetEventData` discriminated union is derived automatically. Consumers can narrow on `kind` to get the typed data shape.

### Adding a new asset kind (third-party)

```ts
declare module '@introspection/types' {
  interface AssetDataMap {
    'my-capture': { path: string; size?: number; contentType: 'binary' }
  }
}
```

### Why centralize?

- No import chains to remember — every type is available from one package
- Type narrowing works everywhere (discriminated unions on `type` and `kind`)
- No risk of forgetting a side-effect import that registers types
- Clear separation: built-in types are in the source, third-party types use augmentation

## Package structure

| Package | Purpose |
|---|---|
| `@introspection/types` | All shared TypeScript types — events, assets, plugins, sessions |
| `@introspection/utils` | Shared utilities: bus, debug, CDP normalizers, snapshot, summariseBody |
| `@introspection/write` | Session recording — creates sessions, appends events, writes assets to disk |
| `@introspection/read` | Session querying — adapter-based, environment-agnostic, supports reactive queries |
| `@introspection/playwright` | Playwright integration — attaches tracing to a page |
| `introspect` | CLI for querying traces |

Plugins live in `plugins/`. Demos live in `demos/`.

### Read vs Write

The read and write sides are intentionally separate:

- **Write** (`@introspection/write`) is Node-only. It uses `fs` to create session directories, append events to NDJSON files, and write assets. Used by the test runner.
- **Read** (`@introspection/read`) is environment-agnostic. It takes a `StorageAdapter` and works in Node, the browser, or anywhere else. The adapter abstracts I/O.

### StorageAdapter

```ts
interface StorageAdapter {
  listDirectories(): Promise<string[]>
  readText(path: string): Promise<string>
  readBinary?(path: string): Promise<ArrayBuffer>
}
```

Built-in adapters:
- `createNodeAdapter(dir)` in `@introspection/read/node` — reads from filesystem
- `createFetchAdapter(baseUrl)` in `demos/shared` — reads over HTTP (may become official)

## Code style

See `CLAUDE.md` for TypeScript and testing conventions.

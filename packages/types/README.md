# @introspection/types

Shared TypeScript types for the introspection system. Used by all packages.

## Install

```bash
pnpm add -D @introspection/types
```

## Key types

### Events

```ts
type TraceEvent =
  | NetworkRequestEvent | NetworkResponseEvent | NetworkErrorEvent
  | JsErrorEvent | BrowserNavigateEvent | MarkEvent
  | PlaywrightActionEvent | PlaywrightResultEvent
  | AssetEvent | PluginEvent

type EventSource = 'cdp' | 'agent' | 'playwright' | 'plugin'
```

### Plugin interface

```ts
interface IntrospectionPlugin {
  name: string
  script: string                    // browser-side IIFE injected on each navigation
  install(ctx: PluginContext): Promise<void>
  capture?(trigger: 'js.error' | 'manual' | 'detach', ts: number): Promise<CaptureResult[]>
}

interface PluginContext {
  page: PluginPage
  cdpSession: { send(method, params?): Promise<unknown> }
  emit(event): void
  writeAsset(opts): Promise<string>
  timestamp(): number
  addSubscription(pluginName, spec): Promise<WatchHandle>
}

interface CaptureResult {
  kind: string
  content: string | Buffer
  ext?: string
  summary: Record<string, unknown>
}
```

### Session format

```ts
interface SessionMeta {
  version: '2'
  id: string
  startedAt: number
  endedAt?: number
  label?: string
}

interface TraceFile {
  version: '2'
  session: Omit<SessionMeta, 'version'>
  events: TraceEvent[]
  snapshots: { [key: string]: OnErrorSnapshot | undefined }
}
```

### `IntrospectHandle`

```ts
interface IntrospectHandle {
  page: Page
  mark(label: string, data?: Record<string, unknown>): void
  snapshot(): Promise<void>
  detach(result?: DetachResult): Promise<void>
}
```

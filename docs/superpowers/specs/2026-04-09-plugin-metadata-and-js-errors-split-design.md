# Plugin Metadata & jsErrors Event Split

## Summary

Two related changes to the introspection plugin system:

1. Plugins declare metadata (description, event types, option descriptions) on the plugin object. This metadata is recorded in `meta.json` alongside the option values used, so the CLI and AI assistants can discover what a session captured and why.
2. The jsErrors plugin emits two separate events: `js.error` from `Runtime.exceptionThrown` (reliable, catches everything) and `js.error.paused` from `Debugger.paused` (rich scope locals, but misses module evaluation errors in `'uncaught'` mode).

## Plugin Metadata

### IntrospectionPlugin interface

Extend with optional metadata fields:

```ts
interface IntrospectionPlugin {
  name: string
  description?: string
  events?: Record<string, string>       // event type → description
  options?: Record<string, {            // option name → docs + resolved value
    description: string
    value: unknown
  }>
  script?: string
  install(ctx: PluginContext): Promise<void>
}
```

All new fields are optional — existing third-party plugins don't break.

### How plugin factories populate metadata

Each factory function sets description, events, and options with the resolved values:

```ts
export function jsErrors(opts?: JsErrorsOptions): IntrospectionPlugin {
  const pauseState = opts?.pauseOnExceptions ?? 'uncaught'

  return {
    name: 'js-errors',
    description: 'Captures uncaught exceptions and unhandled rejections with scope locals and DOM snapshots',
    events: {
      'js.error': 'Uncaught exception or unhandled rejection',
      'js.error.paused': 'Debugger paused on exception — includes scope locals from call stack',
    },
    options: {
      pauseOnExceptions: {
        description: 'Whether to pause on "all" exceptions or only "uncaught" ones',
        value: pauseState,
      },
    },
    async install(ctx) { ... }
  }
}
```

### meta.json

`attach()` writes plugin metadata into `meta.json` at session init:

```json
{
  "version": "2",
  "id": "...",
  "startedAt": 1775506245004,
  "label": "my test",
  "plugins": [
    {
      "name": "js-errors",
      "description": "Captures uncaught exceptions and unhandled rejections with scope locals and DOM snapshots",
      "events": {
        "js.error": "Uncaught exception or unhandled rejection",
        "js.error.paused": "Debugger paused on exception — includes scope locals from call stack"
      },
      "options": {
        "pauseOnExceptions": {
          "description": "Whether to pause on \"all\" exceptions or only \"uncaught\" ones",
          "value": "uncaught"
        }
      }
    },
    {
      "name": "network",
      "description": "Captures HTTP requests, responses, and response bodies",
      "events": {
        "network.request": "Outgoing HTTP request",
        "network.response": "HTTP response with optional body summary",
        "network.error": "Failed or aborted request"
      }
    }
  ]
}
```

Types:

```ts
interface PluginMeta {
  name: string
  description?: string
  events?: Record<string, string>
  options?: Record<string, { description: string; value: unknown }>
}

interface SessionMeta {
  version: '2'
  id: string
  startedAt: number
  endedAt?: number
  label?: string
  plugins?: PluginMeta[]
}
```

## jsErrors Plugin — Two Events

### Problem

The current plugin only listens to `Debugger.paused`. Chrome considers module evaluation errors as "caught" by the module loader, so with `pauseOnExceptions: 'uncaught'` (the default) the debugger doesn't pause on them. These errors are silently missed.

`Runtime.exceptionThrown` fires for all uncaught exceptions including module evaluation errors, regardless of the `pauseOnExceptions` setting.

### Solution

Two independent CDP listeners, two event types:

**`Runtime.exceptionThrown` → `js.error` event**
- The reliable error detection path. Always fires for uncaught exceptions.
- Includes: message, stack trace, DOM snapshot.
- Triggers the `js.error` bus event so other plugins (e.g. webgl) can react.

**`Debugger.paused` → `js.error.paused` event**
- Fires when the debugger pauses on an exception. Depends on `pauseOnExceptions` setting.
- Includes: scope locals from the call stack.
- A bonus when available, not the detection mechanism.

Both may fire for the same error. No correlation id — they'll be adjacent in the NDJSON stream. Temporal proximity is the link.

### Event shapes

`js.error` (new, from `Runtime.exceptionThrown`):
```ts
{
  type: 'js.error'
  source: 'cdp'
  data: { message: string; stack: StackFrame[] }
}
```

`js.error.paused` (new event type, from `Debugger.paused`):
```ts
{
  type: 'js.error.paused'
  source: 'cdp'
  data: { message: string; stack: StackFrame[] }
}
```

The `js.error.paused` handler still collects scope locals, resumes the debugger, and writes a snapshot asset with the scopes attached — same as today. It just emits to a different event type.

The `js.error` handler takes a DOM snapshot (no scopes since the debugger isn't paused) and writes it as an asset.

### Bus event

The `js.error` bus trigger is emitted from the `Runtime.exceptionThrown` handler only. This is the canonical error signal for plugin coordination.

## CLI: `introspect plugins` command

New command that reads plugin metadata from `meta.json`:

```
$ introspect plugins
Session: "my test"

js-errors — Captures uncaught exceptions and unhandled rejections with scope locals and DOM snapshots
  Events:
    js.error          Uncaught exception or unhandled rejection
    js.error.paused   Debugger paused on exception — includes scope locals from call stack
  Options:
    pauseOnExceptions = "uncaught"  Whether to pause on "all" exceptions or only "uncaught" ones

network — Captures HTTP requests, responses, and response bodies
  Events:
    network.request   Outgoing HTTP request
    network.response  HTTP response with optional body summary
    network.error     Failed or aborted request
```

Existing commands (`summary`, `errors`, `events`, etc.) stay unchanged — they filter the NDJSON stream by event type.

## Changes by Package

| Package | Change |
|---|---|
| `@introspection/types` | Add `description`, `events`, `options` to `IntrospectionPlugin`. Add `PluginMeta` type. Add `plugins` to `SessionMeta`. Add `js.error.paused` to `TraceEvent` union. |
| `@introspection/core` | `initSessionDir` accepts plugin metadata, writes to `meta.json`. |
| `@introspection/plugin-js-errors` | Add `Runtime.exceptionThrown` handler emitting `js.error`. Keep `Debugger.paused` handler, change to emit `js.error.paused`. Populate metadata fields. |
| `@introspection/plugin-network` | Populate metadata fields (description, events). No logic changes. |
| `@introspection/plugin-webgl` | Populate metadata fields. No logic changes. |
| `@introspection/playwright` | `attach()` extracts plugin metadata, passes to `initSessionDir`. |
| `introspect` (CLI) | Add `plugins` command that reads from `meta.json`. |

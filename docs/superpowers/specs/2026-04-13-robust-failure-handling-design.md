# Robust failure handling

**Date:** 2026-04-13
**Status:** Design approved; ready for implementation plan.

## Context & goal

The code-quality review and the exhaustive failure catalog (`docs/analysis/failure_catalog_260413132056.md`) surfaced ~120 exception sites in the framework and plugins. Most fall into one of two bad modes:

- **Silently swallowed** — `.catch(() => {})`, empty catch blocks, write-queue `.then(() => {}, () => {})`, bus handlers via `Promise.allSettled`. Failures disappear; the trace looks healthy when it isn't.
- **Unmanaged throw** — CDP handlers that can reject into Playwright's dispatch loop; plugin-install rejections that abort the whole `attach()` at the first failing plugin.

The goal is a single, consistent failure policy across the codebase:

1. **Throw by default** with typed, message-clear errors.
2. **Catch only at documented boundaries** — plugin-handler dispatch, recoverable CDP calls, bus dispatch. At those boundaries, the catch must log (via `debug()`) *and* emit on the internal `introspect:warning` bus channel. Never silent.
3. **Opt-in self-introspection** — a new plugin (`@introspection/plugin-introspection`) subscribes to the internal warning/debug channels and emits them as `introspect.warning` / `introspect.debug` trace events. Without the plugin, the trace stays lean but the framework still throws loudly for unrecoverable cases.

This resolves the "silent failures" class documented in `docs/ideas.md` and turns the trace into a self-describing artifact for consumers who want it.

## Design

### Typed error classes (`@introspection/utils/errors.ts` — new)

```ts
export class IntrospectError extends Error {
  constructor(public source: 'cdp' | 'write' | 'parse' | 'plugin', message: string, public cause?: unknown) {
    super(message)
    this.name = this.constructor.name
  }
}

export class CdpError extends IntrospectError {
  constructor(public method: string, message: string, cause?: unknown) {
    super('cdp', `CDP ${method}: ${message}`, cause)
  }
}

export class WriteError extends IntrospectError {
  constructor(public operation: 'append' | 'write-asset' | 'init' | 'finalize', message: string, cause?: unknown) {
    super('write', `write.${operation}: ${message}`, cause)
  }
}

export class ParseError extends IntrospectError {
  constructor(public context: string, message: string, cause?: unknown) {
    super('parse', `parse.${context}: ${message}`, cause)
  }
}

export class PluginError extends IntrospectError {
  constructor(public pluginName: string, message: string, cause?: unknown) {
    super('plugin', `[${pluginName}] ${message}`, cause)
  }
}
```

Every catch-and-wrap site that currently throws `new Error(...)` or plain `.catch(err => throw err)` moves to the appropriate subclass. Consumer code can do `if (e instanceof CdpError)` / discriminate on `e.source`.

### Subscribable debug (`createDebug` stays introspection-unaware)

`createDebug` remains a pure utility — it doesn't know about sessions, plugins, or buses. It gains one new affordance: a `.subscribe(callback)` method that lets external code receive every call. Plugins explicitly wire that subscription to the session bus inside `install`. Framework code does the same.

**Updated `createDebug` surface (in `@introspection/utils/debug.ts`):**

```ts
type DebugCallback = (message: string, args: unknown[]) => void

interface DebugFn {
  (message: string, ...args: unknown[]): void
  subscribe(callback: DebugCallback): () => void   // returns unsubscribe
}

export function createDebug(label: string, verbose: boolean): DebugFn
```

When `debug(message, ...args)` is invoked:
1. If `verbose` is true, write `[label] message ...args` to stderr (today's behavior).
2. Notify every registered subscriber with `(message, args)` regardless of `verbose`.

No imports of `@introspection/types`, no awareness of buses or sessions. Could be extracted to a standalone package later.

**Plugin-side wiring (explicit, ~11 plugins × 2 lines):**

```ts
const debug = createDebug('plugin-network', options?.verbose ?? false)

return {
  async install(ctx) {
    debug.subscribe((message, args) =>
      ctx.bus.emit('introspect:debug', {
        label: 'plugin-network',
        message,
        args,
        timestamp: ctx.timestamp(),
      })
    )

    debug('enabled')   // unchanged
  },
}
```

The plugin author sees the wiring; nothing magic. They can choose to *not* subscribe (and only get stderr output), or to subscribe to a different sink for non-introspection use cases.

**Framework-side wiring** (in `attach.ts`, `session-writer.ts`):

Same pattern — module-level `createDebug`, then a `.subscribe(...)` call that emits on the session bus once the session exists. For session-writer, the subscription happens during construction; for attach, during the attach call.

**Rationale for subscription-as-opt-in:** a plugin's `verbose: true` controls stderr noise; the bus subscription is independent. `plugin-introspection({ includeDebug: true })` listens on `introspect:debug` and converts to trace events. Without that plugin attached, the bus emissions land on no subscribers and are no-ops.

**Channel naming convention:** `introspect:...` (with `:`) are framework-internal bus channels — reserved for framework + plugin-introspection use. `introspect.warning` / `introspect.debug` (with `.`) are trace-event types. The distinct separators prevent channel-↔-event-type confusion and avoid recursion when plugin-introspection emits events derived from internal channel payloads.

**Migration cost:** every plugin gains a 4-line `debug.subscribe(...)` block inside `install`. The top-level `createDebug` declaration stays. Mechanical, ~11 plugins. The framework helps by not requiring the call (a plugin that omits `subscribe` still works — its debug just doesn't land in the trace).

### Three documented catch boundaries

All other catches go away. `.catch(() => {})` becomes an ESLint rule. The remaining three:

**1. Plugin-handler wrapper** in `attach.ts`. Plugins register CDP event handlers via `ctx.cdpSession.on(event, handler)`. The framework wraps each handler:

```ts
on(event, handler) {
  cdp.on(event, async (params) => {
    try { await handler(params) }
    catch (cause) {
      const error = new PluginError(plugin.name, `handler for ${event} threw`, cause)
      debug(error.message, cause)
      bus.emit('introspect:warning', { error })
    }
  })
}
```

One plugin's bug can't cascade. Other plugins keep receiving events.

**2. CDP catches** in `attach.ts` (navigation recovery loop, unwatch / flush / detach paths) and `snapshot.ts`. These are sites where the framework knows it can continue if the call fails (move on to the next subscription, the next scope, the next iteration). The catch:

```ts
try {
  await cdp.send('Runtime.evaluate', { expression })
} catch (cause) {
  const error = new CdpError('Runtime.evaluate', String(cause), cause)
  debug('CDP Runtime.evaluate failed: %s', String(cause))
  bus.emit('introspect:warning', { error })
  // continue — caller decided this site is non-fatal
}
```

The framework does **not** classify the cause. The error is wrapped in `CdpError` (which preserves `cause` and `method`); whether the failure is "expected lifecycle race" or "real CDP fault" is the consumer's call. Two reasons:

- **No string-matching guesses.** Pattern lists like `'Execution context was destroyed'` are guesses about what Chrome happens to say today; they drift across versions and break silently. The framework doesn't pretend to know.
- **The trace is the truth, the consumer is the lens.** `introspect events --type introspect.warning` shows every recoverable failure. If a consumer wants to filter out navigation noise, they do it at query time: `--filter '!event.metadata.cause?.message?.includes("Execution context")'`. The framework reports; the consumer decides.

**Trade-off acknowledged:** in tests with many navigations, the trace will contain a steady stream of `introspect.warning` events for context-destruction races. That's a visible cost of `plugin-introspection({ includeFailures: true })`. The introspect-debug skill should document common cause-message patterns so consumers know how to filter.

**Compare** to boundary 1 (plugin-handler wrapper) and boundary 3 (bus dispatch): same shape, different framework intent. Those catches mean "a plugin had a bug" — still emit on `introspect:warning` (the session continues), just with a different `error.source` (`'plugin'` vs `'cdp'`). The discriminator is in the typed error, not on the channel.

**3. Bus dispatch** in `@introspection/utils/bus.ts:22`. Other handlers keep running (`allSettled` preserved). Rejected handlers are *reported* instead of silently discarded:

- Each rejection is written to stderr with a `[bus]` prefix.
- For handlers on application channels (anything not starting with `introspect:`), a `bus.emit('introspect:warning', ...)` records the failure on the internal channel.
- For handlers on the internal `introspect:warning` / `introspect:debug` channels, stderr is the only surface — no re-emission, to avoid recursion. (If `plugin-introspection` itself throws, the failure hits stderr and is visible at dev time; it does not loop back into the trace.)

**Plugin-install loop** (`attach.ts:113`): each plugin's `install(ctx)` is wrapped in try/catch. A failed plugin does **not** mutate `meta.json` — install failure is a runtime event, not metadata. It emits on `bus.emit('introspect:warning', { error: PluginError })` and stderr (via `debug`), and the loop continues with subsequent plugins. `meta.plugins` records what was *attempted*; `introspect events --type introspect.warning` filtered by `metadata.source === 'plugin'` records what *failed*. Single source of truth.

The wrapping also covers `await page.evaluate(plugin.script)` (currently `attach.ts:111` with `.catch(() => {})`) and the implicit `await ctx.cdpSession.send(...)` calls plugins make inside their `install`. Any of those rejecting trips the same warning path; the loop continues with the next plugin.

`PluginMeta` stays unchanged — no mutable fields, no `updatePluginMeta` API on `SessionWriter`.

### Non-boundary sites: throw

Everywhere else in the catalog that's currently `.catch(() => {})` or an empty catch gets ripped out:

- `packages/write/src/session.ts:18` — stop swallowing. `ENOSPC` / `EACCES` during `appendEvent` fails the test via rejected write.
- `packages/playwright/src/attach.ts:111` — plugin script eval failures are caught by the plugin-install loop wrapping (above): the plugin is marked failed in session metadata, a warning is emitted, and the loop continues. Not a separate site.
- `packages/playwright/src/attach.ts:82,163,176,179` — unwatch / flush roundtrip / detach catches use the same pattern as boundary 2. Wrap the cause in `CdpError`, emit on `introspect:warning`, continue. No silent swallows; no classification.
- `packages/read/src/index.ts:235` — NDJSON parse in `.map` gets its own per-line try/catch that wraps parse failures in `ParseError` with line number, so one malformed line doesn't abort the whole session.
- `packages/utils/src/summarise-body.ts:5` — parse failure throws instead of returning empty default. Caller decides what to do.

### Internal bus channels

Add two framework-internal channels to `BusPayloadMap`:

```ts
interface BusPayloadMap {
  // ...existing trace events as triggers...
  'introspect:warning': { error: IntrospectError }   // framework caught and continued
  'introspect:debug': {
    label: string
    message: string
    args: unknown[]
    timestamp: number
  }
}
```

Channels prefixed with `introspect:` are framework-reserved. Plugins don't emit on them; they only subscribe.

### New trace event types (`@introspection/types`)

```ts
interface IntrospectWarningEvent extends BaseEvent {
  type: 'introspect.warning'        // recoverable: framework caught and continued
  metadata: {
    source: 'cdp' | 'write' | 'parse' | 'plugin'
    pluginName?: string
    method?: string                 // e.g. 'Runtime.evaluate'
    message: string
    stack?: string
    cause?: { name: string; message: string }   // raw error info; consumer-side filtering
  }
}

interface IntrospectDebugEvent extends BaseEvent {
  type: 'introspect.debug'
  metadata: {
    label: string           // e.g. 'plugin-network'
    message: string
    args: unknown[]         // JSON-serializable; non-serializable values get stringified
  }
}
```

Added to `TraceEventMap`. Only `plugin-introspection` emits these in practice.

**No `introspect.error` in v1.** Every fatal-throw site in the codebase either (a) breaks the write path itself (so it can't tombstone in the trace) or (b) happens outside session context (read-side, pre-attach validation). The catch+record+rethrow pattern has no working caller. If a future `strict: true` mode promotes warnings into thrown errors, reintroduce `introspect.error` then with a real caller.

### `@introspection/plugin-introspection` (new)

Shape:

```ts
export interface PluginIntrospectionOptions {
  verbose?: boolean
  includeFailures?: boolean    // default false
  includeDebug?: boolean       // default false
}

export function introspection(options?: PluginIntrospectionOptions): IntrospectionPlugin
```

`install(ctx)`:

1. If `includeFailures`: subscribe to the warning channel and emit the corresponding trace event:
   ```ts
   ctx.bus.on('introspect:warning', ({ error }) => ctx.emit({
     type: 'introspect.warning',
     metadata: serialize(error),
   }))
   ```
   Consumers filter at query time on `event.metadata.cause?.message` or `event.metadata.source` to slice (e.g. drop navigation-context-destroyed noise).
2. If `includeDebug`: `ctx.bus.on('introspect:debug', ({ label, message, args, timestamp }) => ctx.emit({ type: 'introspect.debug', metadata: { label, message, args } }))`.
3. If both false, the plugin is a no-op (tolerate but warn via debug).

Follows every plugin convention — `verbose`, `createDebug`, `events` map, README per template.

**Not in `plugin-defaults`.** Opt-in only.

## Data flow

```
[throw site in framework/plugin]
        │
        ├─ most sites: throw IntrospectError subclass → propagates
        │                                               │
        │                                               ▼
        │                                  [Playwright test fails]
        │
        └─ 3 boundaries (catch + continue):
              bus.emit('introspect:warning', { error })
                                       │
                                       ▼ (optional) plugin-introspection subscribes
                                       │
                                       ▼ ctx.emit({ type: 'introspect.warning' })
                                       │
                                       ▼ events.ndjson

        Query: `introspect events --type introspect.warning`


[debug(message) call inside plugin]
        │
        ├─ verbose ? write to stderr with '[plugin-x] ...' prefix
        └─ notify subscribers (no-op if none)
                │
                ▼ (when plugin's install registered:
                   debug.subscribe((message, args) =>
                     ctx.bus.emit('introspect:debug', { label, message, args, timestamp })
                   ))
                │
                ▼
        bus.emit('introspect:debug', { label, message, args, timestamp })
                                 │
                                 ▼
                        (optional) plugin-introspection subscribes
                                 │
                                 ▼
                        ctx.emit({ type: 'introspect.debug' })
```

## Testing

- **Unit tests** for each error class (`packages/utils/test/errors.test.ts`): subclass `instanceof` checks, `source` discrimination, `cause` preservation, message format.
- **Playwright tests** in `packages/playwright/test/failure-handling.spec.ts`:
  - Plugin-handler throws → other plugins still receive events.
  - Plugin-install throws → subsequent plugins still install; an `introspect.warning` event is written to the trace with `metadata.source === 'plugin'` and the failed plugin's name.
  - Write queue disk-error → test fails with WriteError (simulate via `mkdir` of the ndjson path).
  - Navigation context destruction during CDP call → no throw, no silent swallow, a failure bus event fires.
- **Plugin test** `plugins/plugin-introspection/test/introspection.spec.ts`:
  - With `includeFailures: true`, induced CDP failure lands as `introspect.warning`.
  - With `includeDebug: true`, a `ctx.debug(...)` call lands as `introspect.debug`.
  - Both-false → plugin is a no-op, no events emitted.
- **Regression**: existing plugin tests stay green after the `debug.subscribe` wiring is added.

## Migration impact

| File class | Change |
|---|---|
| `packages/utils/src/errors.ts` | New file, 5 error classes, ~40 lines. |
| `packages/utils/src/debug.ts` | `createDebug` gains a `.subscribe(callback)` method on the returned function. No other API change; remains introspection-unaware. |
| `packages/utils/src/bus.ts` | Line 22: report rejections via stderr + (for app channels) re-emit on `introspect:warning`. Internal channels stderr-only to avoid recursion. |
| `packages/types/src/index.ts` | Add 2 trace event types (`introspect.warning`, `introspect.debug`), 2 internal bus channels (`introspect:warning`, `introspect:debug`). No `PluginMeta` / `PluginContext` / `SessionWriter` API changes — wiring is done via `debug.subscribe` + `ctx.bus.emit`. |
| `packages/playwright/src/attach.ts` | Remove 5 `.catch(() => {})` sites. Wrap plugin handlers in try/catch → bus emit. Wrap plugin-install loop. Navigation-recovery catch → report. Subscribe own framework `debug` to session bus. |
| `packages/playwright/src/snapshot.ts` | Three non-fatal catches → report on bus. |
| `packages/write/src/session.ts` | Remove the swallow on line 18. Write errors propagate. Subscribe own framework `debug` to session bus. |
| `packages/read/src/index.ts:235` | Per-line try/catch wraps parse errors in `ParseError`. |
| Each plugin (11) | Add `debug.subscribe((message, args) => ctx.bus.emit('introspect:debug', { … }))` inside `install`. Top-level `createDebug` declaration unchanged. |
| `plugins/plugin-introspection/` | New package. |

## Out of scope (deferred)

- Shape-validation helpers (`assertShape<T>`) for CDP response casts — mentioned in the quality review. Separate design round; not blocking this one.
- Replacing the remaining D4 type-assertions across plugins — same.
- A global `strict: true` mode that promotes `introspect.warning` events back into thrown errors — could come later as a convenience flag; not needed for v1.

## Verification plan

1. `pnpm build && pnpm typecheck` across workspace.
2. `pnpm test` — all existing plugin + core-package tests stay green.
3. New `failure-handling.spec.ts` covers every boundary + every "throw by default" regression risk.
4. New `plugin-introspection` tests assert both opt-ins plus the no-op default.
5. Manually: `pnpm -C demos/react-session-list test` with `plugin-introspection({ includeFailures: true, includeDebug: true })` attached, then `introspect events --type 'introspect.*'` shows the debug log line and any boundary-catch failures from the run.

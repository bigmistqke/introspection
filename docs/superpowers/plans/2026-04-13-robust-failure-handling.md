# Robust Failure Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace silent error swallowing with a single, consistent failure policy — typed `IntrospectError` classes, three documented catch boundaries that emit on an internal `introspect:warning` channel, a subscribable `createDebug`, and an opt-in `@introspection/plugin-introspection` that surfaces both in the trace.

**Architecture:** Five typed error classes in `@introspection/utils`. Three framework boundaries (plugin-handler wrapper, recoverable CDP calls, bus dispatch) catch → wrap → emit on `introspect:warning`; everything else throws. `createDebug` gains `.subscribe(callback)`; plugins wire it to `ctx.bus` inside `install`. A new plugin subscribes to `introspect:warning` / `introspect:debug` and emits `introspect.warning` / `introspect.debug` trace events.

**Tech Stack:** TypeScript, pnpm workspaces, vitest (unit tests in `packages/utils`, `packages/write`, `packages/read`), Playwright (integration tests in `packages/playwright`, plugin tests).

**Spec:** `docs/superpowers/specs/2026-04-13-robust-failure-handling-design.md`.

---

## File Structure

**New files:**
- `packages/utils/src/errors.ts` — `IntrospectError` + subclasses
- `packages/utils/test/errors.test.ts` — unit tests for error classes
- `packages/utils/test/debug.test.ts` — unit tests for subscribable `createDebug`
- `packages/utils/test/bus.test.ts` — unit tests for bus rejection reporting
- `packages/utils/vitest.config.ts` — vitest config (matches sibling packages)
- `packages/write/test/session.test.ts` — unit test for unswallowed write errors (add to existing or new)
- `packages/read/test/ndjson-parse.test.ts` — unit test for per-line parse resilience
- `packages/playwright/test/failure-handling.spec.ts` — integration test for catch boundaries
- `plugins/plugin-introspection/` — new package (package.json, src/index.ts, README.md, test/introspection.spec.ts, playwright.config.ts, tsconfig.json)

**Modified files:**
- `packages/utils/src/debug.ts` — subscribable `createDebug`
- `packages/utils/src/bus.ts` — report rejections on stderr + `introspect:warning` (app channels)
- `packages/utils/src/index.ts` — re-export errors
- `packages/utils/src/summarise-body.ts` — throw on parse failure
- `packages/utils/package.json` — add vitest, add `test` script
- `packages/types/src/index.ts` — add `introspect.warning` / `introspect.debug` trace events and `introspect:warning` / `introspect:debug` bus channels
- `packages/write/src/session.ts` — remove `.then(() => {}, () => {})` swallow; subscribe framework `debug` to bus
- `packages/read/src/index.ts` — per-line try/catch wraps `ParseError`
- `packages/playwright/src/attach.ts` — plugin-handler wrapper, plugin-install try/catch, recoverable CDP catches wrap in `CdpError` + emit, subscribe framework `debug` to bus, remove `.catch(() => {})` sites
- `packages/playwright/src/snapshot.ts` — replace silent catches with `CdpError` via `onWarning` callback
- Each plugin's `src/index.ts` (10 files: plugin-cdp, plugin-console, plugin-debugger, plugin-js-error, plugin-network, plugin-performance, plugin-react-scan, plugin-redux, plugin-solid-devtools, plugin-webgl) — add `const unsubscribeDebug = debug.subscribe(...)` + `ctx.bus.on('detach', () => unsubscribeDebug())` inside `install`

---

## Task 1: Typed error classes

**Files:**
- Create: `packages/utils/src/errors.ts`
- Create: `packages/utils/vitest.config.ts`
- Create: `packages/utils/test/errors.test.ts`
- Modify: `packages/utils/src/index.ts`
- Modify: `packages/utils/package.json`

- [ ] **Step 1: Add vitest config + test script**

Create `packages/utils/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { globals: true },
})
```

Modify `packages/utils/package.json`: add `"test": "vitest run"` to `scripts`, add `"vitest": "^2.0.0"` to `devDependencies`.

Run: `pnpm install`
Expected: vitest installs in the utils workspace.

- [ ] **Step 2: Write failing tests for the error classes**

Create `packages/utils/test/errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { IntrospectError, CdpError, WriteError, ParseError, PluginError } from '../src/errors.js'

describe('IntrospectError', () => {
  it('sets source and message and preserves cause', () => {
    const cause = new Error('underlying')
    const err = new IntrospectError('cdp', 'boom', cause)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(IntrospectError)
    expect(err.source).toBe('cdp')
    expect(err.message).toBe('boom')
    expect(err.cause).toBe(cause)
    expect(err.name).toBe('IntrospectError')
  })
})

describe('CdpError', () => {
  it('prefixes method and extends IntrospectError', () => {
    const err = new CdpError('Runtime.evaluate', 'session closed')
    expect(err).toBeInstanceOf(IntrospectError)
    expect(err).toBeInstanceOf(CdpError)
    expect(err.source).toBe('cdp')
    expect(err.method).toBe('Runtime.evaluate')
    expect(err.message).toBe('CDP Runtime.evaluate: session closed')
    expect(err.name).toBe('CdpError')
  })
})

describe('WriteError', () => {
  it('prefixes operation', () => {
    const err = new WriteError('append', 'ENOSPC')
    expect(err.source).toBe('write')
    expect(err.operation).toBe('append')
    expect(err.message).toBe('write.append: ENOSPC')
    expect(err.name).toBe('WriteError')
  })
})

describe('ParseError', () => {
  it('prefixes context', () => {
    const err = new ParseError('ndjson:line 42', 'Unexpected token')
    expect(err.source).toBe('parse')
    expect(err.context).toBe('ndjson:line 42')
    expect(err.message).toBe('parse.ndjson:line 42: Unexpected token')
    expect(err.name).toBe('ParseError')
  })
})

describe('PluginError', () => {
  it('prefixes plugin name', () => {
    const err = new PluginError('plugin-network', 'handler for Network.requestWillBeSent threw')
    expect(err.source).toBe('plugin')
    expect(err.pluginName).toBe('plugin-network')
    expect(err.message).toBe('[plugin-network] handler for Network.requestWillBeSent threw')
    expect(err.name).toBe('PluginError')
  })
})
```

- [ ] **Step 3: Run test — expect FAIL (no errors.ts)**

Run: `pnpm -C packages/utils test`
Expected: FAIL — `Cannot find module '../src/errors.js'`.

- [ ] **Step 4: Implement the error classes**

Create `packages/utils/src/errors.ts`:
```ts
export type IntrospectErrorSource = 'cdp' | 'write' | 'parse' | 'plugin'

export class IntrospectError extends Error {
  constructor(public source: IntrospectErrorSource, message: string, public cause?: unknown) {
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

- [ ] **Step 5: Re-export from utils**

Modify `packages/utils/src/index.ts`:
```ts
export * from './bus.js'
export * from './cdp.js'
export * from './debug.js'
export * from './errors.js'
export * from './summarise-body.js'
```

- [ ] **Step 6: Run tests — expect PASS**

Run: `pnpm -C packages/utils test`
Expected: PASS — 5 tests green.

- [ ] **Step 7: Commit**

```bash
git add packages/utils/src/errors.ts packages/utils/src/index.ts packages/utils/test/errors.test.ts packages/utils/vitest.config.ts packages/utils/package.json
git commit -m "feat(utils): add typed IntrospectError class hierarchy"
```

---

## Task 2: Subscribable `createDebug`

**Files:**
- Modify: `packages/utils/src/debug.ts`
- Create: `packages/utils/test/debug.test.ts`

- [ ] **Step 1: Write failing tests for debug + subscribe**

Create `packages/utils/test/debug.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createDebug } from '../src/debug.js'

describe('createDebug', () => {
  it('writes to stderr when verbose is true', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const debug = createDebug('test', true)
    debug('hello', 1, 2)
    expect(log).toHaveBeenCalledWith('[test]', 'hello', 1, 2)
    log.mockRestore()
  })

  it('does not write to stderr when verbose is false', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const debug = createDebug('test', false)
    debug('hello')
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('notifies subscribers regardless of verbose flag', () => {
    const debug = createDebug('label', false)
    const received: Array<{ message: string; args: unknown[] }> = []
    debug.subscribe((message, args) => received.push({ message, args }))
    debug('msg', 'a', 'b')
    expect(received).toEqual([{ message: 'msg', args: ['a', 'b'] }])
  })

  it('returns an unsubscribe function', () => {
    const debug = createDebug('label', false)
    const received: string[] = []
    const unsubscribe = debug.subscribe((message) => received.push(message))
    debug('first')
    unsubscribe()
    debug('second')
    expect(received).toEqual(['first'])
  })

  it('supports multiple subscribers', () => {
    const debug = createDebug('label', false)
    const a: string[] = []
    const b: string[] = []
    debug.subscribe((message) => a.push(message))
    debug.subscribe((message) => b.push(message))
    debug('hi')
    expect(a).toEqual(['hi'])
    expect(b).toEqual(['hi'])
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm -C packages/utils test debug`
Expected: FAIL — `debug.subscribe is not a function`.

- [ ] **Step 3: Implement subscribable `createDebug`**

Replace `packages/utils/src/debug.ts`:
```ts
export type DebugCallback = (message: string, args: unknown[]) => void

export interface DebugFn {
  (message: string, ...args: unknown[]): void
  subscribe(callback: DebugCallback): () => void
}

export function createDebug(label: string, verbose: boolean): DebugFn {
  const subscribers = new Set<DebugCallback>()

  const fn = ((message: string, ...args: unknown[]) => {
    if (verbose) console.log(`[${label}]`, message, ...args)
    for (const subscriber of subscribers) subscriber(message, args)
  }) as DebugFn

  fn.subscribe = (callback) => {
    subscribers.add(callback)
    return () => { subscribers.delete(callback) }
  }

  return fn
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm -C packages/utils test debug`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Typecheck all plugins (signature compatibility)**

Run: `pnpm typecheck`
Expected: PASS — existing `createDebug('label', bool)` callsites still type-check because call-signature is unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/utils/src/debug.ts packages/utils/test/debug.test.ts
git commit -m "feat(utils): make createDebug subscribable"
```

---

## Task 3: Extend types — bus channels, trace events, PluginMeta

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add new trace-event interfaces**

Open `packages/types/src/index.ts`. Locate the trace-event section (search for `CdpCommandEvent` / `CdpEventEvent` to find the neighbourhood). Add immediately before `TraceEventMap`:

```ts
export interface IntrospectWarningEvent extends BaseEvent {
  type: 'introspect.warning'
  metadata: {
    source: 'cdp' | 'write' | 'parse' | 'plugin'
    pluginName?: string
    method?: string
    message: string
    stack?: string
    cause?: { name: string; message: string }
  }
}

export interface IntrospectDebugEvent extends BaseEvent {
  type: 'introspect.debug'
  metadata: {
    label: string
    message: string
    args: unknown[]
  }
}
```

- [ ] **Step 2: Register in `TraceEventMap`**

Still in `packages/types/src/index.ts`, add the two new entries to `TraceEventMap`:
```ts
export interface TraceEventMap {
  // …existing entries…
  'cdp.command': CdpCommandEvent
  'cdp.event': CdpEventEvent
  'introspect.warning': IntrospectWarningEvent
  'introspect.debug': IntrospectDebugEvent
}
```

- [ ] **Step 3: Extend `BusPayloadMap` with internal channels**

Find `BusPayloadMap` (around line 394). Replace with:
```ts
export type BusPayloadMap = TraceEventMap & {
  'snapshot': { trigger: 'manual' | 'js.error' | 'debugger.paused'; timestamp: number }
  'manual': { trigger: 'manual'; timestamp: number }
  'detach': { trigger: 'detach'; timestamp: number }
  'introspect:warning': { error: IntrospectError }
  'introspect:debug': { label: string; message: string; args: unknown[]; timestamp: number }
}
```

Add at the top of `packages/types/src/index.ts` (structural-only import so `packages/types` remains dependency-free):
```ts
import type { IntrospectError } from '@introspection/utils/dist/errors.js'
```

**Wait — don't do that.** `packages/types` has no dependency on `packages/utils` and must not, because `utils` already depends on `types`. Instead, inline the shape:

```ts
export type BusPayloadMap = TraceEventMap & {
  'snapshot': { trigger: 'manual' | 'js.error' | 'debugger.paused'; timestamp: number }
  'manual': { trigger: 'manual'; timestamp: number }
  'detach': { trigger: 'detach'; timestamp: number }
  'introspect:warning': { error: { name: string; message: string; source: 'cdp' | 'write' | 'parse' | 'plugin'; cause?: unknown; stack?: string; pluginName?: string; method?: string } }
  'introspect:debug': { label: string; message: string; args: unknown[]; timestamp: number }
}
```

The payload describes the structural surface an `IntrospectError` exposes; callers pass the real `IntrospectError` instance which satisfies it structurally.

- [ ] **Step 4: Typecheck**

Run: `pnpm -C packages/types typecheck && pnpm typecheck`
Expected: PASS (types-only additions; no callers reference the new shapes yet).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): add introspect.warning/debug events and internal bus channels"
```

---

## Task 4: Bus dispatch reports rejections

**Files:**
- Modify: `packages/utils/src/bus.ts`
- Create: `packages/utils/test/bus.test.ts`

- [ ] **Step 1: Write failing tests for bus behavior**

Create `packages/utils/test/bus.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createBus } from '../src/bus.js'

describe('bus.emit', () => {
  it('runs all handlers even when one rejects', async () => {
    const bus = createBus()
    const ok: number[] = []
    bus.on('manual', () => { throw new Error('boom') })
    bus.on('manual', async () => { ok.push(1) })
    await bus.emit('manual', { trigger: 'manual', timestamp: 0 })
    expect(ok).toEqual([1])
  })

  it('reports rejections on stderr with [bus] prefix', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bus = createBus()
    bus.on('manual', () => { throw new Error('boom') })
    await bus.emit('manual', { trigger: 'manual', timestamp: 0 })
    expect(err).toHaveBeenCalled()
    const call = err.mock.calls[0]!
    expect(String(call[0])).toContain('[bus]')
    err.mockRestore()
  })

  it('re-emits app-channel rejections on introspect:warning', async () => {
    const bus = createBus()
    const warnings: Array<{ name: string; message: string }> = []
    bus.on('introspect:warning', ({ error }) => {
      warnings.push({ name: error.name, message: error.message })
    })
    bus.on('mark', () => { throw new Error('from-mark-handler') })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await bus.emit('mark', { id: 'x', timestamp: 0, type: 'mark', metadata: { label: 'l' } } as never)
    expect(warnings.length).toBe(1)
    expect(warnings[0]!.message).toContain('from-mark-handler')
    errSpy.mockRestore()
  })

  it('does not recurse: introspect:warning handler rejections hit stderr only', async () => {
    const bus = createBus()
    let reEmitCount = 0
    bus.on('introspect:warning', () => { reEmitCount++; throw new Error('from-warning-handler') })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await bus.emit('introspect:warning', { error: { name: 'X', message: 'y', source: 'cdp' } })
    expect(reEmitCount).toBe(1)
    err.mockRestore()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm -C packages/utils test bus`
Expected: FAIL — stderr not called; no re-emit on `introspect:warning`.

- [ ] **Step 3: Implement rejection reporting**

Replace `packages/utils/src/bus.ts`:
```ts
import type { BusPayloadMap, BusTrigger } from '@introspection/types'

type BusHandler<T extends BusTrigger> = (payload: BusPayloadMap[T]) => void | Promise<void>

export interface Bus {
  on<T extends BusTrigger>(trigger: T, handler: BusHandler<T>): void
  emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]): Promise<void>
}

function isInternalChannel(trigger: string): boolean {
  return trigger.startsWith('introspect:')
}

export function createBus(): Bus {
  const handlers = new Map<string, Array<(payload: unknown) => void | Promise<void>>>()

  const bus: Bus = {
    on<T extends BusTrigger>(trigger: T, handler: BusHandler<T>) {
      const existing = handlers.get(trigger) ?? []
      existing.push(handler as (payload: unknown) => void | Promise<void>)
      handlers.set(trigger, existing)
    },

    async emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]) {
      const registered = handlers.get(trigger) ?? []
      const results = await Promise.allSettled(
        registered.map(handler => Promise.resolve().then(() => handler(payload))),
      )
      for (const result of results) {
        if (result.status !== 'rejected') continue
        const cause = result.reason
        console.error(`[bus] handler for "${trigger}" rejected:`, cause)
        if (isInternalChannel(trigger)) continue
        const message = cause instanceof Error ? cause.message : String(cause)
        const name = cause instanceof Error ? cause.name : 'Error'
        const source = 'plugin' as const
        void bus.emit('introspect:warning', {
          error: {
            name,
            message: `bus handler for "${trigger}" rejected: ${message}`,
            source,
            cause,
            stack: cause instanceof Error ? cause.stack : undefined,
          },
        })
      }
    },
  }

  return bus
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm -C packages/utils test bus`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/utils/src/bus.ts packages/utils/test/bus.test.ts
git commit -m "feat(utils): bus.emit reports rejections on stderr + introspect:warning"
```

---

## Task 5: `summariseBody` throws on parse failure

**Files:**
- Modify: `packages/utils/src/summarise-body.ts`
- Create: `packages/utils/test/summarise-body.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/utils/test/summarise-body.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { summariseBody } from '../src/summarise-body.js'
import { ParseError } from '../src/errors.js'

describe('summariseBody', () => {
  it('returns empty summary for non-object JSON', () => {
    expect(summariseBody('[1,2,3]')).toEqual({ keys: [], scalars: {}, arrays: {}, errorFields: {} })
    expect(summariseBody('42')).toEqual({ keys: [], scalars: {}, arrays: {}, errorFields: {} })
  })

  it('throws ParseError on invalid JSON', () => {
    expect(() => summariseBody('not-json')).toThrow(ParseError)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm -C packages/utils test summarise-body`
Expected: FAIL — does not throw.

- [ ] **Step 3: Implement throw-on-parse-failure**

Replace the `try/catch` block in `packages/utils/src/summarise-body.ts`:
```ts
import type { BodySummary } from '@introspection/types'
import { ParseError } from './errors.js'

export function summariseBody(raw: string): BodySummary {
  let parsed: Record<string, unknown>
  try {
    const body = JSON.parse(raw)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return { keys: [], scalars: {}, arrays: {}, errorFields: {} }
    }
    parsed = body
  } catch (cause) {
    throw new ParseError('summarise-body', cause instanceof Error ? cause.message : String(cause), cause)
  }

  const keys = Object.keys(parsed)
  const scalars: Record<string, string | number | boolean | null> = {}
  const arrays: Record<string, { length: number; itemKeys: string[] }> = {}
  const errorFields: Record<string, unknown> = {}
  const ERROR_KEYS = new Set(['error', 'message', 'code', 'status', 'detail'])

  for (const [k, v] of Object.entries(parsed)) {
    if (Array.isArray(v)) {
      const first = v[0] && typeof v[0] === 'object' ? Object.keys(v[0] as object) : []
      arrays[k] = { length: v.length, itemKeys: first }
    } else if (typeof v !== 'object' || v === null) {
      scalars[k] = v as string | number | boolean | null
    }
    if (ERROR_KEYS.has(k)) errorFields[k] = v
  }
  return { keys, scalars, arrays, errorFields }
}
```

- [ ] **Step 4: Update existing callers**

Search for callers: `pnpm -s exec rg -l 'summariseBody'` (or `Grep` tool). For each caller that does not already handle `ParseError`, wrap in try/catch that either (a) records on `introspect:warning` via ambient debug/bus (if in install scope) or (b) treats body as opaque. Confirm no caller currently relies on "empty summary on error".

Typical call pattern to look for:
```ts
const summary = summariseBody(responseBody)
```
Wrap as needed per caller site.

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm -C packages/utils test`
Expected: PASS — all utils tests pass.

Run: `pnpm typecheck && pnpm test`
Expected: PASS — no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/utils/src/summarise-body.ts packages/utils/test/summarise-body.test.ts
git add -p  # review caller changes
git commit -m "fix(utils): summariseBody throws ParseError instead of silent default"
```

---

## Task 6: NDJSON read path per-line tolerance

**Files:**
- Modify: `packages/read/src/index.ts`
- Create: `packages/read/test/ndjson-parse.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/read/test/ndjson-parse.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import type { StorageAdapter } from '../src/index.js'
// loadEvents is internal; if not exported, export it via `__testing__` wrapper in src/index.ts.
import { __testing__ } from '../src/index.js'

function makeAdapter(sessionId: string, body: string): StorageAdapter {
  return {
    readText: async (path: string) => {
      if (path === `${sessionId}/events.ndjson`) return body
      throw new Error('unexpected path')
    },
    readBinary: async () => Buffer.alloc(0),
    listSessions: async () => [],
  } as unknown as StorageAdapter
}

describe('loadEvents', () => {
  it('skips malformed lines and returns valid ones', async () => {
    const adapter = makeAdapter('s1', [
      '{"id":"1","type":"mark","timestamp":1,"metadata":{"label":"a"}}',
      '{malformed',
      '{"id":"2","type":"mark","timestamp":2,"metadata":{"label":"b"}}',
    ].join('\n'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const events = await __testing__.loadEvents(adapter, 's1')
    expect(events.map(e => (e as { id: string }).id)).toEqual(['1', '2'])
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm -C packages/read test ndjson-parse`
Expected: FAIL — `__testing__` not exported.

- [ ] **Step 3: Implement per-line tolerance**

In `packages/read/src/index.ts`, replace the `loadEvents` function body and export it for testing:
```ts
import { ParseError } from '@introspection/utils'

async function loadEvents(adapter: StorageAdapter, sessionId: string): Promise<TraceEvent[]> {
  const eventsRaw = await adapter.readText(`${sessionId}/events.ndjson`)
  const events: TraceEvent[] = []
  const lines = eventsRaw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    try {
      events.push(JSON.parse(line) as TraceEvent)
    } catch (cause) {
      const err = new ParseError(`ndjson:line ${i + 1}`, cause instanceof Error ? cause.message : String(cause), cause)
      console.error(`[read] ${err.message}`)
    }
  }
  return events
}

export const __testing__ = { loadEvents }
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm -C packages/read test ndjson-parse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/read/src/index.ts packages/read/test/ndjson-parse.test.ts
git commit -m "fix(read): tolerate malformed NDJSON lines with per-line ParseError"
```

---

## Task 7: Write queue stops swallowing errors

**Files:**
- Modify: `packages/write/src/session.ts`
- Create or extend: `packages/write/test/session.test.ts`

- [ ] **Step 1: Write failing test**

Create or extend `packages/write/test/session.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSessionWriter } from '../src/session.js'

describe('createSessionWriter write queue', () => {
  it('propagates write failures instead of swallowing them', async () => {
    const base = await mkdtemp(join(tmpdir(), 'session-test-'))
    const writer = await createSessionWriter({ outDir: base })
    // Corrupt the NDJSON path so append fails: replace the target file with a directory.
    const sessionDir = join(base, writer.id)
    await mkdir(join(sessionDir, 'events.ndjson'), { recursive: true })
    await expect(
      writer.emit({ type: 'mark', metadata: { label: 'x' } }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm -C packages/write test session`
Expected: FAIL — `emit` currently swallows the error via `.then(() => {}, () => {})`.

- [ ] **Step 3: Remove the swallow**

In `packages/write/src/session.ts`, change `createWriteQueue` so the pending chain does not discard errors (and still serialises writes):

```ts
function createWriteQueue() {
  let pending: Promise<unknown> = Promise.resolve()

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation)
    pending = result.catch(() => {})   // keep the chain alive for subsequent writes,
                                        // but the ORIGINAL `result` promise still rejects to the caller.
    return result
  }

  function flush(): Promise<void> {
    return pending.then(() => {})
  }

  return { enqueue, flush }
}
```

**Why still a `.catch`?** The `pending` chain itself must not stay rejected — if it did, every subsequent `enqueue` would reject on the prior failure. The rejection is preserved on the *returned* `result` promise only; the queue continues. Callers (like `session.emit`, which returns the promise) now see the rejection.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm -C packages/write test session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/write/src/session.ts packages/write/test/session.test.ts
git commit -m "fix(write): stop swallowing write-queue errors; propagate to caller"
```

---

## Task 8: Plugin-handler wrapper + install-loop try/catch in `attach.ts`

**Files:**
- Modify: `packages/playwright/src/attach.ts`
- Modify: `packages/playwright/src/snapshot.ts`
- Create: `packages/playwright/test/failure-handling.spec.ts`

- [ ] **Step 1: Write failing Playwright integration test for plugin-handler isolation**

Create `packages/playwright/test/failure-handling.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { attach } from '../src/attach.js'
import type { IntrospectionPlugin } from '@introspection/types'

test('plugin handler throwing does not prevent other plugins from receiving events', async ({ page }) => {
  const good: string[] = []
  const bad: IntrospectionPlugin = {
    name: 'bad',
    async install(ctx) {
      ctx.cdpSession.on('Runtime.consoleAPICalled', () => { throw new Error('handler boom') })
    },
  }
  const goodPlugin: IntrospectionPlugin = {
    name: 'good',
    async install(ctx) {
      ctx.cdpSession.on('Runtime.consoleAPICalled', () => { good.push('saw event') })
    },
  }

  const handle = await attach(page, { plugins: [bad, goodPlugin], verbose: false })
  await page.goto('data:text/html,<script>console.log("hi")</script>')
  await page.waitForTimeout(200)
  await handle.detach()

  expect(good.length).toBeGreaterThan(0)
})

test('plugin install throwing marks plugin as failed and continues with subsequent plugins', async ({ page }) => {
  const other: string[] = []
  const explodes: IntrospectionPlugin = {
    name: 'explodes',
    async install() { throw new Error('install boom') },
  }
  const works: IntrospectionPlugin = {
    name: 'works',
    async install() { other.push('installed') },
  }

  const handle = await attach(page, { plugins: [explodes, works] })
  expect(other).toEqual(['installed'])
  await handle.detach()

  // After detach, read session metadata from disk and assert failed plugin recorded.
  // (Adapt path resolution to your existing test helpers; see plugin-console/test for patterns.)
})

test('bus emits introspect:warning when a recoverable CDP catch fires', async ({ page }) => {
  const warnings: unknown[] = []
  const observer: IntrospectionPlugin = {
    name: 'observer',
    async install(ctx) {
      ctx.bus.on('introspect:warning', (payload) => warnings.push(payload))
    },
  }

  const handle = await attach(page, { plugins: [observer] })
  // Force a post-navigation context destruction scenario by navigating twice rapidly
  // while an in-flight Runtime.evaluate is active.
  await page.goto('data:text/html,<p>one</p>')
  await Promise.all([
    page.goto('data:text/html,<p>two</p>'),
    handle.flush(),
  ])
  await handle.detach()

  // At least: test passes without throwing. Warning-count assertion is optional
  // because the race is timing-dependent.
})
```

- [ ] **Step 2: Run — expect FAIL (or mixed)**

Run: `pnpm -C packages/playwright test failure-handling`
Expected: `plugin handler throwing…` FAIL — first handler's throw kills the dispatch loop; `good.length === 0`. `plugin install throwing…` FAIL — `attach()` rejects before `works` runs. Third test may pass already.

- [ ] **Step 3: Implement plugin-handler wrapper**

In `packages/playwright/src/attach.ts`, modify `makePluginContext`. Replace the `on` line in `cdpSession`:

```ts
cdpSession: {
  send: (method: string, params?: Record<string, unknown>) => cdp.send(method as Parameters<typeof cdp.send>[0], params as Parameters<typeof cdp.send>[1]),
  on: (event: string, handler: (params: unknown) => void) => {
    cdp.on(event as Parameters<typeof cdp.on>[0], (async (params: unknown) => {
      try {
        await handler(params)
      } catch (cause) {
        const err = new PluginError(plugin.name, `handler for ${event} threw`, cause)
        debug(err.message, cause)
        void bus.emit('introspect:warning', {
          error: {
            name: err.name,
            message: err.message,
            source: 'plugin',
            pluginName: plugin.name,
            cause,
            stack: err.stack,
          },
        })
      }
    }) as Parameters<typeof cdp.on>[1])
  },
},
```

Add the import at top of `attach.ts`:
```ts
import { createDebug, PluginError, CdpError } from '@introspection/utils'
```

- [ ] **Step 4: Implement install-loop try/catch**

Replace the existing plugin-install block:

```ts
for (const plugin of plugins) {
  debug('installing plugin', plugin.name)
  try {
    if (plugin.script) {
      await page.addInitScript({ content: plugin.script })
      await page.evaluate((script: string) => { new Function(script)() }, plugin.script)
    }
    await plugin.install(makePluginContext(plugin))
  } catch (cause) {
    const err = new PluginError(plugin.name, `install failed: ${cause instanceof Error ? cause.message : String(cause)}`, cause)
    debug(err.message, cause)
    void bus.emit('introspect:warning', {
      error: {
        name: err.name,
        message: err.message,
        source: 'plugin',
        pluginName: plugin.name,
        cause,
        stack: err.stack,
      },
    })
  }
}
```

**Note:** The plugin-init script change removes the `.catch(() => {})` (previously line 111). Failures in `page.addInitScript` / `page.evaluate` now flow through the same catch and emit on `introspect:warning`.

**Why not touch `meta.json`?** Install failure is a runtime event, not metadata. `meta.plugins` lists what was attempted. Which plugins actually failed is answered by the trace — `introspect events --type introspect.warning` with `metadata.source === 'plugin'` and `metadata.pluginName === '<plugin-name>'` identifies every install failure, and also (via distinct subsequent `introspect.warning` events) every handler failure after install. Single source of truth; no mutable session metadata.

- [ ] **Step 5: Update the install-failure integration test**

In `packages/playwright/test/failure-handling.spec.ts`, adjust the `plugin install throwing…` test to assert against the trace instead of meta. Open the session's `events.ndjson` after detach, filter for `introspect.warning` events with `metadata.source === 'plugin'` and `metadata.pluginName === 'explodes'`, and require at least one. Keep the assertion that `works` installed (the `other` array).

- [ ] **Step 6: Run — expect PASS (first + second tests)**

Run: `pnpm -C packages/playwright test failure-handling`
Expected: PASS for plugin-handler isolation test and plugin-install failure test. (The install-failure assertion requires a `plugin-introspection({ includeFailures: true })` in the test — add it now, or wait for Task 12 and then revisit; either is fine, whichever the implementer prefers.)

- [ ] **Step 7: Commit**

```bash
git add packages/playwright/src/attach.ts packages/playwright/test/failure-handling.spec.ts
git commit -m "feat(playwright): wrap plugin handlers + install loop in catch boundaries"
```

---

## Task 9: Recoverable CDP catches emit on `introspect:warning`

**Files:**
- Modify: `packages/playwright/src/attach.ts`
- Modify: `packages/playwright/src/snapshot.ts`

- [ ] **Step 1: Replace `.catch(() => {})` sites in `attach.ts` with `CdpError` + emit**

Four sites in `packages/playwright/src/attach.ts`:

- Line 82 (unwatch inside `addSubscription.unwatch`):
```ts
await cdp.send('Runtime.evaluate', { expression: unwatchExpression }).catch((cause) => {
  const err = new CdpError('Runtime.evaluate', `unwatch failed: ${String(cause)}`, cause)
  debug(err.message)
  void bus.emit('introspect:warning', { error: structured(err) })
})
```

- Lines 163, 176, 179 — replace each `.catch(() => {})` with the same structured pattern.

Extract a helper at the top of `attach.ts` for brevity:
```ts
function structured(err: CdpError | PluginError) {
  return {
    name: err.name,
    message: err.message,
    source: err.source,
    method: err instanceof CdpError ? err.method : undefined,
    pluginName: err instanceof PluginError ? err.pluginName : undefined,
    cause: err.cause,
    stack: err.stack,
  }
}
```

Use:
```ts
try { await cdp.send('Runtime.evaluate', { expression: '0' }) }
catch (cause) {
  const err = new CdpError('Runtime.evaluate', `flush roundtrip failed: ${String(cause)}`, cause)
  debug(err.message)
  void bus.emit('introspect:warning', { error: structured(err) })
}
```

Apply the same pattern to the three remaining `.catch(() => {})` / `catch { /* non-fatal */ }` sites, plus the `for (const [, subscription] of registry.all())` detach-unwatch loop and the `try { await cdp.detach() } catch { /* non-fatal */ }` site.

- [ ] **Step 2: Replace silent catches in the `page.on('load', …)` subscription-replay**

Replace:
```ts
} catch { /* non-fatal */ }
```
with:
```ts
} catch (cause) {
  const err = new CdpError('Runtime.evaluate', `subscription-replay for ${subscription.pluginName} failed: ${String(cause)}`, cause)
  debug(err.message)
  void bus.emit('introspect:warning', { error: structured(err) })
}
```

- [ ] **Step 3: Replace silent catches in `snapshot.ts`**

`snapshot.ts` has no `bus` / `debug` in scope. Add them via `TakeSnapshotOptions`:
```ts
interface TakeSnapshotOptions {
  cdpSession: CdpSession
  trigger: Snapshot['trigger']
  url: string
  callFrames?: CallFrame[]
  onWarning?: (message: string, cause: unknown) => void
}
```

Replace each `} catch { /* non-fatal */ }` with:
```ts
} catch (cause) {
  options.onWarning?.('snapshot: DOM read failed', cause)
}
```
(and similar for the two other sites — annotate each so the `debug` line tells which path failed).

In the attach-side caller of `takeSnapshot`, pass `onWarning`:
```ts
onWarning: (msg, cause) => {
  const err = new CdpError('snapshot', msg, cause)
  debug(err.message)
  void bus.emit('introspect:warning', { error: structured(err) })
},
```

- [ ] **Step 4: Run existing playwright tests**

Run: `pnpm -C packages/playwright test`
Expected: PASS — no regressions. The third test in `failure-handling.spec.ts` (navigation warning) should pass but is timing-dependent.

- [ ] **Step 5: Commit**

```bash
git add packages/playwright/src/attach.ts packages/playwright/src/snapshot.ts
git commit -m "feat(playwright): recoverable CDP catches emit CdpError on introspect:warning"
```

---

## Task 10: Framework `debug` subscribes to bus

**Files:**
- Modify: `packages/playwright/src/attach.ts`
- Modify: `packages/write/src/session.ts`

- [ ] **Step 1: Wire framework `debug` to bus in `attach.ts`**

After the `session` is created and `bus` is destructured, add:
```ts
const unsubscribeDebug = debug.subscribe((message, args) => {
  void bus.emit('introspect:debug', {
    label: 'introspect',
    message,
    args,
    timestamp: timestamp(),
  })
})
bus.on('detach', () => unsubscribeDebug())
```

- [ ] **Step 2: Wire framework `debug` to bus in `session.ts`**

At top of `packages/write/src/session.ts`, add `const debug = createDebug('session-writer', /* always off by default */ false)` (already off unless explicitly enabled via env). After `const bus = createBus()` and after `timestamp` is defined, add:
```ts
const unsubscribeDebug = debug.subscribe((message, args) => {
  void bus.emit('introspect:debug', {
    label: 'session-writer',
    message,
    args,
    timestamp: timestamp(),
  })
})
bus.on('detach', () => unsubscribeDebug())
```

- [ ] **Step 3: Typecheck + run existing tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/playwright/src/attach.ts packages/write/src/session.ts
git commit -m "feat(playwright,write): subscribe framework debug to session bus"
```

---

## Task 11: Plugin migration — wire `debug.subscribe` inside `install`

**Files:**
- Modify: all 10 plugin `src/index.ts`:
  - `plugins/plugin-cdp/src/index.ts`
  - `plugins/plugin-console/src/index.ts`
  - `plugins/plugin-debugger/src/index.ts`
  - `plugins/plugin-js-error/src/index.ts`
  - `plugins/plugin-network/src/index.ts`
  - `plugins/plugin-performance/src/index.ts`
  - `plugins/plugin-react-scan/src/index.ts`
  - `plugins/plugin-redux/src/index.ts`
  - `plugins/plugin-solid-devtools/src/index.ts`
  - `plugins/plugin-webgl/src/index.ts`

- [ ] **Step 1: Migrate plugin-console as the template**

In `plugins/plugin-console/src/index.ts`, inside `install(ctx)`, **at the top** of the function body (before any other statements):

```ts
const unsubscribeDebug = debug.subscribe((message, args) => {
  void ctx.bus.emit('introspect:debug', {
    label: 'plugin-console',
    message,
    args,
    timestamp: ctx.timestamp(),
  })
})
ctx.bus.on('detach', () => unsubscribeDebug())
```

**Why unsubscribe?** `createDebug` is called at factory scope, so the `debug` closure (and its subscribers Set) outlive any single `install`. If the same plugin factory instance is ever re-installed (or leaks across tests in the same Node process), old subscribers would accumulate and fire against stale bus references. Unsubscribing on the session's `detach` bus event keeps the subscriber set bounded to the active session.

- [ ] **Step 2: Run plugin-console tests**

Run: `pnpm -C plugins/plugin-console test`
Expected: PASS.

- [ ] **Step 3: Commit plugin-console template**

```bash
git add plugins/plugin-console/src/index.ts
git commit -m "refactor(plugin-console): wire debug.subscribe to bus"
```

- [ ] **Step 4: Apply the same patch to the remaining 9 plugins**

For each plugin in the list, locate the `install(ctx)` function and prepend:
```ts
const unsubscribeDebug = debug.subscribe((message, args) => {
  void ctx.bus.emit('introspect:debug', {
    label: '<plugin-name>',   // literal — match the folder name
    message,
    args,
    timestamp: ctx.timestamp(),
  })
})
ctx.bus.on('detach', () => unsubscribeDebug())
```

Variant: some plugins currently destructure `ctx` in the install signature (`install({ cdpSession, emit, … })`). Switch those to `install(ctx)` and use `ctx.bus` / `ctx.timestamp()` — the destructure stays for the rest of the body.

- [ ] **Step 5: Run all plugin tests**

Run: `pnpm test`
Expected: PASS across all plugin packages.

- [ ] **Step 6: Commit remaining plugins**

```bash
git add plugins/plugin-*/src/index.ts
git commit -m "refactor(plugins): wire debug.subscribe to bus across all plugins"
```

---

## Task 12: Create `@introspection/plugin-introspection`

**Files:**
- Create: `plugins/plugin-introspection/package.json`
- Create: `plugins/plugin-introspection/tsconfig.json`
- Create: `plugins/plugin-introspection/src/index.ts`
- Create: `plugins/plugin-introspection/README.md`
- Create: `plugins/plugin-introspection/playwright.config.ts`
- Create: `plugins/plugin-introspection/test/introspection.spec.ts`
- Create: `plugins/plugin-introspection/test/fixtures/index.html`

- [ ] **Step 1: Scaffold package.json**

Create `plugins/plugin-introspection/package.json`:
```json
{
  "name": "@introspection/plugin-introspection",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@introspection/types": "workspace:*",
    "@introspection/utils": "workspace:*"
  },
  "devDependencies": {
    "@introspection/playwright": "workspace:*",
    "@playwright/test": "^1.40.0",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Scaffold tsconfig.json**

Copy `plugins/plugin-console/tsconfig.json` structure into `plugins/plugin-introspection/tsconfig.json`.

- [ ] **Step 3: Implement the plugin**

Create `plugins/plugin-introspection/src/index.ts`:
```ts
import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'

export interface IntrospectionOptions {
  verbose?: boolean
  includeFailures?: boolean
  includeDebug?: boolean
}

export function introspection(options?: IntrospectionOptions): IntrospectionPlugin {
  const includeFailures = options?.includeFailures ?? false
  const includeDebug = options?.includeDebug ?? false
  const debug = createDebug('plugin-introspection', options?.verbose ?? false)

  return {
    name: 'plugin-introspection',
    description: 'Surfaces introspect framework warnings and debug logs as trace events',
    events: {
      'introspect.warning': 'Framework caught a recoverable failure (CDP, write, plugin)',
      'introspect.debug': 'Framework or plugin debug log (verbose-independent)',
    },
    options: {
      includeFailures: { description: 'Emit introspect.warning events', value: includeFailures },
      includeDebug: { description: 'Emit introspect.debug events', value: includeDebug },
    },

    async install(ctx: PluginContext): Promise<void> {
      const unsubscribeDebug = debug.subscribe((message, args) => {
        void ctx.bus.emit('introspect:debug', {
          label: 'plugin-introspection',
          message,
          args,
          timestamp: ctx.timestamp(),
        })
      })
      ctx.bus.on('detach', () => unsubscribeDebug())

      if (!includeFailures && !includeDebug) {
        debug('no-op: neither includeFailures nor includeDebug set')
        return
      }

      if (includeFailures) {
        ctx.bus.on('introspect:warning', ({ error }) => {
          void ctx.emit({
            type: 'introspect.warning',
            metadata: {
              source: error.source,
              pluginName: error.pluginName,
              method: error.method,
              message: error.message,
              stack: error.stack,
              cause: error.cause instanceof Error
                ? { name: error.cause.name, message: error.cause.message }
                : undefined,
            },
          })
        })
      }

      if (includeDebug) {
        ctx.bus.on('introspect:debug', ({ label, message, args }) => {
          void ctx.emit({
            type: 'introspect.debug',
            metadata: { label, message, args },
          })
        })
      }
    },
  }
}
```

- [ ] **Step 4: Write README**

Create `plugins/plugin-introspection/README.md`:
```markdown
# @introspection/plugin-introspection

Opt-in plugin that surfaces framework warnings and debug logs as trace events.

## Events

| Event | Description |
|---|---|
| `introspect.warning` | Framework caught a recoverable failure (CDP, write, plugin). |
| `introspect.debug` | Framework or plugin debug log (independent of `verbose`). |

## Usage

\`\`\`typescript
import { attach, defaults } from '@introspection/playwright'
import { introspection } from '@introspection/plugin-introspection'

const handle = await attach(page, {
  plugins: [...defaults(), introspection({ includeFailures: true, includeDebug: true })],
})
\`\`\`

## Options

- `includeFailures` (default `false`) — emit `introspect.warning` events for every recoverable failure caught at a framework boundary.
- `includeDebug` (default `false`) — emit `introspect.debug` events for every `debug(...)` call made by the framework or any plugin.
- `verbose` (default `false`) — stderr noise for this plugin.

Both flags default off: without this plugin the trace stays lean.

## How it works

The framework emits on internal `introspect:warning` / `introspect:debug` bus channels at three catch boundaries (plugin-handler dispatch, recoverable CDP calls, bus-dispatch rejections). This plugin subscribes and re-emits as trace events. Consumers filter at query time:

\`\`\`
introspect events --type introspect.warning
introspect events --type 'introspect.*'
\`\`\`
```

- [ ] **Step 5: Add playwright config + fixture**

Create `plugins/plugin-introspection/playwright.config.ts` (copy from plugin-console).
Create `plugins/plugin-introspection/test/fixtures/index.html` with minimal `<html><body>ok</body></html>`.

- [ ] **Step 6: Write failing integration test**

Create `plugins/plugin-introspection/test/introspection.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import { attach } from '@introspection/playwright'
import { introspection } from '../src/index.js'
import type { IntrospectionPlugin } from '@introspection/types'
import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'

async function readNdjson(outDir: string): Promise<unknown[]> {
  const sessions = await readdir(outDir)
  const session = sessions.find(s => !s.startsWith('.'))!
  const raw = await readFile(join(outDir, session, 'events.ndjson'), 'utf-8')
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('includeFailures emits introspect.warning for CDP failures', async ({ page }) => {
  const outDir = await mkdtemp(join(tmpdir(), 'introspect-test-'))
  const exploding: IntrospectionPlugin = {
    name: 'exploding-cdp',
    async install(ctx) {
      ctx.cdpSession.on('Runtime.consoleAPICalled', () => { throw new Error('plugin boom') })
    },
  }
  const handle = await attach(page, {
    plugins: [exploding, introspection({ includeFailures: true })],
    outDir,
  })
  await page.goto('data:text/html,<script>console.log("x")</script>')
  await page.waitForTimeout(200)
  await handle.detach()

  const events = await readNdjson(outDir)
  const warnings = events.filter((e): e is { type: string } => (e as { type?: string }).type === 'introspect.warning')
  expect(warnings.length).toBeGreaterThan(0)
})

test('includeDebug emits introspect.debug for plugin debug calls', async ({ page }) => {
  const outDir = await mkdtemp(join(tmpdir(), 'introspect-test-'))
  const debugger_: IntrospectionPlugin = {
    name: 'debug-emitter',
    async install(ctx) {
      // Use ctx.bus directly (a plugin's own debug.subscribe is wired in Task 11)
      void ctx.bus.emit('introspect:debug', {
        label: 'debug-emitter',
        message: 'hello',
        args: [1, 2],
        timestamp: ctx.timestamp(),
      })
    },
  }
  const handle = await attach(page, {
    plugins: [introspection({ includeDebug: true }), debugger_],
    outDir,
  })
  await page.goto('data:text/html,<body>ok</body>')
  await handle.detach()

  const events = await readNdjson(outDir)
  const debugs = events.filter((e): e is { type: string; metadata: { message: string } } =>
    (e as { type?: string }).type === 'introspect.debug' && (e as { metadata?: { message?: string } }).metadata?.message === 'hello'
  )
  expect(debugs.length).toBe(1)
})

test('both flags false is a no-op', async ({ page }) => {
  const outDir = await mkdtemp(join(tmpdir(), 'introspect-test-'))
  const handle = await attach(page, {
    plugins: [introspection()],
    outDir,
  })
  await page.goto('data:text/html,<body>ok</body>')
  await handle.detach()

  const events = await readNdjson(outDir)
  const emittedByUs = events.filter((e): e is { type: string } => {
    const t = (e as { type?: string }).type
    return t === 'introspect.warning' || t === 'introspect.debug'
  })
  expect(emittedByUs.length).toBe(0)
})
```

- [ ] **Step 7: Install deps, run tests — expect PASS**

Run: `pnpm install && pnpm -C plugins/plugin-introspection test`
Expected: PASS — 3 tests green.

- [ ] **Step 8: Commit**

```bash
git add plugins/plugin-introspection/
git commit -m "feat(plugin-introspection): new plugin surfacing internal warnings and debug logs"
```

---

## Task 13: Verification — end-to-end dogfood

**Files:** none modified (the demo-test patch in Step 2 is reverted before the task completes).

- [ ] **Step 1: Full workspace build + typecheck + test**

Run:
```bash
pnpm build
pnpm typecheck
pnpm test
```
Expected: all green.

- [ ] **Step 2: Dogfood with the react-session-list demo**

Add a one-off patch to `demos/react-session-list/test/demo.spec.ts` that attaches with:
```ts
plugins: [...defaults(), introspection({ includeFailures: true, includeDebug: true })],
```

Run:
```bash
pnpm -C demos/react-session-list test
pnpm exec introspect events --dir demos/react-session-list/.introspect --type 'introspect.*'
```
Expected: at least one `introspect.debug` event is visible for framework / plugin debug lines; `introspect.warning` events appear only if a recoverable failure happened during the run.

Revert the demo test patch after verification (do not commit).

- [ ] **Step 3: Reflect**

Invoke the `introspect-reflect` skill. Capture any friction (missing CLI flags, formatter gaps, skill line to add) surfaced by this run. Add reflection file to `docs/analysis/`.

- [ ] **Step 4: Final commit (reflection only, if any)**

```bash
git add docs/analysis/
git commit -m "docs(analysis): reflect on failure-handling verification run"
```

---

## Spec coverage check

| Spec section | Covered by task |
|---|---|
| Typed error classes | Task 1 |
| Subscribable `createDebug` | Task 2 |
| Plugin-side debug wiring | Task 11 |
| Framework-side debug wiring | Task 10 |
| Boundary 1 — plugin-handler wrapper | Task 8 |
| Boundary 2 — recoverable CDP catches | Task 9 |
| Boundary 3 — bus dispatch reports rejections | Task 4 |
| Plugin-install loop emits warning | Task 8 |
| Internal bus channels | Task 3 |
| New trace event types | Task 3 |
| `plugin-introspection` package | Task 12 |
| `summariseBody` throw | Task 5 |
| NDJSON per-line tolerance | Task 6 |
| Write-queue unswallowed | Task 7 |
| Channel naming convention | Task 3, 4 |
| Testing | Tasks 1, 2, 4, 5, 6, 7, 8, 12 |
| Verification plan | Task 13 |

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-04-13-robust-failure-handling.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

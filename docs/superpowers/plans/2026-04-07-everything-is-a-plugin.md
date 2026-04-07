# Everything is a Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor @introspection/playwright so network capture and JS error capture are first-class plugins, attach() becomes a thin host, and all behaviour is declared via a required `plugins` array.

**Architecture:** Extract network() and jsErrors() plugin factories from attach.ts. Add cdpSession.on() and a typed bus (BusPayloadMap) to PluginContext. Drop capture() from IntrospectionPlugin. Migrate webgl() from capture() to bus. Make plugins required everywhere.

**Tech Stack:** TypeScript, Playwright CDP, pnpm workspaces, vitest

---

## File Map

Files created or modified by this plan, with their responsibilities:

| Status | Path | Responsibility |
|---|---|---|
| Modify | `packages/types/src/index.ts` | Add `BusPayloadMap`, `BusTrigger`; update `PluginContext`, `IntrospectionPlugin`, `AttachOptions` |
| Create | `packages/playwright/src/bus.ts` | `createBus()` — typed async event bus |
| Create | `packages/playwright/src/plugins/network.ts` | `network()` plugin factory |
| Create | `packages/playwright/src/plugins/js-errors.ts` | `jsErrors()` plugin factory; augments `BusPayloadMap` with `'js.error'` |
| Create | `packages/playwright/src/plugins/defaults.ts` | `defaults()` convenience factory |
| Modify | `packages/playwright/src/attach.ts` | Thin host: remove hardcoded CDP listeners, wire bus, require plugins |
| Modify | `packages/playwright/src/fixture.ts` | Require `plugins` in `IntrospectFixtureOptions`; remove implicit attach defaults |
| Modify | `packages/plugin-webgl/src/index.ts` | Replace `capture()` with `ctx.bus.on()` handlers; remove `CaptureResult` |
| Modify | `packages/playwright/package.json` | Add new entry points for plugins index |
| Modify | `packages/playwright/README.md` | Update usage examples and exports table |
| Modify | `packages/playwright/test/attach.spec.ts` | Update call sites to pass `plugins`; replace `capture()` tests with bus tests |
| Modify | `packages/playwright/test/fixture.spec.ts` | Pass `plugins: defaults()` to `introspectFixture()` |
| Modify | `demos/silent-form-error/test.spec.ts` | Add `plugins: defaults()` |
| Modify | `demos/missing-scores/test.spec.ts` | Add `plugins: defaults()` |
| Modify | `demos/webgl-animation/test.spec.ts` | Add `defaults()` alongside `webgl()` |
| Modify | `demos/black-canvas/test.spec.ts` | Add `defaults()` alongside `webgl()` |

---

### Task 1: Update types in @introspection/types

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Update `packages/types/src/index.ts`**

  Make these changes to the plugin system section (lines 90–130):

  ```ts
  // ─── Bus ──────────────────────────────────────────────────────────────────────

  /**
   * Augmentable map of bus trigger names to their payload shapes.
   * Core declares 'manual' and 'detach'. Plugins augment this interface
   * from their own packages using declaration merging.
   */
  export interface BusPayloadMap {
    'manual': { trigger: 'manual'; timestamp: number }
    'detach': { trigger: 'detach'; timestamp: number }
  }

  export type BusTrigger = keyof BusPayloadMap

  // ─── Plugin system ────────────────────────────────────────────────────────────

  /** Minimal page abstraction. Playwright's Page satisfies this structurally. */
  export interface PluginPage {
    evaluate<T>(fn: () => T): Promise<T>
    evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>
  }

  export interface CaptureResult {
    kind: string
    content: string | Buffer
    ext?: string
    summary: Record<string, unknown>
  }

  export interface WatchHandle {
    unwatch(): Promise<void>
  }

  export interface PluginContext {
    page: PluginPage
    cdpSession: {
      send(method: string, params?: Record<string, unknown>): Promise<unknown>
      /** Subscribe to a raw CDP event. Call inside install(). */
      on(event: string, handler: (params: unknown) => void): void
    }
    emit(event: Omit<TraceEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }): void
    writeAsset(opts: {
      kind: string
      content: string | Buffer
      ext?: string
      metadata: { timestamp: number; [key: string]: unknown }
      source?: EventSource
    }): Promise<string>
    timestamp(): number
    /** Installs a browser-side watch and registers it for navigation recovery. */
    addSubscription(pluginName: string, spec: unknown): Promise<WatchHandle>
    /** Typed async event bus scoped to this session. */
    bus: {
      on<T extends BusTrigger>(
        trigger: T,
        handler: (payload: BusPayloadMap[T]) => void | Promise<void>
      ): void
      emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]): Promise<void>
    }
  }

  export interface IntrospectionPlugin {
    name: string
    /** Browser-side IIFE script. Optional — not all plugins have browser-side code. */
    script?: string
    install(ctx: PluginContext): Promise<void>
    // capture() removed — use ctx.bus.on(trigger, handler) inside install()
  }
  ```

  Keep `CaptureResult` in place (it is still used by `webgl()` until Task 8).

  Remove `capture?()` from `IntrospectionPlugin` entirely.

  Remove `pauseOnExceptions` from `AttachOptions` — that interface lives in `attach.ts` and is changed in Task 6, not here.

- [ ] **Step 2: Run type-check to verify types compile**

  ```bash
  pnpm --filter @introspection/types exec tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add packages/types/src/index.ts
  git commit -m "feat(types): add BusPayloadMap, BusTrigger; add bus + cdpSession.on() to PluginContext; make script optional; drop capture()"
  ```

---

### Task 2: Create `createBus()` in @introspection/playwright

**Files:**
- Create: `packages/playwright/src/bus.ts`

The bus is a lightweight async dispatcher. `bus.on()` registers a handler. `bus.emit()` calls every registered handler for that trigger concurrently using `Promise.allSettled`, so a failing handler never blocks other handlers or the caller.

- [ ] **Step 1: Write the failing test**

  The test validates three behaviours: handlers are called, async handlers are awaited before emit resolves, and an error in one handler does not prevent other handlers from being called.

  Create `packages/playwright/test/bus.spec.ts`:

  ```ts
  import { test, expect } from '@playwright/test'
  import { createBus } from '../src/bus.js'

  // Augment BusPayloadMap so the bus types work in this test file
  declare module '@introspection/types' {
    interface BusPayloadMap {
      'test.ping': { trigger: 'test.ping'; value: number }
    }
  }

  test('bus calls registered handlers with the emitted payload', async () => {
    const bus = createBus()
    const received: number[] = []
    bus.on('test.ping', (payload) => { received.push(payload.value) })
    await bus.emit('test.ping', { trigger: 'test.ping', value: 42 })
    expect(received).toEqual([42])
  })

  test('bus awaits async handlers before emit resolves', async () => {
    const bus = createBus()
    const order: string[] = []
    bus.on('test.ping', async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      order.push('handler done')
    })
    await bus.emit('test.ping', { trigger: 'test.ping', value: 1 })
    order.push('after emit')
    expect(order).toEqual(['handler done', 'after emit'])
  })

  test('a throwing handler does not prevent other handlers from running', async () => {
    const bus = createBus()
    const called: string[] = []
    bus.on('test.ping', () => { throw new Error('boom') })
    bus.on('test.ping', () => { called.push('second') })
    await bus.emit('test.ping', { trigger: 'test.ping', value: 1 })
    expect(called).toEqual(['second'])
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  pnpm --filter @introspection/playwright exec playwright test test/bus.spec.ts
  ```

  Expected: FAIL — `Cannot find module '../src/bus.js'`

- [ ] **Step 3: Implement `createBus()`**

  Create `packages/playwright/src/bus.ts`:

  ```ts
  import type { BusPayloadMap, BusTrigger } from '@introspection/types'

  type BusHandler<T extends BusTrigger> = (payload: BusPayloadMap[T]) => void | Promise<void>

  export interface Bus {
    on<T extends BusTrigger>(trigger: T, handler: BusHandler<T>): void
    emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]): Promise<void>
  }

  export function createBus(): Bus {
    const handlers = new Map<string, Array<(payload: unknown) => void | Promise<void>>>()

    return {
      on<T extends BusTrigger>(trigger: T, handler: BusHandler<T>) {
        const existing = handlers.get(trigger) ?? []
        existing.push(handler as (payload: unknown) => void | Promise<void>)
        handlers.set(trigger, existing)
      },

      async emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]) {
        const registered = handlers.get(trigger) ?? []
        await Promise.allSettled(registered.map(handler => handler(payload)))
      },
    }
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  pnpm --filter @introspection/playwright exec playwright test test/bus.spec.ts
  ```

  Expected: 3 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/playwright/src/bus.ts packages/playwright/test/bus.spec.ts
  git commit -m "feat(playwright): add createBus() — typed async event bus with allSettled dispatch"
  ```

---

### Task 3: Extract `network()` plugin

**Files:**
- Create: `packages/playwright/src/plugins/network.ts`

All `Network.*` CDP logic currently in `attach.ts` (lines 203–241) moves here. The plugin uses `ctx.cdpSession.on()` to register CDP event handlers and calls `ctx.emit()` / `ctx.writeAsset()` directly — it does not use the bus.

- [ ] **Step 1: Note on test coverage**

  The existing test `'network request appends network.request event'` in `test/attach.spec.ts` covers this behaviour end-to-end. That test currently calls `attach()` with no explicit plugins; it will be updated in Task 6 when `plugins` becomes required. For now, implement the plugin — Task 6 closes the TDD loop by updating the test to use `plugins: [network()]` and verifying it still passes.

- [ ] **Step 2: Create `packages/playwright/src/plugins/network.ts`**

  ```ts
  import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
  import { writeAsset, summariseBody, normaliseCdpNetworkRequest, normaliseCdpNetworkResponse } from '@introspection/core'

  export function network(): IntrospectionPlugin {
    return {
      name: 'network',

      async install(ctx: PluginContext): Promise<void> {
        await ctx.cdpSession.send('Network.enable')

        let cdpTimeOffset = 0

        ctx.cdpSession.on('Network.requestWillBeSent', (rawParams) => {
          const parameters = rawParams as Record<string, unknown>
          const typed = parameters as { wallTime?: number; timestamp?: number }
          if (cdpTimeOffset === 0 && typeof typed.wallTime === 'number' && typeof typed.timestamp === 'number') {
            cdpTimeOffset = Math.round(typed.wallTime * 1000 - typed.timestamp * 1000)
          }
          ctx.emit(normaliseCdpNetworkRequest(parameters, 0))
          // Note: startedAt offset is baked into ctx.timestamp(); normaliseCdpNetworkRequest
          // accepts startedAt as 0 because ctx.emit() applies its own timestamp.
        })

        const pendingResponses = new Map<string, ReturnType<typeof normaliseCdpNetworkResponse>>()

        ctx.cdpSession.on('Network.responseReceived', (rawParams) => {
          const parameters = rawParams as Record<string, unknown>
          const requestId = (parameters as { requestId: string }).requestId
          pendingResponses.set(requestId, normaliseCdpNetworkResponse(parameters, 0, cdpTimeOffset))
        })

        ctx.cdpSession.on('Network.loadingFinished', (rawParams) => {
          const parameters = rawParams as { requestId: string }
          const responseEvent = pendingResponses.get(parameters.requestId)
          if (!responseEvent) return
          pendingResponses.delete(parameters.requestId)
          void (async () => {
            try {
              const result = await ctx.cdpSession.send('Network.getResponseBody', { requestId: parameters.requestId }) as { body: string; base64Encoded: boolean }
              const body = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf-8') : result.body
              const summary = summariseBody(body)
              await ctx.writeAsset({ kind: 'body', content: body, metadata: { timestamp: ctx.timestamp(), summary } })
              ctx.emit({ ...responseEvent, data: { ...responseEvent.data, bodySummary: summary } })
            } catch {
              ctx.emit(responseEvent)
            }
          })()
        })

        ctx.cdpSession.on('Network.loadingFailed', (rawParams) => {
          const parameters = rawParams as { requestId: string }
          const responseEvent = pendingResponses.get(parameters.requestId)
          if (responseEvent) {
            pendingResponses.delete(parameters.requestId)
            ctx.emit(responseEvent)
          }
        })
      },
    }
  }
  ```

  **Note on `normaliseCdpNetworkRequest` / `normaliseCdpNetworkResponse` and `startedAt`:** These core helpers subtract `startedAt` to compute a relative timestamp. Since `ctx.emit()` already applies a relative `timestamp()`, we need to check whether the helpers require `startedAt` to be passed in. Read the core package implementation before finalising this code — if the helpers embed `startedAt` in the event timestamp rather than a relative offset, the plugin must capture `startedAt` from attach.ts. The cleanest fix is to thread `startedAt` into `PluginContext` or to have the helpers accept 0 and let `ctx.emit()` override. Resolve this during implementation; adjust accordingly.

- [ ] **Step 3: Run type-check**

  ```bash
  pnpm --filter @introspection/playwright exec tsc --noEmit
  ```

  Expected: no errors (may need to fix `normaliseCdpNetworkRequest` usage — see note above).

- [ ] **Step 4: Commit**

  ```bash
  git add packages/playwright/src/plugins/network.ts
  git commit -m "feat(playwright): extract network() plugin from attach.ts"
  ```

---

### Task 4: Extract `jsErrors()` plugin

**Files:**
- Create: `packages/playwright/src/plugins/js-errors.ts`

All `Debugger.paused` logic from `attach.ts` (lines 122–199) moves here. The plugin augments `BusPayloadMap` with `'js.error'` using declaration merging and emits `bus.emit('js.error', ...)` after collecting scope locals and writing the snapshot.

- [ ] **Step 1: Note on test coverage**

  The existing `'Runtime.exceptionThrown appends js.error event'` test in `test/attach.spec.ts` covers this end-to-end. It will be updated in Task 6 when `plugins` becomes required (changed to `plugins: [jsErrors()]`). For now, implement the plugin — Task 6 closes the TDD loop.

- [ ] **Step 2: Create `packages/playwright/src/plugins/js-errors.ts`**

  ```ts
  import type { IntrospectionPlugin, PluginContext, ScopeFrame } from '@introspection/types'
  import { normaliseCdpJsError, takeSnapshot, writeAsset } from '@introspection/core'

  // Augment BusPayloadMap so the 'js.error' trigger is typed.
  // External consumers can import this module to get the augmented type.
  declare module '@introspection/types' {
    interface BusPayloadMap {
      'js.error': { trigger: 'js.error'; timestamp: number; message: string }
    }
  }

  export interface JsErrorsOptions {
    /** Whether to pause on all exceptions or only uncaught ones. Default: 'uncaught' */
    pauseOnExceptions?: 'all' | 'uncaught'
  }

  export function jsErrors(opts?: JsErrorsOptions): IntrospectionPlugin {
    const pauseState = opts?.pauseOnExceptions ?? 'uncaught'

    return {
      name: 'js-errors',

      async install(ctx: PluginContext): Promise<void> {
        await ctx.cdpSession.send('Debugger.enable')
        await ctx.cdpSession.send('Debugger.setPauseOnExceptions', { state: pauseState })

        ctx.cdpSession.on('Debugger.paused', (rawParams) => {
          const parameters = rawParams as {
            reason: string
            data?: Record<string, unknown>
            callFrames?: Array<{
              functionName: string
              url: string
              location: { lineNumber: number; columnNumber?: number }
              scopeChain: Array<{ type: string; object: { objectId?: string } }>
            }>
          }

          if (!['exception', 'promiseRejection'].includes(parameters.reason)) {
            void ctx.cdpSession.send('Debugger.resume').catch(() => {})
            return
          }

          void (async () => {
            // Collect scope locals while the debugger is still paused
            const scopes: ScopeFrame[] = []
            for (const frame of (parameters.callFrames ?? []).slice(0, 5)) {
              const locals: Record<string, unknown> = {}
              for (const scope of frame.scopeChain.slice(0, 3)) {
                if (!scope.object.objectId) continue
                try {
                  const { result } = await ctx.cdpSession.send('Runtime.getProperties', {
                    objectId: scope.object.objectId, ownProperties: true,
                  }) as { result: Array<{ name: string; value?: { type?: string; value?: unknown; description?: string; objectId?: string } }> }
                  for (const prop of result.slice(0, 20)) {
                    const propValue = prop.value
                    if (!propValue) { locals[prop.name] = undefined; continue }
                    locals[prop.name] = propValue.value ?? propValue.description ?? undefined
                  }
                } catch { /* non-fatal */ }
              }
              scopes.push({
                frame: `${frame.functionName || '(anonymous)'} (${frame.url}:${frame.location.lineNumber + 1})`,
                locals,
              })
            }

            // Resume before any page.evaluate / CDP evaluate calls
            await ctx.cdpSession.send('Debugger.resume').catch(() => {})

            // Build a synthetic exceptionDetails object compatible with normaliseCdpJsError
            const syntheticParams = {
              timestamp: Date.now() / 1000,
              exceptionDetails: {
                text: '',
                exception: parameters.data ?? {},
                stackTrace: {
                  callFrames: (parameters.callFrames ?? []).map(frame => ({
                    functionName: frame.functionName,
                    url: frame.url,
                    lineNumber: frame.location.lineNumber,
                    columnNumber: frame.location.columnNumber ?? 0,
                  })),
                },
              },
            }

            const errorEvent = normaliseCdpJsError(syntheticParams as Record<string, unknown>, 0)
            ctx.emit(errorEvent)

            const url = await ctx.cdpSession.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })
              .then((r) => ((r as { result: { value?: string } }).result.value ?? ''))
              .catch(() => '')

            const snapshot = await takeSnapshot({
              cdpSession: { send: (method, params) => ctx.cdpSession.send(method, params) },
              trigger: 'js.error',
              url,
              callFrames: [],
            })
            const mergedSnapshot = { ...snapshot, scopes }

            await ctx.writeAsset({
              kind: 'snapshot',
              content: JSON.stringify(mergedSnapshot),
              metadata: {
                timestamp: ctx.timestamp(),
                trigger: 'js.error',
                url: mergedSnapshot.url,
                scopeCount: mergedSnapshot.scopes.length,
              },
            })

            await ctx.bus.emit('js.error', {
              trigger: 'js.error',
              timestamp: ctx.timestamp(),
              message: errorEvent.data.message,
            })
          })()
        })
      },
    }
  }
  ```

  **Note on `normaliseCdpJsError` and `startedAt`:** Same concern as in Task 3. Resolve by reading the core helper and adjusting if needed.

- [ ] **Step 3: Run type-check**

  ```bash
  pnpm --filter @introspection/playwright exec tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/playwright/src/plugins/js-errors.ts
  git commit -m "feat(playwright): extract jsErrors() plugin; augment BusPayloadMap with 'js.error'"
  ```

---

### Task 5: Create `defaults()` factory

**Files:**
- Create: `packages/playwright/src/plugins/defaults.ts`

`defaults()` is pure composition — it delegates to `network()` and `jsErrors()`.

- [ ] **Step 1: Create `packages/playwright/src/plugins/defaults.ts`**

  ```ts
  import type { IntrospectionPlugin } from '@introspection/types'
  import { network } from './network.js'
  import { jsErrors } from './js-errors.js'
  import type { JsErrorsOptions } from './js-errors.js'

  export interface DefaultsOptions {
    jsErrors?: JsErrorsOptions
  }

  export function defaults(opts?: DefaultsOptions): IntrospectionPlugin[] {
    return [network(), jsErrors(opts?.jsErrors)]
  }
  ```

- [ ] **Step 2: Run type-check**

  ```bash
  pnpm --filter @introspection/playwright exec tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add packages/playwright/src/plugins/defaults.ts
  git commit -m "feat(playwright): add defaults() factory — composes network() and jsErrors()"
  ```

---

### Task 6: Refactor `attach.ts`

**Files:**
- Modify: `packages/playwright/src/attach.ts`

This is the central change. `attach.ts` loses all `Network.*` and `Debugger.*` CDP wiring. It gains `createBus()`, threads the bus into each `PluginContext`, and uses the bus to dispatch `'manual'` and `'detach'` triggers. `plugins` becomes required; the `pending` set is removed; `pauseOnExceptions` is removed.

- [ ] **Step 1: Update `packages/playwright/src/attach.ts`**

  Replace the file with this implementation:

  ```ts
  import { randomUUID } from 'crypto'
  import type { Page } from '@playwright/test'
  import type { TraceEvent, IntrospectHandle, DetachResult, IntrospectionPlugin, PluginContext } from '@introspection/types'
  import {
    initSessionDir, appendEvent, writeAsset, finalizeSession, takeSnapshot,
  } from '@introspection/core'
  import { createPageProxy } from './proxy.js'
  import { PluginRegistry } from './plugin-registry.js'
  import { createDebug } from './debug.js'
  import { createBus } from './bus.js'

  export interface AttachOptions {
    outDir?: string
    testTitle?: string
    workerIndex?: number
    plugins: IntrospectionPlugin[]   // required — use defaults() for standard behaviour
    verbose?: boolean
  }

  export async function attach(page: Page, opts: AttachOptions): Promise<IntrospectHandle> {
    const sessionId = randomUUID()
    const outDir = opts.outDir ?? '.introspect'
    const testTitle = opts.testTitle ?? 'unknown test'
    const startedAt = Date.now()
    const debug = createDebug('introspect', opts.verbose ?? false)

    debug('attach', { sessionId, testTitle, outDir })
    await initSessionDir(outDir, { id: sessionId, startedAt, label: testTitle })

    const cdp = await page.context().newCDPSession(page)
    const cdpSend = cdp.send.bind(cdp) as (method: string, params?: Record<string, unknown>) => Promise<unknown>

    function timestamp(): number { return Date.now() - startedAt }

    function emit(event: Omit<TraceEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) {
      void appendEvent(outDir, sessionId, { id: randomUUID(), timestamp: timestamp(), ...event } as TraceEvent)
    }

    const bus = createBus()
    const registry = new PluginRegistry()

    function makePluginContext(plugin: IntrospectionPlugin): PluginContext {
      return {
        page,
        cdpSession: {
          send: (method, params) => cdpSend(method, params),
          on: (event, handler) => cdp.on(event as Parameters<typeof cdp.on>[0], handler as Parameters<typeof cdp.on>[1]),
        },
        emit,
        async writeAsset(wopts) {
          return writeAsset({
            directory: outDir, name: sessionId,
            kind: wopts.kind, content: wopts.content, ext: wopts.ext,
            metadata: wopts.metadata, source: wopts.source ?? 'plugin',
          })
        },
        timestamp,
        async addSubscription(pluginName: string, spec: unknown) {
          const expression = `(() => { const p = window.__introspect_plugins__?.['${pluginName}']; return p ? p.watch(${JSON.stringify(spec)}) : null })()`
          const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }) as { result: { value: string } }
          const browserId = result.result.value
          const nodeId = registry.add(pluginName, spec, browserId)
          return {
            async unwatch() {
              const subscription = registry.remove(nodeId)
              if (!subscription) return
              const unwatchExpression = `(() => { window.__introspect_plugins__?.['${subscription.pluginName}']?.unwatch(${JSON.stringify(subscription.browserId)}) })()`
              await cdp.send('Runtime.evaluate', { expression: unwatchExpression }).catch(() => {})
            },
          }
        },
        bus,
      }
    }

    await cdp.send('Runtime.enable')
    await cdp.send('DOM.enable')
    await cdp.send('Page.enable')

    // Push bridge — browser calls window.__introspect_push__(JSON.stringify({type, data}))
    if (opts.plugins.length > 0) {
      await cdp.send('Runtime.addBinding', { name: '__introspect_push__' })
      cdp.on('Runtime.bindingCalled', (params: { name: string; payload: string }) => {
        if (params.name !== '__introspect_push__') return
        try {
          const { type, data } = JSON.parse(params.payload) as { type: string; data: Record<string, unknown> }
          emit({ type, source: 'plugin', data } as unknown as Parameters<typeof emit>[0])
        } catch { /* malformed push — ignore */ }
      })
    }

    // Inject scripts (future navigations) + evaluate immediately (current page)
    for (const plugin of opts.plugins) {
      debug('installing plugin', plugin.name)
      if (plugin.script) {
        await page.addInitScript({ content: plugin.script })
        await page.evaluate((script: string) => { new Function(script)() }, plugin.script).catch(() => {})
      }
      await plugin.install(makePluginContext(plugin))
    }

    // Re-apply subscriptions after each navigation
    page.on('load', () => {
      void (async () => {
        for (const [nodeId, subscription] of registry.all()) {
          try {
            const expression = `(() => { const p = window.__introspect_plugins__?.['${subscription.pluginName}']; return p ? p.watch(${JSON.stringify(subscription.spec)}) : null })()`
            const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }) as { result: { value: string } }
            registry.updateBrowserId(nodeId, result.result.value)
          } catch { /* non-fatal */ }
        }
      })()
    })

    const proxiedPage = createPageProxy(page, (event) => emit(event))

    return {
      page: proxiedPage,
      mark(label: string, data?: Record<string, unknown>) {
        emit({ type: 'mark', source: 'agent', data: { label, extra: data } })
      },
      async snapshot() {
        const snap = await takeSnapshot({
          cdpSession: { send: cdpSend },
          trigger: 'manual',
          url: await page.evaluate(() => location.href).catch(() => ''),
        })
        await writeAsset({
          directory: outDir, name: sessionId, kind: 'snapshot',
          content: JSON.stringify(snap),
          metadata: { timestamp: timestamp(), trigger: 'manual', url: snap.url, scopeCount: snap.scopes.length },
        })
        await bus.emit('manual', { trigger: 'manual', timestamp: timestamp() })
      },
      async detach(result?: DetachResult) {
        debug('detach', result?.status)
        if (result) emit({ type: 'playwright.result', source: 'playwright', data: result })

        // Emit 'detach' — bus.emit() awaits all handlers (replaces the pending Set drain)
        await bus.emit('detach', { trigger: 'detach', timestamp: timestamp() })

        // Bulk unwatch
        for (const [, subscription] of registry.all()) {
          const expression = `(() => { window.__introspect_plugins__?.['${subscription.pluginName}']?.unwatch(${JSON.stringify(subscription.browserId)}) })()`
          await cdp.send('Runtime.evaluate', { expression }).catch(() => {})
        }

        await finalizeSession(outDir, sessionId, Date.now())
        try { await cdp.detach() } catch { /* non-fatal */ }
      },
    }
  }
  ```

- [ ] **Step 2: Update `packages/playwright/test/attach.spec.ts` to pass `plugins`**

  Every `attach(page, { ... })` call that previously omitted `plugins` must now pass `plugins: []` or `plugins: defaults()` depending on what the test verifies:

  - Tests that verify `network.request` or `network.response` events need `plugins: defaults()` (or `plugins: [network()]`).
  - Tests that verify `js.error` events need `plugins: defaults()` (or `plugins: [jsErrors()]`).
  - Tests that verify `mark`, `playwright.result`, subscriptions, push bridge, or asset writing need `plugins: []` (or any plugin, since those behaviours are in attach.ts itself).
  - The old test `'detach() triggers plugin.capture("detach") and writes resulting assets'` tests the removed `capture()` method. Replace it with a bus-based equivalent.

  **Specific changes:**

  a. Add imports at the top:
  ```ts
  import { defaults } from '../src/plugins/defaults.js'
  import { network } from '../src/plugins/network.js'
  import { jsErrors } from '../src/plugins/js-errors.js'
  ```

  b. `'creates session directory...'` — change to `plugins: []`:
  ```ts
  const handle = await attach(page, { outDir: dir, testTitle: 'my test', plugins: [] })
  ```

  c. `'mark() appends a mark event'` — change to `plugins: []`:
  ```ts
  const handle = await attach(page, { outDir: dir, plugins: [] })
  ```

  d. `'detach() writes playwright.result event'` — change to `plugins: []`:
  ```ts
  const handle = await attach(page, { outDir: dir, plugins: [] })
  ```

  e. `'network request appends network.request event'` — change to `plugins: [network()]`:
  ```ts
  const handle = await attach(page, { outDir: dir, plugins: [network()] })
  ```

  f. `'Runtime.exceptionThrown appends js.error event'` — change to `plugins: [jsErrors()]`:
  ```ts
  const handle = await attach(page, { outDir: dir, plugins: [jsErrors()] })
  ```

  g. `'network response body is captured as an asset'` — change to `plugins: [network()]`:
  ```ts
  const handle = await attach(page, { outDir: dir, plugins: [network()] })
  ```

  h. `'malformed plugin push is silently discarded'` — keep `plugins: [plugin]` (already passes a plugin).

  i. `'plugin subscriptions survive navigation'` — keep `plugins: [plugin]` (already passes a plugin).

  j. `'does not create a .socket file inside session directory'` — change to `plugins: []`:
  ```ts
  const handle = await attach(page, { outDir: dir, plugins: [] })
  ```

  k. `'push event from browser appears in events.ndjson'` — keep `plugins: [plugin]`.

  l. `'ctx.writeAsset produces an asset event'` — keep `plugins: [plugin]`.

  m. Replace `'detach() triggers plugin.capture("detach") and writes resulting assets'` with a bus-based test:
  ```ts
  test('bus "detach" handler is called and can write assets', async ({ page }) => {
    let detachCalled = false
    const plugin: IntrospectionPlugin = {
      name: 'test',
      async install(ctx) {
        ctx.bus.on('detach', async () => {
          detachCalled = true
          await ctx.writeAsset({
            kind: 'webgl-state',
            content: '{"detached":true}',
            metadata: { timestamp: ctx.timestamp() },
          })
        })
      },
    }
    await attach(page, { outDir: dir, plugins: [plugin] }).then(handle => handle.detach())

    expect(detachCalled).toBe(true)
    const events = await readEvents(dir)
    const asset = events.find((event: { type: string; data?: { kind: string } }) =>
      event.type === 'asset' && event.data?.kind === 'webgl-state')
    expect(asset).toBeDefined()
    expect(asset.source).toBe('plugin')
  })
  ```

- [ ] **Step 3: Run all playwright tests to verify everything passes**

  ```bash
  pnpm --filter @introspection/playwright exec playwright test
  ```

  Expected: all tests pass.

- [ ] **Step 4: Run type-check**

  ```bash
  pnpm --filter @introspection/playwright exec tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/playwright/src/attach.ts packages/playwright/test/attach.spec.ts
  git commit -m "feat(playwright): refactor attach() to thin host — bus replaces pending set, plugins required, remove hardcoded CDP wiring"
  ```

---

### Task 7: Update `fixture.ts`

**Files:**
- Modify: `packages/playwright/src/fixture.ts`
- Modify: `packages/playwright/test/fixture.spec.ts`

`plugins` is now required on `AttachOptions`, so `IntrospectFixtureOptions` must expose it and `introspectFixture()` must pass it through. The bare `export const { test, expect }` at the bottom of the file was a shortcut that called `introspectFixture()` with no arguments — it can no longer work without `plugins`. Remove it.

- [ ] **Step 1: Update `packages/playwright/src/fixture.ts`**

  ```ts
  import { test as base, expect } from '@playwright/test'
  import type { IntrospectionPlugin } from '@introspection/types'
  import { attach } from './attach.js'
  import type { IntrospectHandle } from '@introspection/types'

  export interface IntrospectFixtureOptions {
    plugins: IntrospectionPlugin[]   // required
    viteUrl?: string
    outDir?: string
  }

  export function introspectFixture(opts: IntrospectFixtureOptions) {
    const test = base.extend<{ introspect: IntrospectHandle }>({
      introspect: [async ({ page }, use, testInfo) => {
        const handle = await attach(page, {
          testTitle: testInfo.title,
          workerIndex: testInfo.workerIndex,
          plugins: opts.plugins,
          ...(opts.outDir ? { outDir: opts.outDir } : {}),
        })
        await use(handle)
        const knownStatuses = ['passed', 'failed', 'timedOut', 'skipped'] as const
        const status = (knownStatuses as readonly string[]).includes(testInfo.status ?? '')
          ? testInfo.status as typeof knownStatuses[number]
          : 'failed' as const
        if (status !== 'passed' && status !== 'skipped') await handle.snapshot()
        await handle.detach({ status, duration: testInfo.duration, error: testInfo.error?.message })
      }, { auto: true }],
    })
    return { test, expect }
  }
  ```

  Note: the `export const { test, expect }` lines at the bottom of the original file are removed — they called `introspectFixture()` with no arguments which would now be a type error. Callers must construct their own fixture.

- [ ] **Step 2: Update `packages/playwright/test/fixture.spec.ts`**

  Pass `plugins: defaults()`:

  ```ts
  import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
  import { join } from 'path'
  import { tmpdir } from 'os'
  import { introspectFixture } from '../src/fixture.js'
  import { defaults } from '../src/plugins/defaults.js'

  const outDir = mkdtempSync(join(tmpdir(), 'introspect-fixture-'))
  const { test, expect } = introspectFixture({ outDir, plugins: defaults() })

  test('fixture auto-attaches and records mark events', async ({ introspect }) => {
    introspect.mark('step 1', { extra: true })
  })

  test.afterAll(() => {
    const entries = readdirSync(outDir).filter(e => !e.startsWith('.'))
    expect(entries.length).toBeGreaterThan(0)
    const sessionDir = join(outDir, entries[0])
    const meta = JSON.parse(readFileSync(join(sessionDir, 'meta.json'), 'utf-8'))
    expect(meta.endedAt).toBeDefined()

    const ndjson = readFileSync(join(sessionDir, 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))

    const mark = events.find((event: { type: string }) => event.type === 'mark')
    expect(mark).toBeDefined()
    expect(mark.data.label).toBe('step 1')

    const result = events.find((event: { type: string }) => event.type === 'playwright.result')
    expect(result).toBeDefined()
    expect(result.data.status).toBe('passed')

    rmSync(outDir, { recursive: true, force: true })
  })
  ```

- [ ] **Step 3: Run fixture tests**

  ```bash
  pnpm --filter @introspection/playwright exec playwright test test/fixture.spec.ts
  ```

  Expected: 1 test passes.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/playwright/src/fixture.ts packages/playwright/test/fixture.spec.ts
  git commit -m "feat(playwright): make plugins required in introspectFixture(); remove bare export shortcut"
  ```

---

### Task 8: Migrate `webgl()` plugin from `capture()` to bus

**Files:**
- Modify: `packages/plugin-webgl/src/index.ts`

The `webgl()` plugin currently implements `capture()`. This task replaces it with `ctx.bus.on()` registrations inside `install()`. The `captureCanvas()` public method remains but reuses the extracted canvas capture logic. `CaptureResult` is removed from this file.

The plugin listens to:
- `'js.error'`: capture WebGL state + canvases (same as old `capture('js.error', ...)`)
- `'manual'`: capture WebGL state + canvases (same as old `capture('manual', ...)`)
- `'detach'`: capture WebGL state + canvases (same as old `capture('detach', ...)`)

All three triggers run the same logic, so extract a helper.

- [ ] **Step 1: Update `packages/plugin-webgl/src/index.ts`**

  ```ts
  import BROWSER_SCRIPT from '../dist/browser.iife.js'
  import type { IntrospectionPlugin, PluginContext, WatchHandle } from '@introspection/types'
  // Note: import BusPayloadMap augmentation from js-errors so 'js.error' is typed
  import '@introspection/playwright/plugins/js-errors'

  declare global {
    interface Window {
      __introspect_plugins__?: Record<string, unknown>
    }
  }

  export type NameFilter = string | RegExp

  function serialiseName(name: NameFilter | undefined): string | { source: string; flags: string } | undefined {
    if (name === undefined) return undefined
    if (typeof name === 'string') return name
    return { source: name.source, flags: name.flags }
  }

  export interface UniformWatchOpts {
    event: 'uniform'
    contextId?: string
    name?: NameFilter
    valueChanged?: boolean
  }

  export interface DrawWatchOpts {
    event: 'draw'
    contextId?: string
    primitive?: 'TRIANGLES' | 'LINES' | 'POINTS' | 'LINE_STRIP' | 'LINE_LOOP' | 'TRIANGLE_STRIP' | 'TRIANGLE_FAN'
  }

  export interface TextureBindWatchOpts {
    event: 'texture-bind'
    contextId?: string
    unit?: number
  }

  export type WebGLWatchOpts = UniformWatchOpts | DrawWatchOpts | TextureBindWatchOpts

  export interface WebGLStateSnapshot {
    contextId: string
    uniforms: Record<string, { value: unknown; glType: string }>
    textures: Array<{ unit: number; target: string; textureId: number | null }>
    viewport: [number, number, number, number]
    blendState: { enabled: boolean; srcRgb: number; dstRgb: number; srcAlpha: number; dstAlpha: number; equation: number }
    depthState: { testEnabled: boolean; func: number; writeMask: boolean }
  }

  export interface WebGLPlugin extends IntrospectionPlugin {
    watch(opts: WebGLWatchOpts): Promise<WatchHandle>
    captureCanvas(opts?: { contextId?: string }): Promise<void>
  }

  export function webgl(): WebGLPlugin {
    let pluginCtx: PluginContext | null = null

    async function captureState(ctx: PluginContext): Promise<void> {
      const timestamp = ctx.timestamp()

      const snapshots = await ctx.page.evaluate(() => {
        return (window.__introspect_plugins__ as { webgl?: { getState?(): unknown[] } } | undefined)
          ?.webgl?.getState?.() ?? []
      }) as WebGLStateSnapshot[]

      const canvases = await ctx.page.evaluate(async () => {
        const plugin = (window.__introspect_plugins__ as {
          webgl?: { captureCanvases?(): Promise<Array<{ contextId: string; dataUrl: string }>> }
        } | undefined)?.webgl
        return plugin?.captureCanvases?.() ?? []
      })

      for (const snapshot of snapshots) {
        await ctx.writeAsset({
          kind: 'webgl-state',
          content: JSON.stringify(snapshot),
          metadata: {
            timestamp,
            contextId: snapshot.contextId,
            uniformCount: Object.keys(snapshot.uniforms).length,
            boundTextureCount: snapshot.textures.length,
            viewport: snapshot.viewport,
          },
        })
      }

      for (const { contextId, dataUrl } of canvases) {
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
        await ctx.writeAsset({
          kind: 'webgl-canvas',
          content: Buffer.from(base64, 'base64'),
          ext: 'png',
          metadata: { timestamp, contextId },
        })
      }
    }

    return {
      name: 'webgl',
      script: BROWSER_SCRIPT,

      async install(ctx: PluginContext): Promise<void> {
        pluginCtx = ctx

        ctx.bus.on('manual', async () => { await captureState(ctx) })
        ctx.bus.on('js.error', async () => { await captureState(ctx) })
        ctx.bus.on('detach', async () => { await captureState(ctx) })
      },

      async watch(opts: WebGLWatchOpts): Promise<WatchHandle> {
        if (!pluginCtx) throw new Error('webgl plugin: watch() called before install()')
        let spec: Record<string, unknown>
        if (opts.event === 'uniform') {
          spec = {
            event: 'uniform',
            ...(opts.contextId !== undefined && { contextId: opts.contextId }),
            ...(opts.name !== undefined && { name: serialiseName(opts.name) }),
            ...(opts.valueChanged !== undefined && { valueChanged: opts.valueChanged }),
          }
        } else if (opts.event === 'draw') {
          spec = {
            event: 'draw',
            ...(opts.contextId !== undefined && { contextId: opts.contextId }),
            ...(opts.primitive !== undefined && { primitive: opts.primitive }),
          }
        } else {
          spec = {
            event: 'texture-bind',
            ...(opts.contextId !== undefined && { contextId: opts.contextId }),
            ...((opts as TextureBindWatchOpts).unit !== undefined && { unit: (opts as TextureBindWatchOpts).unit }),
          }
        }
        return pluginCtx.addSubscription('webgl', spec)
      },

      async captureCanvas(opts?: { contextId?: string }): Promise<void> {
        if (!pluginCtx) throw new Error('webgl plugin: captureCanvas() called before install()')
        const timestamp = pluginCtx.timestamp()
        const canvases = await pluginCtx.page.evaluate(async () => {
          const plugin = (window.__introspect_plugins__ as {
            webgl?: { captureCanvases?(): Promise<Array<{ contextId: string; dataUrl: string }>> }
          } | undefined)?.webgl
          return plugin?.captureCanvases?.() ?? []
        })
        for (const { contextId, dataUrl } of canvases) {
          if (opts?.contextId !== undefined && contextId !== opts.contextId) continue
          const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
          await pluginCtx.writeAsset({
            kind: 'webgl-canvas',
            content: Buffer.from(base64, 'base64'),
            ext: 'png',
            metadata: { timestamp, contextId },
          })
        }
      },
    }
  }
  ```

  **Note on importing the js-errors augmentation:** The `'js.error'` BusPayloadMap augmentation is declared inside `js-errors.ts`. For the `webgl` package to use `bus.on('js.error', ...)` with correct types, it needs to import that augmentation via a side-effect import. This requires a `"./plugins/js-errors"` export entry in `packages/playwright/package.json` — add it now (before the type-check in Step 3):

  ```json
  // In packages/playwright/package.json, add to "exports":
  "./plugins/js-errors": {
    "types": "./src/plugins/js-errors.ts",
    "import": "./dist/plugins/js-errors.js"
  }
  ```

  The full `package.json` exports will be consolidated in Task 10. For now, just add this one entry so the `import '@introspection/playwright/plugins/js-errors'` side-effect import in `plugin-webgl/src/index.ts` resolves.

- [ ] **Step 2: Update demos that use webgl() to also pass `defaults()` for network and jsErrors**

  `demos/webgl-animation/test.spec.ts` and `demos/black-canvas/test.spec.ts` currently pass `plugins: [plugin]`. They should now also include `defaults()`:

  ```ts
  import { attach, defaults } from '@introspection/playwright'
  // ...
  const handle = await attach(page, {
    outDir: join(__dirname, '.introspect'),
    testTitle: 'webgl-animation',
    plugins: [...defaults(), plugin],
  })
  ```

- [ ] **Step 3: Run type-check on plugin-webgl**

  ```bash
  pnpm --filter @introspection/plugin-webgl exec tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/plugin-webgl/src/index.ts demos/webgl-animation/test.spec.ts demos/black-canvas/test.spec.ts
  git commit -m "feat(plugin-webgl): migrate capture() to ctx.bus.on() handlers; remove CaptureResult dependency"
  ```

---

### Task 9: Update all remaining call sites (demos + types cleanup)

**Files:**
- Modify: `demos/silent-form-error/test.spec.ts`
- Modify: `demos/missing-scores/test.spec.ts`
- Modify: `packages/types/src/index.ts` (remove `CaptureResult`)

- [ ] **Step 1: Update `demos/silent-form-error/test.spec.ts`**

  ```ts
  import { attach, defaults } from '@introspection/playwright'
  // ...
  const handle = await attach(page, {
    outDir: join(__dirname, '.introspect'),
    testTitle: 'silent-form-error',
    plugins: defaults(),
  })
  ```

- [ ] **Step 2: Update `demos/missing-scores/test.spec.ts`**

  ```ts
  import { attach, defaults } from '@introspection/playwright'
  // ...
  const handle = await attach(page, {
    outDir: join(__dirname, '.introspect'),
    testTitle: 'missing-scores',
    plugins: defaults(),
  })
  ```

- [ ] **Step 3: Remove `CaptureResult` from `packages/types/src/index.ts`**

  Delete the `CaptureResult` interface (it was the return type of the now-removed `capture()` method and is no longer used anywhere):

  ```ts
  // Delete this block:
  export interface CaptureResult {
    kind: string
    content: string | Buffer
    ext?: string
    summary: Record<string, unknown>
  }
  ```

- [ ] **Step 4: Verify nothing imports `CaptureResult`**

  Run from the repository root:

  ```bash
  grep -r 'CaptureResult' packages/ demos/
  ```

  Expected: no matches. If any remain, remove them.

- [ ] **Step 5: Run type-check across all packages**

  ```bash
  pnpm --filter '@introspection/*' exec tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add demos/silent-form-error/test.spec.ts demos/missing-scores/test.spec.ts packages/types/src/index.ts
  git commit -m "feat: update all call sites to pass required plugins; remove CaptureResult from @introspection/types"
  ```

---

### Task 10: Update exports and README

**Files:**
- Modify: `packages/playwright/package.json`
- Modify: `packages/playwright/src/attach.ts` (re-export from index, or add a new index file)
- Modify: `packages/playwright/README.md`

The new factories `network`, `jsErrors`, `defaults`, and types `BusPayloadMap`, `BusTrigger` must be exported from `@introspection/playwright`.

- [ ] **Step 1: Check whether `@introspection/playwright` has a single entry point or split entries**

  Currently `package.json` exports `"."` pointing at `src/attach.ts` and `"./fixture"` pointing at `src/fixture.ts`. There is no `src/index.ts`.

  Create `packages/playwright/src/index.ts` as the main entry point that re-exports everything:

  ```ts
  export { attach } from './attach.js'
  export type { AttachOptions } from './attach.js'
  export { network } from './plugins/network.js'
  export { jsErrors } from './plugins/js-errors.js'
  export type { JsErrorsOptions } from './plugins/js-errors.js'
  export { defaults } from './plugins/defaults.js'
  export type { DefaultsOptions } from './plugins/defaults.js'
  export type { BusPayloadMap, BusTrigger } from '@introspection/types'
  ```

- [ ] **Step 2: Update `packages/playwright/package.json`**

  Change `"."` to point at the new index, and add a `"./plugins/js-errors"` entry for augmentation imports from external plugins:

  ```json
  {
    "exports": {
      ".": {
        "types": "./src/index.ts",
        "import": "./dist/index.js"
      },
      "./fixture": {
        "types": "./src/fixture.ts",
        "import": "./dist/fixture.js"
      },
      "./plugins/js-errors": {
        "types": "./src/plugins/js-errors.ts",
        "import": "./dist/plugins/js-errors.js"
      }
    },
    "scripts": {
      "build": "tsup src/index.ts src/fixture.ts src/plugins/js-errors.ts --format esm --dts",
      "test": "playwright test"
    }
  }
  ```

- [ ] **Step 3: Update `packages/playwright/README.md`**

  Replace the current README with updated content that reflects the new API:

  - Update the Usage section to show `plugins: defaults()`
  - Update the `attach()` Options table (remove `pauseOnExceptions`, make `plugins` required)
  - Add a "Plugins" section documenting `network()`, `jsErrors()`, `defaults()`
  - Update the `handle.snapshot()` and `handle.detach()` descriptions to remove references to `plugin.capture()`
  - Update the Exports section

  Key sections to update:

  ```md
  ## Usage

  ```ts
  import { attach, defaults } from '@introspection/playwright'

  const handle = await attach(page, {
    testTitle: 'my test',
    plugins: defaults(),    // network capture + JS error capture
  })

  await handle.page.goto('/')
  handle.mark('step', { extra: 'data' })
  await handle.snapshot()           // capture DOM + scope manually
  await handle.detach()             // finalize session
  ```

  ## Built-in plugins

  ### `network()`

  Captures all network requests and responses as `network.request` / `network.response` / `network.error` events. Response bodies are written as sidecar assets.

  ### `jsErrors(opts?)`

  Captures uncaught JS exceptions and unhandled promise rejections. On each error, pauses the debugger to collect scope locals, writes a DOM snapshot, and emits a `js.error` event.

  ```ts
  jsErrors({ pauseOnExceptions: 'all' })   // catch caught exceptions too (default: 'uncaught')
  ```

  ### `defaults(opts?)`

  Returns `[network(), jsErrors(opts?.jsErrors)]`. Drop-in for standard behaviour:

  ```ts
  attach(page, { plugins: defaults() })
  attach(page, { plugins: defaults({ jsErrors: { pauseOnExceptions: 'all' } }) })
  ```

  ## Exports

  ```ts
  import { attach, network, jsErrors, defaults } from '@introspection/playwright'
  import type { AttachOptions, JsErrorsOptions, DefaultsOptions, BusPayloadMap, BusTrigger } from '@introspection/playwright'
  import { introspectFixture } from '@introspection/playwright/fixture'
  ```
  ```

- [ ] **Step 4: Run full test suite**

  ```bash
  pnpm --filter @introspection/playwright exec playwright test
  ```

  Expected: all tests pass.

- [ ] **Step 5: Run type-check across all packages one final time**

  ```bash
  pnpm --filter '@introspection/*' exec tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/playwright/src/index.ts packages/playwright/package.json packages/playwright/README.md
  git commit -m "feat(playwright): add index.ts; export network, jsErrors, defaults, BusPayloadMap, BusTrigger; update README"
  ```

---

## Known Constraints and Gotchas

### `normaliseCdpNetworkRequest` / `normaliseCdpNetworkResponse` and `startedAt`

These helpers in `@introspection/core` take a `startedAt` timestamp to compute relative event timestamps. In `attach.ts` they are called with the session's `startedAt`. When they move to the `network()` plugin, the plugin's `PluginContext` provides `ctx.timestamp()` which already computes relative time. Before finalising the `network()` plugin code, read the core helper implementations to determine:

1. Whether `startedAt` is embedded in the emitted event's `timestamp` field, or if the helpers return a raw ms value that `emit()` overrides.
2. Adjust accordingly — either thread `startedAt` as a `PluginContext` field (simplest), or pass `0` and let the helpers return a timestamp that `ctx.emit()` overrides.

### `cdp.on()` event name typing

The Playwright CDP session's `on()` method is typed with literal string overloads for known CDP events. Passing it to `ctx.cdpSession.on(event: string, handler)` will require a cast at the wiring point in `attach.ts`. The cast is scoped to the one line in `makePluginContext` where `cdp.on` is called with a string from the plugin, so it is narrow and intentional.

### `BusPayloadMap` augmentation in `js-errors.ts`

The `declare module '@introspection/types'` augmentation in `js-errors.ts` is only active when that module is imported. The `webgl()` plugin needs `'js.error'` to be typed on the bus, so it must import (or side-effect import) `js-errors.ts`. The `"./plugins/js-errors"` export entry added in Task 10 supports this.

### `CaptureResult` removal timing

`CaptureResult` is kept in `@introspection/types` until Task 9 because `webgl()` still uses it until Task 8. Do not remove it from types until Task 9 to avoid build failures mid-refactor.

### Bare fixture export removed

The `export const { test, expect }` convenience at the bottom of `fixture.ts` (which called `introspectFixture()` with no arguments) is removed because `plugins` is now required. Any package that imported these bare exports must be updated to construct its own fixture. Check for any such imports with:

```bash
grep -r 'from.*playwright/fixture' packages/ demos/
```

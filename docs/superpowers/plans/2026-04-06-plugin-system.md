# Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CDP-based plugin system to `@introspection/playwright` that lets plugins inject browser-side scripts, push discrete events via `Runtime.addBinding`, and pull full state on demand.

**Architecture:** `attach()` accepts a `plugins` array; for each plugin it injects the browser-side script, installs the push bridge (`Runtime.addBinding`), and calls `plugin.install(ctx)`. A `PluginRegistry` in `attach.ts` tracks active subscriptions (spec + browserId per watch) and re-applies them after each navigation. `ctx.addSubscription(name, spec)` is the internal hook that both installs a watch browser-side and registers it for navigation recovery.

**Tech Stack:** TypeScript, `@playwright/test` CDP session, `Runtime.addBinding`, `page.addInitScript`, vitest

---

## File Map

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/types/src/index.ts` | Modify | Add `'plugin'` to `EventSource`; add `PluginPage`, `PluginEvent`, `IntrospectionPlugin`, `PluginContext`, `WatchHandle`, `CaptureResult` |
| `packages/core/src/session-writer.ts` | Modify | `writeAsset` accepts optional `source?: EventSource` (default `'agent'`) |
| `packages/playwright/src/plugin-registry.ts` | Create | Node-side subscription registry; `PluginRegistry` class |
| `packages/playwright/src/attach.ts` | Modify | `plugins` option; push bridge; script injection; `install(ctx)`; `load` re-apply; capture triggers; bulk unwatch |
| `packages/cli/src/commands/events.ts` | Modify | Add `'plugin'` to `VALID_SOURCES` |

---

### Task 1: Add plugin types to `@introspection/types`

**Files:**
- Modify: `packages/types/src/index.ts`
- Test: `packages/types/test/index.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/types/test/index.test.ts`:

```ts
import { describe, it, expectTypeOf } from 'vitest'
import type {
  EventSource, TraceEvent, PluginEvent,
  IntrospectionPlugin, PluginContext, PluginPage, WatchHandle, CaptureResult,
} from '../src/index.js'

describe('plugin types', () => {
  it('EventSource includes plugin', () => {
    const s: EventSource = 'plugin'
    expectTypeOf(s).toMatchTypeOf<EventSource>()
  })

  it('PluginEvent is in TraceEvent union', () => {
    const e: TraceEvent = {
      id: 'x', ts: 0, source: 'plugin', type: 'webgl.uniform',
      data: { contextId: 'ctx_0', name: 'u_time', value: 1.0, glType: 'float' },
    }
    expectTypeOf(e).toMatchTypeOf<TraceEvent>()
  })

  it('IntrospectionPlugin has required shape', () => {
    expectTypeOf<IntrospectionPlugin>().toHaveProperty('name')
    expectTypeOf<IntrospectionPlugin>().toHaveProperty('script')
    expectTypeOf<IntrospectionPlugin>().toHaveProperty('install')
  })

  it('PluginPage has evaluate()', () => {
    expectTypeOf<PluginPage>().toHaveProperty('evaluate')
  })

  it('WatchHandle has unwatch()', () => {
    expectTypeOf<WatchHandle>().toHaveProperty('unwatch')
  })

  it('CaptureResult has kind, content, summary', () => {
    expectTypeOf<CaptureResult>().toHaveProperty('kind')
    expectTypeOf<CaptureResult>().toHaveProperty('content')
    expectTypeOf<CaptureResult>().toHaveProperty('summary')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```
cd packages/types && pnpm test
```

Expected: compilation errors — `PluginEvent`, `IntrospectionPlugin`, etc. not found.

- [ ] **Step 3: Add types to `packages/types/src/index.ts`**

After the existing `EventSource` line, replace:
```ts
export type EventSource = 'cdp' | 'agent' | 'playwright'
```
With:
```ts
export type EventSource = 'cdp' | 'agent' | 'playwright' | 'plugin'
```

Add `PluginEvent` after `AssetEvent`:
```ts
export interface PluginEvent extends BaseEvent {
  source: 'plugin'
  type: string   // e.g. 'webgl.uniform', 'redux.action'
  data: Record<string, unknown>
}
```

Add `| PluginEvent` to the `TraceEvent` union.

Add plugin interfaces after the `TraceEvent` union:
```ts
// ─── Plugin system ────────────────────────────────────────────────────────────

/** Minimal page abstraction. Playwright's Page satisfies this structurally. */
export interface PluginPage {
  evaluate<T>(fn: () => T): Promise<T>
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>
}

export interface CaptureResult {
  kind: string
  content: string
  summary: Record<string, unknown>
}

export interface WatchHandle {
  unwatch(): Promise<void>
}

export interface PluginContext {
  page: PluginPage
  cdpSession: { send(method: string, params?: Record<string, unknown>): Promise<unknown> }
  emit(event: Omit<TraceEvent, 'id' | 'ts'> & { id?: string; ts?: number }): void
  writeAsset(opts: {
    kind: string
    content: string | Buffer
    ext?: string
    metadata: { timestamp: number; [key: string]: unknown }
    source?: EventSource
  }): Promise<string>
  timestamp(): number
  /** Internal: installs a browser-side watch and registers it for navigation recovery. */
  addSubscription(pluginName: string, spec: unknown): Promise<WatchHandle>
}

export interface IntrospectionPlugin {
  name: string
  script: string
  install(ctx: PluginContext): Promise<void>
  capture?(trigger: 'js.error' | 'manual' | 'detach', ts: number): Promise<CaptureResult[]>
}
```

- [ ] **Step 4: Run tests**

```
cd packages/types && pnpm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/index.ts packages/types/test/index.test.ts
git commit -m "feat(types): add plugin system types — EventSource, PluginEvent, IntrospectionPlugin, PluginContext, WatchHandle, CaptureResult"
```

---

### Task 2: Make `writeAsset` accept an optional `source` parameter

**Files:**
- Modify: `packages/core/src/session-writer.ts`
- Modify: `packages/core/test/session-writer.test.ts` (add test case)

- [ ] **Step 1: Find the existing writeAsset test**

```
cd packages/core && pnpm test
```

Confirm tests pass before any change.

- [ ] **Step 2: Add failing test**

In `packages/core/test/session-writer.test.ts`, add inside the `writeAsset` describe block (or create one):

```ts
it('writeAsset uses source: plugin when passed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'iw-'))
  await initSessionDir(dir, { id: 'sid', startedAt: 0 })
  await writeAsset({
    directory: dir, name: 'sid', kind: 'webgl-state',
    content: '{}', metadata: { timestamp: 10 }, source: 'plugin',
  })
  const ndjson = await readFile(join(dir, 'sid', 'events.ndjson'), 'utf-8')
  const events = ndjson.trim().split('\n').map(l => JSON.parse(l))
  const asset = events.find((e: { type: string }) => e.type === 'asset')
  expect(asset.source).toBe('plugin')
  await rm(dir, { recursive: true, force: true })
})
```

- [ ] **Step 3: Run to verify it fails**

```
cd packages/core && pnpm test
```

Expected: test fails — writeAsset doesn't accept source param, asset.source is 'agent'.

- [ ] **Step 4: Update `writeAsset` in `packages/core/src/session-writer.ts`**

First, add `EventSource` to the existing import at line 4:
```ts
import type { TraceEvent, SessionMeta, BodySummary, EventSource } from '@introspection/types'
```

Then add `source?: EventSource` to the `writeAsset` opts type (the existing `opts` object, not a new signature):
```ts
export async function writeAsset(opts: {
  directory: string
  name: string
  kind: string
  content: string | Buffer
  ext?: string
  metadata: { timestamp: number; [key: string]: unknown }
  source?: EventSource   // ← add this line
}): Promise<string>
```

Inside the function, change `source: 'agent' as const` to `source: (opts.source ?? 'agent') as EventSource`.

- [ ] **Step 5: Run tests**

```
cd packages/core && pnpm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session-writer.ts packages/core/test/session-writer.test.ts
git commit -m "feat(core): writeAsset accepts optional source param, defaults to agent"
```

---

### Task 3: Create the plugin registry

**Files:**
- Create: `packages/playwright/src/plugin-registry.ts`
- Create: `packages/playwright/test/plugin-registry.test.ts`

The registry stores `{ plugin, spec, browserId }` per subscription. `attach.ts` creates one registry per session, passes it into the `PluginContext`, and uses it to re-apply subscriptions on navigation.

- [ ] **Step 1: Write the failing test**

Create `packages/playwright/test/plugin-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PluginRegistry } from '../src/plugin-registry.js'

describe('PluginRegistry', () => {
  it('add() stores subscription and returns node-side id', () => {
    const registry = new PluginRegistry()
    const id = registry.add('webgl', { event: 'uniform' }, 'browser-id-1')
    expect(id).toBeDefined()
    expect(registry.get(id)).toMatchObject({ pluginName: 'webgl', spec: { event: 'uniform' }, browserId: 'browser-id-1' })
  })

  it('remove() deletes and returns the subscription', () => {
    const registry = new PluginRegistry()
    const id = registry.add('webgl', { event: 'draw' }, 'b1')
    const removed = registry.remove(id)
    expect(removed).toMatchObject({ pluginName: 'webgl', browserId: 'b1' })
    expect(registry.get(id)).toBeUndefined()
  })

  it('all() returns all entries', () => {
    const registry = new PluginRegistry()
    registry.add('webgl', { event: 'uniform' }, 'b1')
    registry.add('webgl', { event: 'draw' }, 'b2')
    expect([...registry.all()]).toHaveLength(2)
  })

  it('updateBrowserId() replaces the browserId on an existing entry', () => {
    const registry = new PluginRegistry()
    const id = registry.add('webgl', { event: 'uniform' }, 'old-id')
    registry.updateBrowserId(id, 'new-id')
    expect(registry.get(id)?.browserId).toBe('new-id')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```
cd packages/playwright && pnpm test
```

Expected: `plugin-registry.js` not found.

- [ ] **Step 3: Create `packages/playwright/src/plugin-registry.ts`**

```ts
export interface PluginSubscription {
  pluginName: string
  spec: unknown
  browserId: string
}

export class PluginRegistry {
  private entries = new Map<string, PluginSubscription>()
  private counter = 0

  add(pluginName: string, spec: unknown, browserId: string): string {
    const id = String(this.counter++)
    this.entries.set(id, { pluginName, spec, browserId })
    return id
  }

  get(id: string): PluginSubscription | undefined {
    return this.entries.get(id)
  }

  remove(id: string): PluginSubscription | undefined {
    const entry = this.entries.get(id)
    this.entries.delete(id)
    return entry
  }

  updateBrowserId(id: string, browserId: string): void {
    const entry = this.entries.get(id)
    if (entry) entry.browserId = browserId
  }

  all(): IterableIterator<[string, PluginSubscription]> {
    return this.entries.entries()
  }
}
```

- [ ] **Step 4: Run tests**

```
cd packages/playwright && pnpm test
```

Expected: plugin-registry tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/playwright/src/plugin-registry.ts packages/playwright/test/plugin-registry.test.ts
git commit -m "feat(playwright): add PluginRegistry for node-side subscription tracking"
```

---

### Task 4: Wire plugin system into `attach()`

**Files:**
- Modify: `packages/playwright/src/attach.ts`
- Modify: `packages/playwright/test/attach.test.ts`

This is the core integration: script injection, push bridge, `install(ctx)`, `load` re-apply, capture triggers, bulk unwatch.

- [ ] **Step 1: Write failing tests first**

First, update the existing `makeFakePage()` helper in `attach.test.ts` to add `page.on` and `page.addInitScript` mocks (required by the plugin integration):

```ts
// Inside makeFakePage(), add to the page object:
addInitScript: vi.fn().mockResolvedValue(undefined),
on: vi.fn(),
```

Then add the plugin helper and tests:

```ts
// Helper that builds a minimal IntrospectionPlugin for testing
function makePlugin(name = 'test-plugin') {
  const installed = vi.fn()
  const captured = vi.fn().mockResolvedValue([])
  return {
    plugin: {
      name,
      script: `window.__introspect_plugins__ = window.__introspect_plugins__ || {}; window.__introspect_plugins__['${name}'] = { watch(spec){ return 'b1' }, unwatch(id){} }`,
      install: installed,
      capture: captured,
    } as import('@introspection/types').IntrospectionPlugin,
    installed,
    captured,
  }
}

describe('attach() with plugins', () => {
  it('calls plugin.install() with a PluginContext after attach', async () => {
    const { page, cdp } = makeFakePage()
    // Runtime.evaluate returns browser-side watch ID
    cdp.send.mockImplementation((method: string) => {
      if (method === 'Runtime.evaluate') return Promise.resolve({ result: { value: 'b1' } })
      return Promise.resolve({})
    })
    const { plugin, installed } = makePlugin()
    await attach(page, { outDir: dir, plugins: [plugin] })
    expect(installed).toHaveBeenCalledOnce()
    const ctx = installed.mock.calls[0][0]
    expect(ctx).toHaveProperty('emit')
    expect(ctx).toHaveProperty('writeAsset')
    expect(ctx).toHaveProperty('timestamp')
    expect(ctx).toHaveProperty('addSubscription')
  })

  it('installs Runtime.addBinding for __introspect_push__', async () => {
    const { page, cdp } = makeFakePage()
    const { plugin } = makePlugin()
    await attach(page, { outDir: dir, plugins: [plugin] })
    expect(cdp.send).toHaveBeenCalledWith('Runtime.addBinding', { name: '__introspect_push__' })
  })

  it('Runtime.bindingCalled with __introspect_push__ emits a PluginEvent', async () => {
    const { page, cdp, trigger } = makeFakePage()
    const { plugin } = makePlugin()
    const handle = await attach(page, { outDir: dir, plugins: [plugin] })
    trigger('Runtime.bindingCalled', {
      name: '__introspect_push__',
      payload: JSON.stringify({ type: 'webgl.uniform', data: { contextId: 'ctx_0', name: 'u_time', value: 1.0, glType: 'float' } }),
    })
    await new Promise(r => setTimeout(r, 10))
    await handle.detach()
    const entries = await readdir(dir)
    const ndjson = await readFile(join(dir, entries[0], 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').map(l => JSON.parse(l))
    const pluginEvent = events.find((e: { type: string }) => e.type === 'webgl.uniform')
    expect(pluginEvent).toBeDefined()
    expect(pluginEvent.source).toBe('plugin')
    expect(pluginEvent.data.name).toBe('u_time')
  })

  it('ignores Runtime.bindingCalled for other bindings', async () => {
    const { page, cdp, trigger } = makeFakePage()
    const { plugin } = makePlugin()
    const handle = await attach(page, { outDir: dir, plugins: [plugin] })
    // Should not throw
    trigger('Runtime.bindingCalled', { name: 'someOtherBinding', payload: '{}' })
    await new Promise(r => setTimeout(r, 10))
    await handle.detach()
  })

  it('detach() calls plugin.capture("detach", ts)', async () => {
    const { page, cdp } = makeFakePage()
    const { plugin, captured } = makePlugin()
    const handle = await attach(page, { outDir: dir, plugins: [plugin] })
    await handle.detach()
    expect(captured).toHaveBeenCalledWith('detach', expect.any(Number))
  })

  it('snapshot() calls plugin.capture("manual", ts)', async () => {
    const { page, cdp } = makeFakePage()
    cdp.send.mockImplementation((method: string) => {
      if (method === 'DOM.getDocument') return Promise.resolve({ root: { nodeId: 1 } })
      if (method === 'DOM.getOuterHTML') return Promise.resolve({ outerHTML: '<html/>' })
      return Promise.resolve({})
    })
    const { plugin, captured } = makePlugin()
    const handle = await attach(page, { outDir: dir, plugins: [plugin] })
    await handle.snapshot()
    expect(captured).toHaveBeenCalledWith('manual', expect.any(Number))
    await handle.detach()
  })

  it('ctx.writeAsset writes an asset event with source: plugin', async () => {
    const { page, cdp } = makeFakePage()
    let capturedCtx: import('@introspection/types').PluginContext
    const plugin: import('@introspection/types').IntrospectionPlugin = {
      name: 'test', script: '',
      async install(ctx) { capturedCtx = ctx },
    }
    await attach(page, { outDir: dir, plugins: [plugin] })
    await capturedCtx!.writeAsset({ kind: 'webgl-state', content: '{"ok":true}', metadata: { timestamp: 5 } })
    const entries = await readdir(dir)
    const ndjson = await readFile(join(dir, entries[0], 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').map(l => JSON.parse(l))
    const asset = events.find((e: { type: string }) => e.type === 'asset')
    expect(asset).toBeDefined()
    expect(asset.source).toBe('plugin')
    expect(asset.data.kind).toBe('webgl-state')
  })

  it('ctx.addSubscription installs watch browser-side and returns WatchHandle', async () => {
    const { page, cdp } = makeFakePage()
    cdp.send.mockImplementation((method: string) => {
      if (method === 'Runtime.evaluate') return Promise.resolve({ result: { value: 'b42' } })
      return Promise.resolve({})
    })
    let capturedCtx: import('@introspection/types').PluginContext
    const plugin: import('@introspection/types').IntrospectionPlugin = {
      name: 'test', script: '',
      async install(ctx) { capturedCtx = ctx },
    }
    await attach(page, { outDir: dir, plugins: [plugin] })
    const wh = await capturedCtx!.addSubscription('test', { event: 'uniform' })
    expect(wh).toHaveProperty('unwatch')
    expect(typeof wh.unwatch).toBe('function')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```
cd packages/playwright && pnpm test
```

Expected: all new tests fail — `plugins` option not implemented.

- [ ] **Step 3: Update `packages/playwright/src/attach.ts`**

Add imports at top:
```ts
import type { IntrospectionPlugin, PluginContext, CaptureResult } from '@introspection/types'
import { PluginRegistry } from './plugin-registry.js'
import { writeAsset as coreWriteAsset } from '@introspection/core'
```

Update `AttachOptions`:
```ts
export interface AttachOptions {
  outDir?: string
  testTitle?: string
  workerIndex?: number
  plugins?: IntrospectionPlugin[]
}
```

Inside `attach()`, after `const cdp = await page.context().newCDPSession(page)` and the existing `ts()` / `emit()` helpers, add plugin setup:

```ts
const plugins = opts.plugins ?? []
const registry = new PluginRegistry()

// Build PluginContext for each plugin
function makePluginCtx(plugin: IntrospectionPlugin): PluginContext {
  return {
    page,
    cdpSession: { send: (method, params) => cdp.send(method as never, params as never) },
    emit,
    async writeAsset(wopts) {
      return coreWriteAsset({
        directory: outDir,
        name: sessionId,
        kind: wopts.kind,
        content: wopts.content,
        ext: wopts.ext,
        metadata: wopts.metadata,
        source: wopts.source ?? 'plugin',
      })
    },
    timestamp: ts,
    async addSubscription(pluginName: string, spec: unknown) {
      const expr = `(() => { const p = window.__introspect_plugins__['${pluginName}']; return p ? p.watch(${JSON.stringify(spec)}) : null })()`
      const result = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }) as { result: { value: string } }
      const browserId = result.result.value
      const nodeId = registry.add(pluginName, spec, browserId)
      return {
        async unwatch() {
          const sub = registry.remove(nodeId)
          if (!sub) return
          const unwatchExpr = `(() => { const p = window.__introspect_plugins__['${sub.pluginName}']; if (p) p.unwatch(${JSON.stringify(sub.browserId)}) })()`
          await cdp.send('Runtime.evaluate', { expression: unwatchExpr }).catch(() => {/* non-fatal */})
        }
      }
    },
  }
}
```

After `emit` definition, add push bridge and script injection:

```ts
// Install push bridge
await cdp.send('Runtime.addBinding', { name: '__introspect_push__' })

// Wire push handler
cdp.on('Runtime.bindingCalled', (params: { name: string; payload: string }) => {
  if (params.name !== '__introspect_push__') return
  try {
    const payload = JSON.parse(params.payload) as { type: string; data: Record<string, unknown> }
    emit({ type: payload.type as never, source: 'plugin' as never, data: payload.data } as never)
  } catch { /* malformed push — ignore */ }
})

// Inject plugin scripts (runs on every future navigation)
// and evaluate immediately for the current page (already loaded)
for (const plugin of plugins) {
  await page.addInitScript({ content: plugin.script })
  await page.evaluate((script) => { new Function(script)() }, plugin.script).catch(() => {/* non-fatal if page not ready */})
  await plugin.install(makePluginCtx(plugin))
}

// Re-apply subscriptions after each navigation
page.on('load', () => {
  void (async () => {
    for (const [nodeId, sub] of registry.all()) {
      try {
        const expr = `(() => { const p = window.__introspect_plugins__['${sub.pluginName}']; return p ? p.watch(${JSON.stringify(sub.spec)}) : null })()`
        const result = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }) as { result: { value: string } }
        registry.updateBrowserId(nodeId, result.result.value)
      } catch { /* non-fatal — page may not have the plugin */ }
    }
  })()
})
```

In the `Runtime.exceptionThrown` handler, after writing the snapshot asset, call plugin capture:

```ts
// After writeAsset for snapshot:
for (const plugin of plugins) {
  if (!plugin.capture) continue
  try {
    const results = await plugin.capture('js.error', ts())
    for (const r of results) {
      await coreWriteAsset({ directory: outDir, name: sessionId, kind: r.kind, content: r.content, metadata: { timestamp: ts(), ...r.summary }, source: 'plugin' })
    }
  } catch { /* non-fatal */ }
}
```

In `snapshot()`, after writing the snapshot asset:

```ts
for (const plugin of plugins) {
  if (!plugin.capture) continue
  try {
    const results = await plugin.capture('manual', ts())
    for (const r of results) {
      await coreWriteAsset({ directory: outDir, name: sessionId, kind: r.kind, content: r.content, metadata: { timestamp: ts(), ...r.summary }, source: 'plugin' })
    }
  } catch { /* non-fatal */ }
}
```

In `detach()`, before `finalizeSession`:

```ts
// Bulk unwatch all active subscriptions
for (const [, sub] of registry.all()) {
  try {
    const expr = `(() => { const p = window.__introspect_plugins__['${sub.pluginName}']; if (p) p.unwatch(${JSON.stringify(sub.browserId)}) })()`
    await cdp.send('Runtime.evaluate', { expression: expr }).catch(() => {})
  } catch { /* non-fatal */ }
}

// Capture detach state for all plugins
for (const plugin of plugins) {
  if (!plugin.capture) continue
  try {
    const results = await plugin.capture('detach', ts())
    for (const r of results) {
      await coreWriteAsset({ directory: outDir, name: sessionId, kind: r.kind, content: r.content, metadata: { timestamp: ts(), ...r.summary }, source: 'plugin' })
    }
  } catch { /* non-fatal */ }
}
```

- [ ] **Step 4: Run tests**

```
cd packages/playwright && pnpm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/playwright/src/attach.ts packages/playwright/test/attach.test.ts
git commit -m "feat(playwright): wire plugin system into attach() — push bridge, script injection, navigation re-apply, capture triggers"
```

---

### Task 5: Add `'plugin'` to `VALID_SOURCES` in CLI

**Files:**
- Modify: `packages/cli/src/commands/events.ts`
- Modify: `packages/cli/test/commands/events.test.ts`

- [ ] **Step 1: Write failing test**

In `packages/cli/test/commands/events.test.ts`, add a test for `--source plugin`. First, add a plugin event to the fixture `trace`:

```ts
{ id: 'e6', type: 'webgl.uniform', ts: 450, source: 'plugin', data: { contextId: 'ctx_0', name: 'u_time', value: 1.0, glType: 'float' } },
```

Then add:
```ts
it('--source plugin filters to plugin events', () => {
  const result = applyEventFilters(trace, { source: 'plugin' })
  expect(result).toHaveLength(1)
  expect(result[0].id).toBe('e6')
})
```

- [ ] **Step 2: Run to verify it fails**

```
cd packages/cli && pnpm test
```

Expected: fails with `unknown source "plugin"`.

- [ ] **Step 3: Update `VALID_SOURCES`**

In `packages/cli/src/commands/events.ts`, change:
```ts
const VALID_SOURCES = new Set(['cdp', 'agent', 'playwright'])
```
To:
```ts
const VALID_SOURCES = new Set(['cdp', 'agent', 'playwright', 'plugin'])
```

Also update the error message:
```ts
throw new Error(`unknown source "${opts.source}". Valid values: cdp, agent, playwright, plugin`)
```

- [ ] **Step 4: Run tests**

```
cd packages/cli && pnpm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/events.ts packages/cli/test/commands/events.test.ts
git commit -m "feat(cli): add 'plugin' to valid event sources for --source filter"
```

---

### Task 6: Final workspace check

- [ ] **Step 1: Run all package tests**

```
pnpm -r test
```

Expected: all packages pass.

- [ ] **Step 2: Commit if any loose changes remain**

```bash
git status
git add -p  # stage only intentional changes
git commit -m "chore(plugin-system): final integration check"
```

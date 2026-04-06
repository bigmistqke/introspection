# Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CDP-based plugin system to `@introspection/playwright` that lets plugins inject browser-side scripts, push discrete events via `Runtime.addBinding`, and pull full state on demand.

**Architecture:** `attach()` accepts a `plugins` array; for each plugin it injects the browser-side script, installs the push bridge (`Runtime.addBinding`), and calls `plugin.install(ctx)`. A `PluginRegistry` in `attach.ts` tracks active subscriptions (spec + browserId per watch) and re-applies them after each navigation. `ctx.addSubscription(name, spec)` is the internal hook that both installs a watch browser-side and registers it for navigation recovery.

**Tech Stack:** TypeScript, `@playwright/test` CDP session, `Runtime.addBinding`, `page.addInitScript`, vitest

**Test philosophy:** Test observable behavior — what ends up in `events.ndjson`. Don't test wiring (was method X called?), don't test trivial data structures. The TypeScript compiler handles interface shape.

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

No new test file — the TypeScript compiler enforces interface shape. The tests in later tasks will fail to compile if the types are wrong.

- [ ] **Step 1: Update `packages/types/src/index.ts`**

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
  /** Installs a browser-side watch and registers it for navigation recovery. */
  addSubscription(pluginName: string, spec: unknown): Promise<WatchHandle>
}

export interface IntrospectionPlugin {
  name: string
  script: string
  install(ctx: PluginContext): Promise<void>
  capture?(trigger: 'js.error' | 'manual' | 'detach', ts: number): Promise<CaptureResult[]>
}
```

- [ ] **Step 2: Verify it compiles**

```
cd packages/types && pnpm build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): add plugin system types — PluginPage, PluginEvent, IntrospectionPlugin, PluginContext, WatchHandle, CaptureResult"
```

---

### Task 2: Make `writeAsset` accept an optional `source` parameter

**Files:**
- Modify: `packages/core/src/session-writer.ts`
- Modify: `packages/core/test/session-writer.test.ts`

- [ ] **Step 1: Confirm tests pass before any change**

```
cd packages/core && pnpm test
```

- [ ] **Step 2: Write the failing test**

In `packages/core/test/session-writer.test.ts`, add:

```ts
it('writeAsset emits asset event with source: plugin when passed', async () => {
  await initSessionDir(dir, { id: 'sid', startedAt: 0 })
  await writeAsset({
    directory: dir, name: 'sid', kind: 'webgl-state',
    content: '{}', metadata: { timestamp: 10 }, source: 'plugin',
  })
  const ndjson = await readFile(join(dir, 'sid', 'events.ndjson'), 'utf-8')
  const events = ndjson.trim().split('\n').map(l => JSON.parse(l))
  const asset = events.find((e: { type: string }) => e.type === 'asset')
  expect(asset.source).toBe('plugin')
})
```

- [ ] **Step 3: Run to verify it fails**

```
cd packages/core && pnpm test
```

Expected: TypeScript error — `source` not in opts type; or test fails with `asset.source === 'agent'`.

- [ ] **Step 4: Update `packages/core/src/session-writer.ts`**

Add `EventSource` to the existing import at the top:
```ts
import type { TraceEvent, SessionMeta, BodySummary, EventSource } from '@introspection/types'
```

Add `source?: EventSource` to the `writeAsset` opts type, and use it inside the function:
```ts
// In opts type — add:
source?: EventSource

// In the event object — change:
source: 'agent' as const,
// To:
source: (opts.source ?? 'agent') as EventSource,
```

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

No dedicated unit test — it's a thin Map wrapper. Its behavior is covered by the integration tests in Task 4.

- [ ] **Step 1: Create `packages/playwright/src/plugin-registry.ts`**

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

- [ ] **Step 2: Commit**

```bash
git add packages/playwright/src/plugin-registry.ts
git commit -m "feat(playwright): add PluginRegistry for node-side subscription tracking"
```

---

### Task 4: Wire plugin system into `attach()` — with behavioral tests

**Files:**
- Modify: `packages/playwright/src/attach.ts`
- Modify: `packages/playwright/test/attach.test.ts`

Tests focus on what ends up in `events.ndjson` — not on whether internal methods were called.

- [ ] **Step 1: Write failing behavioral tests**

First, update the existing `makeFakePage()` helper to add `addInitScript` and `on` mocks:

```ts
// Inside makeFakePage(), add to the page object:
addInitScript: vi.fn().mockResolvedValue(undefined),
evaluate: vi.fn().mockResolvedValue(undefined),  // update existing mock — now returns undefined by default
on: vi.fn(),
```

Then add a minimal plugin that actually pushes events browser-side. Because the fake CDP session intercepts `Runtime.bindingCalled`, we can simulate it manually:

```ts
describe('attach() with plugins', () => {
  it('push event from browser appears in events.ndjson with source: plugin', async () => {
    const { page, cdp, trigger } = makeFakePage()
    const plugin: import('@introspection/types').IntrospectionPlugin = {
      name: 'test', script: '', install: async () => {},
    }
    const handle = await attach(page, { outDir: dir, plugins: [plugin] })

    // Simulate browser calling window.__introspect_push__(...)
    trigger('Runtime.bindingCalled', {
      name: '__introspect_push__',
      payload: JSON.stringify({ type: 'webgl.uniform', data: { name: 'u_time', value: 1.5, glType: 'float' } }),
    })
    await new Promise(r => setTimeout(r, 10))
    await handle.detach()

    const [sessionId] = await readdir(dir)
    const events = (await readFile(join(dir, sessionId, 'events.ndjson'), 'utf-8'))
      .trim().split('\n').map(l => JSON.parse(l))

    const pushed = events.find((e: { type: string }) => e.type === 'webgl.uniform')
    expect(pushed).toBeDefined()
    expect(pushed.source).toBe('plugin')
    expect(pushed.data.name).toBe('u_time')
    expect(pushed.data.value).toBe(1.5)
  })

  it('ctx.writeAsset produces an asset event with source: plugin in events.ndjson', async () => {
    const { page, cdp } = makeFakePage()
    let savedCtx: import('@introspection/types').PluginContext
    const plugin: import('@introspection/types').IntrospectionPlugin = {
      name: 'test', script: '',
      async install(ctx) { savedCtx = ctx },
    }
    const handle = await attach(page, { outDir: dir, plugins: [plugin] })
    await savedCtx!.writeAsset({ kind: 'webgl-state', content: '{"ok":true}', metadata: { timestamp: 5 } })
    await handle.detach()

    const [sessionId] = await readdir(dir)
    const events = (await readFile(join(dir, sessionId, 'events.ndjson'), 'utf-8'))
      .trim().split('\n').map(l => JSON.parse(l))

    const asset = events.find((e: { type: string }) => e.type === 'asset')
    expect(asset).toBeDefined()
    expect(asset.source).toBe('plugin')
    expect(asset.data.kind).toBe('webgl-state')
  })

  it('detach() triggers plugin.capture("detach") and writes resulting assets', async () => {
    const { page } = makeFakePage()
    const plugin: import('@introspection/types').IntrospectionPlugin = {
      name: 'test', script: '', install: async () => {},
      async capture(trigger) {
        if (trigger !== 'detach') return []
        return [{ kind: 'webgl-state', content: '{"detached":true}', summary: { contextId: 'ctx_0' } }]
      },
    }
    await attach(page, { outDir: dir, plugins: [plugin] }).then(h => h.detach())

    const [sessionId] = await readdir(dir)
    const events = (await readFile(join(dir, sessionId, 'events.ndjson'), 'utf-8'))
      .trim().split('\n').map(l => JSON.parse(l))

    const asset = events.find((e: { type: string; data?: { kind: string } }) =>
      e.type === 'asset' && e.data?.kind === 'webgl-state')
    expect(asset).toBeDefined()
    expect(asset.source).toBe('plugin')
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

```
cd packages/playwright && pnpm test
```

Expected: new tests fail — `plugins` option not implemented.

- [ ] **Step 3: Update `packages/playwright/src/attach.ts`**

Add imports at top:
```ts
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
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

Inside `attach()`, after the existing `ts()` and `emit()` helpers:

```ts
const plugins = opts.plugins ?? []
const registry = new PluginRegistry()

function makePluginCtx(plugin: IntrospectionPlugin): PluginContext {
  return {
    page,
    cdpSession: { send: (method, params) => cdp.send(method as never, params as never) },
    emit,
    async writeAsset(wopts) {
      return coreWriteAsset({
        directory: outDir, name: sessionId,
        kind: wopts.kind, content: wopts.content, ext: wopts.ext,
        metadata: wopts.metadata, source: wopts.source ?? 'plugin',
      })
    },
    timestamp: ts,
    async addSubscription(pluginName: string, spec: unknown) {
      const expr = `(() => { const p = window.__introspect_plugins__?.['${pluginName}']; return p ? p.watch(${JSON.stringify(spec)}) : null })()`
      const result = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }) as { result: { value: string } }
      const browserId = result.result.value
      const nodeId = registry.add(pluginName, spec, browserId)
      return {
        async unwatch() {
          const sub = registry.remove(nodeId)
          if (!sub) return
          const unwatchExpr = `(() => { window.__introspect_plugins__?.['${sub.pluginName}']?.unwatch(${JSON.stringify(sub.browserId)}) })()`
          await cdp.send('Runtime.evaluate', { expression: unwatchExpr }).catch(() => {})
        },
      }
    },
  }
}
```

After `emit` definition, add the push bridge and plugin setup:

```ts
// Push bridge — browser calls window.__introspect_push__(JSON.stringify({type, data}))
await cdp.send('Runtime.addBinding', { name: '__introspect_push__' })
cdp.on('Runtime.bindingCalled', (params: { name: string; payload: string }) => {
  if (params.name !== '__introspect_push__') return
  try {
    const { type, data } = JSON.parse(params.payload) as { type: string; data: Record<string, unknown> }
    emit({ type: type as never, source: 'plugin' as never, data } as never)
  } catch { /* malformed push — ignore */ }
})

// Inject scripts (future navigations) + evaluate immediately (current page)
for (const plugin of plugins) {
  await page.addInitScript({ content: plugin.script })
  await page.evaluate((s: string) => { new Function(s)() }, plugin.script).catch(() => {})
  await plugin.install(makePluginCtx(plugin))
}

// Re-apply subscriptions after each navigation
page.on('load', () => {
  void (async () => {
    for (const [nodeId, sub] of registry.all()) {
      try {
        const expr = `(() => { const p = window.__introspect_plugins__?.['${sub.pluginName}']; return p ? p.watch(${JSON.stringify(sub.spec)}) : null })()`
        const result = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }) as { result: { value: string } }
        registry.updateBrowserId(nodeId, result.result.value)
      } catch { /* non-fatal */ }
    }
  })()
})
```

In `Runtime.exceptionThrown` handler, after the existing snapshot write:
```ts
for (const plugin of plugins) {
  if (!plugin.capture) continue
  try {
    for (const r of await plugin.capture('js.error', ts()))
      await coreWriteAsset({ directory: outDir, name: sessionId, kind: r.kind, content: r.content, metadata: { timestamp: ts(), ...r.summary }, source: 'plugin' })
  } catch { /* non-fatal */ }
}
```

In `snapshot()`, after the existing snapshot write:
```ts
for (const plugin of plugins) {
  if (!plugin.capture) continue
  try {
    for (const r of await plugin.capture('manual', ts()))
      await coreWriteAsset({ directory: outDir, name: sessionId, kind: r.kind, content: r.content, metadata: { timestamp: ts(), ...r.summary }, source: 'plugin' })
  } catch { /* non-fatal */ }
}
```

In `detach()`, before `finalizeSession`:
```ts
// Bulk unwatch
for (const [, sub] of registry.all()) {
  const expr = `(() => { window.__introspect_plugins__?.['${sub.pluginName}']?.unwatch(${JSON.stringify(sub.browserId)}) })()`
  await cdp.send('Runtime.evaluate', { expression: expr }).catch(() => {})
}

// Capture detach state
for (const plugin of plugins) {
  if (!plugin.capture) continue
  try {
    for (const r of await plugin.capture('detach', ts()))
      await coreWriteAsset({ directory: outDir, name: sessionId, kind: r.kind, content: r.content, metadata: { timestamp: ts(), ...r.summary }, source: 'plugin' })
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

In `packages/cli/test/commands/events.test.ts`, add a plugin event to the fixture `trace`:

```ts
{ id: 'e6', type: 'webgl.uniform', ts: 450, source: 'plugin', data: { name: 'u_time', value: 1.5 } },
```

Add test:
```ts
it('--source plugin returns only plugin events', () => {
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

- [ ] **Step 3: Update `packages/cli/src/commands/events.ts`**

```ts
const VALID_SOURCES = new Set(['cdp', 'agent', 'playwright', 'plugin'])
```

Update the error message:
```ts
throw new Error(`unknown source "${opts.source}". Valid values: cdp, agent, playwright, plugin`)
```

- [ ] **Step 4: Run tests**

```
cd packages/cli && pnpm test
```

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
git status && git add -p && git commit -m "chore: final integration check"
```

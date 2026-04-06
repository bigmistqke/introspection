# Introspection Plan 3: Playwright Fixture, Zustand Plugin, Source-Map Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `TestResult` to `detach()`, create a Playwright test fixture for zero-boilerplate introspection, add a Zustand plugin, and expose source-map resolution in the eval socket VM context.

**Architecture:** Four tasks that build on the existing attach/vite/types packages. Task 1 is a prerequisite for Task 2 (fixture calls `detach(result)`). Tasks 3 and 4 are fully independent. Each new package follows the exact same structure as `plugin-redux` and `plugin-react`.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, `@playwright/test` (fixture API), Zustand `store.subscribe`, Node.js `vm.runInNewContext`

---

## File Map

**Task 1 — `detach(result?)`**
- Modify: `packages/types/src/index.ts` — add `TestResult` type alias, update `IntrospectHandle.detach` signature
- Modify: `packages/playwright/src/attach.ts` — accept optional `result` param in `detach()`
- Modify: `packages/playwright/test/attach.test.ts` — cover result forwarding

**Task 2 — Playwright fixture**
- Create: `packages/playwright-fixture/package.json`
- Create: `packages/playwright-fixture/tsconfig.json`
- Create: `packages/playwright-fixture/src/index.ts` — `introspectFixture(opts?)` + named exports
- Create: `packages/playwright-fixture/test/fixture.test.ts`

**Task 3 — Zustand plugin**
- Create: `packages/plugin-zustand/package.json`
- Create: `packages/plugin-zustand/tsconfig.json`
- Create: `packages/plugin-zustand/src/index.ts` — `createZustandPlugin(store)`
- Create: `packages/plugin-zustand/test/plugin-zustand.test.ts`

**Task 4 — Source-map `resolve()` in eval socket**
- Modify: `packages/vite/src/eval-socket.ts` — optional third param, expose `resolve()`, handle async results
- Modify: `packages/vite/src/index.ts` — pass `resolveFrame` as third arg
- Modify: `packages/vite/test/eval-socket.test.ts` — add tests for `resolve()`

---

### Task 1: Add `TestResult` to `IntrospectHandle.detach()`

`detach()` currently hardcodes `{ status: 'passed' }` when notifying the Vite server. The Playwright fixture (Task 2) needs to pass the real test outcome.

Note: `TraceTest` in `types/src/index.ts` already has `status`, `duration`, and `error` — `TestResult` is `Omit<TraceTest, 'title' | 'file'>` so we use a type alias rather than a new interface.

**Files:**
- Modify: `packages/types/src/index.ts`
- Modify: `packages/playwright/src/attach.ts`
- Modify: `packages/playwright/test/attach.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/playwright/test/attach.test.ts` (after the existing detach test):

```ts
it('detach() forwards result to END_SESSION', async () => {
  const { page } = makeFakePage()
  const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-detach-result' })
  mockWsSend.mockClear()
  await handle.detach({ status: 'failed', duration: 1234, error: 'AssertionError' })
  const endMsg = mockWsSend.mock.calls.find(([msg]) => {
    try { return JSON.parse(msg).type === 'END_SESSION' } catch { return false }
  })
  expect(endMsg).toBeDefined()
  const parsed = JSON.parse(endMsg![0])
  expect(parsed.result).toEqual({ status: 'failed', duration: 1234, error: 'AssertionError' })
})

it('detach() defaults result to passed when called without args', async () => {
  const { page } = makeFakePage()
  const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-detach-default' })
  mockWsSend.mockClear()
  await handle.detach()
  const endMsg = mockWsSend.mock.calls.find(([msg]) => {
    try { return JSON.parse(msg).type === 'END_SESSION' } catch { return false }
  })
  const parsed = JSON.parse(endMsg![0])
  expect(parsed.result).toEqual({ status: 'passed' })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/playwright && pnpm test 2>&1 | tail -20
```

Expected: TypeScript error — `detach()` does not accept arguments.

- [ ] **Step 3: Add `TestResult` type alias in `packages/types/src/index.ts`**

Add after `TraceTest` (around line 144):

```ts
/** Subset of TraceTest passed to detach() — title and file are not needed at teardown time */
export type TestResult = Omit<TraceTest, 'title' | 'file'>
```

Update `IntrospectHandle.detach`:

```ts
export interface IntrospectHandle {
  page: import('@playwright/test').Page   // Proxy-wrapped page
  mark(label: string, data?: Record<string, unknown>): void
  snapshot(): Promise<void>
  detach(result?: TestResult): Promise<void>
}
```

- [ ] **Step 4: Update `packages/playwright/src/attach.ts`**

Import `TestResult`:

```ts
import type { IntrospectHandle, TraceEvent, OnErrorSnapshot, TestResult } from '@introspection/types'
```

Update `detach()`:

```ts
async detach(result?: TestResult) {
  ws.send(JSON.stringify({ type: 'END_SESSION', sessionId, result: result ?? { status: 'passed' } }))
  try { await cdp.detach() } catch { /* non-fatal: browser context may already be closed */ }
  await new Promise<void>((resolve) => {
    ws.once('close', resolve)
    ws.close()
  })
},
```

- [ ] **Step 5: Run tests**

```bash
cd packages/playwright && pnpm test 2>&1 | tail -20
```

Expected: all tests pass including the two new detach tests.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/index.ts packages/playwright/src/attach.ts packages/playwright/test/attach.test.ts
git commit -m "feat(types,playwright): add TestResult type and optional result param to detach()"
```

---

### Task 2: Playwright Fixture Package

A `@introspection/playwright-fixture` package that exports a pre-wired `{ test, expect }`. Users replace `import { test, expect } from '@playwright/test'` with `import { test, expect } from '@introspection/playwright-fixture'`. Attach/detach happen automatically; test result is forwarded to `detach()`.

**Design:** `test.extend<{ introspect: IntrospectHandle }>()` with `auto: true`. The fixture receives `testInfo` as the third argument (Playwright fixture convention). It calls `attach(page, { testTitle: testInfo.title, testFile: testInfo.file, workerIndex: testInfo.workerIndex })`, `use(handle)`, then `handle.detach({ status: testInfo.status, duration: testInfo.duration, error: testInfo.error?.message })`.

**Files:**
- Create: `packages/playwright-fixture/package.json`
- Create: `packages/playwright-fixture/tsconfig.json`
- Create: `packages/playwright-fixture/src/index.ts`
- Create: `packages/playwright-fixture/test/fixture.test.ts`

- [ ] **Step 1: Create `packages/playwright-fixture/package.json`**

```json
{
  "name": "@introspection/playwright-fixture",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run"
  },
  "dependencies": {
    "@introspection/playwright": "workspace:*",
    "@introspection/types": "workspace:*",
    "@playwright/test": "*"
  }
}
```

Note: No `devDependencies` block — `vitest`, `tsup`, and `typescript` are hoisted from the workspace root, matching the pattern in `plugin-redux/package.json`.

- [ ] **Step 2: Create `packages/playwright-fixture/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Install from workspace root**

```bash
cd /path/to/repo/root && pnpm install
```

This links `workspace:*` dependencies correctly across the monorepo.

- [ ] **Step 4: Write the failing test**

Create `packages/playwright-fixture/test/fixture.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @introspection/playwright attach
const mockAttach = vi.fn()
const mockMark = vi.fn()
const mockDetach = vi.fn().mockResolvedValue(undefined)

vi.mock('@introspection/playwright', () => ({
  attach: mockAttach,
}))

// Mock @playwright/test — test.extend() stores fixtures and returns them for inspection
const capturedFixtures: Record<string, unknown> = {}
vi.mock('@playwright/test', () => ({
  test: {
    extend: (fixtures: Record<string, unknown>) => {
      Object.assign(capturedFixtures, fixtures)
      return { _isExtended: true, fixtures: capturedFixtures }
    },
  },
  expect,
}))

import { introspectFixture } from '../src/index.js'

describe('introspectFixture()', () => {
  beforeEach(() => {
    mockAttach.mockReset()
    mockDetach.mockReset()
    mockDetach.mockResolvedValue(undefined)
    mockAttach.mockResolvedValue({
      page: {},
      mark: mockMark,
      snapshot: vi.fn().mockResolvedValue(undefined),
      detach: mockDetach,
    })
  })

  it('returns an object with test and expect', () => {
    const result = introspectFixture()
    expect(result).toHaveProperty('test')
    expect(result).toHaveProperty('expect')
  })

  it('fixture setup calls attach with testInfo metadata', async () => {
    introspectFixture()
    // The introspect fixture is [fn, { auto: true }]
    const [fixtureFn] = capturedFixtures.introspect as [Function, unknown]

    const fakeUse = vi.fn().mockResolvedValue(undefined)
    const fakePage = {}
    const fakeTestInfo = {
      title: 'my test',
      file: 'my.spec.ts',
      workerIndex: 0,
      status: 'passed' as const,
      duration: 500,
      error: undefined,
    }

    await fixtureFn({ page: fakePage }, fakeUse, fakeTestInfo)

    expect(mockAttach).toHaveBeenCalledWith(fakePage, expect.objectContaining({
      testTitle: 'my test',
      testFile: 'my.spec.ts',
      workerIndex: 0,
    }))
  })

  it('fixture calls use() with the handle', async () => {
    introspectFixture()
    const [fixtureFn] = capturedFixtures.introspect as [Function, unknown]

    const fakeUse = vi.fn().mockResolvedValue(undefined)
    const fakePage = {}
    const fakeTestInfo = { title: 't', file: 'f.spec.ts', workerIndex: 0, status: 'passed' as const, duration: 100, error: undefined }

    await fixtureFn({ page: fakePage }, fakeUse, fakeTestInfo)

    expect(fakeUse).toHaveBeenCalledOnce()
    expect(fakeUse.mock.calls[0][0]).toHaveProperty('detach')
  })

  it('fixture teardown calls detach with test result', async () => {
    introspectFixture()
    const [fixtureFn] = capturedFixtures.introspect as [Function, unknown]

    const fakeUse = vi.fn().mockResolvedValue(undefined)
    const fakePage = {}
    const fakeTestInfo = {
      title: 't',
      file: 'f.spec.ts',
      workerIndex: 1,
      status: 'failed' as const,
      duration: 200,
      error: { message: 'boom' },
    }

    await fixtureFn({ page: fakePage }, fakeUse, fakeTestInfo)

    expect(mockDetach).toHaveBeenCalledWith({
      status: 'failed',
      duration: 200,
      error: 'boom',
    })
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd packages/playwright-fixture && pnpm test 2>&1 | tail -20
```

Expected: import error — `src/index.ts` doesn't exist yet.

- [ ] **Step 6: Implement `packages/playwright-fixture/src/index.ts`**

```ts
import { test as base, expect } from '@playwright/test'
import { attach } from '@introspection/playwright'
import type { IntrospectHandle, TestResult } from '@introspection/types'

export interface IntrospectFixtureOptions {
  viteUrl?: string
  outDir?: string
}

export function introspectFixture(opts: IntrospectFixtureOptions = {}) {
  const test = base.extend<{ introspect: IntrospectHandle }>({
    introspect: [async ({ page }, use, testInfo) => {
      const handle = await attach(page, {
        testTitle: testInfo.title,
        testFile: testInfo.file,
        workerIndex: testInfo.workerIndex,
        ...(opts.viteUrl ? { viteUrl: opts.viteUrl } : {}),
        ...(opts.outDir ? { outDir: opts.outDir } : {}),
      })
      await use(handle)
      const result: TestResult = {
        status: testInfo.status as TestResult['status'],
        duration: testInfo.duration,
        error: testInfo.error?.message,
      }
      await handle.detach(result)
    }, { auto: true }],
  })

  return { test, expect }
}

// Default export for drop-in replacement: import { test, expect } from '@introspection/playwright-fixture'
export const { test, expect: _expect } = introspectFixture()
export { _expect as expect }
```

- [ ] **Step 7: Run tests**

```bash
cd packages/playwright-fixture && pnpm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/playwright-fixture/
git commit -m "feat: add @introspection/playwright-fixture for zero-boilerplate attach/detach"
```

---

### Task 3: Zustand Plugin

A `@introspection/plugin-zustand` package. Zustand stores expose `subscribe(listener)` where listener receives `(newState, prevState)`. No dispatch wrapping needed. Emits `plugin.zustand.change` with `changedKeys` diff (shallow comparison).

**Files:**
- Create: `packages/plugin-zustand/package.json`
- Create: `packages/plugin-zustand/tsconfig.json`
- Create: `packages/plugin-zustand/src/index.ts`
- Create: `packages/plugin-zustand/test/plugin-zustand.test.ts`

- [ ] **Step 1: Create `packages/plugin-zustand/package.json`**

```json
{
  "name": "@introspection/plugin-zustand",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run"
  },
  "dependencies": {
    "@introspection/types": "workspace:*"
  }
}
```

No `devDependencies` — matches `plugin-redux/package.json` pattern (hoisted from workspace root).

- [ ] **Step 2: Create `packages/plugin-zustand/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Install from workspace root**

```bash
cd /path/to/repo/root && pnpm install
```

- [ ] **Step 4: Write the failing test**

Create `packages/plugin-zustand/test/plugin-zustand.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createZustandPlugin } from '../src/index.js'
import type { BrowserAgent } from '@introspection/types'

function makeStore(initial: Record<string, unknown>) {
  let state = { ...initial }
  const listeners: ((next: unknown, prev: unknown) => void)[] = []

  return {
    getState: () => state,
    subscribe: (fn: (next: unknown, prev: unknown) => void) => {
      listeners.push(fn)
      return () => {
        const i = listeners.indexOf(fn)
        if (i !== -1) listeners.splice(i, 1)
      }
    },
    setState: (patch: Record<string, unknown>) => {
      const prev = state
      state = { ...state, ...patch }
      listeners.forEach(fn => fn(state, prev))
    },
  }
}

describe('createZustandPlugin()', () => {
  it('has name "zustand"', () => {
    const store = makeStore({ count: 0 })
    expect(createZustandPlugin(store).name).toBe('zustand')
  })

  it('emits plugin.zustand.change with changedKeys on state update', () => {
    const store = makeStore({ count: 0, name: 'alice' })
    const plugin = createZustandPlugin(store)
    const agent: BrowserAgent = { emit: vi.fn() }

    plugin.browser!.setup(agent)
    store.setState({ count: 1 })

    expect(agent.emit).toHaveBeenCalledOnce()
    const call = (agent.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.type).toBe('plugin.zustand.change')
    expect(call.data.changedKeys).toEqual(['count'])
    expect(call.data.state).toEqual({ count: 1, name: 'alice' })
  })

  it('does not emit when no keys changed', () => {
    const store = makeStore({ count: 0 })
    const plugin = createZustandPlugin(store)
    const agent: BrowserAgent = { emit: vi.fn() }

    plugin.browser!.setup(agent)
    store.setState({ count: 0 }) // same value

    expect(agent.emit).not.toHaveBeenCalled()
  })

  it('snapshot() returns current state', () => {
    const store = makeStore({ count: 42 })
    const plugin = createZustandPlugin(store)
    expect(plugin.browser!.snapshot()).toEqual({ state: { count: 42 } })
  })

  it('calls store.subscribe exactly once during setup', () => {
    const unsubFn = vi.fn()
    const fakeStore = {
      getState: () => ({}),
      subscribe: vi.fn().mockReturnValue(unsubFn),
    }
    const plugin = createZustandPlugin(fakeStore)
    const agent: BrowserAgent = { emit: vi.fn() }

    plugin.browser!.setup(agent)
    expect(fakeStore.subscribe).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd packages/plugin-zustand && pnpm test 2>&1 | tail -20
```

Expected: import error — `src/index.ts` doesn't exist.

- [ ] **Step 6: Implement `packages/plugin-zustand/src/index.ts`**

Note: `IntrospectionPlugin.browser.setup()` returns `void`, so the unsubscribe is captured in a closure.

```ts
import type { IntrospectionPlugin, BrowserAgent } from '@introspection/types'

interface ZustandStore {
  getState(): unknown
  subscribe(listener: (next: unknown, prev: unknown) => void): () => void
}

function shallowChangedKeys(before: unknown, after: unknown): string[] {
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return []
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  return [...keys].filter(k => b[k] !== a[k])
}

export function createZustandPlugin(store: ZustandStore): IntrospectionPlugin {
  return {
    name: 'zustand',
    browser: {
      setup(agent: BrowserAgent) {
        store.subscribe((next, prev) => {
          const changedKeys = shallowChangedKeys(prev, next)
          if (changedKeys.length === 0) return
          agent.emit({
            type: 'plugin.zustand.change',
            data: { state: next, changedKeys },
          })
        })
      },
      snapshot() {
        return { state: store.getState() }
      },
    },
  }
}
```

- [ ] **Step 7: Run tests**

```bash
cd packages/plugin-zustand && pnpm test 2>&1 | tail -20
```

Expected: all 5 tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/plugin-zustand/
git commit -m "feat: add @introspection/plugin-zustand plugin"
```

---

### Task 4: Source-Map `resolve()` in Eval Socket

The eval socket exposes `{ events, snapshot, test }` in the VM context. Adding `resolve(frame)` lets CLI users call `resolve(events[0].data.stack[0])` and get a source-mapped location back.

`resolveFrame` is already computed synchronously in `packages/vite/src/index.ts` (line 17–18). The third param type is `(frame: StackFrame) => StackFrame | Promise<StackFrame>` to support both sync and async resolvers — the existing sync lambda satisfies this.

The eval handler also needs to be upgraded to `async` to correctly `await` Promise results (both from `resolve()` and any other future async expression).

**Files:**
- Modify: `packages/vite/src/eval-socket.ts`
- Modify: `packages/vite/src/index.ts`
- Modify: `packages/vite/test/eval-socket.test.ts`

- [ ] **Step 1: Read the existing eval-socket test**

```bash
cat packages/vite/test/eval-socket.test.ts
```

Confirm the existing pattern: uses `connectToSocket` from `../../cli/src/socket-client.js`, `mkdtemp`/`rm` for temp dirs, and `client.close()` before `sock.shutdown()`.

- [ ] **Step 2: Write the failing tests**

Append to `packages/vite/test/eval-socket.test.ts` inside the `describe('EvalSocket', ...)` block:

```ts
  it('exposes resolve() when resolveFrame is provided', async () => {
    const resolvedFrame = { functionName: 'fn', file: 'src/app.ts', line: 10, column: 5 }
    const resolveFrame = vi.fn().mockResolvedValue(resolvedFrame)

    const sock = createEvalSocket(join(dir, '.socket'), () => [], resolveFrame)
    const client = await connectToSocket(join(dir, '.socket'))

    const typeResult = await client.eval('typeof resolve')
    expect(typeResult).toBe('function')

    const fakeFrame = { functionName: 'fn', file: 'dist/app.js', line: 1, column: 0 }
    const resolved = await client.eval(`resolve(${JSON.stringify(fakeFrame)})`)
    expect(resolveFrame).toHaveBeenCalledWith(fakeFrame)
    expect(resolved).toEqual(resolvedFrame)

    client.close()
    await sock.shutdown()
  })

  it('resolve() is absent when resolveFrame is not provided', async () => {
    const sock = createEvalSocket(join(dir, '.socket'), () => [])
    const client = await connectToSocket(join(dir, '.socket'))

    const result = await client.eval('typeof resolve')
    expect(result).toBe('undefined')

    client.close()
    await sock.shutdown()
  })

  it('awaits Promise results from evaluated expressions', async () => {
    const sock = createEvalSocket(join(dir, '.socket'), () => [])
    const client = await connectToSocket(join(dir, '.socket'))

    const result = await client.eval('Promise.resolve(42)')
    expect(result).toBe(42)

    client.close()
    await sock.shutdown()
  })
```

Also add `import { vi } from 'vitest'` to the imports at the top of the file.

- [ ] **Step 3: Run test to verify it fails**

```bash
cd packages/vite && pnpm test eval-socket 2>&1 | tail -20
```

Expected: `'resolve' is of type 'undefined'` and Promise test returning `{}` instead of `42`.

- [ ] **Step 4: Update `packages/vite/src/eval-socket.ts`**

Full replacement:

```ts
import { createServer } from 'net'
import { existsSync, mkdirSync, unlinkSync } from 'fs'
import { unlink } from 'fs/promises'
import { dirname } from 'path'
import { runInNewContext } from 'vm'
import type { Session } from './server.js'
import type { StackFrame } from '@introspection/types'

export interface EvalSocket {
  shutdown(): Promise<void>
}

export function createEvalSocket(
  socketPath: string,
  getSessions: () => Session[],
  resolveFrame?: (frame: StackFrame) => StackFrame | Promise<StackFrame>
): EvalSocket {
  mkdirSync(dirname(socketPath), { recursive: true })
  if (existsSync(socketPath)) unlinkSync(socketPath)

  const server = createServer((conn) => {
    let buffer = ''
    conn.on('data', async (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line) as { id: string; type: string; expression: string }
          if (msg.type !== 'eval') continue
          const all = getSessions()
          const session = all[all.length - 1]
          const ctx: Record<string, unknown> = session
            ? { events: session.events, snapshot: session.snapshot ?? null, test: { title: session.testTitle, file: session.testFile } }
            : { events: [], snapshot: null, test: null }
          if (resolveFrame) {
            ctx.resolve = (frame: unknown) => resolveFrame(frame as StackFrame)
          }
          try {
            const raw = runInNewContext(msg.expression, ctx)
            const result = raw instanceof Promise ? await raw : raw
            conn.write(JSON.stringify({ id: msg.id, result: result ?? null }) + '\n')
          } catch (err) {
            conn.write(JSON.stringify({ id: msg.id, error: String(err) }) + '\n')
          }
        } catch { /* malformed line */ }
      }
    })
    conn.on('error', () => { /* client disconnected */ })
  })

  server.listen(socketPath)

  return {
    async shutdown() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      try { await unlink(socketPath) } catch { /* already gone */ }
    }
  }
}
```

- [ ] **Step 5: Update `packages/vite/src/index.ts`**

Change line 20 to pass `resolveFrame` as the third arg:

```ts
evalSocket = createEvalSocket(join(outDir, '.socket'), () => server?.getSessions() ?? [], resolveFrame)
```

The existing `resolveFrame` lambda returns `StackFrame` synchronously, which satisfies `StackFrame | Promise<StackFrame>` — no wrapping needed.

- [ ] **Step 6: Run all vite tests**

```bash
cd packages/vite && pnpm test 2>&1 | tail -30
```

Expected: all tests pass including the 3 new eval-socket tests.

- [ ] **Step 7: Commit**

```bash
git add packages/vite/src/eval-socket.ts packages/vite/src/index.ts packages/vite/test/eval-socket.test.ts
git commit -m "feat(vite): expose resolve() in eval socket VM context for source-map lookup"
```

---

## Final Verification

- [ ] Run all tests across the monorepo:

```bash
pnpm -r test 2>&1 | tail -40
```

Expected: all packages green.

---

## Next Steps (Plan 4)

- **WebGL introspection plugin** (`@introspection/plugin-webgl`) — intercept `getContext('webgl'/'webgl2')`, capture draw calls, shader source, uniform values, GPU timing via `EXT_disjoint_timer_query_webgl2`, readPixels snapshots on error. Tracking ideas: draw call count per frame, shader compilation errors, texture upload sizes, frame render time, WebGL context loss events.
- **Web Worker tracing** — postMessage bridge between worker and main thread; relay events through the existing WS connection. Worker plugin installs itself via `importScripts` or dynamic import.

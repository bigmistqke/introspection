# Introspection 2.0 — CDP-Only Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the introspection library into a framework-agnostic `@introspection/core` and a thin `@introspection/playwright` glue layer, removing all Vite, WebSocket, RPC, and plugin dependencies.

**Architecture:** A new `packages/core/` package holds CDP normalizers, snapshot, session-writer, and eval-socket — all with zero runtime deps outside Node builtins. `packages/playwright/` is slimmed to `attach.ts` (wires Playwright's CDP session into core) and `proxy.ts` (Page action tracking). The session directory holds `events.ndjson`, `meta.json`, and an `assets/` subdirectory for all sidecar files (bodies, snapshots, future screenshots). `writeAsset` writes the file and appends the `asset` event atomically — no separate `writeBody`/`writeSnapshot` functions.

**Tech Stack:** TypeScript, Node.js builtins (`fs/promises`, `net`, `vm`, `path`), Playwright (peer dep), Vitest

**Spec:** `docs/superpowers/specs/2026-04-06-cdp-only-pivot-design.md`

---

## File Map

### Created
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/core/vitest.config.ts`
- `packages/core/src/cdp.ts` — CDP event normalizers (moved from `playwright/src/cdp.ts`, drop unused `sessionId` param)
- `packages/core/src/snapshot.ts` — DOM + scope snapshot (moved from `vite/src/snapshot.ts`, drop `plugins` param)
- `packages/core/src/session-writer.ts` — ndjson session I/O (moved from `vite/src/session-writer.ts`, unified `writeAsset` replaces `writeBody`/`writeSnapshot`)
- `packages/core/src/eval-socket.ts` — Unix socket server reading ndjson from disk (rewritten from `vite/src/eval-socket.ts`)
- `packages/core/src/index.ts` — barrel export
- `packages/core/test/cdp.test.ts` — moved + updated from `playwright/test/cdp.test.ts`
- `packages/core/test/snapshot.test.ts` — moved + updated from `vite/test/snapshot.test.ts`
- `packages/core/test/session-writer.test.ts` — moved + updated from `vite/test/session-writer.test.ts`
- `packages/core/test/eval-socket.test.ts` — rewritten from `vite/test/eval-socket.test.ts`

### Modified
- `packages/types/src/index.ts` — remove plugin interfaces, RPC types, update `OnErrorSnapshot.trigger`, simplify `DetachResult`
- `packages/playwright/src/attach.ts` — complete rewrite: no Vite/WS, uses core directly
- `packages/playwright/src/proxy.ts` — update emit callback type (minor)
- `packages/playwright/package.json` — remove `@bigmistqke/rpc`, `ws`, `@introspection/vite`; add `@introspection/core`
- `packages/playwright/test/attach.test.ts` — complete rewrite: no Vite mocks, tests disk output
- `pnpm-workspace.yaml` — remove `demo` entry
- `pnpm-lock.yaml` — updated by pnpm install

### Not Modified
- `packages/playwright-fixture/` — depends only on `@introspection/playwright` and `@introspection/types`; no deleted packages; no changes needed

### Deleted
- `packages/vite/` — entire package
- `packages/browser/` — entire package
- `packages/plugin-redux/` — entire package
- `packages/plugin-react/` — entire package
- `packages/plugin-zustand/` — entire package
- `packages/plugin-webgl/` — entire package
- `packages/playwright/src/cdp.ts` — moved to core
- `packages/playwright/test/cdp.test.ts` — moved to core
- `demos/checkout/` — depends on deleted packages
- `demos/auth/` — depends on deleted packages (if present)

---

## Task 1: Scaffold `@introspection/core` package

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Create the package directory and package.json**

```bash
mkdir -p packages/core/src packages/core/test
```

`packages/core/package.json`:
```json
{
  "name": "@introspection/core",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js"
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

- [ ] **Step 2: Create tsconfig.json and vitest.config.ts**

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { globals: true } })
```

- [ ] **Step 3: Create empty barrel export**

`packages/core/src/index.ts`:
```ts
export * from './cdp.js'
export * from './snapshot.js'
export * from './session-writer.js'
export * from './eval-socket.js'
```

- [ ] **Step 4: Install the new package into the workspace**

```bash
cd /path/to/repo && pnpm install
```

Expected: no errors, `@introspection/core` appears in workspace.

- [ ] **Step 5: Commit**

```bash
git add packages/core/
git commit -m "feat(core): scaffold @introspection/core package"
```

---

## Task 2: Port `cdp.ts` to core

The CDP normalizers move from `packages/playwright/src/cdp.ts` to `packages/core/src/cdp.ts`. The unused `_sessionId` parameter is dropped — the new signature is `(raw, startedAt)`.

**Files:**
- Create: `packages/core/src/cdp.ts`
- Create: `packages/core/test/cdp.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/cdp.test.ts` — copy from `packages/playwright/test/cdp.test.ts` and update the import path and all call sites to drop the `sessionId` argument:

```ts
import { describe, it, expect } from 'vitest'
import { normaliseCdpNetworkRequest, normaliseCdpNetworkResponse, normaliseCdpJsError } from '../src/cdp.js'

describe('CDP event normalisation', () => {
  it('normalises a Network.requestWillBeSent event', () => {
    const raw = {
      requestId: 'req-1',
      request: {
        url: 'https://api.example.com/users',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        postData: '{"name":"alice"}',
      },
      timestamp: 100,
    }
    const evt = normaliseCdpNetworkRequest(raw, 0)
    expect(evt.type).toBe('network.request')
    expect(evt.source).toBe('cdp')
    expect(evt.data.url).toBe('https://api.example.com/users')
    expect(evt.data.method).toBe('POST')
    expect(evt.data.postData).toBe('{"name":"alice"}')
    expect(evt.id).toBeTruthy()
    expect(evt.ts).toBe(100000)
  })

  it('omits postData when absent', () => {
    const raw = { requestId: 'req-2', request: { url: '/health', method: 'GET', headers: {} }, timestamp: 50 }
    const evt = normaliseCdpNetworkRequest(raw, 0)
    expect(evt.data.postData).toBeUndefined()
  })

  it('normalises a Network.responseReceived event', () => {
    const raw = {
      requestId: 'req-1',
      response: { url: 'https://api.example.com/users', status: 201, headers: { 'content-type': 'application/json' } },
      timestamp: 150,
    }
    const evt = normaliseCdpNetworkResponse(raw, 0)
    expect(evt.type).toBe('network.response')
    expect(evt.data.status).toBe(201)
    expect(evt.initiator).toBe('req-1')
    expect(evt.ts).toBe(150000)
  })

  it('normalises a Runtime.exceptionThrown event', () => {
    const raw = {
      timestamp: 200,
      exceptionDetails: {
        text: 'TypeError',
        stackTrace: { callFrames: [{ functionName: 'handleSubmit', url: 'bundle.js', lineNumber: 0, columnNumber: 5000 }] }
      }
    }
    const evt = normaliseCdpJsError(raw, 0)
    expect(evt.type).toBe('js.error')
    expect(evt.data.stack[0].line).toBe(1)
    expect(evt.ts).toBe(200000)
  })

  it('uses (anonymous) for empty functionName', () => {
    const raw = { timestamp: 300, exceptionDetails: { text: 'Error', stackTrace: { callFrames: [{ functionName: '', url: 'app.js', lineNumber: 9, columnNumber: 0 }] } } }
    const evt = normaliseCdpJsError(raw, 0)
    expect(evt.data.stack[0].functionName).toBe('(anonymous)')
  })

  it('subtracts startedAt from ts', () => {
    const raw = { requestId: 'req-3', request: { url: '/api', method: 'GET', headers: {} }, timestamp: 100 }
    const evt = normaliseCdpNetworkRequest(raw, 5000)
    expect(evt.ts).toBe(95000)
  })

  it('produces ts=0 when timestamp is missing', () => {
    const raw = { exceptionDetails: { text: 'Error' } }
    const evt = normaliseCdpJsError(raw, 0)
    expect(evt.ts).toBe(0)
  })

  it('prefers exception.description over details.text', () => {
    const raw = {
      timestamp: 500,
      exceptionDetails: {
        text: 'Uncaught (in promise)',
        exception: { description: 'TypeError: Cannot read properties of undefined (reading "foo")' },
        stackTrace: { callFrames: [] },
      },
    }
    const evt = normaliseCdpJsError(raw, 0)
    expect(evt.data.message).toBe('TypeError: Cannot read properties of undefined (reading "foo")')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/core && pnpm test
```

Expected: FAIL — `../src/cdp.js` not found.

- [ ] **Step 3: Create `packages/core/src/cdp.ts`**

Copy from `packages/playwright/src/cdp.ts`, then update the three function signatures to drop `_sessionId`:

```ts
import { randomUUID } from 'crypto'
import type { NetworkRequestEvent, NetworkResponseEvent, JsErrorEvent, StackFrame } from '@introspection/types'

function makeId(): string { return `evt-${randomUUID().slice(0, 8)}` }
function toTs(timestamp: unknown, startedAt: number): number {
  return typeof timestamp === 'number' ? Math.round(timestamp * 1000 - startedAt) : 0
}

export function normaliseCdpNetworkRequest(raw: Record<string, unknown>, startedAt: number): NetworkRequestEvent {
  const req = (raw.request ?? {}) as Record<string, unknown>
  return {
    id: makeId(),
    type: 'network.request',
    ts: toTs(raw.timestamp, startedAt),
    source: 'cdp',
    data: {
      cdpRequestId: raw.requestId as string,
      url: req.url as string,
      method: req.method as string,
      headers: (req.headers ?? {}) as Record<string, string>,
      postData: req.postData as string | undefined,
    },
  }
}

export function normaliseCdpNetworkResponse(raw: Record<string, unknown>, startedAt: number): NetworkResponseEvent {
  const res = (raw.response ?? {}) as Record<string, unknown>
  return {
    id: makeId(),
    type: 'network.response',
    ts: toTs(raw.timestamp, startedAt),
    source: 'cdp',
    initiator: raw.requestId as string,
    data: {
      cdpRequestId: raw.requestId as string,
      requestId: raw.requestId as string,
      url: res.url as string,
      status: res.status as number,
      headers: (res.headers ?? {}) as Record<string, string>,
    },
  }
}

export function normaliseCdpJsError(raw: Record<string, unknown>, startedAt: number): JsErrorEvent {
  const details = (raw.exceptionDetails ?? {}) as Record<string, unknown>
  const exception = (details.exception ?? {}) as Record<string, unknown>
  const trace = details.stackTrace as { callFrames: Array<Record<string, unknown>> } | undefined
  const message = (exception.description as string | undefined) ?? (details.text as string)
  const stack: StackFrame[] = (trace?.callFrames ?? []).map(f => ({
    functionName: (f.functionName as string) || '(anonymous)',
    file: f.url as string,
    line: (f.lineNumber as number) + 1,
    column: f.columnNumber as number,
  }))
  return {
    id: makeId(),
    type: 'js.error',
    ts: toTs(raw.timestamp, startedAt),
    source: 'cdp',
    data: { message, stack },
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/core && pnpm test -- test/cdp.test.ts
```

Expected: all cdp tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cdp.ts packages/core/test/cdp.test.ts
git commit -m "feat(core): port CDP normalizers from playwright"
```

---

## Task 3: Port `snapshot.ts` to core

Moves from `packages/vite/src/snapshot.ts` to `packages/core/src/snapshot.ts`. The `plugins` parameter is removed (no plugin system in 2.0), and `callFrames` becomes optional.

**Files:**
- Create: `packages/core/src/snapshot.ts`
- Create: `packages/core/test/snapshot.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/snapshot.test.ts` — adapted from `packages/vite/test/snapshot.test.ts`, dropping all plugin-related tests and updating to optional callFrames:

```ts
import { describe, it, expect, vi } from 'vitest'
import { takeSnapshot } from '../src/snapshot.js'

function makeMockCdp(overrides: Record<string, unknown> = {}) {
  return {
    send: vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      if (method === 'DOM.getDocument') return Promise.resolve({ root: { nodeId: 1 } })
      if (method === 'DOM.getOuterHTML') return Promise.resolve({ outerHTML: '<html/>' })
      if (method === 'Runtime.evaluate') {
        const expr = params?.expression as string
        if (expr === 'location.pathname') return Promise.resolve({ result: { value: '/home' } })
        return Promise.resolve({ result: { value: null } })
      }
      if (method === 'Runtime.getProperties') return Promise.resolve({ result: [] })
      return Promise.resolve({})
    }),
    ...overrides,
  }
}

describe('takeSnapshot', () => {
  it('returns a snapshot with required fields', async () => {
    const snap = await takeSnapshot({ cdpSession: makeMockCdp(), trigger: 'js.error', url: '/home' })
    expect(snap.trigger).toBe('js.error')
    expect(snap.url).toBe('/home')
    expect(snap.dom).toBe('<html/>')
    expect(snap.scopes).toEqual([])
    expect(snap.globals).toBeInstanceOf(Object)
  })

  it('omits plugins field entirely', async () => {
    const snap = await takeSnapshot({ cdpSession: makeMockCdp(), trigger: 'manual', url: '/' })
    expect('plugins' in snap).toBe(false)
  })

  it('resolves successfully when CDP calls fail (non-fatal)', async () => {
    const snap = await takeSnapshot({
      cdpSession: { send: vi.fn().mockRejectedValue(new Error('CDP error')) },
      trigger: 'js.error',
      url: '/fail',
    })
    expect(snap.dom).toBe('')
    expect(snap.scopes).toEqual([])
  })

  it('traverses call frames and scope chain when provided', async () => {
    const mockCdp = makeMockCdp({
      send: vi.fn().mockImplementation((method: string) => {
        if (method === 'DOM.getDocument') return Promise.resolve({ root: { nodeId: 1 } })
        if (method === 'DOM.getOuterHTML') return Promise.resolve({ outerHTML: '<html/>' })
        if (method === 'Runtime.evaluate') return Promise.resolve({ result: { value: null } })
        if (method === 'Runtime.getProperties') return Promise.resolve({ result: [{ name: 'x', value: { value: 42 } }] })
        return Promise.resolve({})
      })
    })
    const frame = {
      callFrameId: 'cf1', functionName: 'handleSubmit', url: 'auth.ts',
      location: { scriptId: 's1', lineNumber: 41, columnNumber: 0 },
      scopeChain: [{ type: 'local', object: { objectId: 'obj1' } }]
    }
    const snap = await takeSnapshot({ cdpSession: mockCdp, trigger: 'js.error', url: '/login', callFrames: [frame as never] })
    expect(snap.scopes).toHaveLength(1)
    expect(snap.scopes[0].frame).toBe('handleSubmit (auth.ts:42)')
    expect(snap.scopes[0].locals).toEqual({ x: 42 })
  })

  it('skips scope capture when callFrames is absent', async () => {
    const snap = await takeSnapshot({ cdpSession: makeMockCdp(), trigger: 'manual', url: '/' })
    expect(snap.scopes).toEqual([])
  })

  it('populates globals', async () => {
    const mockCdp = {
      send: vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'DOM.getDocument') return Promise.resolve({ root: { nodeId: 1 } })
        if (method === 'DOM.getOuterHTML') return Promise.resolve({ outerHTML: '' })
        if (method === 'Runtime.evaluate') {
          const expr = params?.expression as string
          if (expr === 'location.pathname') return Promise.resolve({ result: { value: '/app' } })
          if (expr === 'localStorage') return Promise.resolve({ result: { value: { token: 'abc' } } })
          if (expr === 'sessionStorage') return Promise.resolve({ result: { value: {} } })
        }
        return Promise.resolve({})
      })
    }
    const snap = await takeSnapshot({ cdpSession: mockCdp, trigger: 'js.error', url: '/app' })
    expect(snap.globals['location.pathname']).toBe('/app')
    expect(snap.globals['localStorage']).toEqual({ token: 'abc' })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/core && pnpm test -- test/snapshot.test.ts
```

Expected: FAIL — `../src/snapshot.js` not found.

- [ ] **Step 3: Create `packages/core/src/snapshot.ts`**

Copy from `packages/vite/src/snapshot.ts`, then remove the `plugins` parameter from `TakeSnapshotOptions` and from `takeSnapshot`, make `callFrames` optional, and remove the `plugins` field from the return value:

```ts
import type { OnErrorSnapshot, ScopeFrame } from '@introspection/types'

interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
}

interface CallFrame {
  callFrameId: string
  functionName: string
  url: string
  location: { scriptId: string; lineNumber: number; columnNumber: number }
  scopeChain: Array<{ type: string; object: { objectId?: string } }>
}

interface TakeSnapshotOptions {
  cdpSession: CdpSession
  trigger: OnErrorSnapshot['trigger']
  url: string
  callFrames?: CallFrame[]
}

export async function takeSnapshot(options: TakeSnapshotOptions): Promise<OnErrorSnapshot> {
  const { cdpSession, trigger, url, callFrames = [] } = options

  let dom = ''
  try {
    const { root } = await cdpSession.send('DOM.getDocument') as { root: { nodeId: number } }
    const { outerHTML } = await cdpSession.send('DOM.getOuterHTML', { nodeId: root.nodeId }) as { outerHTML: string }
    dom = outerHTML
  } catch { /* non-fatal */ }

  const scopes: ScopeFrame[] = []
  for (const frame of callFrames.slice(0, 5)) {
    const locals: Record<string, unknown> = {}
    for (const scope of frame.scopeChain.slice(0, 3)) {
      if (!scope.object.objectId) continue
      try {
        const { result } = await cdpSession.send('Runtime.getProperties', {
          objectId: scope.object.objectId,
          ownProperties: true,
        }) as { result: Array<{ name: string; value?: { value?: unknown; description?: string } }> }
        for (const prop of result.slice(0, 20)) {
          locals[prop.name] = prop.value?.value ?? prop.value?.description ?? undefined
        }
      } catch { /* non-fatal */ }
    }
    scopes.push({ frame: `${frame.functionName} (${frame.url}:${frame.location.lineNumber + 1})`, locals })
  }

  const globals: Record<string, unknown> = {}
  for (const expr of ['location.pathname', 'localStorage', 'sessionStorage']) {
    try {
      const { result } = await cdpSession.send('Runtime.evaluate', {
        expression: expr, returnByValue: true, silent: true,
      }) as { result: { value?: unknown } }
      globals[expr] = result.value
    } catch { /* non-fatal */ }
  }

  return { ts: Date.now(), trigger, url, dom, scopes, globals }
}
```

Note: `plugins` field is gone from the return value — update `OnErrorSnapshot` type in Task 6.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/core && pnpm test -- test/snapshot.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/snapshot.ts packages/core/test/snapshot.test.ts
git commit -m "feat(core): port snapshot, drop plugins param"
```

---

## Task 4: Rewrite `session-writer.ts` in core

The session-writer moves from `packages/vite/src/session-writer.ts` to `packages/core/src/session-writer.ts` with these changes:
- `appendEvent` drops the `bodyMap` param — asset writing is now separate
- `writeBody` and `writeSnapshot` replaced by a single `writeAsset({ directory, name, kind, content, metadata })` → returns relative path `assets/<uuid>.<kind>.json`
- All sidecar files go into `assets/` — no more `bodies/` or `snapshots/` subdirectories

**Files:**
- Create: `packages/core/src/session-writer.ts`
- Create: `packages/core/test/session-writer.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/session-writer.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { initSessionDir, appendEvent, writeAsset, finalizeSession } from '../src/session-writer.js'
import type { TraceEvent } from '@introspection/types'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-sw-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const initParams = { id: 'sess-1', startedAt: 1000, label: 'my test' }

describe('initSessionDir', () => {
  it('creates session directory, meta.json, and empty events.ndjson', async () => {
    await initSessionDir(dir, initParams)
    const meta = JSON.parse(await readFile(join(dir, 'sess-1', 'meta.json'), 'utf-8'))
    expect(meta.id).toBe('sess-1')
    expect(meta.version).toBe('2')
    expect(meta.startedAt).toBe(1000)
    const ndjson = await readFile(join(dir, 'sess-1', 'events.ndjson'), 'utf-8')
    expect(ndjson).toBe('')
  })

  it('creates assets directory', async () => {
    await initSessionDir(dir, initParams)
    const entries = await readdir(join(dir, 'sess-1'))
    expect(entries).toContain('assets')
  })
})

describe('appendEvent', () => {
  it('appends events as newline-terminated JSON lines', async () => {
    await initSessionDir(dir, initParams)
    const e1: TraceEvent = { id: 'e1', type: 'mark', ts: 10, source: 'agent', data: { label: 'start' } }
    const e2: TraceEvent = { id: 'e2', type: 'mark', ts: 20, source: 'agent', data: { label: 'end' } }
    await appendEvent(dir, 'sess-1', e1)
    await appendEvent(dir, 'sess-1', e2)
    const lines = (await readFile(join(dir, 'sess-1', 'events.ndjson'), 'utf-8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toMatchObject({ id: 'e1' })
    expect(JSON.parse(lines[1])).toMatchObject({ id: 'e2' })
  })
})

describe('writeAsset', () => {
  it('writes content to assets/<uuid>.<kind>.json and returns the relative path', async () => {
    await initSessionDir(dir, initParams)
    const path = await writeAsset({ directory: dir, name: 'sess-1', kind: 'body', content: '{"ok":true}', metadata: { timestamp: 10 } })
    expect(path).toMatch(/^assets\/[a-f0-9]+\.body\.json$/)
    const content = await readFile(join(dir, 'sess-1', path), 'utf-8')
    expect(content).toBe('{"ok":true}')
  })

  it('appends an asset event to events.ndjson', async () => {
    await initSessionDir(dir, initParams)
    const path = await writeAsset({ directory: dir, name: 'sess-1', kind: 'snapshot', content: '{}', metadata: { timestamp: 50, trigger: 'js.error', url: '/login', scopeCount: 2 } })
    const lines = (await readFile(join(dir, 'sess-1', 'events.ndjson'), 'utf-8')).trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    const evt = JSON.parse(lines[0])
    expect(evt.type).toBe('asset')
    expect(evt.ts).toBe(50)
    expect(evt.data.path).toBe(path)
    expect(evt.data.kind).toBe('snapshot')
    expect(evt.data.trigger).toBe('js.error')
    expect(evt.data.scopeCount).toBe(2)
  })

  it('generates unique paths for multiple assets of the same kind', async () => {
    await initSessionDir(dir, initParams)
    const p1 = await writeAsset({ directory: dir, name: 'sess-1', kind: 'snapshot', content: '{"a":1}', metadata: { timestamp: 1 } })
    const p2 = await writeAsset({ directory: dir, name: 'sess-1', kind: 'snapshot', content: '{"b":2}', metadata: { timestamp: 2 } })
    expect(p1).not.toBe(p2)
  })

  it('filename contains the kind segment', async () => {
    await initSessionDir(dir, initParams)
    const path = await writeAsset({ directory: dir, name: 'sess-1', kind: 'webgl-state', content: '{}', metadata: { timestamp: 0 } })
    expect(path).toContain('.webgl-state.json')
  })
})

describe('finalizeSession', () => {
  it('updates meta.json with endedAt', async () => {
    await initSessionDir(dir, initParams)
    await finalizeSession(dir, 'sess-1', 2000)
    const meta = JSON.parse(await readFile(join(dir, 'sess-1', 'meta.json'), 'utf-8'))
    expect(meta.endedAt).toBe(2000)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/core && pnpm test -- test/session-writer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `packages/core/src/session-writer.ts`**

```ts
import { writeFile, mkdir, appendFile, readFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { TraceEvent, SessionMeta, BodySummary } from '@introspection/types'

export interface SessionInitParams {
  id: string
  startedAt: number
  label?: string
}

export function summariseBody(raw: string): BodySummary {
  let parsed: Record<string, unknown>
  try {
    const p = JSON.parse(raw)
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      return { keys: [], scalars: {}, arrays: {}, errorFields: {} }
    }
    parsed = p
  } catch { return { keys: [], scalars: {}, arrays: {}, errorFields: {} } }

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

export async function initSessionDir(outDir: string, params: SessionInitParams): Promise<void> {
  const sessionDir = join(outDir, params.id)
  await mkdir(join(sessionDir, 'assets'), { recursive: true })
  const meta: SessionMeta = { version: '2', id: params.id, startedAt: params.startedAt, label: params.label }
  await writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2))
  await writeFile(join(sessionDir, 'events.ndjson'), '')
}

export async function appendEvent(outDir: string, sessionId: string, event: TraceEvent): Promise<void> {
  await appendFile(join(outDir, sessionId, 'events.ndjson'), JSON.stringify(event) + '\n')
}

/** Writes content to assets/<uuid>.<kind>.<ext>, appends an asset event, and returns the relative path. */
export async function writeAsset(opts: {
  directory: string
  name: string
  kind: string
  content: string | Buffer
  ext?: string
  metadata: { timestamp: number; [key: string]: unknown }
}): Promise<string> {
  const { directory, name, kind, content, ext = 'json', metadata } = opts
  const uuid = randomUUID().replace(/-/g, '').slice(0, 8)
  const filename = `${uuid}.${kind}.${ext}`
  const path = `assets/${filename}`
  await writeFile(join(directory, name, path), content)
  const { timestamp, ...rest } = metadata
  const event = {
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    type: 'asset' as const,
    ts: timestamp,
    source: 'agent' as const,
    data: { path, kind, ...rest },
  }
  await appendFile(join(directory, name, 'events.ndjson'), JSON.stringify(event) + '\n')
  return path
}

export async function finalizeSession(outDir: string, sessionId: string, endedAt: number): Promise<void> {
  const metaPath = join(outDir, sessionId, 'meta.json')
  const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as SessionMeta
  meta.endedAt = endedAt
  await writeFile(metaPath, JSON.stringify(meta, null, 2))
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/core && pnpm test -- test/session-writer.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session-writer.ts packages/core/test/session-writer.test.ts
git commit -m "feat(core): session-writer with unified writeAsset and assets/ directory"
```

---

## Task 5: Rewrite `eval-socket.ts` in core

The eval socket is rewritten to read `events.ndjson` from disk on each query instead of using in-memory sessions. The signature changes from `(socketPath, getSessions)` to `(socketPath, ndjsonPath)`.

**Files:**
- Create: `packages/core/src/eval-socket.ts`
- Create: `packages/core/test/eval-socket.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/eval-socket.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createEvalSocket } from '../src/eval-socket.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-eval-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function connectToSocket(socketPath: string) {
  const { createConnection } = await import('net')
  const socket = await new Promise<import('net').Socket>((resolve, reject) => {
    let attempts = 0
    const tryConnect = () => {
      const conn = createConnection(socketPath)
      conn.once('connect', () => resolve(conn))
      conn.once('error', () => {
        conn.destroy()
        if (++attempts < 20) setTimeout(tryConnect, 10)
        else reject(new Error(`Could not connect to ${socketPath}`))
      })
    }
    tryConnect()
  })
  let buf = ''
  const pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void }>()
  socket.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
    let nl
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
      const msg: { id: string; result?: unknown; error?: string } = JSON.parse(line)
      const p = pending.get(msg.id); if (!p) continue; pending.delete(msg.id)
      if (msg.error !== undefined) p.reject(new Error(msg.error)); else p.resolve(msg.result)
    }
  })
  return {
    eval(expr: string): Promise<unknown> {
      return new Promise((res, rej) => {
        const id = Math.random().toString(36).slice(2)
        pending.set(id, { resolve: res, reject: rej })
        socket.write(JSON.stringify({ id, type: 'eval', expression: expr }) + '\n')
      })
    },
    close() { socket.destroy() },
  }
}

async function writeNdjson(path: string, events: unknown[]): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, events.map(e => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''))
}

describe('createEvalSocket', () => {
  it('evaluates a simple expression against ndjson events', async () => {
    const ndjsonPath = join(dir, 'events.ndjson')
    await writeNdjson(ndjsonPath, [
      { id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'hi' } },
    ])
    const sock = createEvalSocket(join(dir, '.socket'), ndjsonPath)
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events.length')).toBe(1)
    client.close()
    await sock.shutdown()
  })

  it('accesses event properties', async () => {
    const ndjsonPath = join(dir, 'events.ndjson')
    await writeNdjson(ndjsonPath, [
      { id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'checkpoint' } },
    ])
    const sock = createEvalSocket(join(dir, '.socket'), ndjsonPath)
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events[0].data.label')).toBe('checkpoint')
    client.close()
    await sock.shutdown()
  })

  it('returns error for invalid expression', async () => {
    const ndjsonPath = join(dir, 'events.ndjson')
    await writeNdjson(ndjsonPath, [])
    const sock = createEvalSocket(join(dir, '.socket'), ndjsonPath)
    const client = await connectToSocket(join(dir, '.socket'))
    await expect(client.eval('!!!invalid(((')).rejects.toThrow()
    client.close()
    await sock.shutdown()
  })

  it('returns empty events when ndjson is empty', async () => {
    const ndjsonPath = join(dir, 'events.ndjson')
    await writeNdjson(ndjsonPath, [])
    const sock = createEvalSocket(join(dir, '.socket'), ndjsonPath)
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events.length')).toBe(0)
    client.close()
    await sock.shutdown()
  })

  it('reads updated events on subsequent queries', async () => {
    const ndjsonPath = join(dir, 'events.ndjson')
    await writeNdjson(ndjsonPath, [{ id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'a' } }])
    const sock = createEvalSocket(join(dir, '.socket'), ndjsonPath)
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events.length')).toBe(1)
    // append another event
    await writeNdjson(ndjsonPath, [
      { id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'a' } },
      { id: 'e2', type: 'mark', ts: 1, source: 'agent', data: { label: 'b' } },
    ])
    expect(await client.eval('events.length')).toBe(2)
    client.close()
    await sock.shutdown()
  })

  it('shutdown removes the socket file', async () => {
    const { existsSync } = await import('fs')
    const ndjsonPath = join(dir, 'events.ndjson')
    await writeNdjson(ndjsonPath, [])
    const socketPath = join(dir, '.socket')
    const sock = createEvalSocket(socketPath, ndjsonPath)
    await sock.shutdown()
    expect(existsSync(socketPath)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/core && pnpm test -- test/eval-socket.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `packages/core/src/eval-socket.ts`**

```ts
import { createServer } from 'net'
import { existsSync, unlinkSync } from 'fs'
import { unlink, readFile } from 'fs/promises'
import { runInNewContext } from 'vm'

export interface EvalSocket {
  shutdown(): Promise<void>
}

export function createEvalSocket(socketPath: string, ndjsonPath: string): EvalSocket {
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
          let events: unknown[] = []
          try {
            const raw = await readFile(ndjsonPath, 'utf-8')
            events = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
          } catch { /* file may not exist yet */ }
          try {
            const raw = runInNewContext(msg.expression, { events })
            const result = raw != null && typeof raw.then === 'function' ? await raw : raw
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

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/core && pnpm test -- test/eval-socket.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/eval-socket.ts packages/core/test/eval-socket.test.ts
git commit -m "feat(core): eval-socket reads ndjson from disk"
```

---

## Task 6: Trim `@introspection/types`

Remove plugin interfaces, RPC types, `IntrospectionConfig`, and `shallowChangedKeys`. Update `OnErrorSnapshot` (drop `plugins` field, update `trigger` union). Simplify `DetachResult`.

**Files:**
- Modify: `packages/types/src/index.ts`
- Create: `packages/types/test/index.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/types/test/index.test.ts`:
```ts
import { describe, it, expectTypeOf } from 'vitest'
import type { TraceEvent, OnErrorSnapshot, DetachResult } from '../src/index.js'

describe('@introspection/types 2.0', () => {
  it('TraceEvent does not include PluginEvent or SessionEndEvent', () => {
    // These type assertions fail to compile if the union includes the wrong types
    type NoPlugin = Extract<TraceEvent, { type: `plugin.${string}` }>
    type NoSessionEnd = Extract<TraceEvent, { type: 'session.end' }>
    expectTypeOf<NoPlugin>().toBeNever()
    expectTypeOf<NoSessionEnd>().toBeNever()
  })

  it('OnErrorSnapshot trigger is limited to js.error | manual', () => {
    type Trigger = OnErrorSnapshot['trigger']
    expectTypeOf<'js.error'>().toMatchTypeOf<Trigger>()
    expectTypeOf<'manual'>().toMatchTypeOf<Trigger>()
    // 'playwright.assertion' should no longer be assignable
    expectTypeOf<Trigger>().not.toEqualTypeOf<'playwright.assertion'>()
  })

  it('DetachResult has simplified status union', () => {
    type Status = DetachResult['status']
    expectTypeOf<Status>().toEqualTypeOf<'passed' | 'failed' | 'timedOut'>()
  })

  it('AssetEvent is in TraceEvent union', () => {
    type Asset = Extract<TraceEvent, { type: 'asset' }>
    expectTypeOf<Asset>().not.toBeNever()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL (types not yet updated)**

```bash
pnpm --filter @introspection/types test
```

Expected: compilation errors on the `toBeNever()` and `toEqualTypeOf` assertions.

- [ ] **Step 3: Edit `packages/types/src/index.ts`**

Remove these exports entirely:
- `BrowserAgent` interface
- `IntrospectionPlugin` interface
- `IntrospectionServerMethods` interface
- `PlaywrightClientMethods` interface
- `BrowserClientMethods` type
- `CaptureConfig` interface
- `IntrospectionConfig` interface
- `shallowChangedKeys` function
- `TraceFile` interface (not referenced from playwright or core)
- `PluginEvent` interface (plugin system is deferred in 2.0)
- `SessionEndEvent` interface (session end is recorded in `meta.json` via `finalizeSession`, not as a stream event)

Update `OnErrorSnapshot`:
```ts
export interface OnErrorSnapshot {
  ts: number
  trigger: 'js.error' | 'manual'   // removed 'playwright.assertion'
  url: string
  dom: string
  scopes: ScopeFrame[]
  globals: Record<string, unknown>
  // 'plugins' field removed
}
```

Add `AssetEvent` and add it to the `TraceEvent` union:
```ts
export interface AssetEvent extends BaseEvent {
  type: 'asset'
  data: {
    path: string           // relative to session dir: 'assets/<uuid>.<kind>.json'
    kind: string           // 'body' | 'snapshot' | 'screenshot' | 'webgl-state' | ...
    summary?: BodySummary  // for kind='body'
    trigger?: string       // for kind='snapshot'
    url?: string           // for kind='snapshot'
    scopeCount?: number    // for kind='snapshot'
  }
}

export type TraceEvent =
  | NetworkRequestEvent
  | NetworkResponseEvent
  | NetworkErrorEvent
  | JsErrorEvent
  | BrowserNavigateEvent
  | MarkEvent
  | PlaywrightActionEvent
  | PlaywrightResultEvent
  | AssetEvent
```

Update `DetachResult`:
```ts
export interface DetachResult {
  status: 'passed' | 'failed' | 'timedOut'
  error?: string
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @introspection/types test
```

Expected: all type assertions pass.

- [ ] **Step 5: Run the full test suite to catch any breakage**

```bash
cd /path/to/repo && pnpm test
```

Expected: CLI tests, playwright tests, and core tests all pass. Plugin package tests may fail — they're being deleted anyway.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/index.ts packages/types/test/index.test.ts
git commit -m "feat(types): trim plugin interfaces and RPC types for 2.0"
```

---

## Task 7: Rewrite `@introspection/playwright/attach.ts`

Complete rewrite. No Vite, no WebSocket, no RPC. Uses `@introspection/core` directly. Writes to disk via `initSessionDir`, `appendEvent`, `writeAsset`, `summariseBody`, `finalizeSession`. Creates eval socket inside the session directory.

**Files:**
- Modify: `packages/playwright/src/attach.ts`
- Modify: `packages/playwright/test/attach.test.ts`

- [ ] **Step 1: Rewrite the tests first**

`packages/playwright/test/attach.test.ts` — completely replace with disk-based tests:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '../src/attach.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-pw-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function makeFakePage() {
  const cdpListeners: Record<string, (params: unknown) => void> = {}
  const mockCdp = {
    send: vi.fn().mockResolvedValue({}),
    on: vi.fn((event: string, cb: (params: unknown) => void) => { cdpListeners[event] = cb }),
    detach: vi.fn().mockResolvedValue(undefined),
  }
  return {
    page: {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue(mockCdp) }),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue('http://localhost/'),
    } as never,
    cdp: mockCdp,
    trigger: (event: string, params: unknown) => cdpListeners[event]?.(params),
  }
}

describe('attach()', () => {
  it('returns IntrospectHandle with page, mark, snapshot, detach', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page, { outDir: dir, testTitle: 'test' })
    expect(handle.page).toBeDefined()
    expect(typeof handle.mark).toBe('function')
    expect(typeof handle.snapshot).toBe('function')
    expect(typeof handle.detach).toBe('function')
    await handle.detach()
  })

  it('creates session directory with meta.json and events.ndjson', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page, { outDir: dir, testTitle: 'my test' })
    await handle.detach()
    const entries = await readdir(dir)
    expect(entries.length).toBe(1) // one session dir
    const sessionDir = join(dir, entries[0])
    const meta = JSON.parse(await readFile(join(sessionDir, 'meta.json'), 'utf-8'))
    expect(meta.label).toBe('my test')
    expect(meta.endedAt).toBeDefined()
    const ndjson = await readFile(join(sessionDir, 'events.ndjson'), 'utf-8')
    expect(typeof ndjson).toBe('string')
  })

  it('mark() appends a mark event to events.ndjson', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page, { outDir: dir })
    handle.mark('step 1', { extra: true })
    await new Promise(r => setTimeout(r, 10)) // let async write settle
    await handle.detach()
    const entries = await readdir(dir)
    const ndjson = await readFile(join(dir, entries[0], 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').map(l => JSON.parse(l))
    const mark = events.find((e: { type: string }) => e.type === 'mark')
    expect(mark).toBeDefined()
    expect(mark.data.label).toBe('step 1')
  })

  it('detach() writes playwright.result event when result is passed', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page, { outDir: dir })
    await handle.detach({ status: 'failed', error: 'assertion failed' })
    const entries = await readdir(dir)
    const ndjson = await readFile(join(dir, entries[0], 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').map(l => JSON.parse(l))
    const result = events.find((e: { type: string }) => e.type === 'playwright.result')
    expect(result).toBeDefined()
    expect(result.data.status).toBe('failed')
  })

  it('Network.requestWillBeSent appends network.request event', async () => {
    const { page, trigger } = makeFakePage()
    const handle = await attach(page, { outDir: dir })
    trigger('Network.requestWillBeSent', {
      requestId: 'req-1',
      request: { url: '/api/test', method: 'GET', headers: {} },
      timestamp: 100,
    })
    await new Promise(r => setTimeout(r, 10))
    await handle.detach()
    const entries = await readdir(dir)
    const ndjson = await readFile(join(dir, entries[0], 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').map(l => JSON.parse(l))
    const req = events.find((e: { type: string }) => e.type === 'network.request')
    expect(req).toBeDefined()
    expect(req.data.url).toBe('/api/test')
  })

  it('Runtime.exceptionThrown appends js.error event', async () => {
    const { page, cdp, trigger } = makeFakePage()
    cdp.send.mockImplementation((method: string) => {
      if (method === 'DOM.getDocument') return Promise.resolve({ root: { nodeId: 1 } })
      if (method === 'DOM.getOuterHTML') return Promise.resolve({ outerHTML: '<html/>' })
      return Promise.resolve({})
    })
    const handle = await attach(page, { outDir: dir })
    trigger('Runtime.exceptionThrown', {
      timestamp: 200,
      exceptionDetails: {
        text: 'TypeError',
        exception: { description: 'TypeError: oops' },
        stackTrace: { callFrames: [] },
      },
    })
    await new Promise(r => setTimeout(r, 50))
    await handle.detach()
    const entries = await readdir(dir)
    const ndjson = await readFile(join(dir, entries[0], 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').map(l => JSON.parse(l))
    const err = events.find((e: { type: string }) => e.type === 'js.error')
    expect(err).toBeDefined()
    expect(err.data.message).toBe('TypeError: oops')
  })

  it('creates eval socket inside session directory', async () => {
    const { existsSync } = await import('fs')
    const { page } = makeFakePage()
    const handle = await attach(page, { outDir: dir })
    const entries = await readdir(dir)
    const socketPath = join(dir, entries[0], '.socket')
    expect(existsSync(socketPath)).toBe(true)
    await handle.detach()
    expect(existsSync(socketPath)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/playwright && pnpm test -- test/attach.test.ts
```

Expected: FAIL — old `attach.ts` requires Vite connection.

- [ ] **Step 3: Rewrite `packages/playwright/src/attach.ts`**

```ts
import { randomUUID } from 'crypto'
import type { Page } from '@playwright/test'
import type { TraceEvent, IntrospectHandle, DetachResult, ScopeFrame } from '@introspection/types'
import {
  initSessionDir, appendEvent, writeAsset, summariseBody, finalizeSession,
  normaliseCdpNetworkRequest, normaliseCdpNetworkResponse, normaliseCdpJsError,
  takeSnapshot, createEvalSocket,
} from '@introspection/core'
import { createPageProxy } from './proxy.js'
import { join } from 'path'

export interface AttachOptions {
  outDir?: string
  testTitle?: string
  workerIndex?: number
}

export async function attach(page: Page, opts: AttachOptions = {}): Promise<IntrospectHandle> {
  const sessionId = randomUUID()
  const outDir = opts.outDir ?? '.introspect'
  const testTitle = opts.testTitle ?? 'unknown test'
  const startedAt = Date.now()

  await initSessionDir(outDir, { id: sessionId, startedAt, label: testTitle })

  const cdp = await page.context().newCDPSession(page)

  function ts(): number { return Date.now() - startedAt }

  function emit(event: Omit<TraceEvent, 'id' | 'ts'> & { id?: string; ts?: number }) {
    void appendEvent(outDir, sessionId, { id: randomUUID(), ts: ts(), ...event } as TraceEvent)
  }

  await cdp.send('Network.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Debugger.enable')
  await cdp.send('DOM.enable')
  await cdp.send('Debugger.setPauseOnExceptions', { state: 'uncaught' })

  // Scope capture: happens while debugger is paused so objectIds are valid
  let pendingSnapshot: { scopes: ScopeFrame[] } | null = null

  cdp.on('Debugger.paused', (params: {
    reason: string
    callFrames?: Array<{ functionName: string; url: string; location: { lineNumber: number }; scopeChain: Array<{ type: string; object: { objectId?: string } }> }>
  }) => {
    if (!['exception', 'promiseRejection'].includes(params.reason)) {
      void cdp.send('Debugger.resume')
      return
    }
    void (async () => {
      const scopes: ScopeFrame[] = []
      for (const frame of (params.callFrames ?? []).slice(0, 5)) {
        const locals: Record<string, unknown> = {}
        for (const scope of frame.scopeChain.slice(0, 3)) {
          if (!scope.object.objectId) continue
          try {
            const { result } = await cdp.send('Runtime.getProperties', {
              objectId: scope.object.objectId, ownProperties: true,
            }) as { result: Array<{ name: string; value?: { type?: string; value?: unknown; description?: string; objectId?: string } }> }
            for (const prop of result.slice(0, 20)) {
              const v = prop.value
              if (!v) { locals[prop.name] = undefined; continue }
              locals[prop.name] = v.value ?? v.description ?? undefined
            }
          } catch { /* non-fatal */ }
        }
        scopes.push({ frame: `${frame.functionName || '(anonymous)'} (${frame.url}:${frame.location.lineNumber + 1})`, locals })
      }
      pendingSnapshot = { scopes }
      await cdp.send('Debugger.resume')
    })()
  })

  cdp.on('Network.requestWillBeSent', (params) => {
    emit(normaliseCdpNetworkRequest(params as never, startedAt))
  })

  const pendingResponses = new Map<string, ReturnType<typeof normaliseCdpNetworkResponse>>()

  cdp.on('Network.responseReceived', (params) => {
    pendingResponses.set((params as { requestId: string }).requestId, normaliseCdpNetworkResponse(params as never, startedAt))
  })

  cdp.on('Network.loadingFinished', (params: { requestId: string }) => {
    const responseEvent = pendingResponses.get(params.requestId)
    if (!responseEvent) return
    pendingResponses.delete(params.requestId)
    void (async () => {
      try {
        const result = await cdp.send('Network.getResponseBody', { requestId: params.requestId }) as { body: string; base64Encoded: boolean }
        const body = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf-8') : result.body
        const summary = summariseBody(body)
        await writeAsset({ directory: outDir, name: sessionId, kind: 'body', content: body, metadata: { timestamp: ts(), summary } })
        await appendEvent(outDir, sessionId, { ...responseEvent, data: { ...responseEvent.data, bodySummary: summary } })
      } catch {
        await appendEvent(outDir, sessionId, responseEvent)
      }
    })()
  })

  cdp.on('Network.loadingFailed', (params: { requestId: string }) => {
    const responseEvent = pendingResponses.get(params.requestId)
    if (responseEvent) { pendingResponses.delete(params.requestId); void appendEvent(outDir, sessionId, responseEvent) }
  })

  cdp.on('Runtime.exceptionThrown', (params) => {
    // Emit js.error after the snapshot asset is written so the asset event
    // precedes the js.error event in events.ndjson (consistent ordering guarantee)
    void (async () => {
      const captured = pendingSnapshot
      pendingSnapshot = null
      const snap = await takeSnapshot({
        cdpSession: { send: (method: string, p?: Record<string, unknown>) => cdp.send(method as never, p as never) },
        trigger: 'js.error',
        url: await page.evaluate(() => location.href).catch(() => ''),
        callFrames: [],
      })
      const mergedSnap = captured ? { ...snap, scopes: captured.scopes } : snap
      await writeAsset({ directory: outDir, name: sessionId, kind: 'snapshot', content: JSON.stringify(mergedSnap), metadata: {
        timestamp: ts(), trigger: 'js.error', url: mergedSnap.url, scopeCount: mergedSnap.scopes.length,
      } })
      emit(normaliseCdpJsError(params as never, startedAt))
    })()
  })

  const evalSocket = createEvalSocket(
    join(outDir, sessionId, '.socket'),
    join(outDir, sessionId, 'events.ndjson'),
  )

  const proxiedPage = createPageProxy(page, (evt) => emit(evt as never))

  return {
    page: proxiedPage,
    mark(label: string, data?: Record<string, unknown>) {
      emit({ type: 'mark', source: 'agent', data: { label, extra: data } })
    },
    async snapshot() {
      const snap = await takeSnapshot({
        cdpSession: { send: (method: string, p?: Record<string, unknown>) => cdp.send(method as never, p as never) },
        trigger: 'manual',
        url: await page.evaluate(() => location.href).catch(() => ''),
      })
      await writeAsset({ directory: outDir, name: sessionId, kind: 'snapshot', content: JSON.stringify(snap), metadata: {
        timestamp: ts(), trigger: 'manual', url: snap.url, scopeCount: snap.scopes.length,
      } })
    },
    async detach(result?: DetachResult) {
      if (result) emit({ type: 'playwright.result', source: 'playwright', data: result })
      await finalizeSession(outDir, sessionId, Date.now())
      await evalSocket.shutdown()
      try { await cdp.detach() } catch { /* non-fatal */ }
    },
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/playwright && pnpm test -- test/attach.test.ts
```

- [ ] **Step 5: Run all playwright tests**

```bash
cd packages/playwright && pnpm test
```

Expected: `proxy.test.ts` and `attach.test.ts` all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/playwright/src/attach.ts packages/playwright/test/attach.test.ts
git commit -m "feat(playwright): rewrite attach() using core, no Vite/WS"
```

---

## Task 8: Update `@introspection/playwright` package.json

Remove dead dependencies, add `@introspection/core`.

**Files:**
- Modify: `packages/playwright/package.json`

- [ ] **Step 1: Update `packages/playwright/package.json`**

```json
{
  "name": "@introspection/playwright",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/attach.ts",
      "import": "./dist/attach.js"
    }
  },
  "scripts": {
    "build": "tsup src/attach.ts --format esm --dts",
    "test": "vitest run"
  },
  "dependencies": {
    "@introspection/core": "workspace:*",
    "@introspection/types": "workspace:*"
  },
  "devDependencies": {
    "@playwright/test": "^1.40.0"
  },
  "peerDependencies": {
    "@playwright/test": ">=1.40.0"
  }
}
```

- [ ] **Step 2: Install and verify**

```bash
cd /path/to/repo && pnpm install && cd packages/playwright && pnpm test
```

Expected: tests still pass, no missing dependency errors.

- [ ] **Step 3: Commit**

```bash
git add packages/playwright/package.json pnpm-lock.yaml
git commit -m "chore(playwright): remove Vite/WS deps, add @introspection/core"
```

---

## Task 9: Delete dead packages and demos

Remove `packages/vite`, `packages/browser`, `packages/plugin-*`, `demos/checkout`, `demos/auth` (if present), and update `pnpm-workspace.yaml`.

**Files:**
- Delete: `packages/vite/`
- Delete: `packages/browser/`
- Delete: `packages/plugin-redux/`
- Delete: `packages/plugin-react/`
- Delete: `packages/plugin-zustand/`
- Delete: `packages/plugin-webgl/`
- Delete: `demos/checkout/`
- Delete: `demos/auth/` (if it exists)
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Delete packages**

```bash
rm -rf packages/vite packages/browser packages/plugin-redux packages/plugin-react packages/plugin-zustand packages/plugin-webgl
rm -rf demos/checkout demos/auth 2>/dev/null || true
```

- [ ] **Step 2: Update `pnpm-workspace.yaml`**

Remove the old `demo` entry if present and ensure only valid paths remain:

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: Run `pnpm install` to prune lockfile**

```bash
cd /path/to/repo && pnpm install
```

Expected: no errors, lockfile updated.

- [ ] **Step 4: Run the full test suite**

```bash
pnpm test
```

Expected: all tests in `packages/core`, `packages/playwright`, `packages/cli`, `packages/playwright-fixture` pass. No references to deleted packages.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete vite, browser, plugin-* packages and checkout demo"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run the complete test suite from repo root**

```bash
cd /path/to/repo && pnpm test
```

Expected: all tests pass, no import errors referencing deleted packages.

- [ ] **Step 2: Verify core has zero non-builtin runtime deps**

```bash
cat packages/core/package.json
```

Expected: `dependencies` contains only `@introspection/types` (workspace). No `ws`, `rpc`, or other external packages.

- [ ] **Step 3: Verify playwright package.json has no Vite/WS deps**

```bash
cat packages/playwright/package.json
```

Expected: no `@bigmistqke/rpc`, `ws`, or `@introspection/vite`.

- [ ] **Step 4: Smoke-test session directory output**

Write a one-off script to verify end-to-end disk output shape:

```bash
node --input-type=module <<'EOF'
import { initSessionDir, appendEvent, writeAsset, summariseBody, finalizeSession } from './packages/core/src/index.js'
import { join } from 'path'
import { mkdtemp, readdir, readFile } from 'fs/promises'
import { tmpdir } from 'os'

const dir = await mkdtemp(join(tmpdir(), 'smoke-'))
const startedAt = Date.now()
await initSessionDir(dir, { id: 'sess-1', startedAt, label: 'smoke test' })
await appendEvent(dir, 'sess-1', { id: 'e1', type: 'mark', ts: 10, source: 'agent', data: { label: 'hi' } })
const bodyRaw = '{"ok":true}'
const summary = summariseBody(bodyRaw)
const bodyPath = await writeAsset({ directory: dir, name: 'sess-1', kind: 'body', content: bodyRaw, metadata: { timestamp: Date.now() - startedAt, summary } })
console.log('Body asset at:', bodyPath)
const snap = { ts: 50, trigger: 'manual', url: '/', dom: '', scopes: [], globals: {} }
const snapPath = await writeAsset({ directory: dir, name: 'sess-1', kind: 'snapshot', content: JSON.stringify(snap), metadata: {
  timestamp: 50, trigger: 'manual', url: '/', scopeCount: 0,
} })
console.log('Snapshot asset at:', snapPath)
await finalizeSession(dir, 'sess-1', Date.now())

const files = await readdir(join(dir, 'sess-1'), { recursive: true })
console.log('Session files:', files)
const ndjson = await readFile(join(dir, 'sess-1', 'events.ndjson'), 'utf-8')
console.log('NDJSON:', ndjson)
EOF
```

Expected output includes: `meta.json`, `events.ndjson`, `assets/<uuid>.body.json`, `assets/<uuid>.snapshot.json`, and the NDJSON should contain `asset` events for both files plus the `mark` event.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final 2.0 cleanup and verification"
```

# Introspection — Plan 2: Plugins & Eval Socket

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live eval socket to the Vite plugin, Redux and React browser plugins, and README usage docs.

**Architecture:** The eval socket is a Unix domain socket created by the Vite plugin alongside the trace output directory. CLI `eval` already speaks this protocol (NDJSON `{id, type, expression}` / `{id, result|error}`); this plan provides the server side. Redux and React plugins are standalone packages that implement the `IntrospectionPlugin` interface and can be dropped into any app.

**Tech Stack:** TypeScript strict ESM, pnpm workspaces, vitest, Node.js `vm` (eval sandbox), `__REACT_DEVTOOLS_GLOBAL_HOOK__` (React fibers, no peer dep required at runtime)

---

## File Structure

```
packages/
  types/src/index.ts                   # Modified: add outDir to IntrospectionConfig
  vite/src/eval-socket.ts              # New: Unix socket NDJSON eval server
  vite/src/index.ts                    # Modified: start eval socket on configureServer
  vite/test/eval-socket.test.ts        # New: eval socket integration tests

  plugin-redux/
    src/index.ts                       # createReduxPlugin(store): IntrospectionPlugin
    test/plugin-redux.test.ts
    package.json
    tsconfig.json
    vitest.config.ts

  plugin-react/
    src/index.ts                       # createReactPlugin(): IntrospectionPlugin
    test/plugin-react.test.ts
    package.json
    tsconfig.json
    vitest.config.ts

README.md
```

---

## Task 1: Eval Socket Server

The CLI `eval` command already dials a Unix socket at `{outDir}/.socket` and sends NDJSON `{ id, type: 'eval', expression }`. This task builds the server side: the Vite plugin creates the socket, evaluates expressions via Node's `vm` against the live session context, and writes back `{ id, result }` or `{ id, error }`.

**Files:**
- Create: `packages/vite/src/eval-socket.ts`
- Modify: `packages/vite/src/index.ts`
- Modify: `packages/types/src/index.ts`
- Create: `packages/vite/test/eval-socket.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/vite/test/eval-socket.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEvalSocket } from '../src/eval-socket.js'
import { connectToSocket } from '../../cli/src/socket-client.js'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Session } from '../src/server.js'

describe('EvalSocket', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-eval-')) })
  afterEach(async () => { await rm(dir, { recursive: true }) })

  function sessions(events: unknown[] = []): () => Session[] {
    return () => [{
      id: 'sess-1', testTitle: 'my test', testFile: 'foo.spec.ts',
      startedAt: Date.now(), events: events as never, ws: null as never,
    }]
  }

  it('evaluates a simple expression and returns the result', async () => {
    const sock = createEvalSocket(join(dir, '.socket'), sessions([
      { id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'hi' } },
    ]))
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events.length')).toBe(1)
    client.close()
    await sock.shutdown()
  })

  it('evaluates an expression that accesses event properties', async () => {
    const sock = createEvalSocket(join(dir, '.socket'), sessions([
      { id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'checkpoint' } },
    ]))
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events[0].data.label')).toBe('checkpoint')
    client.close()
    await sock.shutdown()
  })

  it('returns an error for an invalid expression', async () => {
    const sock = createEvalSocket(join(dir, '.socket'), sessions())
    const client = await connectToSocket(join(dir, '.socket'))
    await expect(client.eval('!!!invalid syntax(((')).rejects.toThrow()
    client.close()
    await sock.shutdown()
  })

  it('returns empty context when no sessions exist', async () => {
    const sock = createEvalSocket(join(dir, '.socket'), () => [])
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events.length')).toBe(0)
    client.close()
    await sock.shutdown()
  })

  it('shutdown removes the socket file', async () => {
    const { existsSync } = await import('fs')
    const socketPath = join(dir, '.socket')
    const sock = createEvalSocket(socketPath, () => [])
    await sock.shutdown()
    expect(existsSync(socketPath)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run packages/vite/test/eval-socket.test.ts
```

Expected: FAIL — `createEvalSocket` not found.

- [ ] **Step 3: Implement `eval-socket.ts`**

```ts
// packages/vite/src/eval-socket.ts
import { createServer } from 'net'
import { existsSync, mkdirSync, unlinkSync } from 'fs'
import { unlink } from 'fs/promises'
import { dirname } from 'path'
import { runInNewContext } from 'vm'
import type { Session } from './server.js'

export interface EvalSocket {
  shutdown(): Promise<void>
}

export function createEvalSocket(socketPath: string, getSessions: () => Session[]): EvalSocket {
  mkdirSync(dirname(socketPath), { recursive: true })
  if (existsSync(socketPath)) unlinkSync(socketPath)

  const server = createServer((conn) => {
    let buffer = ''
    conn.on('data', (chunk) => {
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
          const ctx = session
            ? { events: session.events, snapshot: session.snapshot ?? null, test: { title: session.testTitle, file: session.testFile } }
            : { events: [], snapshot: null, test: null }
          try {
            const result = runInNewContext(msg.expression, ctx)
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

- [ ] **Step 4: Add `outDir` to `IntrospectionConfig` in `packages/types/src/index.ts`**

Find the existing `IntrospectionConfig` interface and add the `outDir` field:

```ts
export interface IntrospectionConfig {
  plugins?: IntrospectionPlugin[]
  capture?: CaptureConfig
  outDir?: string   // output directory for traces and eval socket; default '.introspect'
}
```

- [ ] **Step 5: Wire eval socket into `packages/vite/src/index.ts`**

```ts
import type { Plugin, ViteDevServer } from 'vite'
import type { IntrospectionConfig, StackFrame } from '@introspection/types'
import { createIntrospectionServer, type IntrospectionServer } from './server.js'
import { resolveStackFrame, viteSourceMapProvider } from './source-maps.js'
import { createEvalSocket, type EvalSocket } from './eval-socket.js'
import { join } from 'path'

export function introspection(config: IntrospectionConfig = {}): Plugin {
  let server: IntrospectionServer | undefined
  let evalSocket: EvalSocket | undefined
  const outDir = config.outDir ?? '.introspect'

  return {
    name: 'introspection',
    configureServer(viteServer: ViteDevServer) {
      if (!viteServer.httpServer) return
      const resolveFrame = (frame: StackFrame) =>
        resolveStackFrame(frame, viteSourceMapProvider((id: string) => viteServer.moduleGraph.getModuleById(id)))
      server = createIntrospectionServer(viteServer.httpServer, config, resolveFrame)
      evalSocket = createEvalSocket(join(outDir, '.socket'), () => server?.getSessions() ?? [])
      viteServer.httpServer.once('close', async () => {
        server?.shutdown()
        await evalSocket?.shutdown()
      })
    },
  }
}

export type { IntrospectionServer, Session } from './server.js'
```

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass including the 5 new eval-socket tests.

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/index.ts packages/vite/src/eval-socket.ts packages/vite/src/index.ts packages/vite/test/eval-socket.test.ts
git commit -m "feat(vite): eval socket server — live expression eval against session context"
```

---

## Task 2: Redux Plugin

A standalone package that wraps a Redux store's `dispatch` to emit trace events on every action and exposes the current state as a snapshot.

**Files:**
- Create: `packages/plugin-redux/src/index.ts`
- Create: `packages/plugin-redux/test/plugin-redux.test.ts`
- Create: `packages/plugin-redux/package.json`
- Create: `packages/plugin-redux/tsconfig.json`
- Create: `packages/plugin-redux/vitest.config.ts`

- [ ] **Step 1: Create package scaffolding**

```json
// packages/plugin-redux/package.json
{
  "name": "@introspection/plugin-redux",
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

```json
// packages/plugin-redux/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src", "test"]
}
```

```ts
// packages/plugin-redux/vitest.config.ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { globals: true } })
```

- [ ] **Step 2: Install workspace dependencies**

```bash
pnpm install
```

Expected: workspace symlinks for `@introspection/types` created inside `packages/plugin-redux/node_modules`.

- [ ] **Step 3: Write failing tests**

```ts
// packages/plugin-redux/test/plugin-redux.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createReduxPlugin } from '../src/index.js'
import type { BrowserAgent } from '@introspection/types'

function makeStore(initialState: Record<string, unknown> = {}) {
  let state = { ...initialState }
  return {
    getState: () => state,
    dispatch: vi.fn((action: { type: string; payload?: Record<string, unknown> }) => {
      if (action.payload) state = { ...state, ...action.payload }
      return action
    }),
  }
}

function makeAgent(): { agent: BrowserAgent; emitted: unknown[] } {
  const emitted: unknown[] = []
  return { agent: { emit: vi.fn((e: unknown) => { emitted.push(e) }) }, emitted }
}

describe('createReduxPlugin', () => {
  it('emits plugin.redux.action on each dispatch', () => {
    const store = makeStore({ count: 0 })
    const plugin = createReduxPlugin(store)
    const { agent, emitted } = makeAgent()
    plugin.browser!.setup(agent)
    store.dispatch({ type: 'INCREMENT', payload: { count: 1 } })
    expect(emitted).toHaveLength(1)
    expect((emitted[0] as { type: string }).type).toBe('plugin.redux.action')
  })

  it('includes the action and changedKeys in event data', () => {
    const store = makeStore({ count: 0, name: 'alice' })
    const plugin = createReduxPlugin(store)
    const { agent, emitted } = makeAgent()
    plugin.browser!.setup(agent)
    store.dispatch({ type: 'UPDATE_COUNT', payload: { count: 5 } })
    const evt = emitted[0] as { data: { action: { type: string }; changedKeys: string[] } }
    expect(evt.data.action.type).toBe('UPDATE_COUNT')
    expect(evt.data.changedKeys).toEqual(['count'])
  })

  it('reports no changedKeys when state is unchanged', () => {
    const store = makeStore({ count: 0 })
    const plugin = createReduxPlugin(store)
    const { agent, emitted } = makeAgent()
    plugin.browser!.setup(agent)
    store.dispatch({ type: 'NOOP' })   // no payload — state unchanged
    const evt = emitted[0] as { data: { changedKeys: string[] } }
    expect(evt.data.changedKeys).toEqual([])
  })

  it('snapshot returns current store state', () => {
    const store = makeStore({ user: 'alice', token: 'abc' })
    const plugin = createReduxPlugin(store)
    const { agent } = makeAgent()
    plugin.browser!.setup(agent)
    expect(plugin.browser!.snapshot()).toEqual({ state: { user: 'alice', token: 'abc' } })
  })

  it('snapshot reflects state after dispatch', () => {
    const store = makeStore({ count: 0 })
    const plugin = createReduxPlugin(store)
    const { agent } = makeAgent()
    plugin.browser!.setup(agent)
    store.dispatch({ type: 'INC', payload: { count: 99 } })
    expect((plugin.browser!.snapshot() as { state: { count: number } }).state.count).toBe(99)
  })
})
```

- [ ] **Step 4: Run tests — verify they fail**

```bash
npx vitest run packages/plugin-redux/test
```

Expected: FAIL — `createReduxPlugin` not found.

- [ ] **Step 5: Implement `plugin-redux/src/index.ts`**

```ts
// packages/plugin-redux/src/index.ts
import type { IntrospectionPlugin, BrowserAgent } from '@introspection/types'

interface ReduxStore {
  getState(): unknown
  dispatch(action: unknown): unknown
}

function shallowChangedKeys(before: unknown, after: unknown): string[] {
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return []
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  return [...keys].filter(k => b[k] !== a[k])
}

export function createReduxPlugin(store: ReduxStore): IntrospectionPlugin {
  return {
    name: 'redux',
    browser: {
      setup(agent: BrowserAgent) {
        const originalDispatch = store.dispatch.bind(store)
        store.dispatch = (action: unknown) => {
          const stateBefore = store.getState()
          const result = originalDispatch(action)
          const stateAfter = store.getState()
          agent.emit({
            type: 'plugin.redux.action',
            data: {
              action,
              changedKeys: shallowChangedKeys(stateBefore, stateAfter),
            },
          })
          return result
        }
      },
      snapshot() {
        return { state: store.getState() }
      },
    },
  }
}
```

- [ ] **Step 6: Run tests — verify they pass**

```bash
npx vitest run packages/plugin-redux/test
```

Expected: 5/5 PASS.

- [ ] **Step 7: Run full suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/plugin-redux/
git commit -m "feat: @introspection/plugin-redux — captures Redux actions and state diffs"
```

---

## Task 3: React Plugin

A standalone package that hooks into React's DevTools global hook (`__REACT_DEVTOOLS_GLOBAL_HOOK__`) to emit `plugin.react.commit` events whenever React commits a fiber tree update. Works without React as a runtime dependency — it patches the global that React itself writes to.

**Files:**
- Create: `packages/plugin-react/src/index.ts`
- Create: `packages/plugin-react/test/plugin-react.test.ts`
- Create: `packages/plugin-react/package.json`
- Create: `packages/plugin-react/tsconfig.json`
- Create: `packages/plugin-react/vitest.config.ts`

- [ ] **Step 1: Create package scaffolding**

```json
// packages/plugin-react/package.json
{
  "name": "@introspection/plugin-react",
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

```json
// packages/plugin-react/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src", "test"]
}
```

```ts
// packages/plugin-react/vitest.config.ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { globals: true } })
```

- [ ] **Step 2: Install workspace dependencies**

```bash
pnpm install
```

Expected: workspace symlinks for `@introspection/types` created inside `packages/plugin-react/node_modules`.

- [ ] **Step 3: Write failing tests**

```ts
// packages/plugin-react/test/plugin-react.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createReactPlugin } from '../src/index.js'
import type { BrowserAgent } from '@introspection/types'

type Hook = Record<string, unknown>

function makeAgent(): { agent: BrowserAgent; emitted: unknown[] } {
  const emitted: unknown[] = []
  return { agent: { emit: vi.fn((e: unknown) => { emitted.push(e) }) }, emitted }
}

function makeFiber(name: string, child: unknown = null, sibling: unknown = null) {
  return { type: { displayName: name }, child, sibling }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__']
})

describe('createReactPlugin', () => {
  it('installs __REACT_DEVTOOLS_GLOBAL_HOOK__ when absent', () => {
    const plugin = createReactPlugin()
    const { agent } = makeAgent()
    plugin.browser!.setup(agent)
    expect((globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__']).toBeDefined()
  })

  it('emits plugin.react.commit with component names on fiber commit', () => {
    const plugin = createReactPlugin()
    const { agent, emitted } = makeAgent()
    plugin.browser!.setup(agent)

    const hook = (globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as Hook
    const fiberRoot = { current: { type: null, child: makeFiber('App', makeFiber('Header')), sibling: null } }
    ;(hook['onCommitFiberRoot'] as Function)(1, fiberRoot)

    expect(emitted).toHaveLength(1)
    const evt = emitted[0] as { type: string; data: { components: string[] } }
    expect(evt.type).toBe('plugin.react.commit')
    expect(evt.data.components).toContain('App')
    expect(evt.data.components).toContain('Header')
  })

  it('only includes user components (capital-letter names)', () => {
    const plugin = createReactPlugin()
    const { agent, emitted } = makeAgent()
    plugin.browser!.setup(agent)

    const hook = (globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as Hook
    // 'div' is a host element — should be excluded; 'Button' is a component — should be included
    const divFiber = { type: 'div', child: makeFiber('Button'), sibling: null }
    ;(hook['onCommitFiberRoot'] as Function)(1, { current: { type: null, child: divFiber, sibling: null } })

    const evt = emitted[0] as { data: { components: string[] } }
    expect(evt.data.components).not.toContain('div')
    expect(evt.data.components).toContain('Button')
  })

  it('chains to an existing onCommitFiberRoot handler', () => {
    const existingFn = vi.fn()
    ;(globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] = {
      isDisabled: false, supportsFiber: true, inject: () => {},
      onCommitFiberRoot: existingFn,
      onCommitFiberUnmount: () => {},
    }

    const plugin = createReactPlugin()
    const { agent } = makeAgent()
    plugin.browser!.setup(agent)

    const hook = (globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as Hook
    ;(hook['onCommitFiberRoot'] as Function)(1, { current: { type: null, child: null, sibling: null } })

    expect(existingFn).toHaveBeenCalledOnce()
  })

  it('snapshot returns accumulated mounted component names', () => {
    const plugin = createReactPlugin()
    const { agent } = makeAgent()
    plugin.browser!.setup(agent)

    const hook = (globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as Hook
    ;(hook['onCommitFiberRoot'] as Function)(1, { current: { type: null, child: makeFiber('Dashboard'), sibling: null } })

    const snap = plugin.browser!.snapshot() as { mountedComponents: string[] }
    expect(snap.mountedComponents).toContain('Dashboard')
  })
})
```

- [ ] **Step 4: Run tests — verify they fail**

```bash
npx vitest run packages/plugin-react/test
```

Expected: FAIL — `createReactPlugin` not found.

- [ ] **Step 5: Implement `plugin-react/src/index.ts`**

```ts
// packages/plugin-react/src/index.ts
import type { IntrospectionPlugin, BrowserAgent } from '@introspection/types'

interface ReactFiber {
  type: unknown
  child: ReactFiber | null
  sibling: ReactFiber | null
}

interface ReactFiberRoot {
  current: ReactFiber
}

type DevToolsHook = Record<string, unknown>

function getFiberName(fiber: ReactFiber): string | null {
  const t = fiber.type
  if (typeof t === 'string') return t
  if (typeof t === 'function') return (t as { displayName?: string; name?: string }).displayName || (t as { name?: string }).name || null
  if (t && typeof t === 'object' && 'displayName' in t) return (t as { displayName: string }).displayName
  return null
}

function walkFiber(fiber: ReactFiber | null, names: string[], depth = 0): void {
  if (!fiber || depth > 30) return
  const name = getFiberName(fiber)
  if (name && /^[A-Z]/.test(name)) names.push(name)
  walkFiber(fiber.child, names, depth + 1)
  walkFiber(fiber.sibling, names, depth + 1)
}

export function createReactPlugin(): IntrospectionPlugin {
  const mountedComponents = new Set<string>()

  return {
    name: 'react',
    browser: {
      setup(agent: BrowserAgent) {
        const g = globalThis as Record<string, unknown>

        if (!g['__REACT_DEVTOOLS_GLOBAL_HOOK__']) {
          g['__REACT_DEVTOOLS_GLOBAL_HOOK__'] = {
            isDisabled: false,
            supportsFiber: true,
            inject: () => {},
            onScheduleFiberRoot: () => {},
            onCommitFiberRoot: () => {},
            onCommitFiberUnmount: () => {},
          }
        }

        const hook = g['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as DevToolsHook
        const prevCommit = hook['onCommitFiberRoot'] as ((...args: unknown[]) => void) | undefined
        const prevUnmount = hook['onCommitFiberUnmount'] as ((...args: unknown[]) => void) | undefined

        hook['onCommitFiberRoot'] = (...args: unknown[]) => {
          prevCommit?.(...args)
          const fiberRoot = args[1] as ReactFiberRoot | undefined
          if (!fiberRoot?.current) return
          const names: string[] = []
          walkFiber(fiberRoot.current.child, names)
          for (const n of names) mountedComponents.add(n)
          if (names.length > 0) {
            agent.emit({ type: 'plugin.react.commit', data: { components: names } })
          }
        }

        hook['onCommitFiberUnmount'] = (...args: unknown[]) => {
          prevUnmount?.(...args)
          const fiber = args[0] as ReactFiber | undefined
          if (!fiber) return
          const name = getFiberName(fiber)
          if (name) mountedComponents.delete(name)
        }
      },

      snapshot() {
        return { mountedComponents: [...mountedComponents] }
      },
    },
  }
}
```

- [ ] **Step 6: Run tests — verify they pass**

```bash
npx vitest run packages/plugin-react/test
```

Expected: 5/5 PASS.

- [ ] **Step 7: Run full suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/plugin-react/
git commit -m "feat: @introspection/plugin-react — commits fiber tree updates as trace events"
```

---

## Task 4: README

Single `README.md` at the repo root covering installation, quick-start, all CLI commands, and both plugins.

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

Cover:

1. **What it is** — one paragraph
2. **Installation** — pnpm add commands per package
3. **Quick start** — vite.config.ts snippet + Playwright fixture snippet showing `attach(page)` / `detach()`
4. **CLI reference** — table of all `introspect` subcommands with description and flags
5. **Plugin: Redux** — `createReduxPlugin(store)` usage example
6. **Plugin: React** — `createReactPlugin()` usage example
7. **Eval socket** — explain that `introspect eval` connects to the live Vite session; example queries
8. **Config reference** — `IntrospectionConfig` fields table

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with quick-start, CLI reference, and plugin usage"
```

---

## Next Steps (Plan 3)

- Playwright test fixture (`@introspection/playwright-fixture`) — wraps `attach`/`detach` around each test automatically, forwards test result status, handles worker index
- `@introspection/plugin-zustand` — Zustand middleware plugin
- Source-map support in eval socket (expressions reference source positions)
- `@introspection/plugin-webgl` — wraps `HTMLCanvasElement.prototype.getContext` to intercept the context instance at creation time (no global prototype patching required); then wraps all methods on that instance. Trackable surface:
  - **Draw calls** — `drawArrays`, `drawElements`, `drawArraysInstanced`, `drawElementsInstanced`: primitive mode (TRIANGLES/LINES/POINTS), vertex/index count, instance count, active program ID
  - **Shader pipeline** — `shaderSource` + `compileShader`: full GLSL source captured at compile time; `linkProgram`: link status + info log (compilation errors surfaced immediately as trace events)
  - **Uniform values** — every `uniform1f`, `uniform2fv`, `uniformMatrix4fv`, etc.: uniform name (resolved via `getActiveUniform`) + value at the time of the call; lets an AI see the exact transform matrices, colors, and time values fed to each draw
  - **Texture uploads** — `texImage2D`, `texSubImage2D`, `compressedTexImage2D`: target, mip level, internal format, width × height, estimated byte size
  - **Buffer uploads** — `bufferData`, `bufferSubData`: target (ARRAY_BUFFER / ELEMENT_ARRAY_BUFFER / etc.), usage hint (STATIC_DRAW / DYNAMIC_DRAW), byte size
  - **Framebuffer operations** — `bindFramebuffer`, `framebufferTexture2D`, `framebufferRenderbuffer`: render-to-texture setup, attachment points; lets an AI understand multi-pass rendering (shadow maps, post-processing)
  - **Render state transitions** — `enable`/`disable` (DEPTH_TEST, BLEND, CULL_FACE, STENCIL_TEST), `blendFunc`, `blendEquation`, `depthFunc`, `cullFace`, `stencilFunc`: full state machine deltas so each draw call has its complete render state context
  - **Viewport and scissor** — `viewport`, `scissor`: captures resolution changes and scissor regions
  - **Program switches** — `useProgram`: shader program switches annotate the draw call sequence; combined with captured sources the AI can follow the full rendering algorithm
  - **GL errors** — automatic `getError()` poll after every call (opt-in to avoid the GPU sync cost); or manual wrap to surface `GL_INVALID_OPERATION`, `GL_OUT_OF_MEMORY`, etc. as `plugin.webgl.error` events
  - **GPU timing** — `EXT_disjoint_timer_query` / `EXT_disjoint_timer_query_webgl2`: per-draw-call GPU elapsed time (async, polled next frame); reveals GPU stalls invisible to `performance.now()`
  - **Context loss / restore** — `webglcontextlost` + `webglcontextrestored` DOM events: GPU reset events surfaced as trace events with timestamp and recovery status
  - **Frame boundaries** — `requestAnimationFrame` interception groups all of the above by frame number; each frame becomes a named group in the trace with total draw call count, total vertex count, and GPU time
  - **Visual snapshots** — `readPixels` called at test marks or on JS error captures the raw pixel buffer of the canvas as a sidecar file (like response bodies); lets an AI describe or diff the rendered output without a screenshot API
- Web Worker support — `postMessage` bridge in the main thread forwards worker-emitted events to the browser agent; workers import a lightweight shim that calls `postMessage` instead of a WebSocket; events tagged with `source: 'worker'` and a worker ID

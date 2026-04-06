# Introspection Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core introspection library — shared types, Vite plugin hub, Playwright CDP adapter, browser agent, and AI query CLI.

**Architecture:** A Vite plugin acts as the central hub, receiving events over WebSocket from both a browser agent (injected JS) and a CDP session opened by `attach(page)`. Events are normalised, source-mapped, and written to per-test `.trace.json` files. An `introspect` CLI lets an AI query those files (or a live session) without reading raw JSON.

**Tech Stack:** TypeScript (strict, ESM), pnpm workspaces, vitest, tsup, Vite 5+, Playwright 1.40+, commander (CLI), ws (WebSocket), jsonpath-plus (body path queries)

---

## File Structure

```
packages/
  types/                              # @introspection/types — shared interfaces, no runtime
    src/index.ts
    package.json
    tsconfig.json

  vite/                               # @introspection/vite — Vite plugin (hub)
    src/
      index.ts                        # plugin factory, exports introspection()
      server.ts                       # WebSocket server, session registry
      merger.ts                       # deduplicates CDP + agent events by source+type+ts
      source-maps.ts                  # resolves minified positions via Vite module graph
      trace-writer.ts                 # writes .trace.json + bodies/ sidecar files
      snapshot.ts                     # on-error snapshot: DOM, scopes, globals, plugins
    test/
      server.test.ts
      source-maps.test.ts
      trace-writer.test.ts
      snapshot.test.ts
    package.json
    tsconfig.json

  playwright/                         # @introspection/playwright — CDP bridge
    src/
      attach.ts                       # attach(page) → IntrospectHandle
      cdp.ts                          # opens CDP session, subscribes to domains, normalises events
      proxy.ts                        # Proxy<Page> for playwright.action tracking
    test/
      attach.test.ts
      cdp.test.ts
      proxy.test.ts
    package.json
    tsconfig.json

  browser/                            # @introspection/browser — optional in-page agent
    src/
      index.ts                        # BrowserAgent class: WS connect, emit(), plugin registry
    test/
      browser-agent.test.ts
    package.json
    tsconfig.json

  cli/                                # introspect — AI query interface
    src/
      index.ts                        # commander entry point
      trace-reader.ts                 # reads .trace.json + bodies/
      socket-client.ts                # connects to .introspect/.socket (live queries)
      format.ts                       # shared output formatting helpers
      commands/
        summary.ts                    # plain-language narrative
        timeline.ts                   # chronological event list
        errors.ts                     # JS errors with source-mapped stacks
        vars.ts                       # scope chain at error time
        network.ts                    # requests/responses tabular
        body.ts                       # body query (--path, --jq)
        dom.ts                        # DOM snapshot at error
        eval.ts                       # live JS eval via socket
    test/
      trace-reader.test.ts
      commands/
        summary.test.ts
        network.test.ts
        body.test.ts
    package.json
    tsconfig.json

pnpm-workspace.yaml
package.json                          # root — scripts only, no dependencies
tsconfig.base.json                    # shared TypeScript config
vitest.workspace.ts                   # vitest workspace config
```

---

## Task 1: Monorepo Setup

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `packages/types/package.json`
- Create: `packages/vite/package.json`
- Create: `packages/playwright/package.json`
- Create: `packages/browser/package.json`
- Create: `packages/cli/package.json`

- [ ] **Step 1: Create root config files**

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

```json
// package.json (root)
{
  "name": "introspection-monorepo",
  "private": true,
  "scripts": {
    "build": "pnpm -r run build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "tsup": "^8.0.0",
    "@types/node": "^20.0.0"
  }
}
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  }
}
```

```ts
// vitest.workspace.ts
import { defineWorkspace } from 'vitest/config'
export default defineWorkspace(['packages/*/vitest.config.ts'])
```

- [ ] **Step 2: Create package.json for each package**

```json
// packages/types/package.json
{
  "name": "@introspection/types",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": { "build": "tsup src/index.ts --format esm --dts" }
}
```

```json
// packages/vite/package.json
{
  "name": "@introspection/vite",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./snapshot": { "import": "./dist/snapshot.js", "types": "./dist/snapshot.d.ts" }
  },
  "scripts": { "build": "tsup src/index.ts src/snapshot.ts --format esm --dts", "test": "vitest run" },
  "dependencies": { "@introspection/types": "workspace:*", "ws": "^8.17.0" },
  "devDependencies": { "@types/ws": "^8.5.0", "vite": "^5.0.0" },
  "peerDependencies": { "vite": ">=5.0.0" }
}
```

```json
// packages/playwright/package.json
{
  "name": "@introspection/playwright",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": { "import": "./dist/attach.js", "types": "./dist/attach.d.ts" } },
  "scripts": { "build": "tsup src/attach.ts --format esm --dts", "test": "vitest run" },
  "dependencies": { "@introspection/types": "workspace:*", "ws": "^8.17.0" },
  "peerDependencies": { "@playwright/test": ">=1.40.0" }
}
```

```json
// packages/browser/package.json
{
  "name": "@introspection/browser",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": { "build": "tsup src/index.ts --format esm iife --dts", "test": "vitest run" },
  "dependencies": { "@introspection/types": "workspace:*" }
}
```

```json
// packages/cli/package.json
{
  "name": "introspect",
  "version": "0.1.0",
  "type": "module",
  "bin": { "introspect": "./dist/index.js" },
  "scripts": { "build": "tsup src/index.ts --format esm", "test": "vitest run" },
  "dependencies": {
    "@introspection/types": "workspace:*",
    "commander": "^12.0.0",
    "jsonpath-plus": "^9.0.0",
    "chalk": "^5.3.0"
  }
}
```

- [ ] **Step 3: Add vitest.config.ts to each package**

```ts
// packages/vite/vitest.config.ts  (same pattern for all packages)
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { globals: true }
})
```

- [ ] **Step 4: Install dependencies**

```bash
pnpm install
```

Expected: workspace linked, no errors.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: monorepo setup with pnpm workspaces, TypeScript, vitest"
```

---

## Task 2: Shared Types (`@introspection/types`)

**Files:**
- Create: `packages/types/src/index.ts`
- Create: `packages/types/tsconfig.json`

- [ ] **Step 1: Write types**

```ts
// packages/types/src/index.ts

// ─── Event types ────────────────────────────────────────────────────────────

export type EventSource = 'cdp' | 'agent' | 'plugin' | 'playwright'

export interface BaseEvent {
  id: string
  ts: number          // ms since test start
  source: EventSource
  initiator?: string  // id of event that caused this one (best-effort)
}

export interface NetworkRequestEvent extends BaseEvent {
  type: 'network.request'
  data: { url: string; method: string; headers: Record<string, string>; postData?: string }
}

export interface NetworkResponseEvent extends BaseEvent {
  type: 'network.response'
  data: {
    requestId: string
    url: string
    status: number
    headers: Record<string, string>
    bodyRef?: string        // id for sidecar body file
    bodySummary?: BodySummary
  }
}

export interface NetworkErrorEvent extends BaseEvent {
  type: 'network.error'
  data: { url: string; errorText: string }
}

export interface JsErrorEvent extends BaseEvent {
  type: 'js.error'
  data: { message: string; stack: StackFrame[] }
}

export interface JsConsoleEvent extends BaseEvent {
  type: 'js.console'
  data: { level: 'log' | 'warn' | 'error' | 'info'; args: unknown[] }
}

export interface DomSnapshotEvent extends BaseEvent {
  type: 'dom.snapshot'
  data: {
    url: string
    focusedSelector?: string
    visibleFormElements: Array<{ selector: string; value: string }>
  }
}

export interface VariableSnapshotEvent extends BaseEvent {
  type: 'variable.snapshot'
  data: { scopes: ScopeFrame[]; trigger: string }
}

export interface BrowserClickEvent extends BaseEvent {
  type: 'browser.click'
  data: { selector: string; text: string; x: number; y: number }
}

export interface BrowserInputEvent extends BaseEvent {
  type: 'browser.input'
  data: { selector: string; value: string }
}

export interface BrowserNavigateEvent extends BaseEvent {
  type: 'browser.navigate'
  data: { from: string; to: string }
}

export interface MarkEvent extends BaseEvent {
  type: 'mark'
  data: { label: string; extra?: Record<string, unknown> }
}

export interface PlaywrightActionEvent extends BaseEvent {
  type: 'playwright.action'
  data: { method: string; args: unknown[] }
}

export interface PluginEvent extends BaseEvent {
  type: `plugin.${string}`
  data: Record<string, unknown>
}

export type TraceEvent =
  | NetworkRequestEvent
  | NetworkResponseEvent
  | NetworkErrorEvent
  | JsErrorEvent
  | JsConsoleEvent
  | DomSnapshotEvent
  | VariableSnapshotEvent
  | BrowserClickEvent
  | BrowserInputEvent
  | BrowserNavigateEvent
  | MarkEvent
  | PlaywrightActionEvent
  | PluginEvent

// ─── Supporting types ────────────────────────────────────────────────────────

export interface StackFrame {
  functionName: string
  file: string      // always source-mapped
  line: number
  column: number
}

export interface ScopeFrame {
  frame: string           // "functionName (file:line)"
  vars: Record<string, unknown>
}

export interface BodySummary {
  keys: string[]
  scalars: Record<string, string | number | boolean | null>
  arrays: Record<string, { length: number; itemKeys: string[] }>
  errorFields: Record<string, unknown>
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface OnErrorSnapshot {
  ts: number
  trigger: 'js.error' | 'playwright.assertion' | 'manual'
  url: string
  dom: string
  scopes: ScopeFrame[]
  globals: Record<string, unknown>
  plugins: Record<string, unknown>
}

// ─── Trace file ──────────────────────────────────────────────────────────────

export interface TraceTest {
  title: string
  file: string
  status: 'passed' | 'failed' | 'timedOut' | 'skipped'
  duration: number
  error?: string
}

export interface TraceFile {
  version: '1'
  test: TraceTest
  events: TraceEvent[]
  snapshots: { 'on-error'?: OnErrorSnapshot; [key: string]: OnErrorSnapshot | undefined }
}

// ─── Plugin interface ─────────────────────────────────────────────────────────

export interface BrowserAgent {
  emit(event: Omit<PluginEvent, 'id' | 'ts' | 'source'>): void
}

export interface IntrospectionPlugin {
  name: string
  browser?: {
    setup(agent: BrowserAgent): void
    snapshot(): Record<string, unknown>
  }
  server?: {
    transformEvent(event: TraceEvent): TraceEvent | null
    extendSnapshot(snapshot: OnErrorSnapshot): Record<string, unknown>
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface CaptureConfig {
  ignore?: string[]
  network?: {
    ignoreUrls?: RegExp[]
    ignoreHeaders?: string[]
  }
  responseBody?: {
    maxSize?: string    // e.g. '50kb'
    ignore?: RegExp[]   // matched against Content-Type first, then URL
  }
}

export interface IntrospectionConfig {
  plugins?: IntrospectionPlugin[]
  capture?: CaptureConfig
}

// ─── IntrospectHandle (returned by attach()) ──────────────────────────────────

export interface IntrospectHandle {
  page: import('@playwright/test').Page   // Proxy-wrapped page
  mark(label: string, data?: Record<string, unknown>): void
  snapshot(): Promise<void>
  detach(): Promise<void>
}
```

- [ ] **Step 2: Add tsconfig**

```json
// packages/types/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Build and verify types compile**

```bash
cd packages/types && pnpm build
```

Expected: `dist/index.js` and `dist/index.d.ts` created, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/types
git commit -m "feat(types): shared TraceEvent, TraceFile, IntrospectionPlugin types"
```

---

## Task 3: Vite Plugin — WebSocket Server & Session Registry

**Files:**
- Create: `packages/vite/src/server.ts`
- Create: `packages/vite/src/index.ts`
- Create: `packages/vite/test/server.test.ts`
- Create: `packages/vite/tsconfig.json`

- [ ] **Step 1: Write the failing test**

```ts
// packages/vite/test/server.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createIntrospectionServer, type IntrospectionServer } from '../src/server.js'
import WebSocket from 'ws'
import { createServer } from 'http'

describe('IntrospectionServer', () => {
  let httpServer: ReturnType<typeof createServer>
  let introspectionServer: IntrospectionServer

  afterEach(() => {
    introspectionServer?.shutdown()
    httpServer?.close()
  })

  it('accepts WebSocket connections on /__introspection', async () => {
    httpServer = createServer()
    introspectionServer = createIntrospectionServer(httpServer, {})

    await new Promise<void>(resolve => httpServer.listen(0, resolve))
    const port = (httpServer.address() as { port: number }).port

    const ws = new WebSocket(`ws://localhost:${port}/__introspection`)
    await new Promise<void>(resolve => ws.once('open', resolve))
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('rejects connections to other paths', async () => {
    httpServer = createServer()
    introspectionServer = createIntrospectionServer(httpServer, {})
    await new Promise<void>(resolve => httpServer.listen(0, resolve))
    const port = (httpServer.address() as { port: number }).port

    const ws = new WebSocket(`ws://localhost:${port}/other`)
    await new Promise<void>(resolve => ws.once('close', resolve))
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('registers a session when START_SESSION message is received', async () => {
    httpServer = createServer()
    introspectionServer = createIntrospectionServer(httpServer, {})
    await new Promise<void>(resolve => httpServer.listen(0, resolve))
    const port = (httpServer.address() as { port: number }).port

    const ws = new WebSocket(`ws://localhost:${port}/__introspection`)
    await new Promise<void>(resolve => ws.once('open', resolve))

    ws.send(JSON.stringify({ type: 'START_SESSION', sessionId: 'test-abc', testTitle: 'my test', testFile: 'foo.spec.ts' }))
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(introspectionServer.getSession('test-abc')).toBeDefined()
    ws.close()
  })

  it('appends events to the correct session', async () => {
    httpServer = createServer()
    introspectionServer = createIntrospectionServer(httpServer, {})
    await new Promise<void>(resolve => httpServer.listen(0, resolve))
    const port = (httpServer.address() as { port: number }).port

    const ws = new WebSocket(`ws://localhost:${port}/__introspection`)
    await new Promise<void>(resolve => ws.once('open', resolve))

    ws.send(JSON.stringify({ type: 'START_SESSION', sessionId: 'sess-1', testTitle: 't', testFile: 'f' }))
    ws.send(JSON.stringify({ type: 'EVENT', sessionId: 'sess-1', event: { id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'hi' } } }))
    await new Promise(resolve => setTimeout(resolve, 20))

    const session = introspectionServer.getSession('sess-1')
    expect(session?.events).toHaveLength(1)
    expect(session?.events[0].type).toBe('mark')
    ws.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/vite && pnpm test
```

Expected: FAIL — `../src/server.js` not found.

- [ ] **Step 3: Implement `server.ts`**

```ts
// packages/vite/src/server.ts
import { WebSocketServer, type WebSocket } from 'ws'
import type { Server } from 'http'
import type { TraceEvent, IntrospectionConfig, TraceTest } from '@introspection/types'

export interface Session {
  id: string
  testTitle: string
  testFile: string
  startedAt: number
  events: TraceEvent[]
  ws: WebSocket
}

export interface IntrospectionServer {
  getSession(id: string): Session | undefined
  getSessions(): Session[]
  shutdown(): void
}

export function createIntrospectionServer(
  httpServer: Server,
  config: IntrospectionConfig
): IntrospectionServer {
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map<string, Session>()

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === '/__introspection') {
      wss.handleUpgrade(req, socket as never, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    } else {
      socket.destroy()
    }
  })

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(raw.toString()) } catch { return }

      if (msg.type === 'START_SESSION') {
        const session: Session = {
          id: msg.sessionId as string,
          testTitle: msg.testTitle as string,
          testFile: msg.testFile as string,
          startedAt: Date.now(),
          events: [],
          ws,
        }
        sessions.set(session.id, session)
      } else if (msg.type === 'EVENT') {
        const session = sessions.get(msg.sessionId as string)
        if (session) {
          const event = msg.event as TraceEvent
          // Apply server-side plugin transforms
          let transformed: TraceEvent | null = event
          for (const plugin of config.plugins ?? []) {
            if (!transformed) break
            transformed = plugin.server?.transformEvent(transformed) ?? transformed
          }
          if (transformed) session.events.push(transformed)
        }
      }
    })
  })

  return {
    getSession: (id) => sessions.get(id),
    getSessions: () => [...sessions.values()],
    shutdown: () => wss.close(),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/vite && pnpm test
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Create the Vite plugin entry point**

```ts
// packages/vite/src/index.ts
import type { Plugin, ViteDevServer } from 'vite'
import type { IntrospectionConfig } from '@introspection/types'
import { createIntrospectionServer, type IntrospectionServer } from './server.js'

export function introspection(config: IntrospectionConfig = {}): Plugin {
  let server: IntrospectionServer | undefined

  return {
    name: 'introspection',
    configureServer(viteServer: ViteDevServer) {
      if (!viteServer.httpServer) return
      server = createIntrospectionServer(viteServer.httpServer, config)
      viteServer.httpServer.once('close', () => server?.shutdown())
    },
  }
}

export type { IntrospectionServer, Session } from './server.js'
```

- [ ] **Step 6: Add tsconfig**

```json
// packages/vite/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src" },
  "include": ["src", "test"]
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/vite
git commit -m "feat(vite): WebSocket server, session registry"
```

---

## Task 4: Vite Plugin — Source Map Resolution

**Files:**
- Create: `packages/vite/src/source-maps.ts`
- Create: `packages/vite/test/source-maps.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/vite/test/source-maps.test.ts
import { describe, it, expect } from 'vitest'
import { resolveStackFrame } from '../src/source-maps.js'
import type { StackFrame } from '@introspection/types'

describe('resolveStackFrame', () => {
  it('returns the frame unchanged when no source map is available', () => {
    const frame: StackFrame = { functionName: 'handleClick', file: 'dist/bundle.js', line: 1, column: 5000 }
    const resolved = resolveStackFrame(frame, () => null)
    expect(resolved).toEqual(frame)
  })

  it('resolves a minified position to original source location', () => {
    // A minimal inline source map: maps line 1, col 0 → originalFile.ts line 5, col 3
    const inlineMap = {
      version: 3,
      sources: ['src/originalFile.ts'],
      names: [],
      mappings: 'AAAKA',  // encodes: line 0 col 0 → source 0 line 0 col 5 name 0
    }
    const frame: StackFrame = { functionName: 'fn', file: 'bundle.js', line: 1, column: 0 }
    const resolved = resolveStackFrame(frame, (_file) => inlineMap)
    expect(resolved.file).toBe('src/originalFile.ts')
    expect(typeof resolved.line).toBe('number')
  })

  it('preserves functionName across resolution', () => {
    const frame: StackFrame = { functionName: 'myFunc', file: 'bundle.js', line: 1, column: 0 }
    const resolved = resolveStackFrame(frame, () => null)
    expect(resolved.functionName).toBe('myFunc')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/vite && pnpm test test/source-maps.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `source-maps.ts`**

```bash
cd packages/vite && pnpm add source-map
pnpm add -D @types/source-map
```

```ts
// packages/vite/src/source-maps.ts
import { SourceMapConsumer } from 'source-map'
import type { StackFrame } from '@introspection/types'

type RawSourceMap = ConstructorParameters<typeof SourceMapConsumer>[0]
type SourceMapProvider = (file: string) => RawSourceMap | null

export function resolveStackFrame(
  frame: StackFrame,
  getSourceMap: SourceMapProvider
): StackFrame {
  const map = getSourceMap(frame.file)
  if (!map) return frame

  const consumer = new SourceMapConsumer(map as never)
  const pos = consumer.originalPositionFor({ line: frame.line, column: frame.column })
  consumer.destroy()

  if (!pos.source) return frame

  return {
    functionName: pos.name ?? frame.functionName,
    file: pos.source,
    line: pos.line ?? frame.line,
    column: pos.column ?? frame.column,
  }
}

/** Builds a SourceMapProvider from Vite's module graph */
export function viteSourceMapProvider(
  getModuleById: (id: string) => { transformResult?: { map?: RawSourceMap } } | undefined
): SourceMapProvider {
  return (file: string) => {
    const mod = getModuleById(file)
    return mod?.transformResult?.map ?? null
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/vite && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 5: Wire source map provider into `server.ts`**

Update `server.ts` to accept an optional `resolveFrame` function and apply it to `js.error` events before appending to the session:

```ts
// In createIntrospectionServer, add resolveFrame parameter:
export function createIntrospectionServer(
  httpServer: Server,
  config: IntrospectionConfig,
  resolveFrame?: (frame: StackFrame) => StackFrame  // new
): IntrospectionServer {
```

In the `EVENT` handler, after plugin transforms, for `js.error` events:
```ts
if (transformed?.type === 'js.error' && resolveFrame) {
  transformed = {
    ...transformed,
    data: { ...transformed.data, stack: transformed.data.stack.map(resolveFrame) }
  }
}
```

Update `index.ts` to pass `viteSourceMapProvider` from the Vite module graph:
```ts
// In configureServer:
const resolveFrame = (frame: StackFrame) =>
  resolveStackFrame(frame, viteSourceMapProvider((id) => viteServer.moduleGraph.getModuleById(id)))
server = createIntrospectionServer(viteServer.httpServer, config, resolveFrame)
```

- [ ] **Step 6: Commit**

```bash
git add packages/vite
git commit -m "feat(vite): source map resolution via Vite module graph"
```

---

## Task 5: Vite Plugin — Trace Writer

**Files:**
- Create: `packages/vite/src/trace-writer.ts`
- Create: `packages/vite/test/trace-writer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/vite/test/trace-writer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeTrace } from '../src/trace-writer.js'
import type { Session } from '../src/server.js'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

describe('writeTrace', () => {
  let dir: string

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-')) })
  afterEach(async () => { await rm(dir, { recursive: true }) })

  it('writes a .trace.json file', async () => {
    const session: Partial<Session> = {
      id: 'sess-1',
      testTitle: 'login > redirects on success',
      testFile: 'tests/login.spec.ts',
      startedAt: Date.now() - 1000,
      events: [],
    }
    await writeTrace(session as Session, { status: 'passed' }, dir, 0)
    const files = await import('fs/promises').then(fs => fs.readdir(dir))
    expect(files.some(f => f.endsWith('.trace.json'))).toBe(true)
  })

  it('slugifies the test title in the filename', async () => {
    const session: Partial<Session> = {
      id: 'sess-2', testTitle: 'login > redirects', testFile: 'f', startedAt: Date.now(), events: []
    }
    await writeTrace(session as Session, { status: 'passed' }, dir, 1)
    const files = await import('fs/promises').then(fs => fs.readdir(dir))
    const traceFile = files.find(f => f.endsWith('.trace.json'))!
    expect(traceFile).toContain('login')
    expect(traceFile).toContain('w1')
  })

  it('writes response body to a sidecar file', async () => {
    const event = {
      id: 'evt-1', type: 'network.response' as const, ts: 100, source: 'cdp' as const,
      data: { requestId: 'r1', url: '/api', status: 200, headers: {}, bodyRef: 'evt-1', bodySummary: undefined }
    }
    const session: Partial<Session> = {
      id: 'sess-3', testTitle: 'test', testFile: 'f', startedAt: Date.now(),
      events: [event as never], bodyMap: new Map([['evt-1', '{"ok":true}']])
    }
    await writeTrace(session as never, { status: 'passed' }, dir, 0)
    const bodyFile = join(dir, 'bodies', 'evt-1.json')
    const body = await readFile(bodyFile, 'utf-8')
    expect(JSON.parse(body)).toEqual({ ok: true })
  })

  it('does not include body content inside the trace file events', async () => {
    const event = {
      id: 'evt-1', type: 'network.response' as const, ts: 100, source: 'cdp' as const,
      data: { requestId: 'r1', url: '/api', status: 200, headers: {}, bodyRef: 'evt-1' }
    }
    const session: Partial<Session> = {
      id: 'sess-4', testTitle: 'test', testFile: 'f', startedAt: Date.now(),
      events: [event as never], bodyMap: new Map([['evt-1', '{"secret":"value"}']])
    }
    await writeTrace(session as never, { status: 'passed' }, dir, 0)
    const files = await import('fs/promises').then(fs => fs.readdir(dir))
    const traceFile = files.find(f => f.endsWith('.trace.json'))!
    const trace = JSON.parse(await readFile(join(dir, traceFile), 'utf-8'))
    const raw = JSON.stringify(trace)
    expect(raw).not.toContain('secret')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/vite && pnpm test test/trace-writer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `trace-writer.ts`**

```ts
// packages/vite/src/trace-writer.ts
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { TraceFile, TraceEvent } from '@introspection/types'
import type { Session } from './server.js'

interface TestResult { status: 'passed' | 'failed' | 'timedOut' | 'skipped'; error?: string }

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
}

function summariseBody(raw: string): import('@introspection/types').BodySummary {
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(raw) } catch { return { keys: [], scalars: {}, arrays: {}, errorFields: {} } }

  const keys = Object.keys(parsed)
  const scalars: Record<string, unknown> = {}
  const arrays: Record<string, { length: number; itemKeys: string[] }> = {}
  const errorFields: Record<string, unknown> = {}
  const ERROR_KEYS = new Set(['error', 'message', 'code', 'status', 'detail'])

  for (const [k, v] of Object.entries(parsed)) {
    if (Array.isArray(v)) {
      const first = v[0] && typeof v[0] === 'object' ? Object.keys(v[0]) : []
      arrays[k] = { length: v.length, itemKeys: first }
    } else if (typeof v === 'object' && v !== null) {
      // skip nested objects from scalars
    } else {
      scalars[k] = v
    }
    if (ERROR_KEYS.has(k)) errorFields[k] = v
  }

  return { keys, scalars: scalars as never, arrays, errorFields }
}

export async function writeTrace(
  session: Session & { bodyMap?: Map<string, string>; snapshot?: unknown },
  result: TestResult,
  outDir: string,
  workerIndex: number
): Promise<void> {
  await mkdir(outDir, { recursive: true })

  // Write body sidecar files
  const bodiesDir = join(outDir, 'bodies')
  if (session.bodyMap?.size) {
    await mkdir(bodiesDir, { recursive: true })
    for (const [id, raw] of session.bodyMap) {
      await writeFile(join(bodiesDir, `${id}.json`), raw)
    }
  }

  // Strip raw body from events, add bodySummary
  const events: TraceEvent[] = session.events.map(evt => {
    if (evt.type === 'network.response' && session.bodyMap?.has(evt.id)) {
      const raw = session.bodyMap.get(evt.id)!
      return { ...evt, data: { ...evt.data, bodySummary: summariseBody(raw) } }
    }
    return evt
  })

  const trace: TraceFile = {
    version: '1',
    test: {
      title: session.testTitle,
      file: session.testFile,
      status: result.status,
      duration: Date.now() - session.startedAt,
      error: result.error,
    },
    events,
    snapshots: session.snapshot ? { 'on-error': session.snapshot as never } : {},
  }

  const filename = `${slugify(session.testTitle)}--w${workerIndex}.trace.json`
  await writeFile(join(outDir, filename), JSON.stringify(trace, null, 2))
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/vite && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite
git commit -m "feat(vite): trace writer with sidecar bodies and bodySummary"
```

---

## Task 6: Vite Plugin — On-Error Snapshot

**Files:**
- Create: `packages/vite/src/snapshot.ts`
- Create: `packages/vite/test/snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/vite/test/snapshot.test.ts
import { describe, it, expect, vi } from 'vitest'
import { takeSnapshot } from '../src/snapshot.js'

describe('takeSnapshot', () => {
  it('returns a snapshot with required fields', async () => {
    const mockCdp = {
      send: vi.fn().mockImplementation((method: string) => {
        if (method === 'DOM.getDocument') return Promise.resolve({ root: { nodeId: 1 } })
        if (method === 'DOM.getOuterHTML') return Promise.resolve({ outerHTML: '<html/>' })
        if (method === 'Runtime.evaluate') return Promise.resolve({ result: { value: '/home' } })
        if (method === 'Debugger.evaluateOnCallFrame') return Promise.resolve({ result: { value: null } })
        if (method === 'Runtime.getProperties') return Promise.resolve({ result: [] })
        return Promise.resolve({})
      })
    }

    const snapshot = await takeSnapshot({
      cdpSession: mockCdp as never,
      trigger: 'js.error',
      url: '/home',
      callFrames: [],
      plugins: [],
    })

    expect(snapshot.trigger).toBe('js.error')
    expect(snapshot.url).toBe('/home')
    expect(snapshot.dom).toBe('<html/>')
    expect(snapshot.scopes).toBeInstanceOf(Array)
    expect(snapshot.globals).toBeInstanceOf(Object)
    expect(snapshot.plugins).toBeInstanceOf(Object)
  })

  it('includes plugin data in snapshot', async () => {
    const mockCdp = {
      send: vi.fn().mockResolvedValue({ root: { nodeId: 1 }, outerHTML: '<html/>', result: { value: null } })
    }
    const mockPlugin = {
      name: 'redux',
      server: {
        transformEvent: (e: never) => e,
        extendSnapshot: () => ({ state: { count: 42 } })
      }
    }

    const snapshot = await takeSnapshot({
      cdpSession: mockCdp as never,
      trigger: 'manual',
      url: '/',
      callFrames: [],
      plugins: [mockPlugin as never],
    })

    expect(snapshot.plugins.redux).toEqual({ state: { count: 42 } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/vite && pnpm test test/snapshot.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `snapshot.ts`**

```ts
// packages/vite/src/snapshot.ts
import type { OnErrorSnapshot, IntrospectionPlugin, ScopeFrame } from '@introspection/types'

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
  callFrames: CallFrame[]
  plugins: IntrospectionPlugin[]
}

export async function takeSnapshot(options: TakeSnapshotOptions): Promise<OnErrorSnapshot> {
  const { cdpSession, trigger, url, callFrames, plugins } = options

  // DOM
  let dom = ''
  try {
    const { root } = await cdpSession.send('DOM.getDocument') as { root: { nodeId: number } }
    const { outerHTML } = await cdpSession.send('DOM.getOuterHTML', { nodeId: root.nodeId }) as { outerHTML: string }
    dom = outerHTML
  } catch { /* non-fatal */ }

  // Scope chain
  const scopes: ScopeFrame[] = []
  for (const frame of callFrames.slice(0, 5)) {
    const vars: Record<string, unknown> = {}
    for (const scope of frame.scopeChain.slice(0, 3)) {
      if (!scope.object.objectId) continue
      try {
        const { result } = await cdpSession.send('Runtime.getProperties', {
          objectId: scope.object.objectId,
          ownProperties: true,
        }) as { result: Array<{ name: string; value?: { value?: unknown; description?: string } }> }
        for (const prop of result.slice(0, 20)) {
          vars[prop.name] = prop.value?.value ?? prop.value?.description ?? undefined
        }
      } catch { /* non-fatal */ }
    }
    scopes.push({ frame: `${frame.functionName} (${frame.url}:${frame.location.lineNumber})`, vars })
  }

  // Key globals
  const globals: Record<string, unknown> = {}
  for (const expr of ['location.pathname', 'localStorage', 'sessionStorage']) {
    try {
      const { result } = await cdpSession.send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        silent: true,
      }) as { result: { value?: unknown } }
      globals[expr] = result.value
    } catch { /* non-fatal */ }
  }

  // Plugin extensions
  const pluginData: Record<string, unknown> = {}
  for (const plugin of plugins) {
    if (plugin.server?.extendSnapshot) {
      try {
        pluginData[plugin.name] = plugin.server.extendSnapshot({} as never)
      } catch { /* non-fatal */ }
    }
  }

  return { ts: Date.now(), trigger, url, dom, scopes, globals, plugins: pluginData }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/vite && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite
git commit -m "feat(vite): on-error snapshot with DOM, scopes, globals, plugin data"
```

---

## Task 7: Playwright Adapter — CDP Session & Event Forwarding

**Files:**
- Create: `packages/playwright/src/cdp.ts`
- Create: `packages/playwright/test/cdp.test.ts`
- Create: `packages/playwright/tsconfig.json`
- Create: `packages/playwright/vitest.config.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/playwright/test/cdp.test.ts
import { describe, it, expect, vi } from 'vitest'
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
      initiator: { type: 'script', stack: { callFrames: [] } },
      timestamp: 100,
    }
    const evt = normaliseCdpNetworkRequest(raw, 'sess-1', 0)
    expect(evt.type).toBe('network.request')
    expect(evt.source).toBe('cdp')
    expect(evt.data.url).toBe('https://api.example.com/users')
    expect(evt.data.method).toBe('POST')
    expect(evt.data.postData).toBe('{"name":"alice"}')
    expect(evt.id).toBeTruthy()
  })

  it('normalises a Network.responseReceived event', () => {
    const raw = {
      requestId: 'req-1',
      response: {
        url: 'https://api.example.com/users',
        status: 201,
        headers: { 'content-type': 'application/json' },
      },
      timestamp: 150,
    }
    const evt = normaliseCdpNetworkResponse(raw, 'sess-1', 0)
    expect(evt.type).toBe('network.response')
    expect(evt.data.status).toBe(201)
    expect(evt.initiator).toBe('req-1')
  })

  it('normalises a Runtime.exceptionThrown event', () => {
    const raw = {
      timestamp: 200,
      exceptionDetails: {
        text: 'TypeError: Cannot read properties of undefined',
        stackTrace: {
          callFrames: [
            { functionName: 'handleSubmit', url: 'bundle.js', lineNumber: 0, columnNumber: 5000 }
          ]
        }
      }
    }
    const evt = normaliseCdpJsError(raw, 'sess-1', 0)
    expect(evt.type).toBe('js.error')
    expect(evt.data.message).toContain('TypeError')
    expect(evt.data.stack).toHaveLength(1)
    expect(evt.data.stack[0].functionName).toBe('handleSubmit')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/playwright && pnpm test
```

Expected: FAIL.

- [ ] **Step 3: Implement `cdp.ts`**

```ts
// packages/playwright/src/cdp.ts
import { randomUUID } from 'crypto'
import type { NetworkRequestEvent, NetworkResponseEvent, JsErrorEvent, StackFrame } from '@introspection/types'

function makeId(): string { return `evt-${randomUUID().slice(0, 8)}` }

export function normaliseCdpNetworkRequest(raw: Record<string, unknown>, _sessionId: string, startedAt: number): NetworkRequestEvent {
  const req = raw.request as Record<string, unknown>
  return {
    id: makeId(),
    type: 'network.request',
    ts: Math.round(((raw.timestamp as number) * 1000) - startedAt),
    source: 'cdp',
    data: {
      url: req.url as string,
      method: req.method as string,
      headers: (req.headers ?? {}) as Record<string, string>,
      postData: req.postData as string | undefined,
    },
  }
}

export function normaliseCdpNetworkResponse(raw: Record<string, unknown>, _sessionId: string, startedAt: number): NetworkResponseEvent {
  const res = raw.response as Record<string, unknown>
  return {
    id: makeId(),
    type: 'network.response',
    ts: Math.round(((raw.timestamp as number) * 1000) - startedAt),
    source: 'cdp',
    initiator: raw.requestId as string,
    data: {
      requestId: raw.requestId as string,
      url: res.url as string,
      status: res.status as number,
      headers: (res.headers ?? {}) as Record<string, string>,
    },
  }
}

export function normaliseCdpJsError(raw: Record<string, unknown>, _sessionId: string, startedAt: number): JsErrorEvent {
  const details = raw.exceptionDetails as Record<string, unknown>
  const trace = details.stackTrace as { callFrames: Array<Record<string, unknown>> } | undefined
  const stack: StackFrame[] = (trace?.callFrames ?? []).map(f => ({
    functionName: (f.functionName as string) || '(anonymous)',
    file: f.url as string,
    line: (f.lineNumber as number) + 1,
    column: f.columnNumber as number,
  }))
  return {
    id: makeId(),
    type: 'js.error',
    ts: Math.round(((raw.timestamp as number) * 1000) - startedAt),
    source: 'cdp',
    data: {
      message: details.text as string,
      stack,
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/playwright && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/playwright
git commit -m "feat(playwright): CDP event normalisation for network and JS errors"
```

---

## Task 8: Playwright Adapter — Page Proxy (`playwright.action`)

**Files:**
- Create: `packages/playwright/src/proxy.ts`
- Create: `packages/playwright/test/proxy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/playwright/test/proxy.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createPageProxy } from '../src/proxy.js'

describe('createPageProxy', () => {
  it('emits a playwright.action event when a tracked method is called', () => {
    const emitted: unknown[] = []
    const emit = vi.fn((evt) => emitted.push(evt))

    const fakePage = {
      click: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      untracked: vi.fn().mockResolvedValue(undefined),
    }

    const proxy = createPageProxy(fakePage as never, emit)
    proxy.click('#btn', { timeout: 1000 })

    expect(emit).toHaveBeenCalledOnce()
    const evt = emitted[0] as { type: string; data: { method: string; args: unknown[] } }
    expect(evt.type).toBe('playwright.action')
    expect(evt.data.method).toBe('click')
    expect(evt.data.args[0]).toBe('#btn')
  })

  it('does not emit for untracked methods', () => {
    const emit = vi.fn()
    const fakePage = { untracked: vi.fn() }
    const proxy = createPageProxy(fakePage as never, emit)
    proxy.untracked()
    expect(emit).not.toHaveBeenCalled()
  })

  it('still calls the original page method', async () => {
    const emit = vi.fn()
    const mockGoto = vi.fn().mockResolvedValue({ url: () => '/home' })
    const fakePage = { goto: mockGoto }
    const proxy = createPageProxy(fakePage as never, emit)
    await proxy.goto('/home')
    expect(mockGoto).toHaveBeenCalledWith('/home')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/playwright && pnpm test test/proxy.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `proxy.ts`**

```ts
// packages/playwright/src/proxy.ts
import { randomUUID } from 'crypto'
import type { PlaywrightActionEvent } from '@introspection/types'
import type { Page } from '@playwright/test'

const TRACKED_METHODS = new Set([
  'click', 'fill', 'goto', 'press', 'selectOption', 'check',
  'uncheck', 'hover', 'dragAndDrop', 'evaluate', 'waitForURL', 'waitForSelector',
])

type EmitFn = (event: Omit<PlaywrightActionEvent, 'id' | 'ts'>) => void

export function createPageProxy(page: Page, emit: EmitFn): Page {
  return new Proxy(page, {
    get(target, prop) {
      const original = target[prop as keyof Page]
      if (typeof original !== 'function' || !TRACKED_METHODS.has(prop as string)) {
        return original
      }
      return (...args: unknown[]) => {
        emit({
          type: 'playwright.action',
          source: 'playwright',
          data: { method: prop as string, args: sanitizeArgs(args) },
        })
        return (original as Function).apply(target, args)
      }
    },
  })
}

function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map(arg => {
    if (arg === null || arg === undefined) return arg
    if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') return arg
    if (typeof arg === 'object') {
      // Return a shallow copy with only serialisable keys
      try { return JSON.parse(JSON.stringify(arg)) } catch { return '[unserializable]' }
    }
    return '[function]'
  })
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/playwright && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/playwright
git commit -m "feat(playwright): Page Proxy for playwright.action event tracking"
```

---

## Task 9: Playwright Adapter — `attach(page)` + IntrospectHandle

**Files:**
- Create: `packages/playwright/src/attach.ts`
- Create: `packages/playwright/test/attach.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/playwright/test/attach.test.ts
import { describe, it, expect, vi } from 'vitest'
import { attach } from '../src/attach.js'

describe('attach()', () => {
  function makeFakePage() {
    return {
      context: () => ({
        newCDPSession: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({}),
          on: vi.fn(),
          detach: vi.fn().mockResolvedValue(undefined),
        })
      }),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
    }
  }

  it('returns an IntrospectHandle with page, mark, snapshot, detach', async () => {
    const fakePage = makeFakePage()
    const handle = await attach(fakePage as never, {
      viteUrl: 'ws://localhost:9999/__introspection',
      sessionId: 'test-sess',
      testTitle: 'my test',
      testFile: 'foo.spec.ts',
      workerIndex: 0,
      outDir: '/tmp/introspect',
    })
    expect(handle.page).toBeDefined()
    expect(typeof handle.mark).toBe('function')
    expect(typeof handle.snapshot).toBe('function')
    expect(typeof handle.detach).toBe('function')
    await handle.detach()
  })

  it('mark() emits a mark event via the session', async () => {
    const fakePage = makeFakePage()
    const handle = await attach(fakePage as never, {
      viteUrl: 'ws://localhost:9999/__introspection',
      sessionId: 'test-sess-2',
      testTitle: 'my test',
      testFile: 'foo.spec.ts',
      workerIndex: 0,
      outDir: '/tmp/introspect',
    })
    // mark() should not throw
    expect(() => handle.mark('step 1', { extra: true })).not.toThrow()
    await handle.detach()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/playwright && pnpm test test/attach.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `attach.ts`**

```ts
// packages/playwright/src/attach.ts
import { randomUUID } from 'crypto'
import WebSocket from 'ws'
import type { Page } from '@playwright/test'
import type { IntrospectHandle, TraceEvent } from '@introspection/types'
import { createPageProxy } from './proxy.js'
import { normaliseCdpNetworkRequest, normaliseCdpNetworkResponse, normaliseCdpJsError } from './cdp.js'

export interface AttachOptions {
  viteUrl: string       // ws://localhost:<port>/__introspection
  sessionId: string
  testTitle: string
  testFile: string
  workerIndex: number
  outDir: string
}

function getViteUrl(): string {
  const port = process.env.VITE_PORT ?? '5173'
  return `ws://localhost:${port}/__introspection`
}

export async function attach(page: Page, opts?: Partial<AttachOptions>): Promise<IntrospectHandle> {
  const sessionId = opts?.sessionId ?? randomUUID()
  const viteUrl = opts?.viteUrl ?? getViteUrl()
  const testTitle = opts?.testTitle ?? 'unknown test'
  const testFile = opts?.testFile ?? 'unknown file'
  const startedAt = Date.now()

  // Connect to Vite plugin WS
  const ws = new WebSocket(viteUrl)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
    setTimeout(() => reject(new Error(`Could not connect to Vite introspection server at ${viteUrl}`)), 3000)
  })

  function sendEvent(event: Omit<TraceEvent, 'id' | 'ts'> & { id?: string; ts?: number }) {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'EVENT', sessionId, event: { id: randomUUID(), ts: Date.now() - startedAt, ...event } }))
  }

  // Start session
  ws.send(JSON.stringify({ type: 'START_SESSION', sessionId, testTitle, testFile }))

  // Open CDP session
  const cdp = await page.context().newCDPSession(page)

  await cdp.send('Network.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Debugger.enable')
  await cdp.send('DOM.enable')

  cdp.on('Network.requestWillBeSent', (params) => {
    sendEvent(normaliseCdpNetworkRequest(params as never, sessionId, startedAt))
  })
  cdp.on('Network.responseReceived', (params) => {
    sendEvent(normaliseCdpNetworkResponse(params as never, sessionId, startedAt))
  })
  cdp.on('Runtime.exceptionThrown', (params) => {
    sendEvent(normaliseCdpJsError(params as never, sessionId, startedAt))
  })
  cdp.on('Page.navigatedWithinDocument', (params: { url: string }) => {
    sendEvent({ type: 'browser.navigate', source: 'cdp', data: { from: '', to: params.url } })
  })

  // Proxy page for playwright.action tracking
  const proxiedPage = createPageProxy(page, (evt) => sendEvent(evt as never))

  const handle: IntrospectHandle = {
    page: proxiedPage,
    mark(label, data) {
      sendEvent({ type: 'mark', source: 'agent', data: { label, extra: data } })
    },
    async snapshot() {
      ws.send(JSON.stringify({ type: 'SNAPSHOT_REQUEST', sessionId, trigger: 'manual' }))
    },
    async detach() {
      ws.send(JSON.stringify({ type: 'END_SESSION', sessionId, result: { status: 'passed' } }))
      await cdp.detach()
      ws.close()
    },
  }

  return handle
}
```

- [ ] **Step 4: Run all playwright package tests**

```bash
cd packages/playwright && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/playwright
git commit -m "feat(playwright): attach(page) returning IntrospectHandle with CDP session"
```

---

## Task 10: Browser Agent

**Files:**
- Create: `packages/browser/src/index.ts`
- Create: `packages/browser/test/browser-agent.test.ts`
- Create: `packages/browser/tsconfig.json`
- Create: `packages/browser/vitest.config.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/browser/test/browser-agent.test.ts
import { describe, it, expect, vi } from 'vitest'
import { BrowserAgent } from '../src/index.js'

describe('BrowserAgent', () => {
  it('calls send when emit() is invoked', () => {
    const send = vi.fn()
    const agent = new BrowserAgent({ send })
    agent.emit({ type: 'plugin.router', source: 'plugin', data: { route: '/home' } })
    expect(send).toHaveBeenCalledOnce()
    const msg = JSON.parse(send.mock.calls[0][0])
    expect(msg.type).toBe('EVENT')
    expect(msg.event.type).toBe('plugin.router')
  })

  it('registers and calls plugin setup', () => {
    const setup = vi.fn()
    const agent = new BrowserAgent({ send: vi.fn() })
    agent.use({ name: 'test', browser: { setup, snapshot: () => ({}) } })
    expect(setup).toHaveBeenCalledWith(agent)
  })

  it('collects plugin snapshot data', () => {
    const agent = new BrowserAgent({ send: vi.fn() })
    agent.use({ name: 'router', browser: { setup: vi.fn(), snapshot: () => ({ route: '/home' }) } })
    const snapData = agent.collectSnapshot()
    expect(snapData.router).toEqual({ route: '/home' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/browser && pnpm test
```

Expected: FAIL.

- [ ] **Step 3: Implement `browser/src/index.ts`**

```ts
// packages/browser/src/index.ts
// Note: uses crypto.randomUUID() (Web Crypto API) — available in all modern browsers and Node 19+.
// Do NOT import from Node's 'crypto' module — this bundle runs in the browser page.
import type { BrowserAgent as IBrowserAgent, IntrospectionPlugin, PluginEvent } from '@introspection/types'

function makeId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `evt-${crypto.randomUUID().slice(0, 8)}`
    : `evt-${Math.random().toString(36).slice(2, 10)}`
}

interface AgentTransport { send(message: string): void }

export class BrowserAgent implements IBrowserAgent {
  private plugins: IntrospectionPlugin[] = []

  constructor(private transport: AgentTransport) {}

  use(plugin: IntrospectionPlugin): void {
    this.plugins.push(plugin)
    plugin.browser?.setup(this)
  }

  emit(event: Omit<PluginEvent, 'id' | 'ts'>): void {
    const full = { id: makeId(), ts: Date.now(), ...event }
    this.transport.send(JSON.stringify({ type: 'EVENT', event: full }))
  }

  collectSnapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const plugin of this.plugins) {
      if (plugin.browser?.snapshot) {
        try { result[plugin.name] = plugin.browser.snapshot() } catch { /* non-fatal */ }
      }
    }
    return result
  }

  /** Call this from the page to connect to the Vite plugin WS */
  static connect(vitePort = 5173, sessionId: string, testTitle = 'browser-agent', testFile = ''): BrowserAgent {
    const ws = new (globalThis as never as { WebSocket: typeof WebSocket }).WebSocket(
      `ws://localhost:${vitePort}/__introspection`
    )
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'START_SESSION', sessionId, testTitle, testFile }))
    })
    return new BrowserAgent({ send: (msg) => ws.send(msg) })
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/browser && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/browser
git commit -m "feat(browser): BrowserAgent with emit, plugin registry, snapshot collection"
```

---

## Task 11: CLI — Foundation, Trace Reader, Socket Client

**Files:**
- Create: `packages/cli/src/trace-reader.ts`
- Create: `packages/cli/src/socket-client.ts`
- Create: `packages/cli/src/format.ts`
- Create: `packages/cli/test/trace-reader.test.ts`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/vitest.config.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/trace-reader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TraceReader } from '../src/trace-reader.js'
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { TraceFile } from '@introspection/types'

const sampleTrace: TraceFile = {
  version: '1',
  test: { title: 'login test', file: 'login.spec.ts', status: 'failed', duration: 2000, error: 'expected /dashboard' },
  events: [
    { id: 'e1', type: 'network.request', ts: 100, source: 'cdp', data: { url: '/api/auth', method: 'POST', headers: {} } },
    { id: 'e2', type: 'network.response', ts: 200, source: 'cdp', initiator: 'e1', data: { requestId: 'e1', url: '/api/auth', status: 401, headers: {}, bodyRef: 'e2' } },
    { id: 'e3', type: 'js.error', ts: 300, source: 'cdp', data: { message: 'Uncaught TypeError', stack: [{ functionName: 'handleAuth', file: 'auth.ts', line: 42, column: 0 }] } },
  ],
  snapshots: {},
}

describe('TraceReader', () => {
  let dir: string

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-cli-')) })
  afterEach(async () => { await rm(dir, { recursive: true }) })

  async function writeTestTrace(name = 'login-test--w0.trace.json') {
    await writeFile(join(dir, name), JSON.stringify(sampleTrace))
  }

  it('loads the most recent trace file', async () => {
    await writeTestTrace()
    const reader = new TraceReader(dir)
    const trace = await reader.loadLatest()
    expect(trace.test.title).toBe('login test')
  })

  it('loads a specific trace by name', async () => {
    await writeTestTrace('my-test--w0.trace.json')
    const reader = new TraceReader(dir)
    const trace = await reader.load('my-test--w0')
    expect(trace.test.title).toBe('login test')
  })

  it('filters events by type', async () => {
    await writeTestTrace()
    const reader = new TraceReader(dir)
    const trace = await reader.loadLatest()
    const errors = reader.filterEvents(trace, { type: 'js.error' })
    expect(errors).toHaveLength(1)
    expect(errors[0].type).toBe('js.error')
  })

  it('reads a sidecar body file', async () => {
    await writeTestTrace()
    await mkdir(join(dir, 'bodies'), { recursive: true })
    await writeFile(join(dir, 'bodies', 'e2.json'), '{"error":"invalid_credentials"}')
    const reader = new TraceReader(dir)
    const body = await reader.readBody('e2')
    expect(JSON.parse(body!)).toEqual({ error: 'invalid_credentials' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/cli && pnpm test
```

Expected: FAIL.

- [ ] **Step 3: Implement `trace-reader.ts`**

```ts
// packages/cli/src/trace-reader.ts
import { readdir, readFile, stat } from 'fs/promises'
import { join, basename } from 'path'
import type { TraceFile, TraceEvent } from '@introspection/types'

interface FilterOptions { type?: string; url?: string; failed?: boolean }

export class TraceReader {
  constructor(private dir: string) {}

  async loadLatest(): Promise<TraceFile> {
    const files = await this.listTraceFiles()
    if (files.length === 0) throw new Error(`No trace files found in ${this.dir}`)
    // Sort by mtime descending
    const stats = await Promise.all(files.map(async f => ({ f, mtime: (await stat(join(this.dir, f))).mtime })))
    stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    return this.loadFile(stats[0].f)
  }

  async load(name: string): Promise<TraceFile> {
    const filename = name.endsWith('.trace.json') ? name : `${name}.trace.json`
    return this.loadFile(filename)
  }

  async readBody(eventId: string): Promise<string | null> {
    const path = join(this.dir, 'bodies', `${eventId}.json`)
    try { return await readFile(path, 'utf-8') } catch { return null }
  }

  filterEvents(trace: TraceFile, opts: FilterOptions): TraceEvent[] {
    return trace.events.filter(evt => {
      if (opts.type && evt.type !== opts.type) return false
      if (opts.url && evt.type === 'network.request' && !evt.data.url.includes(opts.url)) return false
      if (opts.url && evt.type === 'network.response' && !evt.data.url.includes(opts.url)) return false
      if (opts.failed && evt.type === 'network.response' && evt.data.status < 400) return false
      return true
    })
  }

  private async listTraceFiles(): Promise<string[]> {
    const entries = await readdir(this.dir)
    return entries.filter(f => f.endsWith('.trace.json'))
  }

  private async loadFile(filename: string): Promise<TraceFile> {
    const raw = await readFile(join(this.dir, filename), 'utf-8')
    return JSON.parse(raw) as TraceFile
  }
}
```

- [ ] **Step 4: Implement `format.ts` and `socket-client.ts`**

```ts
// packages/cli/src/format.ts
import chalk from 'chalk'

export function statusColor(status: number): string {
  if (status < 300) return chalk.green(String(status))
  if (status < 400) return chalk.yellow(String(status))
  return chalk.red(String(status))
}

export function formatStack(stack: Array<{ functionName: string; file: string; line: number }>): string {
  return stack.map(f => `  at ${f.functionName} (${chalk.cyan(f.file)}:${f.line})`).join('\n')
}
```

```ts
// packages/cli/src/socket-client.ts
import { createConnection } from 'net'

export interface LiveClient {
  eval(expression: string): Promise<unknown>
  close(): void
}

export async function connectToSocket(socketPath: string): Promise<LiveClient> {
  const socket = createConnection(socketPath)

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
    setTimeout(() => reject(new Error(`No active session — start Vite and run attach(page) in a test (socket: ${socketPath})`)), 2000)
  })

  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let buffer = ''

  socket.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as { id: string; result?: unknown; error?: string }
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result)
        }
      } catch { /* ignore */ }
    }
  })

  return {
    eval(expression) {
      const id = Math.random().toString(36).slice(2)
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.write(JSON.stringify({ id, type: 'eval', expression }) + '\n')
        setTimeout(() => { pending.delete(id); reject(new Error('eval timed out')) }, 10000)
      })
    },
    close: () => socket.destroy(),
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd packages/cli && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): TraceReader, format helpers, live socket client"
```

---

## Task 12: CLI — Commands

**Files:**
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/summary.ts`
- Create: `packages/cli/src/commands/timeline.ts`
- Create: `packages/cli/src/commands/errors.ts`
- Create: `packages/cli/src/commands/vars.ts`
- Create: `packages/cli/src/commands/network.ts`
- Create: `packages/cli/src/commands/body.ts`
- Create: `packages/cli/src/commands/dom.ts`
- Create: `packages/cli/src/commands/eval.ts`
- Create: `packages/cli/test/commands/summary.test.ts`
- Create: `packages/cli/test/commands/network.test.ts`
- Create: `packages/cli/test/commands/body.test.ts`

- [ ] **Step 1: Write failing tests for key commands**

```ts
// packages/cli/test/commands/summary.test.ts
import { describe, it, expect } from 'vitest'
import { buildSummary } from '../../src/commands/summary.js'
import type { TraceFile } from '@introspection/types'

const trace: TraceFile = {
  version: '1',
  test: { title: 'login test', file: 'login.spec.ts', status: 'failed', duration: 2000, error: 'expected /dashboard, got /login' },
  events: [
    { id: 'e1', type: 'playwright.action', ts: 50, source: 'playwright', data: { method: 'goto', args: ['/login'] } },
    { id: 'e2', type: 'network.request', ts: 100, source: 'cdp', data: { url: '/api/auth/login', method: 'POST', headers: {} } },
    { id: 'e3', type: 'network.response', ts: 150, source: 'cdp', initiator: 'e2', data: { requestId: 'e2', url: '/api/auth/login', status: 401, headers: {} } },
    { id: 'e4', type: 'js.error', ts: 200, source: 'cdp', data: { message: 'TypeError: Cannot read properties', stack: [] } },
  ],
  snapshots: {},
}

describe('buildSummary', () => {
  it('includes test status', () => {
    const out = buildSummary(trace)
    expect(out).toContain('failed')
  })

  it('mentions failed network requests', () => {
    const out = buildSummary(trace)
    expect(out).toContain('401')
    expect(out).toContain('/api/auth/login')
  })

  it('mentions JS errors', () => {
    const out = buildSummary(trace)
    expect(out).toContain('TypeError')
  })

  it('mentions Playwright actions taken', () => {
    const out = buildSummary(trace)
    expect(out).toContain('goto')
  })
})
```

```ts
// packages/cli/test/commands/network.test.ts
import { describe, it, expect } from 'vitest'
import { formatNetworkTable } from '../../src/commands/network.js'
import type { TraceFile } from '@introspection/types'

const trace: TraceFile = {
  version: '1',
  test: { title: 't', file: 'f', status: 'passed', duration: 100 },
  events: [
    { id: 'r1', type: 'network.request', ts: 10, source: 'cdp', data: { url: '/api/users', method: 'GET', headers: {} } },
    { id: 'r2', type: 'network.response', ts: 50, source: 'cdp', initiator: 'r1', data: { requestId: 'r1', url: '/api/users', status: 200, headers: {} } },
    { id: 'r3', type: 'network.request', ts: 60, source: 'cdp', data: { url: '/api/auth', method: 'POST', headers: {} } },
    { id: 'r4', type: 'network.response', ts: 100, source: 'cdp', initiator: 'r3', data: { requestId: 'r3', url: '/api/auth', status: 401, headers: {} } },
  ],
  snapshots: {},
}

describe('formatNetworkTable', () => {
  it('lists all requests', () => {
    const out = formatNetworkTable(trace.events, {})
    expect(out).toContain('/api/users')
    expect(out).toContain('/api/auth')
  })

  it('--failed filters to non-2xx only', () => {
    const out = formatNetworkTable(trace.events, { failed: true })
    expect(out).not.toContain('/api/users')
    expect(out).toContain('/api/auth')
    expect(out).toContain('401')
  })

  it('--url filters by pattern', () => {
    const out = formatNetworkTable(trace.events, { url: '/api/auth' })
    expect(out).not.toContain('/api/users')
    expect(out).toContain('/api/auth')
  })
})
```

```ts
// packages/cli/test/commands/body.test.ts
import { describe, it, expect } from 'vitest'
import { queryBody } from '../../src/commands/body.js'

const rawBody = JSON.stringify({ users: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }], total: 2 })

describe('queryBody', () => {
  it('pretty-prints the full body when no options', () => {
    const out = queryBody(rawBody, {})
    expect(out).toContain('Alice')
    expect(out).toContain('total')
  })

  it('--path extracts a nested value', () => {
    const out = queryBody(rawBody, { path: '$.users[0].name' })
    expect(out).toContain('Alice')
    expect(out).not.toContain('Bob')
  })

  it('returns error message for invalid path', () => {
    const out = queryBody(rawBody, { path: '$.nonexistent' })
    expect(out).toContain('no match') // or similar
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cli && pnpm test
```

Expected: FAIL on new command tests.

- [ ] **Step 3: Implement commands**

```ts
// packages/cli/src/commands/summary.ts
import type { TraceFile, TraceEvent } from '@introspection/types'

export function buildSummary(trace: TraceFile): string {
  const lines: string[] = []
  const { test, events } = trace

  lines.push(`Test: "${test.title}" — ${test.status.toUpperCase()} (${test.duration}ms)`)
  if (test.error) lines.push(`Error: ${test.error}`)
  lines.push('')

  const actions = events.filter(e => e.type === 'playwright.action') as Array<{ data: { method: string; args: unknown[] } } & TraceEvent>
  if (actions.length) {
    lines.push(`Actions taken (${actions.length}):`)
    for (const a of actions) lines.push(`  ${a.data.method}(${a.data.args[0] ?? ''})`)
    lines.push('')
  }

  const responses = events.filter(e => e.type === 'network.response') as Array<{ data: { url: string; status: number } } & TraceEvent>
  const failed = responses.filter(r => r.data.status >= 400)
  if (failed.length) {
    lines.push(`Failed network requests (${failed.length}):`)
    for (const r of failed) lines.push(`  ${r.data.status} ${r.data.url}`)
    lines.push('')
  }

  const errors = events.filter(e => e.type === 'js.error') as Array<{ data: { message: string } } & TraceEvent>
  if (errors.length) {
    lines.push(`JS errors (${errors.length}):`)
    for (const e of errors) lines.push(`  ${e.data.message}`)
  }

  return lines.join('\n')
}
```

```ts
// packages/cli/src/commands/network.ts
import type { TraceEvent } from '@introspection/types'

interface NetworkOpts { failed?: boolean; url?: string }

export function formatNetworkTable(events: TraceEvent[], opts: NetworkOpts): string {
  const responses = events.filter(e => e.type === 'network.response') as Array<{ data: { url: string; status: number; requestId: string } } & TraceEvent>
  const requests = new Map(
    (events.filter(e => e.type === 'network.request') as Array<{ id: string; data: { url: string; method: string } } & TraceEvent>)
      .map(e => [e.id, e])
  )

  let filtered = responses
  if (opts.failed) filtered = filtered.filter(r => r.data.status >= 400)
  if (opts.url) filtered = filtered.filter(r => r.data.url.includes(opts.url!))

  if (!filtered.length) return '(no matching network events)'

  const rows = filtered.map(res => {
    const req = requests.get(res.data.requestId)
    return `${String(res.data.status).padEnd(5)} ${(req?.data.method ?? '?').padEnd(7)} ${res.data.url}`
  })

  return ['STATUS METHOD  URL', ...rows].join('\n')
}
```

```ts
// packages/cli/src/commands/body.ts
import { JSONPath } from 'jsonpath-plus'

interface BodyOpts { path?: string }

export function queryBody(raw: string, opts: BodyOpts): string {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return raw }

  if (!opts.path) return JSON.stringify(parsed, null, 2)

  const results = JSONPath({ path: opts.path, json: parsed as never })
  if (!results || (Array.isArray(results) && results.length === 0)) return '(no match for path)'
  return JSON.stringify(Array.isArray(results) && results.length === 1 ? results[0] : results, null, 2)
}
```

```ts
// packages/cli/src/commands/errors.ts
import type { TraceFile, JsErrorEvent } from '@introspection/types'
import { formatStack } from '../format.js'

export function formatErrors(trace: TraceFile): string {
  const errors = trace.events.filter(e => e.type === 'js.error') as JsErrorEvent[]
  if (!errors.length) return '(no JS errors recorded)'
  return errors.map(e =>
    `${e.data.message}\n${formatStack(e.data.stack)}`
  ).join('\n\n')
}
```

```ts
// packages/cli/src/commands/vars.ts
import type { TraceFile } from '@introspection/types'

export function formatVars(trace: TraceFile): string {
  const snapshot = trace.snapshots['on-error']
  if (!snapshot) return '(no error snapshot — test may have passed, or snapshot was not captured)'
  const lines: string[] = [`Scope chain at ${snapshot.trigger} (${snapshot.url}):\n`]
  for (const scope of snapshot.scopes) {
    lines.push(`  ${scope.frame}`)
    for (const [k, v] of Object.entries(scope.vars)) {
      lines.push(`    ${k} = ${JSON.stringify(v)}`)
    }
  }
  if (Object.keys(snapshot.globals).length) {
    lines.push('\nGlobals:')
    for (const [k, v] of Object.entries(snapshot.globals)) lines.push(`  ${k} = ${JSON.stringify(v)}`)
  }
  return lines.join('\n')
}
```

```ts
// packages/cli/src/commands/timeline.ts
import type { TraceFile } from '@introspection/types'

export function formatTimeline(trace: TraceFile): string {
  return trace.events.map(e => {
    const ts = String(e.ts).padStart(6) + 'ms'
    const src = e.source.padEnd(10)
    let detail = e.type
    if (e.type === 'network.request') detail += ` ${e.data.method} ${e.data.url}`
    else if (e.type === 'network.response') detail += ` ${e.data.status} ${e.data.url}`
    else if (e.type === 'js.error') detail += ` ${e.data.message}`
    else if (e.type === 'mark') detail += ` "${e.data.label}"`
    else if (e.type === 'playwright.action') detail += ` ${e.data.method}(${e.data.args[0] ?? ''})`
    return `[${ts}] ${src} ${detail}`
  }).join('\n')
}
```

```ts
// packages/cli/src/commands/dom.ts
import type { TraceFile } from '@introspection/types'

export function formatDom(trace: TraceFile): string {
  const snapshot = trace.snapshots['on-error']
  if (!snapshot?.dom) return '(no DOM snapshot available)'
  return snapshot.dom
}
```

```ts
// packages/cli/src/commands/eval.ts
import { connectToSocket } from '../socket-client.js'
import { join } from 'path'

export async function evalExpression(expression: string, outDir: string): Promise<string> {
  const socketPath = join(outDir, '.socket')
  const client = await connectToSocket(socketPath)
  try {
    const result = await client.eval(expression)
    return JSON.stringify(result, null, 2)
  } finally {
    client.close()
  }
}
```

- [ ] **Step 4: Implement CLI entry point**

```ts
// packages/cli/src/index.ts
#!/usr/bin/env node
import { Command } from 'commander'
import { TraceReader } from './trace-reader.js'
import { buildSummary } from './commands/summary.js'
import { formatTimeline } from './commands/timeline.js'
import { formatErrors } from './commands/errors.js'
import { formatVars } from './commands/vars.js'
import { formatNetworkTable } from './commands/network.js'
import { queryBody } from './commands/body.js'
import { formatDom } from './commands/dom.js'
import { evalExpression } from './commands/eval.js'
import { resolve } from 'path'

const DEFAULT_OUT_DIR = resolve('.introspect')
const program = new Command()

program.name('introspect').description('Query Playwright test introspection traces').version('0.1.0')

async function loadTrace(opts: { trace?: string }) {
  const r = new TraceReader(DEFAULT_OUT_DIR)
  return opts.trace ? r.load(opts.trace) : r.loadLatest()
}

program.command('summary').option('--trace <name>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(buildSummary(trace))
})

program.command('timeline').option('--trace <name>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatTimeline(trace))
})

program.command('errors').option('--trace <name>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatErrors(trace))
})

program.command('vars').option('--trace <name>').option('--at <point>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatVars(trace))
})

program.command('network').option('--trace <name>').option('--failed').option('--url <pattern>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatNetworkTable(trace.events, opts))
})

program.command('dom').option('--trace <name>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatDom(trace))
})

program.command('body <eventId>').option('--path <jsonpath>').option('--jq <expr>').action(async (eventId, opts) => {
  const r = new TraceReader(DEFAULT_OUT_DIR)
  const raw = await r.readBody(eventId)
  if (!raw) { console.error(`No body found for event ${eventId}`); process.exit(1) }
  console.log(queryBody(raw, { path: opts.path }))
})

program.command('eval <expression>').action(async (expression) => {
  const result = await evalExpression(expression, DEFAULT_OUT_DIR)
  console.log(result)
})

program.parseAsync()
```

- [ ] **Step 5: Run all CLI tests**

```bash
cd packages/cli && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 6: Build the CLI and verify it runs**

```bash
cd packages/cli && pnpm build
node dist/index.js --help
```

Expected: Help text listing all commands.

- [ ] **Step 7: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): all query commands — summary, timeline, errors, vars, network, body, dom, eval"
```

---

## Task 13: Integration — Wire Vite Plugin to Write Traces on Test End

**Files:**
- Modify: `packages/vite/src/server.ts`
- Modify: `packages/vite/src/index.ts`

- [ ] **Step 1: Handle END_SESSION in server.ts**

In `server.ts`, handle the `END_SESSION` message to write the trace:

```ts
// Add writeTrace import at top:
import { writeTrace } from './trace-writer.js'

// In the message handler, add:
} else if (msg.type === 'END_SESSION') {
  const session = sessions.get(msg.sessionId as string)
  if (session) {
    const result = (msg.result as { status: string; error?: string }) ?? { status: 'passed' }
    const outDir = (msg.outDir as string) ?? '.introspect'
    const workerIndex = (msg.workerIndex as number) ?? 0
    await writeTrace(session as never, result as never, outDir, workerIndex)
    sessions.delete(session.id)
  }
}
```

- [ ] **Step 2: Handle SNAPSHOT_REQUEST + SNAPSHOT messages in server.ts**

The snapshot round-trip: Vite server signals the Playwright adapter (`TAKE_SNAPSHOT`), the adapter calls CDP and sends back a completed `SNAPSHOT` payload, the server stores it on the session for `writeTrace` to include.

```ts
// In server.ts message handler, add two new cases:

} else if (msg.type === 'SNAPSHOT_REQUEST') {
  const session = sessions.get(msg.sessionId as string)
  if (session) {
    // Signal adapter to take snapshot via its CDP session
    session.ws.send(JSON.stringify({ type: 'TAKE_SNAPSHOT', trigger: msg.trigger }))
  }

} else if (msg.type === 'SNAPSHOT') {
  // Adapter sends back completed snapshot data
  const session = sessions.get(msg.sessionId as string)
  if (session) {
    (session as never as { snapshot: unknown }).snapshot = msg.snapshot
  }
}
```

Also extend the `Session` type in `server.ts` to carry `snapshot`:

```ts
export interface Session {
  id: string
  testTitle: string
  testFile: string
  startedAt: number
  events: TraceEvent[]
  ws: WebSocket
  bodyMap?: Map<string, string>
  snapshot?: import('@introspection/types').OnErrorSnapshot
}
```

- [ ] **Step 3: Update attach.ts to handle TAKE_SNAPSHOT and call CDP**

Refactor `attach.ts` so the `cdp` variable is accessible in the WS message handler. Store it in the outer scope before opening the WS message listener:

```ts
// In attach(), after `const cdp = await page.context().newCDPSession(page)`:

ws.on('message', async (raw) => {
  let msg: Record<string, unknown>
  try { msg = JSON.parse(raw.toString()) } catch { return }

  if (msg.type === 'TAKE_SNAPSHOT') {
    // cdp is in scope from attach() closure
    const { takeSnapshot } = await import('../../vite/src/snapshot.js')
    // Note: in the real package this imports from @introspection/vite/snapshot
    // For now call CDP directly and build the snapshot payload:
    const snapshot = await takeSnapshot({
      cdpSession: { send: (method, params) => cdp.send(method as never, params) } as never,
      trigger: (msg.trigger as never) ?? 'manual',
      url: await page.evaluate(() => location.href),
      callFrames: [],
      plugins: [],
    })
    ws.send(JSON.stringify({ type: 'SNAPSHOT', sessionId, snapshot }))
  }
})
```

`takeSnapshot` is already implemented in `packages/vite/src/snapshot.ts` (Task 6). Import it directly here — both packages share the same monorepo. Add `@introspection/vite` as a dependency of `@introspection/playwright` in `playwright/package.json`:

```json
"dependencies": {
  "@introspection/types": "workspace:*",
  "@introspection/vite": "workspace:*",
  "ws": "^8.17.0"
}
```

Then import cleanly:
```ts
import { takeSnapshot } from '@introspection/vite/snapshot'
```

And export `takeSnapshot` from `packages/vite/src/snapshot.ts` (it already is — verify the export is present).

- [ ] **Step 4: Run full test suite**

```bash
pnpm test
```

Expected: all tests PASS across all packages.

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: wire Vite plugin END_SESSION handler to write trace files"
```

---

## Next Steps (Plan 2)

The following are out of scope for this plan and covered in **Plan 2: Plugins**:

- `@introspection/plugin-redux` — Redux middleware + plugin
- `@introspection/plugin-react` — React DevTools hook integration
- Vite plugin server-side eval socket (`eval` command live path)
- README and usage docs

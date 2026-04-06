# Session Directory Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `.trace.json` file per test with a session directory (`<session-id>/`) containing `meta.json` + `events.ndjson` + snapshots, decoupling the storage format entirely from test semantics.

**Architecture:** Each session gets a directory named by its UUID. `meta.json` is written at session start and updated at end. Events are appended to `events.ndjson` one-per-line as they arrive (queryable during the session). The `TraceFile` type has no `test` field — just a `session` object with `id`, `startedAt`, `endedAt?`, and `label?`. Nothing else.

**Tech Stack:** Node.js `fs/promises` + `appendFile` for NDJSON streaming, TypeScript, Vitest for tests.

---

## New on-disk layout

```
.introspect/
  <session-id>/
    meta.json           # SessionMeta — written at start, updated at end
    events.ndjson       # one TraceEvent JSON object per line, appended as events arrive
    snapshots/
      on-error.json     # OnErrorSnapshot keyed by trigger name
    bodies/             # response body sidecars (event-id.json)
```

`meta.json` shape:
```json
{
  "version": "2",
  "id": "abc123",
  "startedAt": 1712345678000,
  "endedAt": 1712345679234,
  "label": "user can checkout"
}
```

`events.ndjson` shape (one line per event):
```
{"id":"evt-abc","type":"network.request","ts":100,"source":"cdp","data":{...}}
{"id":"evt-def","type":"plugin.redux.action","ts":200,"source":"plugin","data":{...}}
```

---

## File Map

| File | Change |
|------|--------|
| `packages/types/src/index.ts` | Add `SessionMeta`, remove `TraceTest`, update `TraceFile` (add `session`, remove `test`), update `IntrospectionServerMethods.startSession` params |
| `packages/vite/src/session-writer.ts` | **New** — pure functions: `initSessionDir`, `appendEvent`, `writeSnapshot`, `finalizeSession` |
| `packages/vite/src/trace-writer.ts` | **Delete** — replaced by `session-writer.ts` |
| `packages/vite/test/trace-writer.test.ts` | **Delete** — tests for deleted module |
| `packages/vite/src/server.ts` | Update `Session` interface, call `session-writer` on each lifecycle event |
| `packages/cli/src/trace-reader.ts` | Read session directories, parse NDJSON, return `TraceFile` |
| `packages/cli/src/index.ts` | Update `list` command, rename `--trace` → `--session` across all commands |
| `packages/cli/src/commands/summary.ts` | Remove all `test` references, use `session.label` and duration |
| `packages/cli/src/commands/eval.ts` | Add `session` to eval context, remove `test` |
| `packages/playwright/src/attach.ts` | Update `startSession` params, remove test result from finalize |
| `packages/cli/test/trace-reader.test.ts` | Update for new directory format |
| `packages/cli/test/commands/summary.test.ts` | Update fixture to new `TraceFile` shape |
| `packages/cli/test/commands/eval.test.ts` | Update fixture to new `TraceFile` shape |
| `packages/vite/test/session-writer.test.ts` | **New** — unit tests for writer functions |
| `packages/playwright/test/attach.test.ts` | Update `startSession` assertion |

---

## Task 1: Update types

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Update `TraceFile`, add `SessionMeta`, remove `TraceTest`**

In `packages/types/src/index.ts`, replace the `TraceFile` section (lines 142–160) with:

```ts
// ─── Session / Trace file ────────────────────────────────────────────────────

export interface SessionMeta {
  version: '2'
  id: string
  startedAt: number    // unix ms
  endedAt?: number     // unix ms, set when session ends
  label?: string       // human-readable name
}

export interface TraceFile {
  version: '2'
  session: {
    id: string
    startedAt: number
    endedAt?: number
    label?: string
  }
  events: TraceEvent[]
  snapshots: { [key: string]: OnErrorSnapshot | undefined }
}
```

Also remove the `TraceTest` interface and `TestResult` type — they are no longer part of the public type surface.

Add `SessionEndEvent` to the event types and the `TraceEvent` union:

```ts
export interface SessionEndEvent extends BaseEvent {
  type: 'session.end'
  data: Record<string, never>   // no data — it's a lifecycle marker
}
```

Add `SessionEndEvent` to the `TraceEvent` union alongside the other event types.

- [ ] **Step 2: Update `IntrospectionServerMethods.startSession`**

Find `IntrospectionServerMethods` and update `startSession`:

```ts
startSession(params: { id: string; startedAt: number; label?: string }): void
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/types && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): replace test-centric TraceFile with session-based shape, add SessionMeta"
```

---

## Task 2: New `session-writer.ts`

**Files:**
- Create: `packages/vite/src/session-writer.ts`
- Create: `packages/vite/test/session-writer.test.ts`
- Delete: `packages/vite/src/trace-writer.ts`
- Delete: `packages/vite/test/trace-writer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/vite/test/session-writer.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initSessionDir,
  appendEvent,
  writeSnapshot,
  finalizeSession,
} from '../src/session-writer.js'
import type { TraceEvent, OnErrorSnapshot } from '@introspection/types'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-test-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const initParams = { id: 'sess-1', startedAt: 1000, label: 'my test' }

describe('initSessionDir', () => {
  it('creates session directory and writes meta.json', async () => {
    await initSessionDir(dir, initParams)
    const raw = await readFile(join(dir, 'sess-1', 'meta.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.id).toBe('sess-1')
    expect(parsed.version).toBe('2')
    expect(parsed.startedAt).toBe(1000)
    expect(parsed.label).toBe('my test')
  })

  it('creates an empty events.ndjson', async () => {
    await initSessionDir(dir, initParams)
    const raw = await readFile(join(dir, 'sess-1', 'events.ndjson'), 'utf-8')
    expect(raw).toBe('')
  })
})

describe('appendEvent', () => {
  it('appends events as newline-terminated JSON lines', async () => {
    await initSessionDir(dir, initParams)
    const e1: TraceEvent = { id: 'e1', type: 'mark', ts: 10, source: 'agent', data: { label: 'start' } }
    const e2: TraceEvent = { id: 'e2', type: 'mark', ts: 20, source: 'agent', data: { label: 'end' } }
    await appendEvent(dir, 'sess-1', e1)
    await appendEvent(dir, 'sess-1', e2)
    const raw = await readFile(join(dir, 'sess-1', 'events.ndjson'), 'utf-8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toMatchObject({ id: 'e1', type: 'mark' })
    expect(JSON.parse(lines[1])).toMatchObject({ id: 'e2', type: 'mark' })
  })
})

describe('writeSnapshot', () => {
  it('writes snapshot to snapshots/<trigger>.json', async () => {
    await initSessionDir(dir, initParams)
    const snap: OnErrorSnapshot = {
      ts: 100, trigger: 'manual', url: 'http://localhost/', dom: '<html/>', scopes: [], globals: {}, plugins: {},
    }
    await writeSnapshot(dir, 'sess-1', snap)
    const raw = await readFile(join(dir, 'sess-1', 'snapshots', 'manual.json'), 'utf-8')
    expect(JSON.parse(raw).trigger).toBe('manual')
  })

  it('uses trigger as filename', async () => {
    await initSessionDir(dir, initParams)
    const snap: OnErrorSnapshot = {
      ts: 100, trigger: 'js.error', url: 'http://localhost/', dom: '<html/>', scopes: [], globals: {}, plugins: {},
    }
    await writeSnapshot(dir, 'sess-1', snap)
    const entries = await readdir(join(dir, 'sess-1', 'snapshots'))
    expect(entries).toContain('js.error.json')
  })
})

describe('finalizeSession', () => {
  it('updates meta.json with endedAt', async () => {
    await initSessionDir(dir, initParams)
    await finalizeSession(dir, 'sess-1', 2000)
    const raw = await readFile(join(dir, 'sess-1', 'meta.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.endedAt).toBe(2000)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/vite && npx vitest run test/session-writer.test.ts 2>&1 | head -20
```

Expected: FAIL — `session-writer.ts` does not exist yet.

- [ ] **Step 3: Implement `session-writer.ts`**

Create `packages/vite/src/session-writer.ts`:

```ts
import { writeFile, mkdir, appendFile, readFile } from 'fs/promises'
import { join } from 'path'
import type { TraceEvent, OnErrorSnapshot, SessionMeta, BodySummary } from '@introspection/types'

export interface SessionInitParams {
  id: string
  startedAt: number
  label?: string
}

function summariseBody(raw: string): BodySummary {
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
  await mkdir(join(sessionDir, 'snapshots'), { recursive: true })
  const meta: SessionMeta = {
    version: '2',
    id: params.id,
    startedAt: params.startedAt,
    label: params.label,
  }
  await writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2))
  await writeFile(join(sessionDir, 'events.ndjson'), '')
}

export async function appendEvent(outDir: string, sessionId: string, event: TraceEvent, bodyMap?: Map<string, string>): Promise<void> {
  const sessionDir = join(outDir, sessionId)
  let evt = event

  if (evt.type === 'network.response' && bodyMap?.has(evt.id)) {
    const raw = bodyMap.get(evt.id)!
    evt = { ...evt, data: { ...evt.data, bodySummary: summariseBody(raw) } }
    const bodiesDir = join(sessionDir, 'bodies')
    await mkdir(bodiesDir, { recursive: true })
    await writeFile(join(bodiesDir, `${evt.id}.json`), raw)
  }

  await appendFile(join(sessionDir, 'events.ndjson'), JSON.stringify(evt) + '\n')
}

export async function writeSnapshot(outDir: string, sessionId: string, snapshot: OnErrorSnapshot): Promise<void> {
  const snapshotsDir = join(outDir, sessionId, 'snapshots')
  await mkdir(snapshotsDir, { recursive: true })
  await writeFile(join(snapshotsDir, `${snapshot.trigger}.json`), JSON.stringify(snapshot, null, 2))
}

export async function finalizeSession(outDir: string, sessionId: string, endedAt: number): Promise<void> {
  const metaPath = join(outDir, sessionId, 'meta.json')
  const raw = await readFile(metaPath, 'utf-8')
  const meta = JSON.parse(raw) as SessionMeta
  meta.endedAt = endedAt
  await writeFile(metaPath, JSON.stringify(meta, null, 2))
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/vite && npx vitest run test/session-writer.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Delete `trace-writer.ts` and its test**

```bash
git rm packages/vite/src/trace-writer.ts packages/vite/test/trace-writer.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/vite/src/session-writer.ts packages/vite/test/session-writer.test.ts
git commit -m "feat(vite): replace trace-writer with session-writer (directory-based, streaming NDJSON)"
```

---

## Task 3: Update `server.ts`

**Files:**
- Modify: `packages/vite/src/server.ts`

- [ ] **Step 1: Update imports and `Session` interface**

Add imports:
```ts
import { randomUUID } from 'crypto'
import { initSessionDir, appendEvent, writeSnapshot, finalizeSession } from './session-writer.js'
```

Remove import of `trace-writer.js`.

Update `Session` interface:
```ts
export interface Session {
  id: string
  label?: string
  outDir: string
  startedAt: number
  events: TraceEvent[]
  playwrightProxy: RPC<PlaywrightClientMethods>
  bodyMap?: Map<string, string>
  snapshot?: OnErrorSnapshot
}
```

- [ ] **Step 2: Update `startSession` handler**

```ts
startSession({ id, startedAt, label }) {
  const outDir = config.outDir ?? '.introspect'
  const session: Session = { id, label, outDir, startedAt, events: [], playwrightProxy }
  sessions.set(id, session)
  void initSessionDir(outDir, { id, startedAt, label })
},
```

- [ ] **Step 3: Update `event` handler**

After `session.events.push(transformed)`, add:
```ts
void appendEvent(session.outDir, sessionId, transformed, session.bodyMap)
```

- [ ] **Step 4: Update `endSession` handler**

Replace the `writeTrace` import and call with `finalizeSession`. The Playwright adapter passes `result` (status, duration, error) and `testFile` — store these as `metadata` so the data is preserved for callers who want it, without the core system depending on it:

```ts
async endSession(sessionId, _result, _outDir, _workerIndex) {
  const session = sessions.get(sessionId)
  if (!session) return
  try {
    // session.end is a core lifecycle event — emitted by the server for any session
    const endEvent: TraceEvent = { id: randomUUID(), type: 'session.end', ts: Date.now() - session.startedAt, source: 'agent', data: {} }
    await appendEvent(session.outDir, sessionId, endEvent)
    await finalizeSession(session.outDir, sessionId, Date.now())
  } catch (err) {
    console.error('[introspection] failed to finalize session:', err)
  } finally {
    sessions.delete(sessionId)
  }
},
```

- [ ] **Step 5: Update `requestSnapshot` handler**

```ts
async requestSnapshot(sessionId, trigger) {
  const session = sessions.get(sessionId)
  if (!session) return
  try {
    session.snapshot = await session.playwrightProxy.takeSnapshot(trigger)
    if (session.snapshot) void writeSnapshot(session.outDir, sessionId, session.snapshot)
  } catch (err) {
    console.error('[introspection] snapshot request failed:', err)
  }
},
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd packages/vite && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add packages/vite/src/server.ts
git commit -m "feat(vite): stream events to session directory on every event"
```

---

## Task 4: Update `trace-reader.ts`

**Files:**
- Modify: `packages/cli/src/trace-reader.ts`
- Modify: `packages/cli/test/trace-reader.test.ts`

- [ ] **Step 1: Write updated tests**

Replace `packages/cli/test/trace-reader.test.ts` with:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { TraceReader } from '../src/trace-reader.js'
import type { OnErrorSnapshot } from '@introspection/types'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'trace-reader-test-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function writeSession(id: string, opts: {
  label?: string
  startedAt?: number
  endedAt?: number
  events?: object[]
  snapshot?: OnErrorSnapshot
} = {}) {
  const sessionDir = join(dir, id)
  await mkdir(join(sessionDir, 'snapshots'), { recursive: true })
  const meta = {
    version: '2', id,
    startedAt: opts.startedAt ?? 1000,
    endedAt: opts.endedAt,
    label: opts.label,
  }
  await writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta))
  const events = opts.events ?? []
  const ndjson = events.map(e => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '')
  await writeFile(join(sessionDir, 'events.ndjson'), ndjson)
  if (opts.snapshot) {
    await writeFile(join(sessionDir, 'snapshots', `${opts.snapshot.trigger}.json`), JSON.stringify(opts.snapshot))
  }
}

describe('TraceReader', () => {
  it('load() reads session directory and returns TraceFile', async () => {
    await writeSession('sess-abc', { label: 'my test', events: [
      { id: 'e1', type: 'mark', ts: 10, source: 'agent', data: { label: 'start' } },
    ]})
    const trace = await new TraceReader(dir).load('sess-abc')
    expect(trace.session.id).toBe('sess-abc')
    expect(trace.session.label).toBe('my test')
    expect(trace.events).toHaveLength(1)
    expect(trace.events[0].type).toBe('mark')
  })

  it('load() returns no test field', async () => {
    await writeSession('sess-1')
    const trace = await new TraceReader(dir).load('sess-1')
    expect((trace as Record<string, unknown>).test).toBeUndefined()
  })

  it('load() handles empty events.ndjson', async () => {
    await writeSession('sess-empty')
    const trace = await new TraceReader(dir).load('sess-empty')
    expect(trace.events).toHaveLength(0)
  })

  it('load() reads snapshot from snapshots/ dir', async () => {
    const snap: OnErrorSnapshot = {
      ts: 100, trigger: 'manual', url: 'http://localhost/', dom: '<html/>', scopes: [], globals: {}, plugins: {},
    }
    await writeSession('sess-snap', { snapshot: snap })
    const trace = await new TraceReader(dir).load('sess-snap')
    expect(trace.snapshots['manual']).toBeDefined()
    expect(trace.snapshots['manual']!.trigger).toBe('manual')
  })

  it('loadLatest() returns session with highest startedAt', async () => {
    await writeSession('sess-old', { label: 'old', startedAt: 1000 })
    await writeSession('sess-new', { label: 'new', startedAt: 9000 })
    const trace = await new TraceReader(dir).loadLatest()
    expect(trace.session.label).toBe('new')
  })

  it('listSessions() returns session directory names', async () => {
    await writeSession('sess-1')
    await writeSession('sess-2')
    const sessions = await new TraceReader(dir).listSessions()
    expect(sessions).toContain('sess-1')
    expect(sessions).toContain('sess-2')
  })

  it('readBody() reads from session bodies directory', async () => {
    await writeSession('sess-body')
    const bodiesDir = join(dir, 'sess-body', 'bodies')
    await mkdir(bodiesDir, { recursive: true })
    await writeFile(join(bodiesDir, 'evt-123.json'), '{"ok":true}')
    const body = await new TraceReader(dir).readBody('sess-body', 'evt-123')
    expect(body).toBe('{"ok":true}')
  })

  it('throws if session directory does not exist', async () => {
    await expect(new TraceReader(dir).load('nonexistent')).rejects.toThrow()
  })

  it('loadLatest() throws if no sessions', async () => {
    await expect(new TraceReader(dir).loadLatest()).rejects.toThrow('No sessions found')
  })

  it('filterEvents() filters by type', async () => {
    await writeSession('sess-filter', { events: [
      { id: 'e1', type: 'mark', ts: 10, source: 'agent', data: { label: 'x' } },
      { id: 'e2', type: 'network.request', ts: 20, source: 'cdp', data: { url: '/api', method: 'GET', headers: {} } },
    ]})
    const trace = await new TraceReader(dir).load('sess-filter')
    const result = new TraceReader(dir).filterEvents(trace, { type: 'mark' })
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('mark')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/cli && npx vitest run test/trace-reader.test.ts 2>&1 | head -20
```

Expected: FAIL.

- [ ] **Step 3: Rewrite `trace-reader.ts`**

Replace `packages/cli/src/trace-reader.ts`:

```ts
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { TraceFile, TraceEvent } from '@introspection/types'

interface FilterOptions { type?: string; url?: string; failed?: boolean }

export class TraceReader {
  constructor(private dir: string) {}

  async loadLatest(): Promise<TraceFile> {
    const sessions = await this.listSessions()
    if (sessions.length === 0) throw new Error(`No sessions found in ${this.dir}`)
    const metas = await Promise.all(
      sessions.map(async id => {
        try {
          const raw = await readFile(join(this.dir, id, 'meta.json'), 'utf-8')
          const meta = JSON.parse(raw) as { startedAt: number }
          return { id, startedAt: meta.startedAt }
        } catch { return { id, startedAt: 0 } }
      })
    )
    metas.sort((a, b) => b.startedAt - a.startedAt)
    return this.load(metas[0].id)
  }

  async load(sessionId: string): Promise<TraceFile> {
    const sessionDir = join(this.dir, sessionId)
    const metaRaw = await readFile(join(sessionDir, 'meta.json'), 'utf-8')
    const meta = JSON.parse(metaRaw) as {
      version: string; id: string; startedAt: number; endedAt?: number; label?: string
    }

    const eventsRaw = await readFile(join(sessionDir, 'events.ndjson'), 'utf-8')
    const events: TraceEvent[] = eventsRaw
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as TraceEvent)

    const snapshots: TraceFile['snapshots'] = {}
    try {
      const snapshotFiles = await readdir(join(sessionDir, 'snapshots'))
      for (const file of snapshotFiles) {
        if (!file.endsWith('.json')) continue
        const key = file.replace('.json', '')
        snapshots[key] = JSON.parse(await readFile(join(sessionDir, 'snapshots', file), 'utf-8'))
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }

    return {
      version: '2',
      session: { id: meta.id, startedAt: meta.startedAt, endedAt: meta.endedAt, label: meta.label },
      events,
      snapshots,
    }
  }

  async readBody(sessionId: string, eventId: string): Promise<string | null> {
    try { return await readFile(join(this.dir, sessionId, 'bodies', `${eventId}.json`), 'utf-8') } catch { return null }
  }

  filterEvents(trace: TraceFile, opts: FilterOptions): TraceEvent[] {
    const NETWORK_URL_TYPES = new Set(['network.request', 'network.response', 'network.error'])
    return trace.events.filter(evt => {
      if (opts.type && evt.type !== opts.type) return false
      if (opts.url && NETWORK_URL_TYPES.has(evt.type) && !(evt.data as { url: string }).url.includes(opts.url)) return false
      if (opts.failed && evt.type === 'network.response' && (evt.data as { status: number }).status < 400) return false
      return true
    })
  }

  async listSessions(): Promise<string[]> {
    try {
      const entries = await readdir(this.dir, { withFileTypes: true })
      return entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/cli && npx vitest run test/trace-reader.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/trace-reader.ts packages/cli/test/trace-reader.test.ts
git commit -m "feat(cli): read session directories with NDJSON events instead of .trace.json"
```

---

## Task 5: Update CLI commands

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/commands/summary.ts`
- Modify: `packages/cli/src/commands/eval.ts`
- Modify: `packages/cli/test/commands/summary.test.ts`
- Modify: `packages/cli/test/commands/eval.test.ts`

- [ ] **Step 1: Update `index.ts` — rename `--trace` to `--session` and update helpers**

Replace the `loadTrace` helper:
```ts
// --session defaults to latest. Breaking change: --trace is no longer supported.
async function loadTrace(opts: { session?: string }) {
  const r = new TraceReader(program.opts().dir as string)
  return opts.session ? r.load(opts.session) : r.loadLatest()
}
```

Replace every `.option('--trace <name>')` with `.option('--session <id>')` across all commands: `summary`, `timeline`, `errors`, `vars`, `network`, `dom`, `eval`, `events`.

Update the `body` command to require `--session` (defaulting to latest):
```ts
program.command('body <eventId>')
  .option('--session <id>')
  .option('--path <jsonpath>')
  .action(async (eventId, opts) => {
    const r = new TraceReader(program.opts().dir as string)
    let sessionId = opts.session
    if (!sessionId) {
      const trace = await r.loadLatest()
      sessionId = trace.session.id
    }
    const raw = await r.readBody(sessionId, eventId)
    if (!raw) { console.error(`No body found for event ${eventId}`); process.exit(1) }
    console.log(queryBody(raw, { path: opts.path }))
  })
```

Update the `list` command — no `test` field, derive duration from `startedAt`/`endedAt`:
```ts
program.command('list').description('List available sessions').action(async () => {
  const dir = program.opts().dir as string
  const r = new TraceReader(dir)
  const sessions = await r.listSessions()
  if (sessions.length === 0) { console.error(`No sessions found in ${dir}`); process.exit(1) }
  const items = await Promise.all(sessions.map(async id => {
    const trace = await r.load(id)
    return { id, trace }
  }))
  items.sort((a, b) => b.trace.session.startedAt - a.trace.session.startedAt)
  for (const { id, trace } of items) {
    const label = trace.session.label ?? id
    const duration = trace.session.endedAt != null
      ? `${trace.session.endedAt - trace.session.startedAt}ms`
      : 'ongoing'
    console.log(`${id.padEnd(40)}  ${duration.padEnd(10)}  ${label}`)
  }
})
```

- [ ] **Step 2: Update `summary.ts` and its test**

Replace `packages/cli/src/commands/summary.ts`:

```ts
import type { TraceFile, TraceEvent } from '@introspection/types'

export function buildSummary(trace: TraceFile): string {
  const lines: string[] = []
  const { session, events } = trace

  const label = session.label ?? session.id
  const duration = session.endedAt != null ? `${session.endedAt - session.startedAt}ms` : 'ongoing'
  lines.push(`Session: "${label}" (${duration})`)
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

Replace `packages/cli/test/commands/summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSummary } from '../../src/commands/summary.js'
import type { TraceFile } from '@introspection/types'

const trace: TraceFile = {
  version: '2',
  session: { id: 'sess-1', startedAt: 1000, endedAt: 3000, label: 'login test' },
  events: [
    { id: 'e1', type: 'playwright.action', ts: 50, source: 'playwright', data: { method: 'goto', args: ['/login'] } },
    { id: 'e2', type: 'network.request', ts: 100, source: 'cdp', data: { url: '/api/auth/login', method: 'POST', headers: {} } },
    { id: 'e3', type: 'network.response', ts: 150, source: 'cdp', initiator: 'e2', data: { requestId: 'e2', url: '/api/auth/login', status: 401, headers: {} } },
    { id: 'e4', type: 'js.error', ts: 200, source: 'cdp', data: { message: 'TypeError: Cannot read properties', stack: [] } },
  ],
  snapshots: {},
}

describe('buildSummary', () => {
  it('includes session label and duration', () => {
    const out = buildSummary(trace)
    expect(out).toContain('login test')
    expect(out).toContain('2000ms')
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

  it('shows "ongoing" when session has no endedAt', () => {
    const ongoing: TraceFile = { ...trace, session: { ...trace.session, endedAt: undefined } }
    expect(buildSummary(ongoing)).toContain('ongoing')
  })
})
```

- [ ] **Step 3: Update `eval.ts` and its test fixture**

In `packages/cli/src/commands/eval.ts`, expose `session` and remove `test`:

```ts
import { runInNewContext } from 'vm'
import type { TraceFile } from '@introspection/types'

export function evalExpression(trace: TraceFile, expression: string): string {
  const ctx = { events: trace.events, snapshots: trace.snapshots, session: trace.session }
  const raw = runInNewContext(expression, ctx)
  return JSON.stringify(raw ?? null, null, 2)
}
```

Update the fixture at the top of `packages/cli/test/commands/eval.test.ts`:

```ts
const trace: TraceFile = {
  version: '2',
  session: { id: 'sess-1', startedAt: 1000, endedAt: 1800, label: 'checkout test' },
  snapshots: {},
  events: [
    { id: 'e1', type: 'plugin.redux.action', ts: 100, source: 'plugin', data: { action: { type: 'CART/ADD' } } },
    { id: 'e2', type: 'plugin.redux.action', ts: 200, source: 'plugin', data: { action: { type: 'CART/REMOVE' } } },
    { id: 'e3', type: 'network.request',     ts: 300, source: 'cdp',    data: { url: '/api/checkout', method: 'POST', headers: {} } },
  ],
}
```

Update the existing `exposes test object` test to `exposes session object`:
```ts
it('exposes session object', () => {
  const result = JSON.parse(evalExpression(trace, 'session.label'))
  expect(result).toBe('checkout test')
})
```

Remove the `exposes test object` test entirely.

- [ ] **Step 4: Run all CLI tests**

```bash
cd packages/cli && npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/ packages/cli/test/
git commit -m "feat(cli): remove test semantics, use session-based TraceFile throughout"
```

---

## Task 6: Update `attach.ts` and its tests

**Files:**
- Modify: `packages/playwright/src/attach.ts`
- Modify: `packages/playwright/test/attach.test.ts`

The Playwright adapter no longer stores test result data in the trace — the trace is session data only. `TraceTest` / `TestResult` are removed from `@introspection/types` and no longer needed here either. `detach()` still accepts a result for Playwright's own internal use (e.g. the fixture knows whether the test passed) but it is not written to the trace.

- [ ] **Step 1: Remove `TestResult` import, keep `detach()` signature**

Remove imports of `TraceTest` / `TestResult` from `@introspection/types`. The `detach()` method can accept an optional result object for callers who want to pass it (the playwright-fixture uses this), but it is no longer forwarded to the server or written to disk. Define a local type if needed:

```ts
interface DetachResult {
  status?: 'passed' | 'failed' | 'timedOut' | 'skipped'
  duration?: number
  error?: string
}
```

- [ ] **Step 2: Update `startSession` call**

Replace:
```ts
await server.startSession({ id: sessionId, testTitle, testFile })
```

with:
```ts
await server.startSession({ id: sessionId, startedAt, label: testTitle })
```

- [ ] **Step 3: Update `detach` — emit `playwright.result`, stop forwarding result to server**

The Playwright adapter emits a `playwright.result` plugin event before closing. This is Playwright-specific data in the stream — not a core lifecycle event. `session.end` is emitted by the server itself (Step 5 below).

```ts
async detach(result?: DetachResult) {
  if (result) {
    sendEvent({ type: 'playwright.result', source: 'playwright', data: result })
  }
  await server.endSession(sessionId, { status: 'passed', duration: 0 }, outDir, workerIndex)
  try { await cdp.detach() } catch { /* non-fatal */ }
  await new Promise<void>((resolve) => { ws.once('close', resolve); ws.close() })
}
```

The `endSession` RPC signature is unchanged to avoid protocol churn — the server ignores the result params.

- [ ] **Step 4: Run existing attach tests — expect one failure**

```bash
cd packages/playwright && npx vitest run test/attach.test.ts 2>&1 | head -30
```

Expected: `startSession` assertion fails.

- [ ] **Step 5: Update assertions in tests**

Update the `startSession` assertion:
```ts
expect(serverProxy.startSession).toHaveBeenCalledWith({
  id: 'sess-abc', startedAt: expect.any(Number), label: 'test title',
})
```

Update the `detach()` test to verify `playwright.result` is emitted before `endSession`:
```ts
it('detach() emits playwright.result event then calls endSession', async () => {
  const { page } = makeFakePage()
  const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-end' })
  await handle.detach({ status: 'failed', duration: 500, error: 'oops' })
  const resultEvt = vi.mocked(serverProxy.event).mock.calls.find(
    ([, evt]) => (evt as { type: string }).type === 'playwright.result'
  )
  expect(resultEvt).toBeDefined()
  expect((resultEvt![1] as { data: Record<string, unknown> }).data.status).toBe('failed')
  expect(serverProxy.endSession).toHaveBeenCalled()
})

it('detach() without result emits no playwright.result event', async () => {
  const { page } = makeFakePage()
  const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-noend' })
  await handle.detach()
  const resultEvt = vi.mocked(serverProxy.event).mock.calls.find(
    ([, evt]) => (evt as { type: string }).type === 'playwright.result'
  )
  expect(resultEvt).toBeUndefined()
})
```

- [ ] **Step 6: Run all tests**

```bash
cd packages/playwright && npx vitest run test/attach.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/playwright/src/attach.ts packages/playwright/test/attach.test.ts
git commit -m "feat(playwright): remove test-centric types, session has no test result data"
```

---

## Verification

```bash
cd packages/cli && npm test
cd packages/playwright && npm test
cd packages/types && npx tsc --noEmit
cd packages/vite && npx tsc --noEmit
```

The on-disk format is now:
- `.introspect/<session-id>/meta.json` — session: id, startedAt, endedAt, label. Nothing else.
- `.introspect/<session-id>/events.ndjson` — streaming events, queryable during session
- `.introspect/<session-id>/snapshots/*.json` — snapshots
- `.introspect/<session-id>/bodies/*.json` — response body sidecars

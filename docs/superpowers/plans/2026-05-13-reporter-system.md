# Reporter System Implementation Plan

> **Status:** landed (2026-05-13) · spec: `docs/superpowers/specs/2026-05-08-reporter-system-design.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the live-only Reporter API per `docs/superpowers/specs/2026-05-08-reporter-system-design.md`, plus a reference `summaryReporter` in a new `@introspection/reporters` package.

**Architecture:** Reporters are plain objects with optional lifecycle methods (`onTraceStart`, `onEvent`, `onTestStart`, `onTestEnd`, `onTraceEnd`). They are passed to `createTraceWriter` and driven by a small lifecycle runner that subscribes to the trace bus, maintains a per-test event-slice buffer, traps per-reporter errors, and wraps async callbacks with `track()` so `finalize()` waits for disk writes. No post-hoc replay.

**Tech Stack:** TypeScript ESM, vitest, Node `fs/promises`. No new runtime dependencies.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `packages/types/src/index.ts` | modify | Add `IntrospectionReporter`, `TestStartInfo`, `TestEndInfo`, `ReporterContext`; widen `introspect:warning` source union to include `'reporter'`. |
| `packages/write/src/reporter-lifecycle.ts` | create | The lifecycle runner: subscribes to the bus, manages the per-test slice buffer, calls each reporter's hooks, traps errors, tracks async work. |
| `packages/write/src/trace.ts` | modify | Accept `reporters?: IntrospectionReporter[]` in `CreateTraceWriterOptions`, construct a `ReporterContext`, instantiate the runner, drive `onTraceStart` at creation and `onTraceEnd` at finalize. |
| `packages/write/src/index.ts` | modify | Re-export new public types. |
| `packages/write/test/reporters.test.ts` | create | Integration tests: lifecycle hooks fire correctly, slicing works, errors are trapped, async callbacks are awaited. |
| `packages/reporters/package.json` | create | New workspace package `@introspection/reporters`. |
| `packages/reporters/tsconfig.json` | create | TS config (copy `packages/write/tsconfig.json`). |
| `packages/reporters/src/index.ts` | create | `export * from './summary-reporter.js'`. |
| `packages/reporters/src/summary-reporter.ts` | create | `summaryReporter({ outFile, format? })` implementation. |
| `packages/reporters/test/summary-reporter.test.ts` | create | summaryReporter unit + concurrent-append tests. |

---

## Task 1: Add reporter types to `@introspection/types`

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add the reporter types**

Insert the following at the end of the existing "Plugin system" section in `packages/types/src/index.ts` (right after the `IntrospectConfig` interface around line 785; keep the file's section comment style):

```ts
// ─── Reporter system ─────────────────────────────────────────────────────────

export interface TestStartInfo {
  /** Id of the test.start event (matches BaseEvent.id). */
  testId: string
  label: string
  titlePath: string[]
  /** Wall-clock ms-since-trace-start. */
  startedAt: number
}

export interface TestEndInfo extends TestStartInfo {
  endedAt: number
  duration?: number
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
  error?: string
  /** All events emitted between this test's test.start and test.end (inclusive). */
  events: TraceEvent[]
  /** Every PayloadAsset referenced by events in the slice, flattened in emission order. */
  assets: PayloadAsset[]
}

export interface ReporterContext {
  traceId: string
  /** Trace directory (e.g. `.introspect/<run-id>/<test-id>`). */
  outDir: string
  /** Run directory (e.g. `.introspect/<run-id>`). Defaults to the parent of outDir. */
  runDir: string
  meta: TraceMeta
  /** Convenience writer for reporter outputs. Relative paths resolve against runDir. */
  writeFile(path: string, content: string | Uint8Array): Promise<void>
  /** Track an async operation so finalize() waits for it. */
  track(operation: () => Promise<unknown>): void
}

export interface IntrospectionReporter {
  name: string
  onTraceStart?(ctx: ReporterContext): void | Promise<void>
  onEvent?(event: TraceEvent, ctx: ReporterContext): void | Promise<void>
  onTestStart?(test: TestStartInfo, ctx: ReporterContext): void | Promise<void>
  onTestEnd?(test: TestEndInfo, ctx: ReporterContext): void | Promise<void>
  onTraceEnd?(ctx: ReporterContext): void | Promise<void>
}
```

Then widen the `introspect:warning` source union in `BusPayloadMap` (around line 705). Find:

```ts
'introspect:warning': { error: { name: string; message: string; source: 'cdp' | 'write' | 'parse' | 'plugin'; cause?: unknown; stack?: string; pluginName?: string; method?: string } }
```

Replace with:

```ts
'introspect:warning': { error: { name: string; message: string; source: 'cdp' | 'write' | 'parse' | 'plugin' | 'reporter'; cause?: unknown; stack?: string; pluginName?: string; method?: string; reporterName?: string } }
```

(Added `'reporter'` to the source union and an optional `reporterName` field.)

- [ ] **Step 2: Typecheck**

Run: `pnpm -C packages/types typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "types: add reporter types (IntrospectionReporter, TestStartInfo, TestEndInfo, ReporterContext)"
```

---

## Task 2: Plumb `reporters` option through `createTraceWriter`

**Files:**
- Modify: `packages/write/src/trace.ts`
- Modify: `packages/write/test/trace-writer.test.ts`

This is a zero-behavior plumbing task — accept the option, store it, but call nothing. Establishes the surface before any lifecycle code lands.

- [ ] **Step 1: Write the failing test**

Append to `packages/write/test/trace-writer.test.ts` (inside the existing top-level `describe('createTraceWriter', ...)` block, before the closing `})`):

```ts
  it('accepts an optional reporters array', async () => {
    const reporter = { name: 'noop' }
    const writer = await createTraceWriter({ outDir, id: 'rs1', reporters: [reporter] })
    expect(writer.id).toBe('rs1')
  })
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm -C packages/write test -- trace-writer`
Expected: FAIL with a type error or runtime error about `reporters` not being a known option.

- [ ] **Step 3: Add the option to `CreateTraceWriterOptions`**

In `packages/write/src/trace.ts`, update the imports near the top:

```ts
import type { TraceWriter, TraceEvent, BusPayloadMap, PluginMeta, EmitInput, TraceMeta, WriteAssetOptions, PayloadAsset, IntrospectionReporter } from '@introspection/types'
```

Then update the options interface:

```ts
export interface CreateTraceWriterOptions {
  outDir?: string
  id?: string
  label?: string
  plugins?: PluginMeta[]
  reporters?: IntrospectionReporter[]
  adapter?: MemoryWriteAdapter
}
```

In the body of `createTraceWriter`, after the existing `const adapter = options.adapter` line, add:

```ts
  const reporters = options.reporters ?? []
```

(Used by the next task; nothing else changes here.)

- [ ] **Step 4: Run test and verify it passes**

Run: `pnpm -C packages/write test -- trace-writer`
Expected: PASS for the new test and all existing tests.

- [ ] **Step 5: Commit**

```bash
git add packages/write/src/trace.ts packages/write/test/trace-writer.test.ts
git commit -m "write: accept optional reporters option in createTraceWriter"
```

---

## Task 3: Create the reporter lifecycle runner

**Files:**
- Create: `packages/write/src/reporter-lifecycle.ts`
- Create: `packages/write/test/reporters.test.ts`
- Modify: `packages/write/src/trace.ts`

The runner is the small module that holds slicing state and dispatches hooks. We add it with a single behavior first (`onTraceStart`), then extend in subsequent tasks.

- [ ] **Step 1: Write the failing test**

Create `packages/write/test/reporters.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceWriter } from '../src/index.js'
import type { IntrospectionReporter, ReporterContext } from '@introspection/types'

let outDir: string

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-reporter-'))
})

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

describe('reporter lifecycle', () => {
  it('calls onTraceStart exactly once with a populated context', async () => {
    const calls: ReporterContext[] = []
    const reporter: IntrospectionReporter = {
      name: 'capture',
      onTraceStart(ctx) { calls.push(ctx) },
    }
    await createTraceWriter({ outDir, id: 'sess', reporters: [reporter] })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.traceId).toBe('sess')
    expect(calls[0]!.outDir).toBe(join(outDir, 'sess'))
    expect(calls[0]!.runDir).toBe(outDir)
    expect(calls[0]!.meta.id).toBe('sess')
  })
})
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm -C packages/write test -- reporters`
Expected: FAIL — `calls` is empty (no lifecycle wiring yet).

- [ ] **Step 3: Create the lifecycle runner module**

Create `packages/write/src/reporter-lifecycle.ts`:

```ts
import type { IntrospectionReporter, ReporterContext, TraceEvent, TraceBus, TestEndInfo, TestStartInfo, PayloadAsset } from '@introspection/types'

export interface ReporterRunner {
  start(): Promise<void>
  end(): Promise<void>
}

export function createReporterRunner(
  reporters: IntrospectionReporter[],
  ctx: ReporterContext,
  bus: TraceBus,
): ReporterRunner {
  return {
    async start() {
      for (const reporter of reporters) {
        if (!reporter.onTraceStart) continue
        await reporter.onTraceStart(ctx)
      }
    },
    async end() {
      for (const reporter of reporters) {
        if (!reporter.onTraceEnd) continue
        await reporter.onTraceEnd(ctx)
      }
    },
  }
}
```

(More hooks land in later tasks.)

- [ ] **Step 4: Build the ReporterContext and start the runner in trace.ts**

In `packages/write/src/trace.ts`, add a `path` import near the existing imports:

```ts
import { dirname, isAbsolute, join } from 'path'
import { mkdir, writeFile as fsWriteFile } from 'fs/promises'
```

(The `writeFile` import is aliased to avoid shadowing the `writeFile` method on `ReporterContext`.)

Then update the imports for the lifecycle module:

```ts
import { createReporterRunner } from './reporter-lifecycle.js'
```

Inside `createTraceWriter`, after the existing `const tracker = createTracker()` line, build the context and start the runner. The current trace directory is `<outDir>/<id>`; runDir is `outDir`:

```ts
  const traceDir = join(outDir, id)
  const reporterCtx: ReporterContext = {
    traceId: id,
    outDir: traceDir,
    runDir: outDir,
    meta,
    writeFile: async (target, content) => {
      const resolved = isAbsolute(target) ? target : join(outDir, target)
      await mkdir(dirname(resolved), { recursive: true })
      await fsWriteFile(resolved, content)
    },
    track: (operation) => tracker.track(operation),
  }
  const reporterRunner = createReporterRunner(reporters, reporterCtx, bus)
  await reporterRunner.start()
```

Add `ReporterContext` to the type imports at the top:

```ts
import type { TraceWriter, TraceEvent, BusPayloadMap, PluginMeta, EmitInput, TraceMeta, WriteAssetOptions, PayloadAsset, IntrospectionReporter, ReporterContext } from '@introspection/types'
```

- [ ] **Step 5: Run test and verify it passes**

Run: `pnpm -C packages/write test -- reporters`
Expected: PASS — the single test now succeeds; `calls` contains one ReporterContext with the expected fields.

- [ ] **Step 6: Commit**

```bash
git add packages/write/src/reporter-lifecycle.ts packages/write/src/trace.ts packages/write/test/reporters.test.ts
git commit -m "write: scaffold reporter lifecycle runner; call onTraceStart at trace start"
```

---

## Task 4: `onEvent` callback fires for every emitted event

**Files:**
- Modify: `packages/write/src/reporter-lifecycle.ts`
- Modify: `packages/write/src/trace.ts`
- Modify: `packages/write/test/reporters.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside `describe('reporter lifecycle', ...)`:

```ts
  it('calls onEvent for every emitted event, in emission order', async () => {
    const seen: string[] = []
    const reporter: IntrospectionReporter = {
      name: 'capture',
      onEvent(event) { seen.push(event.type) },
    }
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [reporter] })
    await writer.emit({ type: 'mark', metadata: { label: 'a' } })
    await writer.emit({ type: 'mark', metadata: { label: 'b' } })
    await writer.flush()
    expect(seen).toEqual(['mark', 'mark'])
  })
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm -C packages/write test -- reporters`
Expected: FAIL — `seen` is empty.

- [ ] **Step 3: Wire onEvent in the runner**

In `packages/write/src/reporter-lifecycle.ts`, add a `handleEvent` method to the `ReporterRunner` interface and implementation:

```ts
export interface ReporterRunner {
  start(): Promise<void>
  handleEvent(event: TraceEvent): void
  end(): Promise<void>
}

export function createReporterRunner(
  reporters: IntrospectionReporter[],
  ctx: ReporterContext,
  bus: TraceBus,
): ReporterRunner {
  return {
    async start() {
      for (const reporter of reporters) {
        if (!reporter.onTraceStart) continue
        await reporter.onTraceStart(ctx)
      }
    },
    handleEvent(event) {
      for (const reporter of reporters) {
        if (!reporter.onEvent) continue
        const result = reporter.onEvent(event, ctx)
        if (result instanceof Promise) ctx.track(() => result)
      }
    },
    async end() {
      for (const reporter of reporters) {
        if (!reporter.onTraceEnd) continue
        await reporter.onTraceEnd(ctx)
      }
    },
  }
}
```

- [ ] **Step 4: Call `handleEvent` from the trace writer's emit**

In `packages/write/src/trace.ts`, inside the `emit` function, after the existing `void bus.emit(...)` line and before `return writePromise`, add:

```ts
    reporterRunner.handleEvent(full)
```

So the `emit` function looks like:

```ts
  function emit(event: EmitInput): Promise<void> {
    const full = { id: randomUUID(), timestamp: timestamp(), ...event } as TraceEvent
    const writePromise = queue.enqueue(async () => {
      if (adapter) {
        const path = `${id}/events.ndjson`
        const line = JSON.stringify(full) + '\n'
        await adapter.appendText(path, line)
      } else {
        await appendEvent(outDir, id, full)
      }
    })
    void bus.emit(full.type, full as BusPayloadMap[typeof full.type])
    reporterRunner.handleEvent(full)
    return writePromise
  }
```

- [ ] **Step 5: Run test and verify it passes**

Run: `pnpm -C packages/write test -- reporters`
Expected: PASS — both reporter tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/write/src/reporter-lifecycle.ts packages/write/src/trace.ts packages/write/test/reporters.test.ts
git commit -m "write: call reporter.onEvent for every emitted event"
```

---

## Task 5: `onTestStart` and per-test slicing buffer

**Files:**
- Modify: `packages/write/src/reporter-lifecycle.ts`
- Modify: `packages/write/test/reporters.test.ts`

When a `test.start` event arrives, the runner builds a `TestStartInfo` and calls `onTestStart`, then begins collecting events into a per-test buffer (including the `test.start` event itself).

- [ ] **Step 1: Write the failing test**

Append inside `describe('reporter lifecycle', ...)`:

```ts
  it('calls onTestStart with titlePath and label when a test.start event is emitted', async () => {
    const seen: TestStartInfo[] = []
    const reporter: IntrospectionReporter = {
      name: 'capture',
      onTestStart(info) { seen.push(info) },
    }
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [reporter] })
    await writer.emit({ type: 'test.start', metadata: { label: 'logs in', titlePath: ['auth', 'logs in'] } })
    await writer.flush()
    expect(seen).toHaveLength(1)
    expect(seen[0]!.label).toBe('logs in')
    expect(seen[0]!.titlePath).toEqual(['auth', 'logs in'])
    expect(typeof seen[0]!.testId).toBe('string')
    expect(typeof seen[0]!.startedAt).toBe('number')
  })
```

Add the type import at the top of `packages/write/test/reporters.test.ts`:

```ts
import type { IntrospectionReporter, ReporterContext, TestStartInfo } from '@introspection/types'
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm -C packages/write test -- reporters`
Expected: FAIL — `seen` is empty.

- [ ] **Step 3: Implement test.start detection and slicing init**

In `packages/write/src/reporter-lifecycle.ts`, replace the entire file with:

```ts
import type { IntrospectionReporter, ReporterContext, TraceEvent, TraceBus, TestEndInfo, TestStartInfo, PayloadAsset, TestStartEvent } from '@introspection/types'

interface ActiveTest {
  info: TestStartInfo
  events: TraceEvent[]
}

export interface ReporterRunner {
  start(): Promise<void>
  handleEvent(event: TraceEvent): void
  end(): Promise<void>
}

export function createReporterRunner(
  reporters: IntrospectionReporter[],
  ctx: ReporterContext,
  bus: TraceBus,
): ReporterRunner {
  let active: ActiveTest | null = null

  function deliverTestStart(event: TestStartEvent) {
    const info: TestStartInfo = {
      testId: event.id,
      label: event.metadata.label,
      titlePath: event.metadata.titlePath,
      startedAt: event.timestamp,
    }
    active = { info, events: [event] }
    for (const reporter of reporters) {
      if (!reporter.onTestStart) continue
      const result = reporter.onTestStart(info, ctx)
      if (result instanceof Promise) ctx.track(() => result)
    }
  }

  return {
    async start() {
      for (const reporter of reporters) {
        if (!reporter.onTraceStart) continue
        await reporter.onTraceStart(ctx)
      }
    },
    handleEvent(event) {
      if (event.type === 'test.start') {
        deliverTestStart(event)
      } else if (active) {
        active.events.push(event)
      }
      for (const reporter of reporters) {
        if (!reporter.onEvent) continue
        const result = reporter.onEvent(event, ctx)
        if (result instanceof Promise) ctx.track(() => result)
      }
    },
    async end() {
      for (const reporter of reporters) {
        if (!reporter.onTraceEnd) continue
        await reporter.onTraceEnd(ctx)
      }
    },
  }
}
```

- [ ] **Step 4: Run test and verify it passes**

Run: `pnpm -C packages/write test -- reporters`
Expected: PASS for all three reporter tests.

- [ ] **Step 5: Commit**

```bash
git add packages/write/src/reporter-lifecycle.ts packages/write/test/reporters.test.ts
git commit -m "write: call reporter.onTestStart and begin per-test event buffer on test.start"
```

---

## Task 6: `onTestEnd` delivers the per-test slice with flattened assets

**Files:**
- Modify: `packages/write/src/reporter-lifecycle.ts`
- Modify: `packages/write/test/reporters.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside `describe('reporter lifecycle', ...)`:

```ts
  it('calls onTestEnd with the event slice (inclusive) and flattened assets', async () => {
    const seen: TestEndInfo[] = []
    const reporter: IntrospectionReporter = {
      name: 'capture',
      onTestEnd(info) { seen.push(info) },
    }
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [reporter] })
    await writer.emit({ type: 'test.start', metadata: { label: 't', titlePath: ['t'] } })
    await writer.emit({ type: 'mark', metadata: { label: 'a' } })
    await writer.emit({
      type: 'mark',
      metadata: { label: 'b' },
      payloads: { snapshot: { kind: 'asset', format: 'json', path: 's/assets/x.json' } },
    })
    await writer.emit({ type: 'test.end', metadata: { label: 't', titlePath: ['t'], status: 'passed', duration: 42 } })
    await writer.flush()
    expect(seen).toHaveLength(1)
    const info = seen[0]!
    expect(info.status).toBe('passed')
    expect(info.duration).toBe(42)
    expect(info.events.map(e => e.type)).toEqual(['test.start', 'mark', 'mark', 'test.end'])
    expect(info.assets).toHaveLength(1)
    expect(info.assets[0]!.path).toBe('s/assets/x.json')
  })

  it('does not deliver onTestEnd for events outside any test', async () => {
    const seen: TestEndInfo[] = [];
    const events: string[] = [];
    const reporter: IntrospectionReporter = {
      name: 'capture',
      onTestEnd(info) { seen.push(info) },
      onEvent(event) { events.push(event.type) },
    }
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [reporter] })
    await writer.emit({ type: 'mark', metadata: { label: 'outside' } })
    await writer.flush()
    expect(seen).toHaveLength(0)
    expect(events).toEqual(['mark'])
  })
```

Add `TestEndInfo` to the type imports at the top of the test file:

```ts
import type { IntrospectionReporter, ReporterContext, TestStartInfo, TestEndInfo } from '@introspection/types'
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm -C packages/write test -- reporters`
Expected: FAIL — the first new test fails because `seen` stays empty.

- [ ] **Step 3: Implement onTestEnd delivery**

In `packages/write/src/reporter-lifecycle.ts`, extend the `handleEvent` logic. Add a `deliverTestEnd` helper above the returned object, and call it on `test.end`:

Replace the `handleEvent` body and add the helper. The full file is now:

```ts
import type { IntrospectionReporter, ReporterContext, TraceEvent, TraceBus, TestEndInfo, TestStartInfo, PayloadAsset, TestStartEvent, TestEndEvent } from '@introspection/types'

interface ActiveTest {
  info: TestStartInfo
  events: TraceEvent[]
}

export interface ReporterRunner {
  start(): Promise<void>
  handleEvent(event: TraceEvent): void
  end(): Promise<void>
}

function flattenAssets(events: TraceEvent[]): PayloadAsset[] {
  const out: PayloadAsset[] = []
  for (const event of events) {
    if (!event.payloads) continue
    for (const key of Object.keys(event.payloads)) {
      const payload = event.payloads[key]
      if (payload && payload.kind === 'asset') out.push(payload)
    }
  }
  return out
}

function asEndStatus(raw: string): TestEndInfo['status'] {
  if (raw === 'passed' || raw === 'failed' || raw === 'timedOut' || raw === 'skipped' || raw === 'interrupted') return raw
  return 'failed'
}

export function createReporterRunner(
  reporters: IntrospectionReporter[],
  ctx: ReporterContext,
  bus: TraceBus,
): ReporterRunner {
  let active: ActiveTest | null = null

  function deliverTestStart(event: TestStartEvent) {
    const info: TestStartInfo = {
      testId: event.id,
      label: event.metadata.label,
      titlePath: event.metadata.titlePath,
      startedAt: event.timestamp,
    }
    active = { info, events: [event] }
    for (const reporter of reporters) {
      if (!reporter.onTestStart) continue
      const result = reporter.onTestStart(info, ctx)
      if (result instanceof Promise) ctx.track(() => result)
    }
  }

  function deliverTestEnd(event: TestEndEvent) {
    if (!active) return
    active.events.push(event)
    const info: TestEndInfo = {
      ...active.info,
      endedAt: event.timestamp,
      duration: event.metadata.duration,
      status: asEndStatus(event.metadata.status),
      error: event.metadata.error,
      events: active.events,
      assets: flattenAssets(active.events),
    }
    active = null
    for (const reporter of reporters) {
      if (!reporter.onTestEnd) continue
      const result = reporter.onTestEnd(info, ctx)
      if (result instanceof Promise) ctx.track(() => result)
    }
  }

  return {
    async start() {
      for (const reporter of reporters) {
        if (!reporter.onTraceStart) continue
        await reporter.onTraceStart(ctx)
      }
    },
    handleEvent(event) {
      if (event.type === 'test.start') {
        deliverTestStart(event)
      } else if (event.type === 'test.end') {
        deliverTestEnd(event)
      } else if (active) {
        active.events.push(event)
      }
      for (const reporter of reporters) {
        if (!reporter.onEvent) continue
        const result = reporter.onEvent(event, ctx)
        if (result instanceof Promise) ctx.track(() => result)
      }
    },
    async end() {
      for (const reporter of reporters) {
        if (!reporter.onTraceEnd) continue
        await reporter.onTraceEnd(ctx)
      }
    },
  }
}
```

Note: the order in `handleEvent` matters — `deliverTestEnd` must consume the event *before* the generic `onEvent` loop, but the test slice must still include the `test.end` event in `info.events`. The implementation above achieves that by pushing the event into `active.events` inside `deliverTestEnd` before reading the slice.

- [ ] **Step 4: Run test and verify it passes**

Run: `pnpm -C packages/write test -- reporters`
Expected: PASS for all reporter tests.

- [ ] **Step 5: Commit**

```bash
git add packages/write/src/reporter-lifecycle.ts packages/write/test/reporters.test.ts
git commit -m "write: deliver per-test slice and flattened assets via onTestEnd"
```

---

## Task 7: `onTraceEnd` fires at finalize

**Files:**
- Modify: `packages/write/src/trace.ts`
- Modify: `packages/write/test/reporters.test.ts`

The runner already has an `end()` method; this task wires it into `finalize()`.

- [ ] **Step 1: Write the failing test**

Append inside `describe('reporter lifecycle', ...)`:

```ts
  it('calls onTraceEnd exactly once when finalize() runs', async () => {
    let count = 0
    const reporter: IntrospectionReporter = { name: 'capture', onTraceEnd() { count++ } }
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [reporter] })
    await writer.finalize()
    expect(count).toBe(1)
  })
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm -C packages/write test -- reporters`
Expected: FAIL — `count` is 0; the runner's `end()` is never called.

- [ ] **Step 3: Call `reporterRunner.end()` in finalize**

In `packages/write/src/trace.ts`, modify the existing `finalize` method:

```ts
    async finalize() {
      await bus.emit('detach', { trigger: 'detach', timestamp: timestamp() })
      await tracker.flush()
      await queue.flush()
      await reporterRunner.end()
      await tracker.flush()
      if (adapter) {
        await adapter.writeText(`${id}/meta.json`, JSON.stringify({ ...meta, endedAt: Date.now() }, null, 2))
      } else {
        await finalizeTrace(outDir, id, Date.now())
      }
    },
```

(The second `tracker.flush()` after `reporterRunner.end()` catches any async work `onTraceEnd` itself tracked.)

- [ ] **Step 4: Run test and verify it passes**

Run: `pnpm -C packages/write test -- reporters`
Expected: PASS for all reporter tests.

- [ ] **Step 5: Commit**

```bash
git add packages/write/src/trace.ts packages/write/test/reporters.test.ts
git commit -m "write: call reporter.onTraceEnd from trace finalize"
```

---

## Task 8: Reporter errors are trapped, warned, and disable that reporter

**Files:**
- Modify: `packages/write/src/reporter-lifecycle.ts`
- Modify: `packages/write/test/reporters.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside `describe('reporter lifecycle', ...)`:

```ts
  it('disables a reporter after it throws and emits an introspect:warning', async () => {
    const goodEvents: string[] = []
    const badEvents: string[] = []
    const warnings: string[] = []
    const bad: IntrospectionReporter = {
      name: 'bad',
      onEvent(event) {
        badEvents.push(event.type)
        throw new Error('boom')
      },
    }
    const good: IntrospectionReporter = {
      name: 'good',
      onEvent(event) { goodEvents.push(event.type) },
    }
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [bad, good] })
    writer.bus.on('introspect:warning', (w) => warnings.push(w.error.reporterName ?? ''))
    await writer.emit({ type: 'mark', metadata: { label: 'a' } })
    await writer.emit({ type: 'mark', metadata: { label: 'b' } })
    await writer.flush()
    expect(badEvents).toEqual(['mark'])              // disabled after first throw
    expect(goodEvents).toEqual(['mark', 'mark'])     // unaffected
    expect(warnings).toContain('bad')
  })
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm -C packages/write test -- reporters`
Expected: FAIL — the throw propagates out of `emit` (and the test crashes before reaching its assertions), or the bad reporter keeps being called.

- [ ] **Step 3: Add a disabled-set and error trap in the runner**

In `packages/write/src/reporter-lifecycle.ts`, replace the file with:

```ts
import type { IntrospectionReporter, ReporterContext, TraceEvent, TraceBus, TestEndInfo, TestStartInfo, PayloadAsset, TestStartEvent, TestEndEvent } from '@introspection/types'

interface ActiveTest {
  info: TestStartInfo
  events: TraceEvent[]
}

export interface ReporterRunner {
  start(): Promise<void>
  handleEvent(event: TraceEvent): void
  end(): Promise<void>
}

function flattenAssets(events: TraceEvent[]): PayloadAsset[] {
  const out: PayloadAsset[] = []
  for (const event of events) {
    if (!event.payloads) continue
    for (const key of Object.keys(event.payloads)) {
      const payload = event.payloads[key]
      if (payload && payload.kind === 'asset') out.push(payload)
    }
  }
  return out
}

function asEndStatus(raw: string): TestEndInfo['status'] {
  if (raw === 'passed' || raw === 'failed' || raw === 'timedOut' || raw === 'skipped' || raw === 'interrupted') return raw
  return 'failed'
}

export function createReporterRunner(
  reporters: IntrospectionReporter[],
  ctx: ReporterContext,
  bus: TraceBus,
): ReporterRunner {
  let active: ActiveTest | null = null
  const disabled = new Set<IntrospectionReporter>()

  function reportFailure(reporter: IntrospectionReporter, method: string, cause: unknown) {
    disabled.add(reporter)
    const error = cause instanceof Error ? cause : new Error(String(cause))
    void bus.emit('introspect:warning', {
      error: {
        name: error.name,
        message: error.message,
        source: 'reporter',
        cause,
        stack: error.stack,
        reporterName: reporter.name,
        method,
      },
    })
  }

  function invoke<T>(
    reporter: IntrospectionReporter,
    method: string,
    call: () => T | Promise<T>,
  ): void {
    if (disabled.has(reporter)) return
    let result: T | Promise<T>
    try {
      result = call()
    } catch (cause) {
      reportFailure(reporter, method, cause)
      return
    }
    if (result instanceof Promise) {
      ctx.track(() => result.then(() => undefined, (cause) => { reportFailure(reporter, method, cause) }))
    }
  }

  function deliverTestStart(event: TestStartEvent) {
    const info: TestStartInfo = {
      testId: event.id,
      label: event.metadata.label,
      titlePath: event.metadata.titlePath,
      startedAt: event.timestamp,
    }
    active = { info, events: [event] }
    for (const reporter of reporters) {
      if (!reporter.onTestStart) continue
      invoke(reporter, 'onTestStart', () => reporter.onTestStart!(info, ctx))
    }
  }

  function deliverTestEnd(event: TestEndEvent) {
    if (!active) return
    active.events.push(event)
    const info: TestEndInfo = {
      ...active.info,
      endedAt: event.timestamp,
      duration: event.metadata.duration,
      status: asEndStatus(event.metadata.status),
      error: event.metadata.error,
      events: active.events,
      assets: flattenAssets(active.events),
    }
    active = null
    for (const reporter of reporters) {
      if (!reporter.onTestEnd) continue
      invoke(reporter, 'onTestEnd', () => reporter.onTestEnd!(info, ctx))
    }
  }

  return {
    async start() {
      for (const reporter of reporters) {
        if (!reporter.onTraceStart) continue
        invoke(reporter, 'onTraceStart', () => reporter.onTraceStart!(ctx))
      }
    },
    handleEvent(event) {
      if (event.type === 'test.start') {
        deliverTestStart(event)
      } else if (event.type === 'test.end') {
        deliverTestEnd(event)
      } else if (active) {
        active.events.push(event)
      }
      for (const reporter of reporters) {
        if (!reporter.onEvent) continue
        invoke(reporter, 'onEvent', () => reporter.onEvent!(event, ctx))
      }
    },
    async end() {
      for (const reporter of reporters) {
        if (!reporter.onTraceEnd) continue
        invoke(reporter, 'onTraceEnd', () => reporter.onTraceEnd!(ctx))
      }
    },
  }
}
```

- [ ] **Step 4: Run test and verify it passes**

Run: `pnpm -C packages/write test -- reporters`
Expected: PASS for all reporter tests.

- [ ] **Step 5: Commit**

```bash
git add packages/write/src/reporter-lifecycle.ts packages/write/test/reporters.test.ts
git commit -m "write: trap reporter errors, emit introspect:warning, disable offender"
```

---

## Task 9: Orphan `test.end` emits a warning and is skipped

**Files:**
- Modify: `packages/write/src/reporter-lifecycle.ts`
- Modify: `packages/write/test/reporters.test.ts`

If a `test.end` arrives with no matching `test.start`, the runner already returns early from `deliverTestEnd` (silent). The spec requires a warning.

- [ ] **Step 1: Write the failing test**

Append inside `describe('reporter lifecycle', ...)`:

```ts
  it('emits an introspect:warning when test.end arrives without a matching test.start', async () => {
    const warnings: Array<{ source: string; message: string }> = []
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [] })
    writer.bus.on('introspect:warning', (w) => warnings.push({ source: w.error.source, message: w.error.message }))
    await writer.emit({ type: 'test.end', metadata: { label: 't', titlePath: ['t'], status: 'passed' } })
    await writer.flush()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.source).toBe('reporter')
    expect(warnings[0]!.message).toMatch(/test\.end/i)
    expect(warnings[0]!.message).toMatch(/no matching test\.start/i)
  })
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm -C packages/write test -- reporters`
Expected: FAIL — `warnings` is empty.

- [ ] **Step 3: Emit the warning in `deliverTestEnd`**

In `packages/write/src/reporter-lifecycle.ts`, change the early-return branch in `deliverTestEnd` from:

```ts
    if (!active) return
```

to:

```ts
    if (!active) {
      void bus.emit('introspect:warning', {
        error: {
          name: 'OrphanTestEnd',
          message: 'test.end emitted with no matching test.start',
          source: 'reporter',
        },
      })
      return
    }
```

- [ ] **Step 4: Run test and verify it passes**

Run: `pnpm -C packages/write test -- reporters`
Expected: PASS for all reporter tests.

- [ ] **Step 5: Commit**

```bash
git add packages/write/src/reporter-lifecycle.ts packages/write/test/reporters.test.ts
git commit -m "write: warn on orphan test.end (no matching test.start)"
```

---

## Task 10: Re-export reporter types from `@introspection/write`

**Files:**
- Modify: `packages/write/src/index.ts`

(The `IntrospectionReporter` types live in `@introspection/types` — already accessible. This step is only for symbols `@introspection/reporters` will need from `@introspection/write`; if none, skip the file change but verify the package builds.)

- [ ] **Step 1: Confirm exports**

Run: `pnpm -C packages/write build`
Expected: PASS.

- [ ] **Step 2: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: PASS (or whatever the existing baseline is — no new failures).

- [ ] **Step 3: Commit (only if files changed)**

If nothing changed in this task, no commit needed. Otherwise:

```bash
git add packages/write/src/index.ts
git commit -m "write: re-export reporter-related symbols"
```

---

## Task 11: Scaffold `@introspection/reporters` package

**Files:**
- Create: `packages/reporters/package.json`
- Create: `packages/reporters/tsconfig.json`
- Create: `packages/reporters/src/index.ts`

- [ ] **Step 1: Create `package.json`**

Create `packages/reporters/package.json`:

```json
{
  "name": "@introspection/reporters",
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
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@introspection/types": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Copy from a peer package:

```bash
cp packages/write/tsconfig.json packages/reporters/tsconfig.json
```

- [ ] **Step 3: Create the index**

Create `packages/reporters/src/index.ts`:

```ts
export {}
```

(Empty placeholder; the next task adds the actual export.)

- [ ] **Step 4: Install and verify**

Run: `pnpm install`
Expected: workspace package recognized, no errors.

Run: `pnpm -C packages/reporters typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporters/
git commit -m "reporters: scaffold @introspection/reporters package"
```

---

## Task 12: `summaryReporter` — default JSONL shape

**Files:**
- Create: `packages/reporters/src/summary-reporter.ts`
- Modify: `packages/reporters/src/index.ts`
- Create: `packages/reporters/test/summary-reporter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/reporters/test/summary-reporter.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceWriter } from '@introspection/write'
import { summaryReporter } from '../src/index.js'

let outDir: string

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-summary-'))
})

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

describe('summaryReporter', () => {
  it('appends one JSON line per test to outFile with the default shape', async () => {
    const writer = await createTraceWriter({
      outDir,
      id: 's',
      reporters: [summaryReporter({ outFile: 'tests.jsonl' })],
    })
    await writer.emit({ type: 'test.start', metadata: { label: 'one', titlePath: ['suite', 'one'] } })
    await writer.emit({ type: 'mark', metadata: { label: 'a' } })
    await writer.emit({ type: 'test.end', metadata: { label: 'one', titlePath: ['suite', 'one'], status: 'passed', duration: 100 } })

    await writer.emit({ type: 'test.start', metadata: { label: 'two', titlePath: ['suite', 'two'] } })
    await writer.emit({ type: 'test.end', metadata: { label: 'two', titlePath: ['suite', 'two'], status: 'failed', duration: 200, error: 'nope' } })

    await writer.finalize()

    const contents = await readFile(join(outDir, 'tests.jsonl'), 'utf-8')
    const lines = contents.trim().split('\n').map(line => JSON.parse(line))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      titlePath: ['suite', 'one'],
      status: 'passed',
      duration: 100,
      error: null,
      eventCount: 3,    // test.start + mark + test.end
    })
    expect(typeof lines[0].startedAt).toBe('number')
    expect(typeof lines[0].endedAt).toBe('number')
    expect(lines[1]).toMatchObject({
      titlePath: ['suite', 'two'],
      status: 'failed',
      duration: 200,
      error: 'nope',
      eventCount: 2,
    })
  })
})
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm -C packages/reporters test`
Expected: FAIL — `summaryReporter` does not exist.

- [ ] **Step 3: Implement `summaryReporter`**

Create `packages/reporters/src/summary-reporter.ts`:

```ts
import { appendFile, mkdir } from 'fs/promises'
import { dirname, isAbsolute, join } from 'path'
import type { IntrospectionReporter, TestEndInfo } from '@introspection/types'

export interface SummaryReporterOptions {
  /** File to append summary lines to. Relative paths resolve against the run directory. */
  outFile: string
  /** Optional projector for the line shape. Defaults to the built-in shape. */
  format?: (info: TestEndInfo) => Record<string, unknown>
}

function defaultFormat(info: TestEndInfo): Record<string, unknown> {
  return {
    titlePath: info.titlePath,
    status: info.status,
    duration: info.duration,
    error: info.error ?? null,
    startedAt: info.startedAt,
    endedAt: info.endedAt,
    eventCount: info.events.length,
  }
}

export function summaryReporter(options: SummaryReporterOptions): IntrospectionReporter {
  const format = options.format ?? defaultFormat
  return {
    name: 'summary',
    onTestEnd(info, ctx) {
      const target = isAbsolute(options.outFile) ? options.outFile : join(ctx.runDir, options.outFile)
      const line = JSON.stringify(format(info)) + '\n'
      ctx.track(async () => {
        await mkdir(dirname(target), { recursive: true })
        await appendFile(target, line)
      })
    },
  }
}
```

Update `packages/reporters/src/index.ts`:

```ts
export * from './summary-reporter.js'
```

- [ ] **Step 4: Run test and verify it passes**

Run: `pnpm -C packages/reporters test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporters/
git commit -m "reporters: add summaryReporter with default JSONL shape"
```

---

## Task 13: `summaryReporter` — custom `format` projector

**Files:**
- Modify: `packages/reporters/test/summary-reporter.test.ts`

The implementation already supports `format`; this task is the test that locks the contract.

- [ ] **Step 1: Write the failing test**

Append inside `describe('summaryReporter', ...)`:

```ts
  it('uses a custom format projector when provided', async () => {
    const writer = await createTraceWriter({
      outDir,
      id: 's',
      reporters: [summaryReporter({
        outFile: 'custom.jsonl',
        format: (info) => ({ path: info.titlePath.join(' > '), ok: info.status === 'passed' }),
      })],
    })
    await writer.emit({ type: 'test.start', metadata: { label: 't', titlePath: ['s', 't'] } })
    await writer.emit({ type: 'test.end', metadata: { label: 't', titlePath: ['s', 't'], status: 'passed', duration: 1 } })
    await writer.finalize()

    const contents = await readFile(join(outDir, 'custom.jsonl'), 'utf-8')
    const lines = contents.trim().split('\n').map(line => JSON.parse(line))
    expect(lines).toEqual([{ path: 's > t', ok: true }])
  })
```

- [ ] **Step 2: Run test and verify it passes**

Run: `pnpm -C packages/reporters test`
Expected: PASS (the implementation from Task 12 already supports `format`).

- [ ] **Step 3: Commit**

```bash
git add packages/reporters/test/summary-reporter.test.ts
git commit -m "reporters: lock summaryReporter custom format contract"
```

---

## Task 14: `summaryReporter` — concurrent appends from multiple writers don't interleave

**Files:**
- Modify: `packages/reporters/test/summary-reporter.test.ts`

The vision relies on POSIX `O_APPEND` atomicity below `PIPE_BUF` (4096 bytes). One summary line easily fits. This test exercises the assumption: two writers append to the same file concurrently and we verify every line is parseable JSON with the expected fields.

- [ ] **Step 1: Write the failing test**

Append inside `describe('summaryReporter', ...)`:

```ts
  it('produces non-interleaved lines when two writers append concurrently', async () => {
    async function runWriter(id: string, label: string, count: number) {
      const writer = await createTraceWriter({
        outDir,
        id,
        reporters: [summaryReporter({ outFile: 'tests.jsonl' })],
      })
      for (let index = 0; index < count; index++) {
        await writer.emit({ type: 'test.start', metadata: { label: `${label}-${index}`, titlePath: [label, String(index)] } })
        await writer.emit({ type: 'test.end', metadata: { label: `${label}-${index}`, titlePath: [label, String(index)], status: 'passed', duration: 1 } })
      }
      await writer.finalize()
    }

    await Promise.all([
      runWriter('a', 'alpha', 50),
      runWriter('b', 'beta', 50),
    ])

    const contents = await readFile(join(outDir, 'tests.jsonl'), 'utf-8')
    const lines = contents.trim().split('\n')
    expect(lines).toHaveLength(100)
    const parsed = lines.map(line => JSON.parse(line))      // throws if any line is interleaved garbage
    const alpha = parsed.filter(p => p.titlePath[0] === 'alpha')
    const beta = parsed.filter(p => p.titlePath[0] === 'beta')
    expect(alpha).toHaveLength(50)
    expect(beta).toHaveLength(50)
  })
```

- [ ] **Step 2: Run test and verify it passes**

Run: `pnpm -C packages/reporters test`
Expected: PASS — `fs.appendFile` uses `O_APPEND`, atomic for sub-4KB lines on POSIX (Linux + macOS).

Note: this test does not run on Windows. If the project supports Windows in CI, gate it with `it.skipIf(process.platform === 'win32', ...)` (or move to a POSIX-only test file). Default assumption per the existing repo is POSIX.

- [ ] **Step 3: Commit**

```bash
git add packages/reporters/test/summary-reporter.test.ts
git commit -m "reporters: verify atomic concurrent appends in summaryReporter"
```

---

## Task 15: Update the in-flight config package to surface `reporters`

**Files:**
- Modify: `packages/types/src/index.ts`

The current `IntrospectConfig` interface has only `plugins`. Add `reporters` so the config plan (`docs/superpowers/plans/2026-04-23-introspection-config-package.md`) has the type to consume.

- [ ] **Step 1: Add `reporters` to `IntrospectConfig`**

In `packages/types/src/index.ts`, locate:

```ts
export interface IntrospectConfig {
  plugins?: PluginSet
}
```

Replace with:

```ts
/**
 * A reporters field in introspect config: either a flat array (single always-active set)
 * or an object of named presets where `default` is required.
 */
export type ReporterSet =
  | IntrospectionReporter[]
  | ({ default: IntrospectionReporter[] } & Record<string, IntrospectionReporter[]>)

export interface IntrospectConfig {
  plugins?: PluginSet
  reporters?: ReporterSet
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -C packages/types typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "types: add reporters field (with named-preset support) to IntrospectConfig"
```

---

## Task 16: Repo-wide build + test

**Files:**
- (none)

- [ ] **Step 1: Build all packages**

Run: `pnpm -r build`
Expected: PASS for every package.

- [ ] **Step 2: Run all tests**

Run: `pnpm -r test`
Expected: PASS for every package. No regressions in existing `@introspection/write` tests.

- [ ] **Step 3: Repo typecheck**

Run: `pnpm typecheck` (or `pnpm -r typecheck` if there's no root script).
Expected: PASS.

- [ ] **Step 4: Commit any incidental fixups discovered in the verification pass**

If steps 1–3 surfaced anything, fix and commit. Otherwise no commit needed.

---

## Out of scope (deliberately)

- **No CLI integration.** The revised spec has no `introspect replay` subcommand. CLI consumers continue to use `introspect events` / `introspect summary` / `introspect payload`.
- **No Playwright wrapper.** The `withIntrospect` wrapper is a separate sub-spec (`packages/playwright` work, future plan). This plan only builds the writer-side reporter machinery and the reference reporter.
- **No `IntrospectionReporter` alias re-export for `Reporter`.** The type is named `IntrospectionReporter` from the start to avoid Playwright's `Reporter` collision.

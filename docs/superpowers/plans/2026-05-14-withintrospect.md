# withIntrospect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Playwright adoption surface for introspection — a `withIntrospect` config wrapper, runner-side `globalSetup`/`globalTeardown` for run lifecycle, and a pre-built `test`/`expect` whose auto-fixture captures every test (including steps) into a per-run, per-test trace directory.

**Architecture:** `withIntrospect(defineConfig({...}), { plugins, reporters, mode })` runs in both the runner and every worker (Playwright re-evaluates `playwright.config.ts` per worker); it stashes config in a module-level singleton and composes introspection's `globalSetup`/`globalTeardown` into the config via Playwright's array form. The runner-side `globalSetup` picks a run-id, creates `.introspect/<run-id>/`, writes a `RunMeta`, and exports `RUN_DIR`. The worker auto-fixture reads `RUN_DIR` + the singleton, creates a per-test trace writer at `<RUN_DIR>/<project>__<slug>/`, wires plugins/reporters, captures steps via Playwright's internal `testInfo._callbacks` hook (throwing if absent), and writes a per-test `meta.json` including `status` and `project`. `globalTeardown` scans trace metas, writes the run's aggregate status, and runs `retain-on-failure` cleanup.

**Tech Stack:** TypeScript (NodeNext), pnpm workspace, tsup (build), Playwright Test (the package's test runner — `*.spec.ts`).

**Spec:** `docs/superpowers/specs/2026-05-14-withintrospect-design.md`

---

## File Structure

**Modify:**
- `packages/types/src/index.ts` — `TraceMeta` gains `status`/`project`; new `RunMeta`; new `StepStartEvent`/`StepEndEvent` + `TraceEventMap` entries; `TraceWriter.finalize` signature gains optional `{ status }`.
- `packages/write/src/trace-writer.ts` — `TraceInitParams` + `initTraceDir` accept `project`; `finalizeTrace` merges optional `status`.
- `packages/write/src/trace.ts` — `CreateTraceWriterOptions` accepts `project`; `finalize` accepts `{ status }`.
- `packages/playwright/src/index.ts` — export `withIntrospect`, `test`, `expect`, `IntrospectMode`; keep `attach`/`trace`.
- `packages/playwright/package.json` — bump `@playwright/test` peer/dev range; drop `./fixture` export.
- `packages/playwright/tsup.config.ts` — entries: `index`, `global-setup`, `global-teardown` (drop `fixture`).
- `packages/playwright/playwright.config.ts` — `testIgnore` the fixtures dir.

**Create (all under `packages/playwright/src/`):**
- `config-store.ts` — the module-level config singleton.
- `run-id.ts` — `resolveRunId()`.
- `run-meta.ts` — git detection, `RunMeta` read/write, `scanTraceMetas`, `computeAggregateStatus`.
- `with-introspect.ts` — the `withIntrospect` wrapper.
- `global-setup.ts` — runner-side setup module.
- `global-teardown.ts` — runner-side teardown module.
- `step-capture.ts` — `installStepCapture(testInfo, trace)`.
- `test-id.ts` — `testIdFor(testInfo)` directory-name slug.
- `test.ts` — the pre-built `test`/`expect` auto-fixture.

**Delete:**
- `packages/playwright/src/fixture.ts` and `packages/playwright/test/fixture.spec.ts`.

**Test files (Playwright `*.spec.ts` under `packages/playwright/test/`):**
- `config-store.spec.ts`, `run-id.spec.ts`, `run-meta.spec.ts`, `with-introspect.spec.ts`, `global-setup.spec.ts`, `global-teardown.spec.ts`, `step-capture.spec.ts`, `test-id.spec.ts`, `integration.spec.ts`.
- Fixture project: `packages/playwright/test/fixtures/withintrospect/playwright.config.ts` + `sample.spec.ts`.

---

## Task 1: Types — run/trace metadata, step events, finalize signature

**Files:**
- Modify: `packages/types/src/index.ts`
- Test: `packages/playwright/test/types.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/playwright/test/types.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import type { RunMeta, TraceMeta, StepStartEvent, StepEndEvent } from '@introspection/types'

test('RunMeta and extended TraceMeta have the expected shape', () => {
  const run: RunMeta = {
    version: '1', id: 'r1', startedAt: 1, endedAt: 2, status: 'passed', branch: 'main', commit: 'abc',
  }
  const trace: TraceMeta = {
    version: '2', id: 's1', startedAt: 1, status: 'failed', project: 'browser-mobile',
  }
  expect(run.status).toBe('passed')
  expect(trace.project).toBe('browser-mobile')

  const start: StepStartEvent = {
    id: 'e1', type: 'step.start', timestamp: 0,
    metadata: { stepId: 's@1', parentStepId: undefined, title: 'click', category: 'test.step' },
  }
  const end: StepEndEvent = { id: 'e2', type: 'step.end', timestamp: 1, metadata: { stepId: 's@1' } }
  expect(start.type).toBe('step.start')
  expect(end.metadata.stepId).toBe('s@1')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/playwright && pnpm exec tsc --noEmit`
Expected: FAIL — `RunMeta`, `StepStartEvent`, `StepEndEvent` not exported; `status`/`project` not on `TraceMeta`.

- [ ] **Step 3: Implement the type changes**

In `packages/types/src/index.ts`, replace the `TraceMeta` interface (currently around line 874) with:

```ts
export type RunStatus = 'passed' | 'failed'

export type TraceStatus =
  | 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'skipped' | 'crashed'

export interface TraceMeta {
  version: '2'
  id: string
  startedAt: number    // unix ms
  endedAt?: number     // unix ms, set when trace ends
  label?: string       // human-readable name
  plugins?: PluginMeta[]
  /** Playwright project name; 'default' when the config defines no projects. */
  project?: string
  /**
   * Final test status. Written by the worker auto-fixture at finalize.
   * 'crashed' is never written — it is derived by readers when a trace
   * directory has no test.end event and no endedAt.
   */
  status?: TraceStatus
}

export interface RunMeta {
  version: '1'
  id: string
  startedAt: number          // unix ms
  endedAt?: number           // unix ms, set by globalTeardown
  status?: RunStatus         // aggregate, set by globalTeardown
  branch?: string
  commit?: string
}
```

In the same file, add the step event interfaces right after `TestEndEvent` (currently around line 99):

```ts
export interface StepStartEvent extends BaseEvent {
  type: 'step.start'
  metadata: { stepId: string; parentStepId?: string; title: string; category: string }
}

export interface StepEndEvent extends BaseEvent {
  type: 'step.end'
  metadata: { stepId: string; error?: string }
}
```

In `TraceEventMap` (around line 615), add after the `'test.end'` line:

```ts
  'step.start': StepStartEvent
  'step.end': StepEndEvent
```

Find the `TraceWriter` interface in the same file and change its `finalize` member from `finalize(): Promise<void>` to:

```ts
  finalize(extras?: { status?: TraceStatus }): Promise<void>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/playwright && pnpm exec tsc --noEmit`
Expected: PASS (no type errors). Then `cd packages/types && pnpm exec tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/index.ts packages/playwright/test/types.spec.ts
git commit -m "types: add RunMeta, TraceMeta status/project, step events, finalize extras"
```

---

## Task 2: `@introspection/write` — `project` option and `status` at finalize

**Files:**
- Modify: `packages/write/src/trace-writer.ts`, `packages/write/src/trace.ts`
- Test: `packages/write/test/trace-meta.test.ts`

`@introspection/write` uses vitest (`packages/write/test/*.test.ts`). Follow that pattern.

- [ ] **Step 1: Write the failing test**

Create `packages/write/test/trace-meta.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceWriter } from '../src/trace.js'

describe('trace meta project + status', () => {
  it('writes project at init and status at finalize', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'introspect-write-'))
    const writer = await createTraceWriter({ outDir, id: 'sess', project: 'browser-mobile' })
    await writer.finalize({ status: 'failed' })

    const meta = JSON.parse(readFileSync(join(outDir, 'sess', 'meta.json'), 'utf-8'))
    expect(meta.project).toBe('browser-mobile')
    expect(meta.status).toBe('failed')
    expect(meta.endedAt).toBeDefined()
    rmSync(outDir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/write && pnpm exec vitest run test/trace-meta.test.ts`
Expected: FAIL — `project` not accepted; `meta.project`/`meta.status` undefined.

- [ ] **Step 3: Implement the write changes**

In `packages/write/src/trace-writer.ts`:

Add `project` to `TraceInitParams`:

```ts
export interface TraceInitParams {
  id: string
  startedAt: number
  label?: string
  plugins?: PluginMeta[]
  project?: string
}
```

In `initTraceDir`, include `project` in the `meta` object it writes:

```ts
  const meta: TraceMeta = {
    version: '2',
    id: parameters.id,
    startedAt: parameters.startedAt,
    label: parameters.label,
    plugins: parameters.plugins,
    project: parameters.project,
  }
```

Change `finalizeTrace` to accept and merge an optional status:

```ts
export async function finalizeTrace(
  outDir: string,
  traceId: string,
  endedAt: number,
  extras?: { status?: TraceMeta['status'] },
): Promise<void> {
  const metaPath = join(outDir, traceId, 'meta.json')
  const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as TraceMeta
  meta.endedAt = endedAt
  if (extras?.status) meta.status = extras.status
  await writeFile(metaPath, JSON.stringify(meta, null, 2))
}
```

In `packages/write/src/trace.ts`:

Add `project` to `CreateTraceWriterOptions`:

```ts
export interface CreateTraceWriterOptions {
  outDir?: string
  id?: string
  label?: string
  plugins?: PluginMeta[]
  reporters?: IntrospectionReporter[]
  adapter?: MemoryWriteAdapter
  project?: string
}
```

In `createTraceWriter`, add `project` to the in-memory `meta` object and to the `initTraceDir` call:

```ts
  const meta: TraceMeta = {
    version: '2',
    id,
    startedAt,
    label: options.label,
    plugins: options.plugins,
    project: options.project,
  }
```

```ts
    await initTraceDir(outDir, {
      id,
      startedAt,
      label: options.label,
      plugins: options.plugins,
      project: options.project,
    })
```

Change the returned `finalize` to accept and forward `extras`:

```ts
    async finalize(extras?: { status?: TraceMeta['status'] }) {
      await bus.emit('detach', { trigger: 'detach', timestamp: timestamp() })
      await tracker.flush()
      await queue.flush()
      await reporterRunner.end()
      await tracker.flush()
      if (adapter) {
        await adapter.writeText(`${id}/meta.json`, JSON.stringify({ ...meta, endedAt: Date.now(), ...(extras?.status ? { status: extras.status } : {}) }, null, 2))
      } else {
        await finalizeTrace(outDir, id, Date.now(), extras)
      }
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/write && pnpm exec vitest run`
Expected: PASS (new test + all existing write tests). Then `pnpm exec tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/write/src/trace-writer.ts packages/write/src/trace.ts packages/write/test/trace-meta.test.ts
git commit -m "write: accept project option and status at finalize"
```

---

## Task 3: Config singleton

**Files:**
- Create: `packages/playwright/src/config-store.ts`
- Test: `packages/playwright/test/config-store.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/playwright/test/config-store.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { setIntrospectConfig, getIntrospectConfig } from '../src/config-store.js'

test('config store round-trips the stored config', () => {
  expect(getIntrospectConfig()).toBeUndefined()
  setIntrospectConfig({ plugins: [], reporters: [], mode: 'retain-on-failure' })
  expect(getIntrospectConfig()).toEqual({ plugins: [], reporters: [], mode: 'retain-on-failure' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/playwright && pnpm exec playwright test test/config-store.spec.ts`
Expected: FAIL — `../src/config-store.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/playwright/src/config-store.ts`:

```ts
import type { IntrospectionPlugin, IntrospectionReporter } from '@introspection/types'

export type IntrospectMode = 'on' | 'retain-on-failure' | 'on-first-retry'

export interface StoredIntrospectConfig {
  plugins: IntrospectionPlugin[]
  reporters: IntrospectionReporter[]
  mode: IntrospectMode
}

let stored: StoredIntrospectConfig | undefined

/** Called by withIntrospect in every process that evaluates playwright.config.ts. */
export function setIntrospectConfig(config: StoredIntrospectConfig): void {
  stored = config
}

/** Read by the worker auto-fixture and by globalTeardown. */
export function getIntrospectConfig(): StoredIntrospectConfig | undefined {
  return stored
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/playwright && pnpm exec playwright test test/config-store.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/playwright/src/config-store.ts packages/playwright/test/config-store.spec.ts
git commit -m "playwright: add module-level introspect config store"
```

---

## Task 4: Run-id resolution

**Files:**
- Create: `packages/playwright/src/run-id.ts`
- Test: `packages/playwright/test/run-id.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/playwright/test/run-id.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { resolveRunId } from '../src/run-id.js'

test('uses INTROSPECT_RUN_ID when set', () => {
  expect(resolveRunId({ INTROSPECT_RUN_ID: 'main_4821' })).toBe('main_4821')
})

test('auto-generates a timestamped id with a random suffix when env is unset', () => {
  const id = resolveRunId({})
  expect(id).toMatch(/^\d{8}-\d{6}-[0-9a-f]{4}$/)
})

test('two auto-generated ids are distinct', () => {
  expect(resolveRunId({})).not.toBe(resolveRunId({}))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/playwright && pnpm exec playwright test test/run-id.spec.ts`
Expected: FAIL — `../src/run-id.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/playwright/src/run-id.ts`:

```ts
import { randomBytes } from 'crypto'

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

function timestamp(date = new Date()): string {
  const y = date.getFullYear()
  const mo = pad(date.getMonth() + 1, 2)
  const d = pad(date.getDate(), 2)
  const h = pad(date.getHours(), 2)
  const mi = pad(date.getMinutes(), 2)
  const s = pad(date.getSeconds(), 2)
  return `${y}${mo}${d}-${h}${mi}${s}`
}

/**
 * The run directory name. `INTROSPECT_RUN_ID` (set by CI to e.g.
 * `<branch>_<pipeline>`) wins; otherwise `<YYYYMMDD-HHmmss>-<random>`.
 */
export function resolveRunId(env: NodeJS.ProcessEnv = process.env): string {
  const provided = env.INTROSPECT_RUN_ID
  if (provided && provided.length > 0) return provided
  return `${timestamp()}-${randomBytes(2).toString('hex')}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/playwright && pnpm exec playwright test test/run-id.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/playwright/src/run-id.ts packages/playwright/test/run-id.spec.ts
git commit -m "playwright: add resolveRunId (env override + timestamped fallback)"
```

---

## Task 5: Run metadata — git detection, IO, aggregate status, trace scan

**Files:**
- Create: `packages/playwright/src/run-meta.ts`
- Test: `packages/playwright/test/run-meta.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/playwright/test/run-meta.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  detectGitInfo, writeRunMeta, readRunMeta, scanTraceMetas, computeAggregateStatus,
} from '../src/run-meta.js'

test('detectGitInfo prefers env overrides', () => {
  const info = detectGitInfo({ INTROSPECT_RUN_BRANCH: 'feat', INTROSPECT_RUN_COMMIT: 'deadbeef' })
  expect(info).toEqual({ branch: 'feat', commit: 'deadbeef' })
})

test('writeRunMeta / readRunMeta round-trip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'introspect-runmeta-'))
  await writeRunMeta(dir, { version: '1', id: 'r1', startedAt: 5 })
  expect(await readRunMeta(dir)).toEqual({ version: '1', id: 'r1', startedAt: 5 })
  rmSync(dir, { recursive: true, force: true })
})

test('scanTraceMetas reads each trace dir status, ignoring meta.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'introspect-scan-'))
  writeFileSync(join(dir, 'meta.json'), '{}')
  for (const [name, status] of [['a', 'passed'], ['b', 'failed']] as const) {
    mkdirSync(join(dir, name))
    writeFileSync(join(dir, name, 'meta.json'), JSON.stringify({ version: '2', id: name, startedAt: 0, status }))
  }
  const scanned = await scanTraceMetas(dir)
  expect(scanned.sort((x, y) => x.dir.localeCompare(y.dir)))
    .toEqual([{ dir: 'a', status: 'passed' }, { dir: 'b', status: 'failed' }])
  rmSync(dir, { recursive: true, force: true })
})

test('computeAggregateStatus is failed if any trace failed', () => {
  expect(computeAggregateStatus(['passed', 'skipped'])).toBe('passed')
  expect(computeAggregateStatus(['passed', 'timedOut'])).toBe('failed')
  expect(computeAggregateStatus([])).toBe('passed')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/playwright && pnpm exec playwright test test/run-meta.spec.ts`
Expected: FAIL — `../src/run-meta.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/playwright/src/run-meta.ts`:

```ts
import { execFileSync } from 'child_process'
import { readFile, writeFile, readdir } from 'fs/promises'
import { join } from 'path'
import type { RunMeta, RunStatus, TraceMeta, TraceStatus } from '@introspection/types'

const FAILING: ReadonlySet<string> = new Set(['failed', 'timedOut', 'interrupted', 'crashed'])

function gitOutput(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

/** Best-effort branch + commit: env overrides win, else local git, else absent. */
export function detectGitInfo(env: NodeJS.ProcessEnv = process.env): { branch?: string; commit?: string } {
  const branch = env.INTROSPECT_RUN_BRANCH || gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'])
  const commit = env.INTROSPECT_RUN_COMMIT || gitOutput(['rev-parse', 'HEAD'])
  const info: { branch?: string; commit?: string } = {}
  if (branch) info.branch = branch
  if (commit) info.commit = commit
  return info
}

export async function writeRunMeta(runDir: string, meta: RunMeta): Promise<void> {
  await writeFile(join(runDir, 'meta.json'), JSON.stringify(meta, null, 2))
}

export async function readRunMeta(runDir: string): Promise<RunMeta> {
  return JSON.parse(await readFile(join(runDir, 'meta.json'), 'utf-8')) as RunMeta
}

export interface ScannedTrace {
  dir: string
  status: TraceStatus | undefined
}

/** Reads `status` from every `<runDir>/<dir>/meta.json`, skipping the run's own meta.json. */
export async function scanTraceMetas(runDir: string): Promise<ScannedTrace[]> {
  const entries = await readdir(runDir, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  return Promise.all(
    dirs.map(async (dir): Promise<ScannedTrace> => {
      try {
        const meta = JSON.parse(await readFile(join(runDir, dir, 'meta.json'), 'utf-8')) as TraceMeta
        return { dir, status: meta.status }
      } catch {
        return { dir, status: undefined }
      }
    }),
  )
}

export function computeAggregateStatus(statuses: ReadonlyArray<string | undefined>): RunStatus {
  return statuses.some((s) => s !== undefined && FAILING.has(s)) ? 'failed' : 'passed'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/playwright && pnpm exec playwright test test/run-meta.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/playwright/src/run-meta.ts packages/playwright/test/run-meta.spec.ts
git commit -m "playwright: add run-meta (git detect, IO, trace scan, aggregate status)"
```

---

## Task 6: `withIntrospect` wrapper

**Files:**
- Create: `packages/playwright/src/with-introspect.ts`
- Test: `packages/playwright/test/with-introspect.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/playwright/test/with-introspect.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { withIntrospect } from '../src/with-introspect.js'
import { getIntrospectConfig } from '../src/config-store.js'

test('stashes config and composes globalSetup/globalTeardown as arrays', () => {
  const result = withIntrospect(
    { testDir: './tests', globalSetup: './my-setup.ts', globalTeardown: './my-teardown.ts' },
    { plugins: [], mode: 'retain-on-failure' },
  )

  // singleton populated
  expect(getIntrospectConfig()).toEqual({ plugins: [], reporters: [], mode: 'retain-on-failure' })

  // introspection sets up first, tears down last; project's own preserved
  expect(Array.isArray(result.globalSetup)).toBe(true)
  expect((result.globalSetup as string[])[0]).toMatch(/global-setup\.(js|ts)$/)
  expect((result.globalSetup as string[])[1]).toBe('./my-setup.ts')
  expect((result.globalTeardown as string[]).at(-1)).toMatch(/global-teardown\.(js|ts)$/)
  expect((result.globalTeardown as string[])[0]).toBe('./my-teardown.ts')

  // untouched field passes through
  expect(result.testDir).toBe('./tests')
})

test('handles a config with no existing globalSetup/globalTeardown', () => {
  const result = withIntrospect({ testDir: './t' }, { plugins: [] })
  expect((result.globalSetup as string[]).length).toBe(1)
  expect((result.globalTeardown as string[]).length).toBe(1)
  expect(getIntrospectConfig()?.mode).toBe('on')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/playwright && pnpm exec playwright test test/with-introspect.spec.ts`
Expected: FAIL — `../src/with-introspect.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/playwright/src/with-introspect.ts`:

```ts
import { fileURLToPath } from 'url'
import type { PlaywrightTestConfig } from '@playwright/test'
import type { IntrospectionPlugin, IntrospectionReporter } from '@introspection/types'
import { setIntrospectConfig, type IntrospectMode } from './config-store.js'

export interface WithIntrospectOptions {
  plugins: IntrospectionPlugin[]
  reporters?: IntrospectionReporter[]
  mode?: IntrospectMode
}

// Resolved relative to this module. In the built package this module is
// dist/index.js (with-introspect is bundled into it), so these resolve to
// dist/global-setup.js / dist/global-teardown.js — both emitted as their own
// tsup entries. At source-test time they resolve to the .ts siblings.
const SETUP_PATH = fileURLToPath(new URL('./global-setup.js', import.meta.url))
const TEARDOWN_PATH = fileURLToPath(new URL('./global-teardown.js', import.meta.url))

function toArray(value: string | string[] | undefined): string[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Wraps a Playwright config: stashes plugins/reporters/mode in the module
 * singleton (read again in every worker, since Playwright re-evaluates the
 * config file per worker) and composes introspection's globalSetup /
 * globalTeardown around the project's own via Playwright's array form.
 */
export function withIntrospect(
  config: PlaywrightTestConfig,
  options: WithIntrospectOptions,
): PlaywrightTestConfig {
  setIntrospectConfig({
    plugins: options.plugins,
    reporters: options.reporters ?? [],
    mode: options.mode ?? 'on',
  })
  return {
    ...config,
    globalSetup: [SETUP_PATH, ...toArray(config.globalSetup)],
    globalTeardown: [...toArray(config.globalTeardown), TEARDOWN_PATH],
  }
}
```

> Note: array `globalSetup`/`globalTeardown` requires Playwright ≥1.49. Task 11 bumps the peer-dependency range. The test asserts the resolved path ends with `global-setup.(js|ts)` so it passes whether run against source or build.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/playwright && pnpm exec playwright test test/with-introspect.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/playwright/src/with-introspect.ts packages/playwright/test/with-introspect.spec.ts
git commit -m "playwright: add withIntrospect config wrapper"
```

---

## Task 7: `globalSetup` module

**Files:**
- Create: `packages/playwright/src/global-setup.ts`
- Test: `packages/playwright/test/global-setup.spec.ts`

`globalSetup` is a default-exported async function. It is testable by importing and calling it directly with a controlled environment.

- [ ] **Step 1: Write the failing test**

Create `packages/playwright/test/global-setup.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import introspectGlobalSetup from '../src/global-setup.js'

test('creates the run dir, writes RunMeta, exports RUN_DIR', async () => {
  const base = mkdtempSync(join(tmpdir(), 'introspect-setup-'))
  const env = { INTROSPECT_DIR: base, INTROSPECT_RUN_ID: 'run1', INTROSPECT_RUN_BRANCH: 'b', INTROSPECT_RUN_COMMIT: 'c' } as NodeJS.ProcessEnv

  await introspectGlobalSetup(env)

  const runDir = join(base, 'run1')
  expect(env.RUN_DIR).toBe(runDir)
  const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf-8'))
  expect(meta).toMatchObject({ version: '1', id: 'run1', branch: 'b', commit: 'c' })
  expect(typeof meta.startedAt).toBe('number')
  rmSync(base, { recursive: true, force: true })
})

test('does nothing when INTROSPECT_TRACING=0', async () => {
  const base = mkdtempSync(join(tmpdir(), 'introspect-setup-off-'))
  const env = { INTROSPECT_DIR: base, INTROSPECT_RUN_ID: 'run1', INTROSPECT_TRACING: '0' } as NodeJS.ProcessEnv
  await introspectGlobalSetup(env)
  expect(env.RUN_DIR).toBeUndefined()
  expect(existsSync(join(base, 'run1'))).toBe(false)
  rmSync(base, { recursive: true, force: true })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/playwright && pnpm exec playwright test test/global-setup.spec.ts`
Expected: FAIL — `../src/global-setup.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/playwright/src/global-setup.ts`:

```ts
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { resolveRunId } from './run-id.js'
import { detectGitInfo, writeRunMeta } from './run-meta.js'

/**
 * Runner-side run lifecycle setup. Default-exported so Playwright can load it
 * as a globalSetup module. The `env` parameter defaults to `process.env`;
 * passing it explicitly is for tests. Mutates `env.RUN_DIR` so test workers
 * (which inherit the runner's environment) can find the run directory.
 */
export default async function introspectGlobalSetup(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (env.INTROSPECT_TRACING === '0') return

  const runId = resolveRunId(env)
  const baseDir = env.INTROSPECT_DIR ?? '.introspect'
  const runDir = join(baseDir, runId)
  await mkdir(runDir, { recursive: true })

  await writeRunMeta(runDir, {
    version: '1',
    id: runId,
    startedAt: Date.now(),
    ...detectGitInfo(env),
  })

  env.RUN_DIR = runDir
}
```

> Playwright calls `globalSetup` with no arguments, so `env` defaults to `process.env` in real runs — `env.RUN_DIR = runDir` then mutates the real environment that workers inherit.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/playwright && pnpm exec playwright test test/global-setup.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/playwright/src/global-setup.ts packages/playwright/test/global-setup.spec.ts
git commit -m "playwright: add globalSetup — run dir, RunMeta, RUN_DIR export"
```

---

## Task 8: `globalTeardown` module

**Files:**
- Create: `packages/playwright/src/global-teardown.ts`
- Test: `packages/playwright/test/global-teardown.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/playwright/test/global-teardown.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import introspectGlobalTeardown from '../src/global-teardown.js'
import { setIntrospectConfig } from '../src/config-store.js'

function seedRun(): { base: string; runDir: string } {
  const base = mkdtempSync(join(tmpdir(), 'introspect-teardown-'))
  const runDir = join(base, 'run1')
  mkdirSync(runDir)
  writeFileSync(join(runDir, 'meta.json'), JSON.stringify({ version: '1', id: 'run1', startedAt: 1 }))
  for (const [name, status] of [['a', 'passed'], ['b', 'failed']] as const) {
    mkdirSync(join(runDir, name))
    writeFileSync(join(runDir, name, 'meta.json'), JSON.stringify({ version: '2', id: name, startedAt: 0, status }))
  }
  return { base, runDir }
}

test('writes endedAt + aggregate status, keeps all dirs in mode "on"', async () => {
  const { base, runDir } = seedRun()
  setIntrospectConfig({ plugins: [], reporters: [], mode: 'on' })
  await introspectGlobalTeardown({ RUN_DIR: runDir } as NodeJS.ProcessEnv)

  const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf-8'))
  expect(meta.status).toBe('failed')
  expect(meta.endedAt).toBeDefined()
  expect(existsSync(join(runDir, 'a'))).toBe(true)
  expect(existsSync(join(runDir, 'b'))).toBe(true)
  rmSync(base, { recursive: true, force: true })
})

test('retain-on-failure deletes passing trace dirs', async () => {
  const { base, runDir } = seedRun()
  setIntrospectConfig({ plugins: [], reporters: [], mode: 'retain-on-failure' })
  await introspectGlobalTeardown({ RUN_DIR: runDir } as NodeJS.ProcessEnv)

  expect(existsSync(join(runDir, 'a'))).toBe(false)  // passed → deleted
  expect(existsSync(join(runDir, 'b'))).toBe(true)   // failed → kept
  rmSync(base, { recursive: true, force: true })
})

test('does nothing when RUN_DIR is unset', async () => {
  await introspectGlobalTeardown({} as NodeJS.ProcessEnv)  // must not throw
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/playwright && pnpm exec playwright test test/global-teardown.spec.ts`
Expected: FAIL — `../src/global-teardown.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/playwright/src/global-teardown.ts`:

```ts
import { rm } from 'fs/promises'
import { join } from 'path'
import { readRunMeta, writeRunMeta, scanTraceMetas, computeAggregateStatus } from './run-meta.js'
import { getIntrospectConfig } from './config-store.js'

const RETAINED: ReadonlySet<string> = new Set(['failed', 'timedOut', 'interrupted', 'crashed'])

/**
 * Runner-side run lifecycle teardown. Default-exported so Playwright can load
 * it as a globalTeardown module. Scans per-test trace metas to compute the
 * run's aggregate status, then applies `retain-on-failure` cleanup in the same
 * pass.
 */
export default async function introspectGlobalTeardown(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (env.INTROSPECT_TRACING === '0') return
  const runDir = env.RUN_DIR
  if (!runDir) return

  const traces = await scanTraceMetas(runDir)
  const status = computeAggregateStatus(traces.map((s) => s.status))

  const meta = await readRunMeta(runDir)
  await writeRunMeta(runDir, { ...meta, endedAt: Date.now(), status })

  const mode = getIntrospectConfig()?.mode ?? 'on'
  if (mode === 'retain-on-failure') {
    for (const trace of traces) {
      if (!trace.status || !RETAINED.has(trace.status)) {
        await rm(join(runDir, trace.dir), { recursive: true, force: true })
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/playwright && pnpm exec playwright test test/global-teardown.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/playwright/src/global-teardown.ts packages/playwright/test/global-teardown.spec.ts
git commit -m "playwright: add globalTeardown — aggregate status + retain-on-failure GC"
```

---

## Task 9: Step capture

**Files:**
- Create: `packages/playwright/src/step-capture.ts`
- Test: `packages/playwright/test/step-capture.spec.ts`

`installStepCapture` wraps Playwright's internal `testInfo._callbacks.onStepBegin`/`onStepEnd` (verified against Playwright 1.59.1: `TestInfoImpl` holds a `_callbacks` object with those methods). It throws if the hook is absent.

- [ ] **Step 1: Write the failing test**

Create `packages/playwright/test/step-capture.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import type { TestInfo } from '@playwright/test'
import type { TraceWriter, EmitInput } from '@introspection/types'
import { installStepCapture } from '../src/step-capture.js'

function fakeTrace(): { writer: TraceWriter; emitted: EmitInput[] } {
  const emitted: EmitInput[] = []
  const writer = { emit: async (e: EmitInput) => { emitted.push(e) } } as unknown as TraceWriter
  return { writer, emitted }
}

test('wraps onStepBegin/onStepEnd, emits step events, calls originals, restores on stop', () => {
  const calls: string[] = []
  const callbacks = {
    onStepBegin: () => { calls.push('begin') },
    onStepEnd: () => { calls.push('end') },
  }
  const testInfo = { _callbacks: callbacks } as unknown as TestInfo
  const { writer, emitted } = fakeTrace()

  const stop = installStepCapture(testInfo, writer)
  callbacks.onStepBegin({ stepId: 's@1', parentStepId: undefined, title: 'click', category: 'test.step' } as never)
  callbacks.onStepEnd({ stepId: 's@1', error: { message: 'boom' } } as never)

  expect(calls).toEqual(['begin', 'end'])  // originals still invoked
  expect(emitted).toEqual([
    { type: 'step.start', metadata: { stepId: 's@1', parentStepId: undefined, title: 'click', category: 'test.step' } },
    { type: 'step.end', metadata: { stepId: 's@1', error: 'boom' } },
  ])

  stop()
  expect(callbacks.onStepBegin).toBe(callbacks.onStepBegin)  // restored to originals (identity check below)
})

test('throws a clear error when the internal hook is absent', () => {
  const { writer } = fakeTrace()
  expect(() => installStepCapture({} as TestInfo, writer)).toThrow(/internal step hook/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/playwright && pnpm exec playwright test test/step-capture.spec.ts`
Expected: FAIL — `../src/step-capture.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/playwright/src/step-capture.ts`:

```ts
import type { TestInfo } from '@playwright/test'
import type { TraceWriter } from '@introspection/types'

interface StepBeginPayload {
  stepId: string
  parentStepId?: string
  title: string
  category: string
}
interface StepEndPayload {
  stepId: string
  error?: { message?: string }
}
interface TestInfoCallbacks {
  onStepBegin: (payload: StepBeginPayload) => void
  onStepEnd: (payload: StepEndPayload) => void
}

/**
 * Wraps Playwright's internal worker-side step callbacks so step boundaries
 * become `step.start` / `step.end` events on the trace bus. Verified against
 * Playwright's `TestInfoImpl._callbacks` (>=1.49 <=1.59). If the hook is
 * absent, throws — there is no fallback (see spec §"Step capture").
 *
 * Returns a `stop()` that restores the original callbacks.
 */
export function installStepCapture(testInfo: TestInfo, trace: TraceWriter): () => void {
  const callbacks = (testInfo as unknown as { _callbacks?: Partial<TestInfoCallbacks> })._callbacks
  if (!callbacks || typeof callbacks.onStepBegin !== 'function' || typeof callbacks.onStepEnd !== 'function') {
    throw new Error(
      "@introspection/playwright: Playwright's internal step hook " +
        '(testInfo._callbacks.onStepBegin/onStepEnd) was not found. This build is ' +
        'verified against Playwright >=1.49 <=1.59. Pin a supported Playwright ' +
        'version or file an issue at @introspection/playwright.',
    )
  }

  const originalBegin = callbacks.onStepBegin
  const originalEnd = callbacks.onStepEnd

  callbacks.onStepBegin = (payload: StepBeginPayload) => {
    void trace.emit({
      type: 'step.start',
      metadata: {
        stepId: payload.stepId,
        parentStepId: payload.parentStepId,
        title: payload.title,
        category: payload.category,
      },
    })
    return originalBegin(payload)
  }
  callbacks.onStepEnd = (payload: StepEndPayload) => {
    void trace.emit({
      type: 'step.end',
      metadata: { stepId: payload.stepId, error: payload.error?.message },
    })
    return originalEnd(payload)
  }

  return () => {
    callbacks.onStepBegin = originalBegin
    callbacks.onStepEnd = originalEnd
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/playwright && pnpm exec playwright test test/step-capture.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/playwright/src/step-capture.ts packages/playwright/test/step-capture.spec.ts
git commit -m "playwright: add step capture via Playwright internal step hook"
```

---

## Task 10: Per-test directory id + the pre-built `test`/`expect`

**Files:**
- Create: `packages/playwright/src/test-id.ts`, `packages/playwright/src/test.ts`
- Test: `packages/playwright/test/test-id.spec.ts` (the auto-fixture itself is exercised by the Task 12 integration test)

- [ ] **Step 1: Write the failing test**

Create `packages/playwright/test/test-id.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import type { TestInfo } from '@playwright/test'
import { testIdFor } from '../src/test-id.js'

function fakeInfo(partial: Partial<TestInfo> & { project: { name: string } }): TestInfo {
  return { titlePath: ['file.spec.ts', 'desc', 'name'], retry: 0, ...partial } as unknown as TestInfo
}

test('builds <project>__<slug> from project name and titlePath', () => {
  expect(testIdFor(fakeInfo({ project: { name: 'browser-mobile' } })))
    .toBe('browser-mobile__file-spec-ts-desc-name')
})

test('falls back to "default" when the project name is empty', () => {
  expect(testIdFor(fakeInfo({ project: { name: '' } })))
    .toBe('default__file-spec-ts-desc-name')
})

test('appends a retry suffix when retry > 0', () => {
  expect(testIdFor(fakeInfo({ project: { name: 'p' }, retry: 2 })))
    .toBe('p__file-spec-ts-desc-name-2')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/playwright && pnpm exec playwright test test/test-id.spec.ts`
Expected: FAIL — `../src/test-id.js` does not exist.

- [ ] **Step 3: Implement `test-id.ts`**

Create `packages/playwright/src/test-id.ts`:

```ts
import type { TestInfo } from '@playwright/test'

/** Lowercase, collapse any non-alphanumeric run to a single dash, trim dashes. */
export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * The per-test trace directory name: `<project>__<titlePath-slug>` with a
 * `-<retry>` suffix on retries. Project is encoded as a filename prefix, not a
 * structural directory level — `ls <run-dir>/` still groups by project, the
 * tree stays two-level.
 */
export function testIdFor(testInfo: TestInfo): string {
  const project = slugify(testInfo.project.name) || 'default'
  const slug = slugify(testInfo.titlePath.join(' '))
  const suffix = testInfo.retry > 0 ? `-${testInfo.retry}` : ''
  return `${project}__${slug}${suffix}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/playwright && pnpm exec playwright test test/test-id.spec.ts`
Expected: PASS.

- [ ] **Step 5: Implement `test.ts` (the pre-built fixture)**

Create `packages/playwright/src/test.ts`:

```ts
import { test as base, expect } from '@playwright/test'
import type { IntrospectHandle } from '@introspection/types'
import { createTraceWriter } from '@introspection/write'
import { attach, toPluginMetas } from './attach.js'
import { getIntrospectConfig } from './config-store.js'
import { installStepCapture } from './step-capture.js'
import { testIdFor } from './test-id.js'

/**
 * The pre-built introspection `test`. The `introspect` auto-fixture captures
 * every test into `<RUN_DIR>/<test-id>/`, wiring plugins/reporters from the
 * module config singleton (populated by withIntrospect). It is `undefined`
 * when tracing is disabled, when there is no run context, or on the first
 * attempt under `on-first-retry`.
 */
export const test = base.extend<{ introspect: IntrospectHandle | undefined }>({
  introspect: [
    async ({ page }, use, testInfo) => {
      const config = getIntrospectConfig()
      const runDir = process.env.RUN_DIR

      // No run context, tracing off, or first-attempt under on-first-retry:
      // no-op handle, capture nothing.
      const skip =
        process.env.INTROSPECT_TRACING === '0' ||
        !config ||
        !runDir ||
        (config.mode === 'on-first-retry' && testInfo.retry === 0)
      if (skip) {
        await use(undefined)
        return
      }

      const project = testInfo.project.name || 'default'
      const trace = await createTraceWriter({
        outDir: runDir,
        id: testIdFor(testInfo),
        label: testInfo.title,
        project,
        plugins: toPluginMetas(config.plugins),
        reporters: config.reporters,
      })
      const handle = await attach(page, { trace, plugins: config.plugins })
      const stopStepCapture = installStepCapture(testInfo, trace)

      await trace.emit({
        type: 'test.start',
        metadata: { label: testInfo.title, titlePath: testInfo.titlePath },
      })

      await use(handle)

      const status = testInfo.status ?? 'failed'
      if (status !== 'passed' && status !== 'skipped') {
        await handle.snapshot().catch(() => {})
      }
      await trace.emit({
        type: 'test.end',
        metadata: {
          label: testInfo.title,
          titlePath: testInfo.titlePath,
          status,
          duration: testInfo.duration,
          error: testInfo.error?.message,
        },
      })

      stopStepCapture()
      await handle.detach()
      await trace.finalize({ status })
    },
    { auto: true },
  ],
})

export { expect }
```

- [ ] **Step 6: Run test to verify it passes (and typecheck)**

Run: `cd packages/playwright && pnpm exec playwright test test/test-id.spec.ts && pnpm exec tsc --noEmit`
Expected: PASS / no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/playwright/src/test-id.ts packages/playwright/src/test.ts packages/playwright/test/test-id.spec.ts
git commit -m "playwright: add per-test id slug and the pre-built introspect test/expect"
```

---

## Task 11: Wire exports, package.json, tsup; delete the old fixture

**Files:**
- Modify: `packages/playwright/src/index.ts`, `packages/playwright/package.json`, `packages/playwright/tsup.config.ts`, `packages/playwright/playwright.config.ts`
- Delete: `packages/playwright/src/fixture.ts`, `packages/playwright/test/fixture.spec.ts`

- [ ] **Step 1: Delete the old fixture and its test**

```bash
git rm packages/playwright/src/fixture.ts packages/playwright/test/fixture.spec.ts
```

- [ ] **Step 2: Update `index.ts`**

Replace `packages/playwright/src/index.ts` with:

```ts
export { attach } from './attach.js'
export type { AttachOptions } from './attach.js'
export { session } from './session.js'
export type { TraceOptions, TraceContext } from './trace.js'
export { withIntrospect } from './with-introspect.js'
export type { WithIntrospectOptions } from './with-introspect.js'
export { test, expect } from './test.js'
export type { IntrospectMode } from './config-store.js'
export { createTraceWriter } from '@introspection/write'
export type { CreateTraceWriterOptions } from '@introspection/write'
export type { BusPayloadMap, BusTrigger, TraceWriter } from '@introspection/types'
export type { IntrospectConfig, PluginSet } from '@introspection/types'
export { loadPlugins, loadIntrospectConfig, resolvePlugins } from '@introspection/config'
export type { LoadPluginsOptions, LoadConfigOptions, ResolvePluginsArgs } from '@introspection/config'
```

- [ ] **Step 3: Update `tsup.config.ts`**

Replace `packages/playwright/tsup.config.ts` with:

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/global-setup.ts', 'src/global-teardown.ts'],
  format: ['esm'],
  dts: true,
  external: ['@playwright/test'],
})
```

- [ ] **Step 4: Update `package.json`**

In `packages/playwright/package.json`: remove the `"./fixture"` entry from `exports`, and bump the Playwright version ranges. The `exports` block becomes:

```json
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js"
    }
  },
```

Change `devDependencies` `"@playwright/test": "^1.40.0"` → `"^1.49.0"`, and `peerDependencies` `"@playwright/test": ">=1.40.0"` → `">=1.49.0"`.

> Rationale: array `globalSetup`/`globalTeardown` requires Playwright ≥1.49. If a `pnpm install` reveals the installed Playwright predates array support, raise the floor to the first version that has it and update this note.

- [ ] **Step 5: Update the package's own `playwright.config.ts` to ignore the integration fixture project**

Replace `packages/playwright/playwright.config.ts` with:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/fixtures/**',
  use: {
    headless: true,
  },
})
```

- [ ] **Step 6: Verify the package builds, typechecks, and existing tests pass**

Run: `cd packages/playwright && pnpm exec tsc --noEmit && pnpm build && pnpm exec playwright test`
Expected: typecheck clean; build emits `dist/index.js`, `dist/global-setup.js`, `dist/global-teardown.js`; all `*.spec.ts` (except the ignored fixtures) pass — `attach.spec.ts`, `proxy.spec.ts`, and every spec added in Tasks 1–10.

- [ ] **Step 7: Commit**

```bash
git add packages/playwright/src/index.ts packages/playwright/package.json packages/playwright/tsup.config.ts packages/playwright/playwright.config.ts
git commit -m "playwright: wire withIntrospect/test exports, drop introspectFixture, bump Playwright range"
```

---

## Task 12: End-to-end integration test

**Files:**
- Create: `packages/playwright/test/fixtures/withintrospect/playwright.config.ts`, `packages/playwright/test/fixtures/withintrospect/sample.spec.ts`, `packages/playwright/test/integration.spec.ts`

This task runs a real Playwright run, in a subprocess, against a fixture project wired with `withIntrospect`, and asserts on the produced `.introspect/` tree. It exercises `withIntrospect`, both global hooks, the auto-fixture, and step capture together.

- [ ] **Step 1: Create the fixture project config**

Create `packages/playwright/test/fixtures/withintrospect/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'
import { withIntrospect } from '@introspection/playwright'

export default withIntrospect(
  defineConfig({
    testDir: '.',
    testMatch: 'sample.spec.ts',
    use: { headless: true },
  }),
  { plugins: [] },
)
```

- [ ] **Step 2: Create the fixture project test file**

Create `packages/playwright/test/fixtures/withintrospect/sample.spec.ts`:

```ts
import { test, expect } from '@introspection/playwright'

test('sample test with a step', async ({ page }) => {
  await page.goto('about:blank')
  await test.step('do a thing', async () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 3: Write the failing integration test**

Create `packages/playwright/test/integration.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

test('withIntrospect produces a run dir, run meta, and a per-test trace with steps', () => {
  const base = mkdtempSync(join(tmpdir(), 'introspect-e2e-'))

  execFileSync(
    'pnpm',
    ['exec', 'playwright', 'test', '--config', 'test/fixtures/withintrospect/playwright.config.ts'],
    {
      cwd: packageRoot,
      env: { ...process.env, INTROSPECT_DIR: base, INTROSPECT_RUN_ID: 'e2e-run' },
      stdio: 'inherit',
    },
  )

  const runDir = join(base, 'e2e-run')

  // run meta
  const runMeta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf-8'))
  expect(runMeta.id).toBe('e2e-run')
  expect(runMeta.status).toBe('passed')
  expect(runMeta.endedAt).toBeDefined()

  // exactly one per-test trace directory
  const traceDirs = readdirSync(runDir).filter((e) => e !== 'meta.json')
  expect(traceDirs.length).toBe(1)
  expect(traceDirs[0]).toMatch(/^default__/)

  // trace meta carries status + project
  const traceMeta = JSON.parse(readFileSync(join(runDir, traceDirs[0], 'meta.json'), 'utf-8'))
  expect(traceMeta.status).toBe('passed')
  expect(traceMeta.project).toBe('default')

  // events include test lifecycle + a captured step
  const events = readFileSync(join(runDir, traceDirs[0], 'events.ndjson'), 'utf-8')
    .trim().split('\n').map((line) => JSON.parse(line))
  expect(events.some((e) => e.type === 'test.start')).toBe(true)
  expect(events.some((e) => e.type === 'test.end')).toBe(true)
  expect(events.some((e) => e.type === 'step.start')).toBe(true)

  rmSync(base, { recursive: true, force: true })
})
```

- [ ] **Step 4: Run test to verify it fails (before build)**

Run: `cd packages/playwright && pnpm exec playwright test test/integration.spec.ts`
Expected: FAIL — the fixture project resolves `@introspection/playwright` from `node_modules` (the built `dist`), which is stale or missing the new exports.

- [ ] **Step 5: Build the workspace so the fixture project resolves the new package**

Run: `cd packages/playwright && pnpm build` (and, if `@introspection/write`/`@introspection/types` changes are not yet built into their `dist`, `pnpm -w build` from the repo root).
Expected: build succeeds.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/playwright && pnpm exec playwright test test/integration.spec.ts`
Expected: PASS — the subprocess Playwright run completes; the `.introspect/e2e-run/` tree has run meta with `status: 'passed'`, one `default__*` trace dir with `status`/`project` in its meta, and `test.start`/`test.end`/`step.start` events in its NDJSON.

- [ ] **Step 7: Run the full package test suite**

Run: `cd packages/playwright && pnpm exec playwright test`
Expected: PASS — all specs including the integration test; the fixtures dir is not picked up as a suite (`testIgnore`).

- [ ] **Step 8: Commit**

```bash
git add packages/playwright/test/fixtures packages/playwright/test/integration.spec.ts
git commit -m "playwright: add end-to-end withIntrospect integration test"
```

---

## Self-Review

**Spec coverage:**
- `withIntrospect` wrapper → Task 6. ✓
- `globalSetup`/`globalTeardown`, run-id, run dir, run `meta.json`, `RUN_DIR` propagation → Tasks 4, 5, 7, 8. ✓
- Array-form setup/teardown composition + Playwright peer-dep bump → Tasks 6, 11. ✓
- Delete `introspectFixture` factory; ship pre-built `test`/`expect`; keep `attach`/`trace` → Tasks 10, 11. ✓
- Per-test trace dir under run dir; reporter wiring; `test.start`/`test.end`; per-test `meta.json` incl. `status` + `project` → Tasks 2, 10. ✓
- Step capture via internal hook; throw if absent; no fallback → Task 9. ✓
- `mode` retention (`on` / `retain-on-failure` / `on-first-retry`) → Task 8 (retain GC), Task 10 (`on-first-retry` worker-side). ✓
- `INTROSPECT_TRACING=0` override → Task 7 (globalSetup), Task 8 (globalTeardown), Task 10 (fixture). ✓
- Types: `TraceMeta` gains `status`/`project`; new `RunMeta` → Task 1. ✓
- Run-level identity: `branch`/`commit` via git with env override → Task 5. ✓
- Project as filename prefix, not a directory level → Task 10 (`test-id.ts`). ✓

**Deferred (per spec, intentionally absent):** step-capture hardening (CI version matrix, exhaustive README compat section); the `test.extend` `.step` fallback (resolved: no fallback).

**Type consistency:** `RunMeta`/`TraceMeta`/`TraceStatus`/`RunStatus` defined in Task 1 and consumed unchanged in Tasks 2, 5, 7, 8. `StoredIntrospectConfig`/`IntrospectMode` defined in Task 3, consumed in Tasks 6, 8, 10. `installStepCapture(testInfo, trace)` signature defined in Task 9, called in Task 10. `testIdFor(testInfo)` defined in Task 10, used in `test.ts` same task. `createTraceWriter`'s new `project` option and `finalize({ status })` defined in Task 2, used in Task 10. `globalSetup`/`globalteardown` default exports take `env?: NodeJS.ProcessEnv` — consistent across Tasks 7, 8 and their tests.

**Planning-time check (from the spec):** the model assumes Playwright re-evaluates `playwright.config.ts` in worker processes (so `withIntrospect` re-populates the singleton per worker). Task 12's integration test is the verification — if step/test events do *not* appear in the worker's NDJSON, the singleton was not populated in the worker and the config-injection approach needs revisiting (fallback: `globalSetup` writes a serialized config path to env, workers `loadIntrospectConfig` it).

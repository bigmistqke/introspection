# Reporter System — Design

A consumer-side counterpart to plugins. **Plugins capture; reporters consume.** Reporters subscribe to the trace's live event stream during a run and produce derived artifacts: summary files, JUnit XML, downstream tooling input, custom dashboards.

The NDJSON event stream remains the canonical, debuggable source of truth. Reporters are additive — they never replace it, they only derive views from it.

> **Position in the broader vision.** Reporters are one of several sub-projects that compose the holistic Playwright-tracing vision. See `2026-05-13-introspection-playwright-vision.md` for the overall architecture; this spec focuses solely on the Reporter abstraction.

## Why

Introspection captures a rich event stream per trace, but today the *only* output is `events.ndjson` + `assets/` + `meta.json`. Anything that wants a different shape (per-test summary, run index, JUnit XML, custom HTML viewer) has to:

1. Read the NDJSON after the run, parse every line, reduce.
2. Or fork the writer and inline its own logic.

Concrete motivating case: the downstream Playwright project `@rg/integration-tests` maintains its own custom logger that produces `tests.jsonl` — one summary line per test, with a pre-reduced step tree, so its viewer can render a whole run by reading one file. Migrating that project to introspection means we either lose the aggregation (viewer reads N event streams) or bake the aggregation into introspection in a generic way. The latter is what reporters are for.

The bus already exists (`TraceBus` in `packages/types/src/index.ts:716`) and `createTraceWriter` already exposes it (`packages/write/src/trace.ts:119`). Plugins can subscribe via `PluginContext.bus`. What's missing is a **first-class reporter abstraction** with per-test slicing and lifecycle hooks so consumers don't reinvent the test-boundary bookkeeping.

## Scope

**In scope:**

- `Reporter` (type `IntrospectionReporter`) interface — registered alongside plugins in `createTraceWriter` and via `withIntrospect`.
- Per-event callback (`onEvent`) and lifecycle callbacks (`onTraceStart`, `onTestStart`, `onTestEnd`, `onTraceEnd`).
- Per-test slicing — `onTestEnd` receives the events emitted between this test's `test.start` and `test.end`, so reporters that aggregate per-test don't need to do their own bookkeeping.
- `finalize()` waits for all reporters' async callbacks to drain — disk writes complete before the trace is considered finalized.
- A reference reporter shipped from a new `@introspection/reporters` package: `summaryReporter` — appends one JSONL line per test (titlePath, status, duration, error, optional event count). Demonstrates the pattern; downstream consumers build their own.

**Out of scope:**

- **Post-hoc replay.** Reporters run live during capture only. Any post-hoc derivation (regenerating a `tests.jsonl` shape, building a viewer) reads the NDJSON directly via the `@introspection/read` API or the `introspect` CLI. This is a deliberate simplification: replay would mean shared lifecycle code paths between live and post-hoc, name-registered reporter lookup or config-loading at replay time, and constraints on what reporters can do (no closure-captured state at runtime). The complexity isn't justified by the use cases — if a reporter has a bug, the trace is cheap to regenerate (re-run the failing test) or the consumer writes a one-off NDJSON reader.
- **Streaming reporters** that produce output incrementally observable by other processes (would need a persistence/IPC story).
- **Cross-trace reporters** (aggregating multiple traces). Users can run any post-hoc tooling against multiple run directories themselves.

## Public API

```ts
import { createTraceWriter } from '@introspection/write'
import { summaryReporter } from '@introspection/reporters'

const trace = await createTraceWriter({
  outDir: '.introspect',
  plugins: [...],
  reporters: [
    summaryReporter({ outFile: 'tests.jsonl' }),
    customReporter,
  ],
})
```

For Playwright projects (the canonical entry point per the vision doc):

```ts
withIntrospect(defineConfig({...}), {
  plugins: [...],
  reporters: [summaryReporter({ outFile: 'tests.jsonl' })],
})
```

`withIntrospect` forwards `reporters` to each per-test `createTraceWriter` call in the worker. There is no runner-side reporter; reporters are instantiated once per worker process and receive per-test lifecycle callbacks for every test that worker runs.

## Reporter interface

```ts
export interface IntrospectionReporter {
  name: string

  /** Called once when the trace starts. */
  onTraceStart?(ctx: ReporterContext): void | Promise<void>

  /** Called for every event, in emission order. */
  onEvent?(event: TraceEvent, ctx: ReporterContext): void | Promise<void>

  /** Called when a `test.start` event is emitted. */
  onTestStart?(test: TestStartInfo, ctx: ReporterContext): void | Promise<void>

  /**
   * Called when a `test.end` event is emitted. Receives all events between
   * the matching `test.start` and `test.end` (inclusive of both endpoints).
   */
  onTestEnd?(test: TestEndInfo, ctx: ReporterContext): void | Promise<void>

  /** Called once when the trace is finalized. */
  onTraceEnd?(ctx: ReporterContext): void | Promise<void>
}

export interface TestStartInfo {
  testId: string                  // id of the test.start event
  label: string
  titlePath: string[]
  startedAt: number
}

export interface TestEndInfo extends TestStartInfo {
  endedAt: number
  duration?: number
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
  error?: string
  events: TraceEvent[]            // slice from test.start..test.end inclusive
  assets: AssetRef[]              // flattened from every event in the slice
}

export interface ReporterContext {
  traceId: string
  outDir: string                  // trace directory (.introspect/<run-id>/<test-id>)
  runDir: string                  // run directory  (.introspect/<run-id>) — for run-level outputs
  meta: TraceMeta
  /** Convenience writer for reporter outputs. Resolves relative paths against runDir by default. */
  writeFile(path: string, content: string | Uint8Array): Promise<void>
  /** Same async-tracking the plugin context offers — finalize awaits these. */
  track(operation: () => Promise<unknown>): void
}
```

The interface is renamed to `IntrospectionReporter` (from the original `Reporter`) to avoid import collision with Playwright's `Reporter` type, mirroring the existing `IntrospectionPlugin` convention.

### Why a separate abstraction from plugins

Plugins and reporters touch overlapping primitives (the event bus, async tracking) but their **roles** differ enough that conflating them is a footgun:

- Plugins **install** browser-side scripts, attach CDP listeners, mutate the page or trace.
- Reporters are read-only over events. They never inject scripts, never speak CDP, never affect what's captured.
- Reporters need lifecycle hooks plugins don't — `onTestEnd` with a per-test slice is the marquee example.
- Conflating them means anyone writing a "give me a JUnit XML" reporter has to learn the plugin install lifecycle, the CDP context, and decide what to do with `script`. They shouldn't have to.

The two systems share `bus` and `track` because those *are* general primitives — but the entry-point interfaces stay separate.

## Per-test slicing

`onTestEnd` is the highest-leverage hook. It exists so the common case ("emit a per-test summary") doesn't require every reporter to track `test.start`/`test.end` boundaries by hand.

Implementation: the writer keeps a per-test ring buffer of event ids (or full events) between `test.start` and `test.end`. When `test.end` fires, the slice is materialized and passed to each reporter's `onTestEnd`. The buffer is then dropped.

Edge cases the design must handle:

- **No matching `test.start`** for a `test.end` — log an `introspect:warning`, skip the callback. Indicates a malformed stream.
- **Nested `test.start`s** — not possible in Playwright's model; if a future framework allows it, push/pop a stack. Document for now: one test in flight at a time.
- **Events outside any test** (`describe.start`, plugin events emitted before the first test, navigation events between tests) — not delivered to `onTestEnd`. Reporters that care receive them via `onEvent`.
- **Trace ends mid-test** (interrupt, crash) — the in-flight test's slice is delivered to `onTestEnd` with `status: 'interrupted'` synthesized.

## `summaryReporter` reference implementation

Bundled in a new `@introspection/reporters` package to demonstrate the pattern and to give downstream consumers (`@rg/integration-tests` first) a working baseline.

```ts
summaryReporter({
  outFile: 'tests.jsonl',          // relative to runDir, or absolute
  /** Optional: project a custom shape per test. Default: built-in summary. */
  format?: (info: TestEndInfo) => Record<string, unknown>
})
```

Default shape per appended line:

```json
{
  "titlePath": ["suites/foo", "describes auth", "logs in"],
  "status": "passed",
  "duration": 1234,
  "error": null,
  "startedAt": 12000,
  "endedAt": 13234,
  "eventCount": 42
}
```

Implementation: `onTestEnd` appends one JSON line to `outFile` using `fs.promises.appendFile` (which uses `O_APPEND` under the hood). POSIX guarantees `O_APPEND` writes below `PIPE_BUF` (4096 bytes) are atomic, so concurrent appends from multiple worker processes interleave at line boundaries without locking — a single summary line easily fits under the limit. The write is wrapped in `ctx.track(...)` so `finalize()` waits before the worker's auto-fixture teardown completes.

## Wiring into existing entry points

- `createTraceWriter(options)` — accept `reporters?: IntrospectionReporter[]`. Pass through to internal lifecycle handler.
- `withIntrospect(playwrightConfig, { ..., reporters })` — instantiate reporters once per worker (on first auto-fixture call), reuse across all tests in that worker.
- `IntrospectConfig` (the in-flight `@introspection/config` package) — add a `reporters` field mirroring `plugins`, with support for named presets (`{ default: [], ci: [...] }`).
- **No CLI integration.** Without replay, the CLI has no reporter-shaped command. CLI consumers read NDJSON directly via existing `introspect events` / `introspect summary` / `introspect payload` commands.

## Failure handling

A reporter throwing must not crash the trace or the test run. Same policy as plugins (see `2026-04-13-robust-failure-handling-design.md`):

- Errors from `onEvent` / `onTestEnd` / etc. are caught, surfaced as `introspect:warning` events on the bus (`source: 'reporter'`, with the reporter name), and the reporter is **disabled for the rest of the trace**. Other reporters keep running.
- An unhandled rejection inside a `track()`-ed operation is similarly caught and warned; `finalize()` does not throw because of it.

## Open questions

- **Sync vs async `onEvent`.** Every event going through every reporter and awaiting before the next event is emitted has performance cost. Recommend `onEvent` runs concurrently with the next emit (fire-and-track), and only `finalize()` blocks until all are drained. Reporters that need ordering can serialize internally.
- **Backpressure.** If a reporter is slow, the in-memory event queue grows. For now, document the constraint ("reporters should be cheap; defer heavy work to `onTraceEnd`"). Revisit if it bites.
- **Cross-worker coordination for run-level reporters.** Each worker instantiates its own copy of every reporter. For run-level outputs (e.g., `tests.jsonl`), the design relies on `O_APPEND` atomicity rather than coordination — see `summaryReporter` implementation above. Reporters with cross-worker state that can't be expressed as atomic appends are out of scope.

## Out of band: downstream impact

Once this lands, `@rg/integration-tests` migrates off its custom logger by:

1. Replacing `logs/index.ts` fixture wrappers with `withIntrospect` + appropriate plugins (see vision doc).
2. Configuring `summaryReporter({ outFile: 'tests.jsonl' })` to preserve the existing aggregation contract.
3. Updating `services/integration-tests-viewer/src/tree.ts` to either consume the new `tests.jsonl` shape directly, or run a custom reporter alongside `summaryReporter` that emits the exact legacy shape during a transition period.

This is tracked in that repo, not here, but it's the motivating use case — the design should be checked against it before landing.

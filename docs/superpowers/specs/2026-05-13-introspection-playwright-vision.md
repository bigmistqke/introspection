# Introspection as the Main Tracing Framework for Playwright — Vision

A holistic design that positions introspection as the primary tracing primitive for a typical Playwright project. Replaces Playwright's built-in `trace.zip`, captures app-level state via plugins, and exposes its event stream to userspace viewers, the CLI, and LLMs.

This is a vision document, not a single implementable spec. It defines the target shape and decomposes the work into independent sub-specs (Section 7). Each sub-spec gets its own writing-plans cycle.

## Vision

Introspection becomes the canonical tracing primitive for Playwright projects. Adoption is two touch points: `withIntrospect(defineConfig({...}), { plugins, reporters })` in `playwright.config.ts`, and `import { test, expect } from '@introspection/playwright'` in test files. From there: every test produces a per-test trace directory under a per-run parent (`.introspect/<run-id>/<test-id>/`) containing an NDJSON event stream, an assets folder, and a `meta.json`. Plugins capture app- and page-level state into the stream during the test. Reporters consume per-test events live and write derived artifacts — per-test files, or run-level files via atomic `O_APPEND`. Post-hoc, humans and LLMs query the NDJSON directly via the `introspect` CLI; viewers are built per-project in userspace, on top of the same NDJSON. Introspection itself ships only capture, the Reporter API, plugins, and the CLI — no bundled viewer. Playwright's built-in `trace.zip` is replaced, not augmented.

### Capture is granular; retention is configurable

Playwright's `trace` option folds two concerns into one knob — *what to capture* and *whether to keep it* — because `trace.zip` records everything by default (DOM snapshots on every action, full network log, every console message). The user has no granular control over what's captured, so the only available switch is a global "when do I pay this cost?" toggle, and the answer almost has to be "only when something fails." That's the symptom of a coarse-grained tracer.

Introspection separates the two concerns:

**Capture is granular and always on, owned by the plugin list.** There is no monolithic "tracing" to turn on or off — there is the **union of plugins you register**. If you register `redux()` and `network()`, you trace Redux actions and network requests, and nothing else. If you add `domSnapshot()` with a sample rate, you also get DOM snapshots at that rate. The control surface is the plugin list, where each plugin owns its domain, its data shape, and its cost. The redefinition introspection is pushing here is: *tracing is the lens you debug through, composed of the specific observations you care about — not a blanket recording.*

**Retention is a separate dimension and does take a mode.** Even with granular plugins, "do I want a trace directory for every passing test, forever?" is a real question — disk in CI, signal-to-noise locally. `withIntrospect` accepts a `mode` field that controls retention only:

| `mode` | Capture during the test | Retained on disk afterwards |
|---|---|---|
| `'on'` (default) | full | always |
| `'retain-on-failure'` | full | only for tests whose final status is `failed`, `timedOut`, `interrupted`, or `crashed` |
| `'on-first-retry'` | no-op handle when `testInfo.retry === 0`; full on retries | matches what was captured |

`'on-first-retry'` is implementable cleanly because `testInfo.retry` is worker-side; no cross-process signaling needed. `'retain-on-failure'` is implemented by a built-in retention step (either in `globalTeardown` or in the auto-fixture's teardown after status is known): it deletes the per-test trace directory for passing tests. `tests.jsonl` summary lines emit for everything regardless of mode — you want to see what passed at the summary level.

**Operator override:** `INTROSPECT_TRACING=0` in the environment fully disables introspection for that run, regardless of configured `mode`. `globalSetup` skips creating the run directory; the auto-fixture short-circuits to a no-op handle; no plugins install, no events emit, no reporters run. This is for emergencies (debugging a Playwright-only issue, isolating cost in CI, running on a read-only filesystem) — config still describes steady-state intent; the env var is the override.

## Scope

**In scope:**

- A Playwright-aware entry point (`@introspection/playwright`) that wraps `defineConfig` and extends `test`, providing the entire adoption surface a Playwright project needs.
- A two-process model: a runner-side `globalSetup`/`globalTeardown` for run-level state (run id, run directory, env propagation), and a worker-side auto-fixture for per-test capture.
- A hybrid trace layout: one directory per run, one sub-directory per test.
- Reporters that run live during capture only; no post-hoc reporter replay.
- Step capture via Playwright's worker-side step hook, with a `test.extend` step-wrapper fallback when the internal hook is unavailable.
- Run-level aggregation (e.g., `tests.jsonl`) via per-worker reporters appending to a shared file with POSIX `O_APPEND` atomicity. No central coordinator.
- A documented set of capture plugins sufficient to replace `trace.zip` (DOM snapshot, network, console, plus the app-specific plugins introspection already ships).
- CLI affordances for both humans and LLMs to query the NDJSON post-hoc.

**Out of scope:**

- Bundled viewers. Each project builds its own visualization on top of the NDJSON; the `demos/static-report` directory remains a demo, not a product.
- `replayReporters` and any post-hoc reporter execution. Reporters run live; whatever they wrote at capture time is the artifact.
- Augmenting (rather than replacing) `trace.zip`. Recommendation: users disable Playwright tracing when adopting introspection.
- A "non-test-runner" stance at the entry-point level. The *internals* (writer, plugin contract, NDJSON format, CLI, asset model) remain Playwright-agnostic and reusable by ad-hoc capture scripts, but the canonical adoption path is Playwright-shaped.
- Cross-trace reporters or cross-run aggregation. Users can run any post-hoc tooling against multiple run directories themselves.

## Architecture

```
                ┌───────────────────────────────────────────┐
                │  playwright.config.ts                     │
                │    withIntrospect(                        │
                │      defineConfig({...}),                 │
                │      { plugins, reporters, mode }         │
                │    )                                      │
                └───────────────────────────────────────────┘
                                  │
                  ┌───────────────┴────────────────┐
                  │                                │
                  ▼                                ▼
        ┌──────────────────┐           ┌──────────────────────┐
        │  globalSetup     │           │  Test files          │
        │  (RUNNER)        │           │   import { test,     │
        │                  │           │     expect } from    │
        │  - pick run-id   │           │  '@introspection     │
        │  - mkdir run dir │           │    /playwright'      │
        │  - export env:   │           └──────────┬───────────┘
        │    RUN_DIR,      │                      │
        │    CONFIG_PATH   │                      ▼
        └──────────────────┘           ┌──────────────────────────────┐
                                       │  Auto-fixture (WORKER)       │
                                       │                              │
                                       │  per test:                   │
                                       │   1. loadInjectedConfig()    │
                                       │   2. createTraceWriter({   │
                                       │        outDir:               │
                                       │          <run>/<test>/,      │
                                       │        plugins,              │
                                       │        reporters             │
                                       │      })                      │
                                       │   3. attach(page) →          │
                                       │      plugins capture into    │
                                       │      trace.bus → NDJSON    │
                                       │   4. register step listener  │
                                       │      on testInfo →           │
                                       │      step.start/end events   │
                                       │      into bus                │
                                       │   5. await use(handle)       │
                                       │   6. emit test.end           │
                                       │      (status from testInfo)  │
                                       │   7. drive reporters'        │
                                       │      onTestEnd               │
                                       │   8. finalize writer         │
                                       │      (await track())         │
                                       └──────────────┬───────────────┘
                                                      │
                                                      ▼
                            ┌────────────────────────────────────────┐
                            │  .introspect/<run-id>/                 │
                            │    ├── <test-id-1>/                    │
                            │    │     ├── events.ndjson             │
                            │    │     ├── meta.json                 │
                            │    │     └── assets/                   │
                            │    ├── <test-id-2>/                    │
                            │    │     └── ...                       │
                            │    └── tests.jsonl   ← O_APPEND from   │
                            │                       each worker's    │
                            │                       summaryReporter  │
                            └────────────────────────────────────────┘
                                            │
                       ┌────────────────────┴────────────────────┐
                       ▼                                         ▼
              ┌──────────────────┐                  ┌────────────────────────┐
              │  introspect CLI  │                  │  Userspace viewer      │
              │                  │                  │                        │
              │  summary         │                  │  reads NDJSON +        │
              │  events          │                  │  tests.jsonl directly  │
              │  payload         │                  │                        │
              │                  │                  │  Not shipped by us     │
              └──────────────────┘                  └────────────────────────┘
```

### Package layout

| Package | Role | Playwright-aware? |
|---|---|---|
| `@introspection/playwright` | `withIntrospect`, extended `test`, `globalSetup`/`globalTeardown`, step capture. The only Playwright-coupled package. | yes |
| `@introspection/write` | `createTraceWriter`, bus, NDJSON writer, assets, reporter lifecycle. | no |
| `@introspection/types` | Event shapes, plugin and reporter interfaces. No runtime. | no |
| `@introspection/config` | `defineIntrospectConfig`, plugin/reporter type contracts, named presets. | no |
| `@introspection/plugins` | Individual capture plugins (Redux, IndexedDB, network, console, DOM snapshot, ...). | no |
| `@introspection/reporters` | Reference reporters (`summaryReporter` initially). Live-only. | no |
| `@introspection/read` + CLI | NDJSON readers and `introspect` CLI. No reporter replay code path. | no |

### Why a two-process split is unavoidable

Playwright runs the test runner in one process and N test workers in separate processes. Workers own the Page; only workers can call CDP, run plugins against the page, or write per-test NDJSON. The runner owns the run lifecycle (and Playwright's own Reporter API). Our model honors this split:

- The runner picks the run id and creates the run directory. It exports that path to workers via environment variables.
- Each worker, on first fixture use, loads the introspection config and creates per-test trace writers under the shared run directory.
- Workers never talk to each other or to the runner at runtime. They cooperate only through filesystem semantics (per-test sub-directories are non-overlapping; the run-level `tests.jsonl` uses atomic `O_APPEND`).
- We do *not* use Playwright's Reporter API to bridge the split. `globalSetup` + `globalTeardown` are sufficient for run lifecycle, and worker-side step hooks (see below) are sufficient for step capture.

### Step capture

Step events (`step.start` / `step.end`) originate in the worker process, even though Playwright's Reporter API exposes them in the runner. The fixture registers a worker-side step listener on `testInfo` (Playwright's internal `_addStepReporter`-style hook) so step events flow directly into the per-test event bus and NDJSON, co-located with everything else captured for that test.

If the internal hook proves too unstable across Playwright minor versions, the fallback is `test.extend` overriding `.step`. Coverage narrows from "all categories" (`test.step`, `expect`, `pw:api`, `hook`, `fixture`) to "only user-authored `test.step`" — adequate for the `@rg/integration-tests` migration, which is the immediate motivating case.

**Visibility of the fallback.** The internal hook is semi-public; depending on it is a deliberate trade-off and users should know. Requirements:

1. **Runtime detection and warning.** At fixture initialization (first test in a worker), probe whether the internal hook is present. If not, emit a one-shot `introspect:warning` event on the bus with `source: 'playwright'`, naming the missing API and the Playwright version detected, and stating that step coverage is degraded to user-authored `test.step` only. Also log to stderr once per worker so the warning is visible in CI output, not only to viewers that read the bus.
2. **`packages/playwright/README` section.** A dedicated section titled "Step capture and Playwright version compatibility" documenting: the two paths, the categories each captures, the Playwright version range where the internal hook is verified, what to do when the warning fires (pin Playwright, file an issue, accept narrower coverage), and the pinned version we test against in CI.
3. **Versioned regression check.** CI runs the test suite against the lowest supported Playwright minor and the latest minor; both must succeed and both must report whichever hook path they took, so a silent change in Playwright internals surfaces as a test diff rather than a degraded user experience in the wild.

### Run-level aggregation

A run-level summary file like `tests.jsonl` is produced without any central coordinator:

1. The user registers `summaryReporter({ outFile: 'tests.jsonl' })` once at the run level.
2. Each worker, on first fixture use, instantiates its own copy of `summaryReporter`. There are N instances across N workers, all configured identically.
3. On each test end, the worker's reporter appends one JSON line to `<run-dir>/tests.jsonl`.
4. POSIX guarantees that an `O_APPEND` write below `PIPE_BUF` (4096 bytes) is atomic. A single test's summary line fits well under that limit, so concurrent appends from different workers interleave at line boundaries — never within a line. No locking, no IPC.

The output order is finish order, not test-file order. Consumers sort by `titlePath` or `startedAt` if they need stable ordering.

## Adoption surface

What a project does to adopt introspection, end-to-end:

**1. Install:**

```sh
pnpm add -D @introspection/playwright @introspection/plugins @introspection/reporters
```

**2. Wrap `playwright.config.ts`:**

```ts
import { defineConfig } from '@playwright/test'
import { withIntrospect } from '@introspection/playwright'
import { redux, indexeddb, network, console, domSnapshot } from '@introspection/plugins'
import { summaryReporter } from '@introspection/reporters'

export default withIntrospect(
  defineConfig({
    testDir: './tests',
    // no `trace:` — introspection replaces it
  }),
  {
    plugins: [redux(), indexeddb(), network(), console(), domSnapshot()],
    reporters: [summaryReporter({ outFile: 'tests.jsonl' })],
    mode: 'retain-on-failure',
  }
)
```

**3. Update test-file imports:**

```ts
// before
import { test, expect } from '@playwright/test'
// after
import { test, expect } from '@introspection/playwright'
```

Test bodies do not change. `test('...', async ({ page }) => { await test.step('...', ...) })` works as written; the auto-fixture captures into the per-test NDJSON without any opt-in per call site.

## Event model

The NDJSON stream is the contract. Every consumer reads it: reporters at capture time, CLI commands post-hoc, userspace viewers, LLMs. Schema lives in `@introspection/types`.

| Source | Events | Emitted by |
|---|---|---|
| Lifecycle | `trace.start`, `trace.end`, `test.start`, `test.end` | Auto-fixture |
| Steps | `step.start`, `step.end` (with `category`) | Auto-fixture via Playwright step hook |
| Page | `page.created`, `page.closed`, `page.navigated` | `@introspection/playwright` core |
| Plugins | `redux.action`, `redux.state`, `indexeddb.snapshot`, `network.request`, `console.message`, `dom.snapshot`, ... | Each plugin |

Each event is JSON, one per line, append-only, timestamped. Events can carry `payloads: { <name>: AssetRef }` for large or binary attachments; assets live in `<test-dir>/assets/` and are referenced by content-addressed name.

Per-test `meta.json` denormalizes the identity bits (`titlePath`, `status`, `duration`, `error`, `runId`, `testId`, `workerIndex`, `startedAt`, `endedAt`) so consumers like `summaryReporter` and the CLI don't need to scan the NDJSON to answer simple identity questions.

## Failure handling

| Failure | Behavior |
|---|---|
| Plugin throws during capture | Caught, surfaced as `introspect:warning` on the bus, plugin disabled for the rest of the trace. Test continues; the captured stream remains valid. |
| Reporter throws in `onEvent` / `onTestEnd` / etc. | Caught, warned, reporter disabled for the rest of the worker's lifetime. Other reporters keep running. |
| Worker crashes mid-test | The in-flight test directory exists with partial NDJSON and no `meta.json`. CLI surfaces `status: 'crashed'` (derived from "no `test.end` event and no `meta.json`"). Other tests in other workers unaffected. |
| `globalSetup` fails | Playwright fails the run before any worker starts. Normal Playwright error flow. |
| Race on `tests.jsonl` | None. `O_APPEND` atomicity below 4KB carries the load. |

Cross-cutting policy: introspection never crashes the test or the run because of its own internal failure. Capture is best-effort; the test result is authoritative.

## Sub-projects

Independent sub-specs, ordered roughly by dependency. Each is small enough for one writing-plans cycle.

1. **`@introspection/config` package** — `defineIntrospectConfig`, plugin and reporter type contracts, named presets. Existing plan: `docs/superpowers/plans/2026-04-23-introspection-config-package.md`. Prerequisite for everything below.
2. **Reporter API (live-only)** — revise the existing spec to drop `replayReporters` and finalize the interface. Existing spec: `docs/superpowers/specs/2026-05-08-reporter-system-design.md`.
3. **`withIntrospect` + `globalSetup` / `globalTeardown`** — runner-side run-dir creation and env propagation; the wrapper itself. New spec.
4. **`@introspection/playwright` package shape** — `test.extend`-ed `test` and `expect`, step capture (Playwright internal hook + `test.extend` fallback), cross-process config injection. New spec.
5. **`trace.zip` coverage plugins** — DOM snapshot, network, console plugins. Inventory what's already there vs. what's missing; spec the gaps.
6. **`@introspection/reporters` package** — extract / build `summaryReporter` as the reference. New spec.
7. **CLI / LLM ergonomics** — `introspect events --test <name>`, `introspect summary`, `introspect payload`. Identify gaps for the LLM use case (compact output, deterministic ordering, queryability). New spec.
8. **`@rg/integration-tests` migration** — owned in that repo, but specs the contract introspection must meet (the `tests.jsonl` shape, the step categories the existing viewer consumes). Reference only here; the migration plan lives in that repo.

## Open questions

- **Playwright peer-dep range.** Worker-side step hooks are semi-public. The package needs a documented Playwright version range and a CI check that the hook still exists in newer minors. See "Step capture / Visibility of the fallback" above for the warning, README, and CI requirements.
- **Config injection across the runner/worker boundary.** Options: env-serialized path to a `introspect.config.ts` file (clean, requires file loading in workers), or a module-level singleton populated by `withIntrospect` (faster, only works because workers share the same `node_modules`). Decide in the `@introspection/playwright` spec.
- **Run-id format.** Options: ISO timestamp + short uuid, monotonic counter, user-provided via env. Decide in the `withIntrospect` spec.
- **Run-level identity metadata.** The vision has no run-level metadata artifact — `tests.jsonl` carries per-*test* rows, not run identity. Downstream tooling that lists runs (e.g. `introspect runs`, per the remote-trace-CLI spec `2026-05-14-remote-trace-cli-design.md`) needs run-level branch, commit, run timestamp, and aggregate status to make a run pickable. Decide in the `withIntrospect` spec: what artifact carries this (a run-level `meta.json`? a header line in `tests.jsonl`?) and who writes it (`globalSetup` for identity at start, `globalTeardown` for `endedAt` + aggregate status). Surfaced by the 2026-05-14 brainstorm/grill on remote trace access.
- **Reporter naming collision.** Playwright has `Reporter`; we should probably type ours `IntrospectionReporter` to avoid import collisions when both are in scope.

## Non-goals (explicit)

- Coexisting with `trace.zip`. Users disable Playwright tracing when adopting introspection. If a user wants both, they can keep both running independently — introspection does not integrate with `trace.zip`.
- A "main" or default reporter that produces an HTML view. Visualization belongs in userspace.
- A "main" CDP host other than Playwright. If a second host emerges, the internals are reusable, but designing for it preemptively is not in scope.

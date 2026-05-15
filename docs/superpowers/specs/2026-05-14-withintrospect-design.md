# `withIntrospect` — Design

The Playwright adoption surface for introspection: a `withIntrospect` config
wrapper, runner-side `globalSetup` / `globalTeardown` for run lifecycle, and a
pre-built `test` / `expect` whose auto-fixture captures every test into a
per-run, per-test trace directory.

> **Position.** This is sub-project #3 (`withIntrospect` + `globalSetup` /
> `globalTeardown`) of the Playwright vision
> (`2026-05-13-introspection-playwright-vision.md`), expanded to also absorb
> the worker-side package shape from #4 (extended `test` / `expect`, step
> capture) — see Scope. It is the unblocker for the remote-trace-CLI spec
> chain (`2026-05-14-remote-trace-cli-design.md`, Sequencing): it establishes
> the `<run-id>/<test-id>/` layout, the run-level metadata artifact, and the
> per-test `status` field that everything downstream reads.

## Why

Today `@introspection/playwright` ships *primitives* — `attach()` (wires
plugins to a page + a trace writer), `trace()`, and `introspectFixture(opts)`
(a worker-side auto-fixture *factory* that takes `plugins` / `outDir`
explicitly). There is **no run-level concept at all**: nothing picks a run id,
creates a run directory, or runs at the Playwright *runner* level. Every test's
trace writer points at a flat `outDir`.

The vision's adoption surface is two touch points — `withIntrospect(...)` in
`playwright.config.ts`, and `import { test, expect } from '@introspection/playwright'`
in test files. Neither exists. This spec builds both, and the run lifecycle
between them.

## Scope

**In scope:**

- `withIntrospect(playwrightConfig, { plugins, reporters?, mode? })` — the
  config wrapper.
- Runner-side `globalSetup` / `globalTeardown` modules: run-id resolution, run
  directory creation, run-level `meta.json`, `RUN_DIR` env propagation,
  aggregate status, `retain-on-failure` cleanup.
- Worker side: **delete the `introspectFixture` factory**; ship a pre-built
  `test` / `expect`. The lower-level `attach()` / `trace()` primitives stay
  (used by `introspect debug` and ad-hoc capture).
- The auto-fixture: per-test trace directory under the run dir, reporter
  wiring, `test.start` / `test.end`, per-test `meta.json` including `status`.
- **Step capture**: a worker-side listener on Playwright's internal step hook
  emitting `step.start` / `step.end` into the bus. If the internal hook is
  absent, **throw** at fixture init (see §8).
- `mode` retention knob (`on` / `retain-on-failure` / `on-first-retry`).
- `INTROSPECT_TRACING=0` operator override.
- `@introspection/types` changes: `TraceMeta` gains `status`; a new `RunMeta`
  type.

**Out of scope:**

- **Step-capture hardening.** The CI regression matrix against min/max
  Playwright minors, and the exhaustive README compatibility section. The
  capture itself ships here; proving it across Playwright versions is a
  separable follow-up.
- **`@introspection/config`** (vision #1) — already built; this spec consumes
  it.
- **Reporter API internals** (vision #2) — already in implementation;
  `createTraceWriter` already accepts `reporters`. This spec only *wires*
  reporters through, it does not design them.
- The `test.extend` `.step`-override fallback. Resolved: no fallback — a
  missing internal hook throws (§8).
- Everything in the remote-trace-CLI chain (Specs B/C/D): `StorageAdapter`
  hierarchy methods, whole-tree `createHandler`, `introspect runs`.

## Architecture

```
playwright.config.ts:
  withIntrospect(defineConfig({...}), { plugins, reporters, mode })
        │
        │  evaluated in BOTH the runner AND every worker process
        │  (Playwright re-loads playwright.config.ts per worker)
        │  → stashes { plugins, reporters, mode } in a module-level singleton
        │  → config.globalSetup    = [introspectSetup,    ...userSetups]
        │    config.globalTeardown = [...userTeardowns, introspectTeardown]
        ▼
  ┌─ RUNNER ──────────────────┐        ┌─ WORKER (per test) ───────────────┐
  │ introspectSetup:          │        │ pre-built `test` auto-fixture:    │
  │  · resolve run-id         │RUN_DIR │  · read RUN_DIR from env          │
  │  · mkdir run dir          │───────▶│  · read config from singleton     │
  │  · write run meta.json    │ (env)  │  · createTraceWriter →          │
  │    (identity)             │        │      <RUN_DIR>/<test-id>/         │
  │  · export RUN_DIR         │        │  · attach(page); wire reporters   │
  │ introspectTeardown:       │        │  · register step listener         │
  │  · scan trace metas     │        │  · emit test.start / test.end     │
  │  · write endedAt + status │        │  · write trace meta.json        │
  │  · retain-on-failure GC   │        │      (incl. status)               │
  └───────────────────────────┘        │  · finalize (await reporters)     │
                                       └───────────────────────────────────┘
                                                       │
                                                       ▼
                              .introspect/<run-id>/
                                ├── meta.json            ← RunMeta
                                ├── <test-id-1>/
                                │     ├── events.ndjson
                                │     ├── meta.json       ← TraceMeta + status
                                │     └── assets/
                                └── <test-id-2>/ ...
```

**Config injection — only `RUN_DIR` crosses the process boundary.** Plugins and
reporters are live JS objects; they are never serialized. Playwright re-evaluates
`playwright.config.ts` inside every worker, so `withIntrospect` runs again in
each process and re-stashes the same singleton — each process independently
rebuilds the config by running the same file. The run-id, by contrast, is
*chosen once* (nondeterministically) in `globalSetup` and must be *shared*, so
it travels via the `RUN_DIR` environment variable.

> Planning-time check: confirm Playwright evaluates `playwright.config.ts` in
> worker processes. The whole config-injection model rests on it. (Strongly
> expected — workers need the config for projects, fixtures, timeouts — but
> verify before building.)

## `withIntrospect`

```ts
function withIntrospect(
  playwrightConfig: PlaywrightTestConfig,
  options: { plugins: IntrospectionPlugin[]; reporters?: IntrospectionReporter[]; mode?: IntrospectMode },
): PlaywrightTestConfig
```

It:

1. Stashes `{ plugins, reporters, mode }` in a module-level singleton in
   `@introspection/playwright`.
2. Composes `globalSetup` / `globalTeardown` via Playwright's **array form**:
   `globalSetup = [introspectSetupModule, ...asArray(config.globalSetup)]`,
   `globalTeardown = [...asArray(config.globalTeardown), introspectTeardownModule]`.
   Introspection sets up first and tears down last, around the project's own.
3. Returns the config otherwise untouched — no `trace:` manipulation (the
   vision has users drop `trace:` themselves).

**Playwright peer-dependency.** Array `globalSetup` / `globalTeardown` requires
a newer Playwright than the current `>=1.40` peer range. This spec bumps the
documented range to the minor that introduced array form (~1.49 — exact version
confirmed at planning time). The motivating target, `@rg/integration-tests`, is
on 1.53. The same range is enforced at runtime by the step-hook throw (§8), so
there is one coherent version story.

## `globalSetup` (runner)

A module shipped by `@introspection/playwright`. On run start:

- **Run-id**: `process.env.INTROSPECT_RUN_ID` if set (lets CI pass e.g.
  `<branch>_<pipeline>`); otherwise auto-generate `<timestamp>-<short-random>`.
- `mkdir -p .introspect/<run-id>/`.
- Write `.introspect/<run-id>/meta.json` (`RunMeta`) with identity + start:
  `id`, `startedAt`, `branch`, `commit`. `branch` / `commit` are best-effort
  from local `git` (`git rev-parse`), overridable via `INTROSPECT_RUN_BRANCH` /
  `INTROSPECT_RUN_COMMIT`. Introspection stays CI-provider-agnostic — no baked-in
  GitLab/GitHub env-var knowledge; CI wires the override.
- Export `RUN_DIR=.introspect/<run-id>` into `process.env` so workers inherit it.

If `INTROSPECT_TRACING=0`, `globalSetup` does nothing (§9).

## `globalTeardown` (runner)

On run end:

- Scan every `<RUN_DIR>/<test-id>/meta.json` for the per-test `status`.
- Compute the aggregate: `failed` if any test is `failed` / `timedOut` /
  `interrupted` / `crashed`, else `passed`. Write it plus `endedAt` into the run
  `meta.json`.
- **`retain-on-failure`**: in the *same scan*, delete the trace directories of
  passing tests. (Status computation and retention GC share one pass — this is
  why aggregate status is computed at teardown rather than derived on read.)

## Worker side — the pre-built `test`

- **`introspectFixture(opts)` is deleted.** `@introspection/playwright` exports
  a pre-built `test` and `expect`: `import { test, expect } from '@introspection/playwright'`.
  Test bodies are unchanged. `attach()` and `trace()` stay as primitives.
- The built-in auto-fixture (`{ auto: true }`), per test:
  1. Read `RUN_DIR` from env, `{ plugins, reporters, mode }` from the singleton.
  2. `createTraceWriter({ outDir: <RUN_DIR>/<test-id>/, plugins, reporters })`,
     `attach(page)`.
  3. Register the step listener (§8); emit `test.start`.
  4. `await use(handle)`.
  5. Emit `test.end` (status from `testInfo`); write the per-test `meta.json`
     including `status`, `duration`, `error`, `titlePath`.
  6. Finalize the writer (await reporter `track()` callbacks).
- **Per-test directory name (`<test-id>`)**: `<project>__<slug>`, where
  `<project>` is the normalized `testInfo.project.name` — falling back to
  `default` when a config defines no `projects` array and the name is empty —
  and `<slug>` is a readable slug of `testInfo.titlePath`. A `-<retry>` suffix
  is appended when `testInfo.retry > 0` (retries are distinct captures — see
  `on-first-retry`). The Playwright project is encoded as a *filename prefix*,
  not a structural directory level: `ls .introspect/<run-id>/` still groups
  traces by project (they sort together), but the tree stays two-level so
  nothing downstream — `StorageAdapter`, `createHandler`, the CLI — gains a
  level. Readable beats `testInfo.testId`'s opaque hash for `ls` and CLI
  output; `project` + `titlePath` is collision-free per test.

## `@introspection/types` changes

- `TraceMeta` gains `status: 'passed' | 'failed' | 'timedOut' | 'interrupted'
  | 'skipped' | 'crashed'` and `project: string` (the Playwright project name,
  `default` when unnamed). Per-test pass/fail currently lives only in the
  `test.end` event; denormalizing status — and `project` — into `meta.json` is
  what lets `globalTeardown` (and later `listTraces`, the viewer, the CLI)
  read and group by them without scanning NDJSON or parsing directory names.
- New `RunMeta`: `{ version, id, startedAt, endedAt?, status?, branch?,
  commit? }`. `status` / `endedAt` are absent until `globalTeardown` runs (a run
  with no teardown — crashed runner — is legitimately left without them).

## `mode` retention

| `mode` | Capture | Retained |
|---|---|---|
| `'on'` (default) | full | every trace directory |
| `'retain-on-failure'` | full | `globalTeardown` deletes passing tests' dirs (§ above) |
| `'on-first-retry'` | no-op handle when `testInfo.retry === 0`; full on retries | matches what was captured |

`on-first-retry` is worker-side only — `testInfo.retry` is worker-local, so no
cross-process signaling. The auto-fixture installs a no-op handle on the first
attempt and a real trace writer on retries.

## `INTROSPECT_TRACING=0`

Operator override for emergencies (debugging a Playwright-only issue, isolating
cost, read-only filesystem). When set: `globalSetup` skips run-dir creation and
does not export `RUN_DIR`; the auto-fixture short-circuits to a no-op handle —
no plugins install, no events emit, no reporters run, no `meta.json` is written.
Config still describes steady-state intent; the env var is the override.

## Step capture

The worker-side auto-fixture registers a listener on Playwright's internal step
hook (the `_addStepReporter`-style API the vision describes), translating step
boundaries into `step.start` / `step.end` events on the per-test bus — co-located
with everything else captured for that test.

**No fallback.** If the internal hook is absent at fixture init, the fixture
**throws** a clear error naming the detected Playwright version and the supported
range. There is no `test.extend` `.step`-override fallback and no degraded-mode
warning: introspection refuses to run rather than produce a trace missing steps.

This does not violate the vision's "introspection never crashes the test/run
because of its own internal failure — capture is best-effort" policy. That
policy governs *capture-time* failures (a plugin throwing mid-test). A missing
step hook is a *startup environment incompatibility* — the same category as
"`globalSetup` fails → Playwright fails the run," which the vision explicitly
accepts. Failing fast at init, on an unsupported Playwright, is correct; it also
makes the documented peer-dep range runtime-enforced.

Deferred (see Scope): the CI version matrix and the exhaustive README
compatibility section.

## Testing

TDD throughout.

- **`withIntrospect`** — pure function: config in → config out. Assert the
  singleton is populated, and that array composition *prepends* introspection's
  setup / *appends* its teardown while preserving a project's existing
  `globalSetup` / `globalTeardown` (string form and array form inputs).
- **`globalSetup` / `globalTeardown`** — plain modules, tested in isolation:
  run-id resolution (env override vs auto), run `meta.json` contents, the
  `git`-detection-with-env-override path, aggregate-status computation over a
  fixture run directory, `retain-on-failure` GC, and the `INTROSPECT_TRACING=0`
  no-op path.
- **The auto-fixture** — real Playwright runs against small fixture test
  projects (the package already runs `playwright test`): per-test directory
  layout under the run dir, `meta.json` with `status`, reporter wiring, the
  `mode` variants, step events present in the NDJSON, and the throw when the
  step hook is stubbed absent.

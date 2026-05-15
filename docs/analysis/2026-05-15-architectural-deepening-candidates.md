# Architectural Deepening Candidates — 2026-05-15

Output of an `improve-codebase-architecture` walk over the introspection
monorepo. Five **deepening opportunities**, framed in the skill's vocabulary
(deep/shallow modules, interface vs implementation, seams, adapters, leverage,
locality, the deletion test).

> **Caveat.** This repo has no `CONTEXT.md` or `docs/adr/` at the time of
> writing, so concepts here are named from the code itself (`StorageAdapter`,
> plugin, trace, run, reporter, attach). If any of these candidates moves
> forward, the deepened module's name should land in a new `CONTEXT.md` as a
> side-effect of the grilling loop.

Ranked roughly by deepening impact: **2 ≈ 3 > 1 > 5 > 4** (4 is real but
possibly premature — the code is new).

---

## 1. The config-loading pipeline is a three-file fan-out

**Files:** `packages/config/src/{load,plugins,resolve}.ts`

**Problem.** Three files implement one sequential pipeline — find file →
import module → resolve plugins (array or preset form) against ENV. The order
leaks: `cli/commands/debug.ts` has to know to call `loadIntrospectConfig` then
`resolvePlugins`, while `plugins.ts` is a different convenience composition of
the same two. There is no single named **module** for "load the plugin set
the CLI/Playwright should run with."

**Deletion test.** Deleting `plugins.ts` concentrates nothing — its callers
replicate the dance inline. The three files have a hidden contract (a state
machine: file path → loaded module → resolved plugin array) but no
**interface** that names it.

**Direction.** One **deep** module — `loadPluginSet({ cwd, env, explicitPath? })`
— whose **implementation** still has internal helpers for the three phases,
but whose **interface** is the one operation callers actually want. Big
locality win: changes to plugin-resolution semantics happen in one place.

**Testability.** Today each phase is testable in isolation but the
*interaction* (where the bugs are: preset-vs-array branching against ENV) has
no natural test surface. A `loadPluginSet` interface tests the whole journey,
fixture-driven.

---

## 2. Reporter lifecycle is a hidden state machine

**Files:** `packages/write/src/reporter-lifecycle.ts`, called from
`packages/write/src/trace.ts:120`.

**Problem.** `createReporterRunner` tracks "active test", buffers events until
`test.end` arrives, warns on orphaned ends, disables reporters on failure —
but the state machine is implicit, enforced by runtime checks rather than
types. A third-party reporter author cannot tell from the **interface** when
`TestEndInfo.events` is populated or what guarantees `events` makes.

**Deletion test.** Can't delete — the lifecycle is real. But the state lives
behind no named **seam**: it's tangled with `trace.ts`'s event emission. If
you wanted to swap "test-scoped buffering" for "run-scoped buffering" you
would do surgery on `reporter-lifecycle.ts`, not swap an **adapter**.

**Direction.** Extract a `TestLifecycleBuffer` (or similar) module that owns
the start→end pairing as its sole job; reporters consume **paired** events
from it. The reporter interface gets shallower (more **leverage** per
reporter, less ceremony) and the lifecycle gets a real test surface
independent of any reporter.

**Testability.** Today reporter tests have to drive both the lifecycle and a
reporter to assert anything. With the buffer as its own module, lifecycle
invariants (orphaned ends, double-starts, failure-disabling) become
unit-testable; reporters become trivial transforms over `PairedTestEvent`s.

---

## 3. `StorageAdapter` is symmetric in name, asymmetric in fact

**Files:**

- `packages/types/src/index.ts` — the interface
- `packages/read/src/node.ts` — `createNodeAdapter` (has `TraversalError` +
  `safeJoin`)
- `packages/write/src/trace.ts:70–161` — inline `if (adapter)` branching +
  ad-hoc path resolution
- `packages/write/src/memory.ts` — parallel `MemoryWriteAdapter`

**Problem.** Reads go through `createNodeAdapter` with a hardened **seam**
(path traversal protection lives there — recently landed in Spec C of the
remote-trace-CLI chain). Writes branch inline on `if (adapter)` and resolve
paths with `isAbsolute`, *not* `safeJoin`. Same conceptual operation ("write
a trace file"), two **adapters**, divergent invariants. The
`StorageAdapter` interface today is read-shaped; the write side gets a
parallel `MemoryWriteAdapter` and the FS fallback hand-codes what should be
the adapter's job.

**Deletion test.** Can't delete the seam — read-side was actively *deepened*
here recently. But the write side fails the **"one adapter = hypothetical
seam"** test: it has memory + FS branching inline, not behind a uniform
adapter.

**Direction.** Make `StorageAdapter` carry the write operations the writer
actually needs (`writeText`, `writeBinary`, `appendNdjson`, whatever the
writer does today), and lift path-safety into the node adapter so the writer
never sees a raw path. Two real **adapters** (node, memory) on a symmetric
interface; writer gets shallower.

**Testability.** Writer tests stop needing FS scaffolding; the in-memory
adapter — which already exists — becomes the testing default for free.

**Note.** This touches Spec C territory (just landed). Worth checking it
doesn't re-litigate a fresh decision before going further — Spec C was
deliberately scoped to reads.

---

## 4. The Playwright adoption surface is four files of one concept

**Files:** `packages/playwright/src/{attach,attach-run,trace,with-introspect}.ts`

**Problem.** Four files for one concept — "make a Playwright thing emit
introspection events." `attach.ts` is the real engine (CDP, plugin install,
event emission, 242 lines). `attach-run.ts` is 39 lines of mkdir+meta.
`trace.ts` (149 lines) monkey-patches the test object for a describe-block
lifecycle. `with-introspect.ts` (44 lines) wires globalSetup/Teardown. The
**interface** to "use this from a Playwright suite" is unspecified — adopters
guess which entry to import.

**Deletion test.** Each holds real logic (deletion would scatter to callers),
so none is a pass-through. But the *boundaries between them* fail the test:
the partition does not name three different things, it just splits one thing
four ways.

**Direction.** A three-level public API named in **interface** order:
`attach(page, opts)` (lowest) → `withTraceLifecycle(page, plugins)` (the
describe-block lifecycle, currently hidden inside `trace.ts`'s
monkey-patch) → `withIntrospect(config, opts)` (config wrapper). Adopters
pick the level matching their integration depth.

**Caveat.** This code is *new* — the `withIntrospect` initiative recently
landed. Don't deepen too early. Worth raising mostly to ask whether the
four-file shape is provisional or intentional.

---

## 5. CLI command formatters are shallow per-command pass-throughs

**Files:** `packages/cli/src/commands/{network,summary,plugins,payload,events}.ts`

**Problem.** Each command's "formatter" is a single function with no internal
abstraction, called from exactly one place in `cli/src/index.ts`. They
duplicate the same event-table rendering pattern with no shared helpers —
`network.ts:5-37` and `events.ts:113-135` both render tabular event data, no
shared code. The **interface** of each formatter (event-array in, string out)
is as complex as its **implementation**.

**Deletion test.** Inline them and complexity does not reappear — it just
moves into the command handlers. Classic shallow modules.

**Direction.** One event-rendering module that knows event *categories*
(network row, generic row, payload detail, plugin row) and a thin per-command
call into it. Reuse instead of repetition.

**Testability.** Today these are untested; a single rendering module with
category-shaped inputs becomes worth testing.

---

## Considered and dropped

- **"Dissolve the `packages/utils` package."** The original walk surfaced
  this. Dropped because the deletion test verdict was "scatters code; no
  gain" — i.e. the opposite of concentrating complexity behind a single
  interface. That is a layout preference, not a deepening.

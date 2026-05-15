# Introspection — Context

`introspection` is a capture/replay system for browser test runs: a Playwright
suite (or other producer) emits structured events to disk while it runs, and a
CLI / viewer reads those events back to explain what happened. This document
fixes the language used to talk about the system. General programming
concepts (timeouts, retries, JSON, "module") live in the architectural
glossary at `.claude/skills/improve-codebase-architecture/LANGUAGE.md`, not
here.

## Language

### Capture units

**Run**:
The top-level grouping for one execution of a producer (a Playwright suite, a
script). Carries identity (`id`, `branch`, `commit`, `startedAt`, aggregate
`status`) in `RunMeta`. One Run contains one or more Traces.
_Avoid_: job, build, suite execution.

**Trace**:
The trace for one Page / one test — a directory at `<run-id>/<trace-id>/`
holding `meta.json`, `events.ndjson`, and an `assets/` folder. Described by
`TraceMeta`. This is the canonical unit of capture.

**Event** (a.k.a. **TraceEvent**):
One typed entry in a Trace's `events.ndjson`. Every Event has an `id`,
`timestamp`, `type`, and `initiator` (the Plugin name); concrete event types
live in `@introspection/types`.
_Avoid_: log line, log entry, message.

**Asset**:
A binary blob (screenshot, captured response body, etc.) stored under a
Trace's `assets/` directory and referenced from an Event via a
`PayloadRef`. Written through the `AssetWriter` interface.
_Avoid_: attachment, blob, artifact.

**Payload**:
A piece of data attached to an Event — either inline (`PayloadInline`) or by
reference to an Asset (`PayloadAsset`). The union is `PayloadRef`.

### Producers and capture

**Plugin** (a.k.a. **IntrospectionPlugin**):
A module that installs capture for one data source (console, network, redux,
webgl, …) and emits Events. Plugins receive a `PluginContext` and declare
themselves with a `PluginMeta`.
_Avoid_: integration, capture, collector.

**Attach**:
The operation of installing introspection into a Playwright `Page` — wires
CDP, registers Plugins, and returns an `IntrospectHandle`. The verb is
"attach"; the noun for what gets returned is "handle."
_Avoid_: hook, instrument, wrap.

**TraceWriter**:
The producer-side write surface for a single Trace. Owns the
`events.ndjson` append and exposes `emit`, `flush`, `finalize`, and asset
writes via `AssetWriter`.

### Readers, transport, presentation

**StorageAdapter**:
The read seam for Runs and Traces — `listDirectories`, `readText`,
`readBinary`, `readJSON`. Concrete adapters: `createNodeAdapter` (filesystem),
in-memory, and (Spec D) HTTP. The same interface is the read protocol
`@introspection/serve` exposes over HTTP.

**TraceReader**:
The query surface over one Trace — `meta`, an `events` API
(`ls` / `query` / `watch`), and `resolvePayload` to dereference `PayloadRef`s.
Built on a `StorageAdapter`; identical interface regardless of transport.

**`@introspection/serve`**:
The HTTP read protocol. `createHandler({ adapter })` returns a Web-standard
`(Request) => Response | null` over two verbs:
`GET <prefix>/dirs/<subPath>` and `GET <prefix>/file/<path>`. Read-only,
storage-agnostic.

**`introspect`**:
The CLI. Reads via a `StorageAdapter` (filesystem `--dir`; HTTP `--url` after
Spec D). Subcommands: `list`, `summary`, `events`, `network`, `assets`,
`plugins`, `debug`.

**Reporter**:
A consumer of *paired* test Events — receives a `TestEndInfo` after each
test.start → test.end pair (with the events in between). The lifecycle pairing
is the Reporter's contract; raw event streams are not. Drives `--reporter`
output in the CLI and is the migration target for `@rg/integration-tests`'s
custom logger.

### Test framing inside a Trace

**Test**:
A Playwright (or test-framework) test, framed inside a Trace by a
`TestStartEvent` … `TestEndEvent` pair. Steps are framed similarly
(`StepStartEvent` / `StepEndEvent`). A Trace typically holds one Test but
this is not enforced; the pairing is what Reporters consume.

## Relationships

- A **Run** contains one or more **Traces** (`<run-id>/<trace-id>/`).
- A **Trace** contains many **Events** and (optionally) many **Assets**.
- A **Plugin** produces **Events** within a **Trace** and may write
  **Assets**.
- An **Event** may reference an **Asset** via a **Payload**.
- A **StorageAdapter** is the read seam over Runs/Traces; a **TraceReader**
  is built on top of one.
- `@introspection/serve`'s `createHandler` is a transport over a
  **StorageAdapter**; the `introspect` CLI's HTTP mode is a **StorageAdapter**
  over that transport. Same protocol, two sides.
- A **Reporter** consumes paired `TestStart`/`TestEnd` **Events** from a
  **Trace**.

## Example dialogue

> **Dev:** "When `attach()` runs, does it create the **Trace** directory?"
>
> **Maintainer:** "The **TraceWriter** does — `attach()` builds the writer,
> which mkdirs `<run-id>/<trace-id>/` and starts appending **Events**. The
> **Run** directory and `RunMeta` are created earlier, by `globalSetup`."
>
> **Dev:** "And **Assets** like screenshots?"
>
> **Maintainer:** "Written via the handle's `AssetWriter`. The **Event** that
> mentions the screenshot carries a `PayloadRef` of kind `'asset'` pointing
> at the file under `assets/`. The CLI dereferences that through
> `TraceReader.resolvePayload`."
>
> **Dev:** "So `introspect --url` and the viewer fetch through the same
> path?"
>
> **Maintainer:** "Yes — both go through a **StorageAdapter**. Local CLI uses
> `createNodeAdapter`; remote CLI and the viewer go through
> `@introspection/serve`'s handler over HTTP. **TraceReader** does not know
> which."

## Flagged ambiguities

- **"snapshot"** — overloaded across Plugins (`ReduxSnapshotEvent`,
  `WebStorageSnapshotEvent`, `CookieSnapshotEvent`, `IntrospectHandle.snapshot()`
  for DOM). Always qualify: "redux snapshot," "DOM snapshot," "cookie
  snapshot." Never bare "snapshot" in a name without context.

- **"log"** — reserved for the `@rg/integration-tests` custom logger that is
  being migrated *away from*. Do not use "log" / "log line" / "logger" for
  introspection's own constructs; the words are **Event**, **emit**,
  **TraceWriter**, **Reporter**.

- **"fixture"** — Playwright concept; not an introspection construct.
  `@introspection/playwright`'s pre-built `test` extends Playwright's
  `test` with an internal `introspect` auto-fixture — adopters import
  the `test`, not the fixture. There is no public `introspectFixture`
  export.

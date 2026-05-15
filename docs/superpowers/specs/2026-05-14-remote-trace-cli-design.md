# Remote Trace Access for the `introspect` CLI — Design

> **Status:** landed (2026-05-15) · plan: `docs/superpowers/plans/2026-05-15-remote-trace-cli.md`

Lets the `introspect` CLI read traces served over HTTP, not just from local
disk. Today the CLI only reads `--dir <local path>`; CI runs produce traces on
a server, and debugging them means downloading artifacts first. This spec
adds an HTTP-backed `StorageAdapter` and replaces `--dir` with a single
`--base <pathOrUrl>` flag whose value discriminates by URL scheme — local
path, or `http(s)://` for the remote transport. Run selection on a remote
server (pick a run by branch/commit/etc.) is handled by the run-selection
flags that Spec B introduces — see "Run selection" below.

> **Position.** This is one slice of the broader effort to migrate
> `@rg/integration-tests` onto introspection (see the Reporter System design
> and the Playwright vision doc). It is independently shippable: it depends
> only on primitives that already exist (`@introspection/read`'s adapter
> abstraction, `@introspection/serve`'s HTTP protocol).

## Why

`@introspection/read` is already adapter-based — `createTraceReader` and
`listTraces` take a `StorageAdapter`, and every CLI command (`summary`,
`events`, `network`, `assets`, `plugins`, `list`) is built on top of that
reader. `@introspection/serve` already defines an HTTP protocol for serving
trace directories read-only (`createHandler` returns a Web-standard
`(Request) => Response | null`).

What's missing is the client half: an adapter that speaks that protocol over
`fetch`, wired into the CLI. A prototype already exists —
`demos/shared/src/fetch-adapter.ts` (`createFetchAdapter`) — but it lives in
`demos/` (unpublished, not depended on by the CLI) and may have drifted from
the current `StorageAdapter` interface. This spec promotes and hardens it.

**This adapter belongs in `@introspection/serve`, not `@introspection/read`.**
It is not a generic "filesystem over HTTP" — `createHandler` does not serve
arbitrary paths. It exposes a fixed, semantic endpoint vocabulary: `GET /` →
trace list, `GET /:trace/meta.json`, `GET /:trace/events.ndjson`,
`GET /:trace/events`, `GET /:trace/events?sse`, `GET /:trace/assets/...`.
The HTTP adapter works only because `createTraceReader`'s access pattern
happens to read exactly those paths. That makes the adapter a *client of
serve's protocol*, sharing an unwritten contract (the exact endpoint set) with
`createHandler`. Co-locating producer and consumer in one package is what
keeps that contract maintainable as a unit — split across packages it drifts
silently. `StorageAdapter` is defined in `@introspection/types`, so
`@introspection/serve` depending on that type introduces no cycle.

The result: **the trace read protocol gets a second client.** A server that
mounts `@introspection/serve` can be read by both a project's own viewer UI
*and* the `introspect` CLI, through the same endpoints.

## Scope

**In scope:**

- `createHttpReadAdapter(baseUrl)` — a new export from `@introspection/serve`
  (subpath `@introspection/serve/client`), implementing `StorageAdapter` over
  `fetch` against `createHandler`'s endpoint vocabulary. Promoted from
  `demos/shared/src/fetch-adapter.ts`, reconciled against the current
  `StorageAdapter` interface.
- The demos drop their local `fetch-adapter.ts` copy and import from
  `@introspection/serve/client`, so there is one implementation.
- `introspect --base <pathOrUrl>` — replaces `--dir`. A single flag whose
  value discriminates the transport: any string containing `://` is parsed
  as a URL (only `http://` / `https://` accepted, anything else is an
  argument error) and builds the HTTP adapter; everything else is treated as
  a filesystem path and builds the node adapter. Default: `./.introspect`.
  Also settable as `base` in `introspect.config.ts`.
- `--dir` is removed in the same change (hard cut; the CLI is pre-1.0).
  Demos, tests, and docs are updated in the same PR.

**Out of scope:**

- Any change to `../develop` (the integration-tests viewer or its API).
  `../develop` is the real-life target this work builds *toward* and validates
  against — not something this spec modifies.
- Mounting `@introspection/serve` into any server. The demos already prove the
  mounting pattern; the reference target (below) describes it for illustration
  only.
- Promoting the demo Vite-plugin serve-mounting helper. Its only consumers are
  demos, which already have it.
- Write/streaming access. The adapter is read-only, matching
  `@introspection/serve`.
- Auth. The reference target serves traces on an internal network; if auth is
  needed later it is a follow-up (the adapter would need a header/token hook).

## Sequencing

This spec is the **last node in a four-spec chain** and must not be planned or
implemented until the chain above it lands. A brainstorming + grill session on
2026-05-14 decomposed the work:

```
Spec A — Run/trace hierarchy contract + writer-side metadata
  · Largely already decomposed in the Playwright vision doc
    (2026-05-13-introspection-playwright-vision.md, sub-projects #3, #4, #6):
    trace meta.json gains `status`/`titlePath`/`runId`/etc.; tests.jsonl is
    the run-level aggregation.
  · GAP found by the grill: nothing carries run-level *identity* (branch,
    commit, run timestamp, aggregate status) — `introspect runs` needs it,
    but no such artifact exists or is planned. Logged in the vision doc's
    Open questions as an input to the `withIntrospect` spec (#3).
        │
        ▼
Spec B — StorageAdapter hierarchy + read
  · StorageAdapter grows listRuns() / listTraces(runId), returning rich
    objects (id + status + identity metadata), not bare names.
  · node + memory adapters implement them; @introspection/read navigates the
    two-level <run-id>/<trace-id>/ hierarchy.
        │
        ▼
Spec C — createHandler as a generic StorageAdapter-over-HTTP transport
  · createHandler({ adapter }) — async, no filesystem code, no trace
    vocabulary; just two URL verbs: GET <prefix>/dirs/<subPath> →
    adapter.listDirectories(subPath); GET <prefix>/file/<path> →
    adapter.readBinary(path). readText/readJSON parse client-side.
  · Traversal protection pushed down into createNodeAdapter
    (TraversalError; handler maps to 403).
  · serve({ directory }) keeps the convenience by building a node adapter
    internally; demos/shared/introspectionServe likewise.
  · SSE leaves @introspection/serve entirely and moves into a
    solid-streaming-only Vite plugin (GET /__introspect/stream/<run>/
    <trace>/events).
  · Also fixes demos/shared/fetch-adapter.ts (listDirectories honours
    subPath; reads hit /file/...) and un-skips the four HTTP-demo tests,
    tightening the weak ones (wc-graph + react-trace-list).
  · Full design: docs/superpowers/specs/2026-05-15-storage-agnostic-
    createhandler-design.md.
        │
        ▼
Spec D — THIS SPEC (remote trace access for the CLI)
```

**Why the chain, not just a runtime dependency.** "Seamless local *and*
remote" makes the `introspect` CLI a generic consumer of a run/trace
hierarchy — and that hierarchy is the canonical layout *locally* too
(`<run-id>/<trace-id>/`), so it is not a remote-only concern. Specs B and C
settle `StorageAdapter`'s final shape (the hierarchy methods) and serve's
structure; this spec's `createHttpReadAdapter` and `introspect runs` build
directly on both. Building the client first means building against an
interface and a package layout that are still moving.

**Scope status when D's turn arrived.** Specs A and B already shipped the
`introspect runs` command, the run/trace hierarchy methods (`listRuns` /
`listTraces`), and the run/trace selection flags (`--run`, `--trace-id`) —
all wired against `StorageAdapter`. So Spec D really is just
`createHttpReadAdapter` + the single `--base` flag.

An earlier draft proposed a `--ci [ref]` flag and a `resolveRun(ref)` hook in
`introspect.config.ts` to map a human ref to a base URL; once Spec B exposed
`listRuns()` with branch/commit identity, that resolution happens against the
server's run list instead — under the assumption of a single stable trace
base per project — so `--ci` and the hook are dropped. A second iteration
also unified the originally-proposed `--url <baseUrl>` flag with `--dir
<path>` into a single `--base <pathOrUrl>` whose value discriminates the
transport by URL scheme; `--dir` is removed.

## Architecture

Today there are two unrelated read paths: a project viewer's bespoke
file-serving middleware, and the `introspect` CLI reading a local `--dir`.
After this change there is **one read protocol** — `@introspection/serve` —
with two transports, both selected by a single CLI flag:

```
                    ┌─────────────────────────────┐
                    │  trace storage              │
                    │  (.introspect / server logs)│
                    └──────────────┬──────────────┘
                                   │
                  ┌────────────────┴─────────────────┐
          createNodeAdapter                  @introspection/serve
          (local disk)                       createHandler (HTTP)
                  │                                  │
                  │                      ┌───────────┴───────────┐
                  │                      │                       │
            introspect CLI         introspect CLI          project viewer UI
        --base ./.introspect    --base https://…/_introspect    (fetch)
```

The CLI gains exactly one branch point inside `--base` parsing: value with
`http(s)://` → HTTP adapter, anything else → filesystem adapter. Everything
downstream of the adapter is unchanged.

## `createHttpReadAdapter`

New export from `@introspection/serve` at the `@introspection/serve/client`
subpath (the rationale — endpoint-vocabulary coupling with `createHandler` —
is in the Why section):

```ts
import type { StorageAdapter } from '@introspection/types'

/**
 * A StorageAdapter that reads trace data over HTTP from a server mounting
 * the @introspection/serve protocol.
 *
 * @param baseUrl - URL prefix where traces are served
 *                  (e.g. https://ci.example/_introspect)
 */
export function createHttpReadAdapter(baseUrl: string): StorageAdapter
```

It implements the current `StorageAdapter` interface — `listDirectories`,
`readText`, `readBinary`, `readJSON` — using the Spec C verb-prefix URL
shape: `GET <base>/dirs/<subPath>` and `GET <base>/file/<path>`. `readJSON`
parses client-side via `readText`. The demo prototype at
`demos/shared/src/fetch-adapter.ts` is already this shape and is the
direct ancestor; in the same change it is deleted and its importers point
at `@introspection/serve/client`.

Behaviour, per method:

- `listDirectories(subPath?)` — `GET <base>/dirs/<subPath || ''>`; on a
  non-OK response, **throws** a clear error (see Error handling — this is
  the resolved decision point, not `[]`).
- `readText(path)` / `readBinary(path)` — `GET <base>/file/<path>`; non-OK
  throws `Failed to fetch <path>: <status>`.
- `readJSON(path)` — parses `readText` client-side.

## CLI surface

`introspect` selects its trace source with a single top-level flag:

| Flag | Meaning |
|---|---|
| `--base <pathOrUrl>` | Where the traces live. Default: `./.introspect`. A value containing `://` is parsed as a URL: only `http://` and `https://` are accepted, anything else is an argument error. Any other value is a filesystem path. May also be set as `base` in `introspect.config.ts`. |

`--dir` is removed in the same change (hard cut; the CLI is pre-1.0). Demos
and tests are updated in the same PR.

Internally, `--base` is parsed once at startup into a `StorageAdapter` —
`createNodeAdapter(path)` or `createHttpReadAdapter(url)` — and every
command receives the adapter. No command implementation changes.

## Run selection

Once a remote server is selected (via `--base <url>` or config `base`), there is
still the question of *which* run on that server to read. That is the job of
Spec B's `listRuns()` plus the run-selection flags that Spec D's planning-time
revision introduces (`--run <id>` and similar) — not of a project-supplied
URL-resolution hook. The default is "latest run on the current git branch",
resolved by filtering `listRuns()` against the branch identity Spec A puts on
each run. This whole section is deliberately under-specified here; it is
called out so readers know where the old `--ci [ref]` / `resolveRun` shape
went.

## Error handling

- **Bad / unreachable base URL** — `fetch` rejection or non-OK status surfaces
  as a clear error naming the URL and status; the CLI exits non-zero. It does
  not silently produce empty output.
- **`listDirectories` on a non-OK response** — *throws* rather than returning
  `[]`. Rationale: a developer running `introspect --base https://… list`
  against a wrong URL must see "that URL is wrong", not "no traces found".
  (The demo prototype returns `[]`; that is a demo affordance, not correct
  CLI behaviour. This is the resolved decision point.)
- **`--base` value with an unsupported URL scheme** — e.g. `--base ftp://…`
  or a typo like `--base htttp://…`. The CLI errors at startup naming the
  unsupported scheme; it does not fall back to treating the value as a
  filesystem path.

## Testing

TDD throughout.

- **`createHttpReadAdapter`** — tested in-process against
  `@introspection/serve`'s `createHandler` over a fixture trace directory: no
  real network. The core assertion is *equivalence* — a `TraceReader` built
  on the HTTP adapter returns the same events / assets / meta as one built on
  the filesystem adapter reading the same fixture. Plus per-method error cases
  (404, 500, network rejection).
- **CLI argument resolution** — `--base` parsing: path vs URL discrimination,
  config `base` fallback, default to `./.introspect`, and the
  unsupported-scheme error, tested at the arg-parsing layer.

## Reference target (illustration only — not built here)

The work this spec builds toward: `@rg/integration-tests` migrates onto
introspection, and its viewer moves to a conventional **built SPA + Node API
(Hono)** setup. The Hono API mounts the project's own endpoints *and*
`@introspection/serve`'s `createHandler`. Because `createHandler` is a
Web-standard `(Request) => Response | null`, mounting it in Hono is direct —
Hono's `c.req.raw` is a standard `Request` — no `req`/`res` shim. At that
point the viewer UI and the `introspect --base https://…` CLI are two clients of
the same mounted protocol. None of that server-side work is in this spec; it
is the picture that justifies the shape chosen here.

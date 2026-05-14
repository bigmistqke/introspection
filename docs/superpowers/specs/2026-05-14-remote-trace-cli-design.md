# Remote Trace Access for the `introspect` CLI — Design

Lets the `introspect` CLI read traces served over HTTP, not just from local
disk. Today the CLI only reads `--dir <local path>`; CI runs produce traces on
a server, and debugging them means downloading artifacts first. This spec adds
an HTTP-backed `StorageAdapter`, a `--url` flag, and a pluggable `resolveRun`
discovery hook so a developer can point the CLI at a CI run without copying
files locally.

> **Position.** This is one slice of the broader effort to migrate
> `@rg/integration-tests` onto introspection (see the Reporter System design
> and the Playwright vision doc). It is independently shippable: it depends
> only on primitives that already exist (`@introspection/read`'s adapter
> abstraction, `@introspection/serve`'s HTTP protocol).

## Why

`@introspection/read` is already adapter-based — `createSessionReader` and
`listSessions` take a `StorageAdapter`, and every CLI command (`summary`,
`events`, `network`, `assets`, `plugins`, `list`) is built on top of that
reader. `@introspection/serve` already defines an HTTP protocol for serving
trace directories read-only (`createHandler` returns a Web-standard
`(Request) => Response | null`).

What's missing is the client half: an adapter that speaks that protocol over
`fetch`, wired into the CLI. A prototype already exists —
`demos/shared/src/fetch-adapter.ts` (`createFetchAdapter`) — but it lives in
`demos/` (unpublished, not depended on by the CLI) and may have drifted from
the current `StorageAdapter` interface. This spec promotes and hardens it.

The result: **the trace read protocol gets a second client.** A server that
mounts `@introspection/serve` can be read by both a project's own viewer UI
*and* the `introspect` CLI, through the same endpoints.

## Scope

**In scope:**

- `createHttpReadAdapter(baseUrl)` — a public export from `@introspection/read`,
  implementing `StorageAdapter` over `fetch` against the `@introspection/serve`
  protocol. Promoted from `demos/shared/src/fetch-adapter.ts`, reconciled
  against the current `StorageAdapter` interface.
- The demos drop their local `fetch-adapter.ts` copy and import from
  `@introspection/read`, so there is one implementation.
- `introspect --url <baseUrl>` — a sibling to `--dir`, mutually exclusive,
  building the HTTP adapter instead of the filesystem one.
- `introspect --ci [ref]` plus an optional `resolveRun(ref)` hook in
  `introspect.config.ts` — resolves a human ref (branch, PR, etc.) to a base
  URL. Introspection ships the contract and a current-git-branch default for
  the ref; it ships no built-in resolver implementation.

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

## Architecture

Today there are two unrelated read paths: a project viewer's bespoke
file-serving middleware, and the `introspect` CLI reading a local `--dir`.
After this change there is **one read protocol** — `@introspection/serve` —
with two transports and two clients:

```
                    ┌─────────────────────────────┐
                    │  trace storage              │
                    │  (.introspect / server logs)│
                    └──────────────┬──────────────┘
                                   │
                  ┌────────────────┴─────────────────┐
          FilesystemAdapter                  @introspection/serve
          (local disk)                       createHandler (HTTP)
                  │                                  │
                  │                      ┌───────────┴───────────┐
                  │                      │                       │
            introspect CLI         introspect CLI          project viewer UI
              --dir                    --url                   (fetch)
```

The CLI gains exactly one branch point: `--url` → HTTP adapter, `--dir` →
filesystem adapter. Everything downstream of the adapter is unchanged.

## `createHttpReadAdapter`

New export from `@introspection/read`:

```ts
import type { StorageAdapter } from '@introspection/types'

/**
 * A StorageAdapter that reads trace data over HTTP from a server mounting
 * the @introspection/serve protocol.
 *
 * @param baseUrl - URL prefix where sessions are served
 *                  (e.g. https://ci.example/_introspect/<run-id>)
 */
export function createHttpReadAdapter(baseUrl: string): StorageAdapter
```

It implements the **current** `StorageAdapter` interface — the precise method
set (`listDirectories`, `readText`, and whichever of `readBinary` / `readBytes`
/ `readJSON` the interface actually declares today) is reconciled during
implementation. The demo prototype implements `listDirectories`, `readText`,
`readBinary`, `readJSON`; the first implementation task is to diff that against
`@introspection/types`'s `StorageAdapter` and implement exactly the current
shape. The demo's `demos/shared/src/fetch-adapter.ts` is then deleted and its
importers point at `@introspection/read`.

Behaviour, per method:

- `listDirectories()` — `GET <base>/`; on a non-OK response, **throws** a clear
  error (see Error handling — this is the resolved decision point, not `[]`).
- `readText(path)` / binary / JSON reads — `GET <base>/<path>`; non-OK throws
  `Failed to fetch <path>: <status>`.

## CLI surface

`introspect` gains two ways to select a remote source, alongside the existing
`--dir`:

| Flag | Meaning |
|---|---|
| `--dir <path>` | Filesystem adapter. Default: `.introspect` in cwd. Unchanged. |
| `--url <baseUrl>` | HTTP adapter pointed directly at `baseUrl`. |
| `--ci [ref]` | Resolve `ref` to a base URL via the `resolveRun` config hook, then use the HTTP adapter. `ref` defaults to the current git branch. |

`--dir`, `--url`, and `--ci` are mutually exclusive; supplying more than one is
an argument error. With none supplied, the default `--dir .introspect` applies
as today.

The adapter is constructed once at command startup; `loadSession` /
`listSessions` receive it exactly as they receive the filesystem adapter now.
No command implementation changes.

## The `resolveRun` discovery hook

"Knowing the URL" is the genuinely project-specific part: a developer has a
branch / PR / pipeline in hand, and the mapping from that to a trace URL
depends on the project's CI and server conventions. Introspection must not bake
in any one project's scheme.

So `introspect.config.ts` may export an optional hook:

```ts
export function resolveRun(ref: string): string | Promise<string>
```

- Input `ref` — a human reference. The CLI passes whatever followed `--ci`, or
  the current git branch when `--ci` was given bare.
- Output — a base URL suitable for `createHttpReadAdapter`.

The CLI flow for `--ci [ref]`:

1. Determine `ref` (argument, or `git rev-parse --abbrev-ref HEAD`).
2. Load `introspect.config.ts`. If it has no `resolveRun` export, error:
   `--ci requires a resolveRun hook in introspect.config.ts`.
3. `await resolveRun(ref)` → base URL → `createHttpReadAdapter(url)`.

Introspection ships the **contract** and the git-branch default only — no
built-in resolver. The introspection repo's own `introspect.config.ts` carries
a minimal example `resolveRun` as executable documentation (it can resolve
against a local fixture server or simply construct a URL from a template, with
a comment pointing at the reference target).

## Error handling

- **Bad / unreachable base URL** — `fetch` rejection or non-OK status surfaces
  as a clear error naming the URL and status; the CLI exits non-zero. It does
  not silently produce empty output.
- **`listDirectories` on a non-OK response** — *throws* rather than returning
  `[]`. Rationale: a developer running `introspect --url … list` against a
  wrong URL must see "that URL is wrong", not "no sessions found". (The demo
  prototype returns `[]`; that is a demo affordance, not correct CLI
  behaviour. This is the resolved decision point.)
- **`resolveRun` throws or returns a non-string** — the CLI reports the hook
  failed, including the thrown message, and exits non-zero.
- **Missing `resolveRun` with `--ci`** — the explicit error above.

## Testing

TDD throughout.

- **`createHttpReadAdapter`** — tested in-process against
  `@introspection/serve`'s `createHandler` over a fixture trace directory: no
  real network. The core assertion is *equivalence* — a `SessionReader` built
  on the HTTP adapter returns the same events / assets / meta as one built on
  the filesystem adapter reading the same fixture. Plus per-method error cases
  (404, 500, network rejection).
- **CLI argument resolution** — `--dir` / `--url` / `--ci` selection and the
  mutual-exclusion error, tested at the arg-parsing layer.
- **`resolveRun`** — tested with a stub `introspect.config.ts`: ref defaulting
  to git branch, the missing-hook error, the hook-throws error.

## Reference target (illustration only — not built here)

The work this spec builds toward: `@rg/integration-tests` migrates onto
introspection, and its viewer moves to a conventional **built SPA + Node API
(Hono)** setup. The Hono API mounts the project's own endpoints *and*
`@introspection/serve`'s `createHandler`. Because `createHandler` is a
Web-standard `(Request) => Response | null`, mounting it in Hono is direct —
Hono's `c.req.raw` is a standard `Request` — no `req`/`res` shim. At that
point the viewer UI and the `introspect --url` / `--ci` CLI are two clients of
the same mounted protocol. None of that server-side work is in this spec; it
is the picture that justifies the shape chosen here.

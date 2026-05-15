# Named payloads: inline-or-asset, named entries, uniform reads

> **Status:** landed (2026-05-08) · plan: `docs/superpowers/plans/2026-05-08-named-payloads-schema-migration.md`

## Status

Design. Supersedes `docs/superpowers/plans/2026-05-08-event-payload-size-threshold.md` (the original "deferred" plan), which framed the threshold as a single-plugin question. The actual scope is broader: 6+ plugins already write assets, several emit multi-asset events, and positional `assets[]` arrays have lost their semantic names.

## Problem

Plugins currently make two unrelated decisions every time they capture a payload:

1. **Inline vs. asset.** Today every payload-bearing plugin writes to disk via `writeAsset`, even for tiny snapshots that would be more useful inlined in `events.ndjson` (queryable, greppable, no round-trip). `plugin-redux` always writes; `plugin-debugger` always writes; `plugin-web-storage` (planned) wants inline. There's no shared mechanism, and the right answer is usually "inline below a threshold, asset above it."
2. **Naming.** Events carry `assets: AssetRef[]`. `plugin-solid-devtools` writes three assets per emit (structure, dgraph, updates) in array order; `plugin-indexeddb` writes three (stores, indexes, records); `plugin-webgl` writes several. Consumers reading `event.assets[1]` have to consult plugin source to know what entry 1 means. The names exist conceptually but are erased on the wire.

Both issues compound: when we add the inline/asset cutoff, we need a shape that names what's in each entry anyway.

## Current call sites

```
playwright/src/proxy.ts       (network response bodies — built-in)
plugin-network                 (response bodies)
plugin-redux                   (state snapshots)
plugin-debugger                (variable values)
plugin-indexeddb               (3 named payloads per emit)
plugin-solid-devtools          (3 named payloads per emit)
plugin-webgl                   (frames + state)
```

All use `assets: AssetRef[]`. Several would benefit from named payloads independent of the inline question.

## Design

### Schema change: `assets` → `payloads: Record<string, PayloadRef>`

```ts
type PayloadFormat = 'json' | 'html' | 'text' | 'image' | 'binary'  // unchanged from today's AssetKind

type PayloadRef =
  | { kind: 'inline'; value: unknown }                            // lives in events.ndjson; implicitly json
  | { kind: 'asset';  format: PayloadFormat; path: string; size: number }  // lives in assets/ on disk

interface IntrospectionEvent {
  // ...
  payloads?: Record<string, PayloadRef>  // replaces `assets: AssetRef[]`
}
```

Single-level discriminator (`kind: 'inline' | 'asset'`), no nested type. The asset variant carries `format` (renamed from the old `AssetRef.kind`) so reading code knows how to parse the bytes — `'json'` is a content format, not a storage kind. `size` is required (always known at write time — `JSON.stringify` length for json, `Buffer.byteLength` for binary). Existing `AssetRef` as a separate named type goes away; `writeAsset`'s return is itself a valid `PayloadRef`.

### Payload naming convention

Payload names are part of the public schema — consumers will write filters like `event.payloads.state.value.user.id` and pipe through `introspect payload <event-id> <name>`. Inconsistent names across plugins make cross-plugin queries unreliable.

Canonical names by intent:

| Intent | Name |
|---|---|
| The captured "main thing" of a single-payload event | `value` |
| Application or framework state snapshot | `state` |
| Network response body (or any captured request/response body) | `body` |
| Captured image (screenshot, frame) | `image` |
| Captured HTML or DOM fragment | `html` |
| Multi-part captures: name each part by what it represents | e.g. `structure`, `dgraph`, `updates`, `stores`, `indexes`, `records` |

Rule of thumb: a name should be a noun describing what the payload _is_, not what produced it (`body` not `responseBody`, `state` not `reduxState`). Plugin authors picking a new name should grep existing usages first.

Inline values are JSON-only. Anything binary or HTML goes through `writeAsset` and is emitted as the returned ref directly.

Rename rationale: once inline is a first-class variant, "asset" stops fitting on the outer shape (it implies on-disk), and the old `AssetRef.kind` name overloads with the new discriminator. One clean break is cheaper than living with both.

### Write API

`emit({ payloads })` accepts two forms per entry:

```ts
// 1. Bare JSON-serializable value — threshold-checked using trace default.
emit({ type: 'redux.snapshot', payloads: { state } })

// 2. Already-resolved PayloadRef — passed through as-is.
//    writeAsset returns a PayloadRef directly; no wrapping needed.
const asset = await ctx.writeAsset({ format: 'binary', content: buf })
emit({ type: 'screenshot', payloads: { image: asset } })
```

For threshold overrides (force inline / force asset), plugins call the explicit helper:

```ts
ctx.payload(value, { inlineUnder?: number }): Promise<PayloadRef>

// e.g. force asset regardless of size:
emit({
  type: 'redux.snapshot',
  payloads: { state: await ctx.payload(state, { inlineUnder: 0 }) },
})
```

**Detection rule.** Inside `emit`, a payload value is treated as a `PayloadRef` iff it is an object with `kind === 'inline'` or `kind === 'asset'` (and the matching `value`/`format` fields). Otherwise it is a bare value to be JSON-serialized and threshold-checked. Documented edge case: bare values whose top-level shape is `{ kind: 'inline' | 'asset', ... }` need to be wrapped via `ctx.payload(value)` to disambiguate. In practice this is rare (most snapshot/state shapes don't use a top-level `kind` field); the alternative (always requiring `ctx.payload` wrapping) costs every call site an `await` and an extra import for the 99% case. **Plugin authors:** if your payload's value happens to use `kind` as a top-level field, wrap with `await ctx.payload(value)`.

`ctx.writeAsset(...)` keeps its semantics; only field names change as part of this design. `WriteAssetOptions.kind` becomes `WriteAssetOptions.format` (same value set: `'json' | 'html' | 'text' | 'image' | 'binary'`), and the return type becomes a `PayloadRef` asset variant. Use it for non-JSON content, for streaming, or when the plugin wants to construct a ref ahead of `emit`.

### Threshold logic

When `emit` sees a bare value:
1. `JSON.stringify(value)` once.
2. Measure byte length.
3. If `≤ inlineUnder` → store as `{ kind: 'inline', value }`.
4. Else → `writeAsset({ format: 'json', content: <serialized> })` and store the returned `{ kind: 'asset', format: 'json', path, ext }`.

`inlineUnder` resolution: per-call (via `ctx.payload`) > trace default (via `attach({ inlineUnder })`) > global default.

**Initial global default: `0`.** Every payload stays an asset on day one — behavior is unchanged from today. The threshold mechanism is shipped but dormant. We then measure real payload sizes from a recorded trace and pick a defensible default (likely 8–32 KB) in a follow-up. This decouples the schema migration from the policy decision and keeps the rollout reversible.

### Read API

```ts
reader.resolvePayload(ref: PayloadRef): Promise<unknown>
```

- `{ kind: 'inline', value }` → returns `value`.
- `{ kind: 'asset', format, path }` → reads from disk, parses by `format`.

When the asset file is missing on disk (deleted, copied without `assets/`, etc.), the resolver throws — callers decide whether to surface as a warning or hard fail. The CLI surfaces missing-asset errors to stderr without aborting the surrounding command.

Consumers (CLI rendering, query layer, `serve`, `demos/static-report`, debugger views) use this resolver and stay agnostic to the storage variant.

### CLI surface

The change implies updates to the CLI to keep the read workflow ergonomic.

**`introspect events`.** Default text format stays compact: a timeline line per event followed by one line per payload showing name + summary (`state: json, 12.3KB` for assets, `state: <inline 0.4KB>` for inline). No values rendered by default — text is for scanning. `--format json` auto-resolves text-ish payloads (`json`, `text`, `html`) by augmenting asset entries with a `value` field; inline entries already carry `value`. Binary/image entries keep their metadata (`path`, `size`, `format`) and are not augmented — bytes-as-JSON is a bad default and a `null` sentinel would overload with "unresolvable." When `--filter <expr>` is provided, payloads are resolved before the expression evaluates so filters can reference `event.payloads.<name>.value` symmetrically across inline and text-ish asset; filter expressions referencing `.value` on binary payloads see `undefined`. Filter evaluation errors surface to stderr (not silently swallowed). A `--payload <name>` option (repeatable or comma-separated) limits both rendering and resolution to the listed names — useful for multi-payload events like solid-devtools captures.

**`introspect payload <event-id> <name>`.** New command — resolves a single named payload of a single event and dumps it to stdout. JSON values are pretty-printed; text/HTML are raw; binary values pass through as bytes (pipe-friendly: `introspect payload <id> image > shot.png`). This is the explicit "give me this value" surface — replaces the deleted `introspect assets <path>` workflow with one that speaks the user's vocabulary (event id + payload name) instead of internal file paths.

**`introspect assets`.** Removed entirely. Flat directory listings of asset files no longer have a clear user-facing purpose now that events name their payloads.

### Legacy trace normalization

Existing recorded `.introspect/` traces on disk have `assets: AssetRef[]`. The read layer maps them on load:

```ts
// Old AssetRef.kind becomes new PayloadRef.format on the asset variant.
{ assets: [{ kind: 'json', path: 'a.json' }, ...] }
  →
{ payloads: { '0': { kind: 'asset', format: 'json', path: 'a.json' }, ... } }
```

Numeric string keys preserve order without inventing names. Code that consumed `event.assets` directly is updated to use `event.payloads`; nothing in the codebase needs to handle both shapes.

A trace schema version bump signals the rename for tooling that cares.

## Migration plan

### In-tree consumers (read side)

Before sizing implementation effort, inventory every reader of `event.assets`. Known surfaces:

- `packages/cli` — event rendering, `events`/`assets` subcommands
- `packages/query` — query layer
- `packages/serve` and `demos/static-report` — viewer
- `packages/read` — reader API
- Plugin tests that assert on `event.assets`

The inventory step is part of the implementation plan, not this design doc. Each touch point shifts from `event.assets` array indexing to `event.payloads[name]` plus `resolvePayload` where it needs the value.

### Plugin migrations (write side)

| Site | Today | After |
|---|---|---|
| `playwright/src/proxy.ts` | `writeAsset` + `assets: [ref]` | `writeAsset` + `payloads: { body: asset }` |
| `plugin-network` | same | `payloads: { body: asset }` |
| `plugin-redux` | always asset | `payloads: { state }` (threshold dormant at first) |
| `plugin-debugger` | always asset | `payloads: { value }` |
| `plugin-indexeddb` | 3 unnamed assets | `payloads: { stores, indexes, records }` |
| `plugin-solid-devtools` | 3 unnamed assets | `payloads: { structure, dgraph, updates }` |
| `plugin-webgl` | multiple unnamed | named payloads; binary frames keep `writeAsset`, return passed straight through |

Each plugin gets named payloads immediately. Inlining only kicks in once the global default is raised above 0.

## Why this shape

- **Named payloads are valuable independent of inlining.** Solid-devtools and indexeddb consumers stop guessing at `assets[1]` regardless of whether anything ever inlines.
- **Per-event-type policy is unnecessary if reads are uniform.** The `resolvePayload` resolver hides the inline/asset split, so we don't need to pin event types to one strategy.
- **Bare-value ergonomics keep the happy path one line.** `payloads: { state }` is the shortest plausible expression. Overrides go through `ctx.payload(...)` — explicit and rare.
- **Binary stays out of the implicit form.** No `kind` field to set, no "should I have inlined this buffer?" question. JSON-only on the implicit path is honest about what can be inlined safely.
- **Dormant default lets us ship the schema first, tune the policy second.** Two reversible decisions instead of one entangled one.
- **CLI split fits how users actually work.** `events` for filtering and overview, `payload` for "give me this one value." Each command does one job. Auto-resolve in `--format json` keeps machine-readable output complete; compact text keeps scans usable.

## Out of scope

- Reconstruction-layer changes beyond `resolvePayload`. Time-travel debuggers etc. should be unaffected.
- Compression or alternate encodings for inline values (CBOR, etc.).
- Asset deduplication across events (a known win, but orthogonal).
- Picking the eventual non-zero default threshold. That's a follow-up after measurement.

## Open questions

- Should the resolver cache parsed asset payloads in-process? Likely yes for query-layer ergonomics, but trivially additive — defer to implementation.
- Trace schema version bump: does the read layer hard-fail on unknown versions, or just warn? Existing convention should win; verify in the plan.

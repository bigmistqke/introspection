# Named payloads — schema migration (Plan A)

> **Status:** landed (2026-05-08) · spec: `docs/superpowers/specs/2026-05-08-named-payloads-design.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `assets: AssetRef[]` to `payloads: Record<string, PayloadRef>` across the introspection codebase, drop `AssetRef` as a separate named type, and add a uniform `resolvePayload` to the read API. Behavior is unchanged — every payload still goes through `writeAsset` — but events have named payloads and reads are uniform across inline/asset variants. Plan B (in a follow-up doc) wires the threshold mechanism on top.

**Architecture:** A single discriminated union `PayloadRef = { kind: 'inline', value } | { kind: 'asset', format, path, size }` replaces `AssetRef`. `WriteAssetOptions.kind` becomes `WriteAssetOptions.format`. `writeAsset` returns a `PayloadRef` directly so plugins can pass the result straight into `emit({ payloads: { name: asset } })`. A `resolvePayload(ref)` helper hides the inline-vs-asset distinction from consumers. The CLI splits into two commands: `introspect events` keeps a compact, scannable text format (timeline + per-payload summary lines, no values rendered) and an auto-resolved `--format json` (text-ish asset entries are augmented with `value`; binary entries keep metadata only — no `value` field, since bytes-as-JSON is a bad default); a new `introspect payload <event-id> <name>` command handles "give me this one value" — pretty-prints JSON, raw text/HTML, pipes binary bytes. Filter expressions trigger payload resolution before evaluation so `event.payloads.<name>.value` works symmetrically across inline and text-ish asset.

**Tech Stack:** TypeScript, Node, Playwright (for the e2e plugin tests), Vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-05-08-named-payloads-design.md`.

---

## File map

**Types (foundation):**
- Modify: `packages/types/src/index.ts` — drop `AssetRef`, add `PayloadRef` + `PayloadFormat`, change `BaseEvent.assets` → `BaseEvent.payloads`, rename `WriteAssetOptions.kind` → `WriteAssetOptions.format`, update `AssetWriter.writeAsset` return type, update typed events that pin asset shape (e.g. `ReduxSnapshotEvent`).
- Modify: `packages/types/README.md` — keep documentation in sync (the public type doc).

**Write side:**
- Modify: `packages/write/src/trace-writer.ts` — `writeAsset` builds and returns a `PayloadRef` asset variant.
- Modify: `packages/write/src/trace.ts` — pass-through, types only.
- Modify: `packages/write/src/memory.ts` — adapter signature unchanged on disk side, types only.
- Modify: `packages/write/test/trace-writer.test.ts`, `packages/write/test/memory.test.ts` — update assertions.

**Read side:**
- Modify: `packages/read/src/index.ts` — add `resolvePayload`, drop the `assets.ls()` / `assets.metadata()` API (no longer used after the CLI command is removed).
- Modify: `packages/read/test/trace-reader.test.ts` — add resolver tests, drop tests for the removed asset-listing API.

Legacy trace normalization is **out of scope**. Old recorded traces on disk (with `assets: AssetRef[]`) will not be readable by the new code. The repo is early enough that this cost is acceptable.

**Built-in writers:**
- Modify: `packages/playwright/src/attach.ts` — `PluginContext.writeAsset` typed return, no behavior change.
- Modify: `packages/playwright/src/proxy.ts` — replace `assets: [ref]` with `payloads: { body: ref }` on network response events.
- Modify: `packages/playwright/test/proxy.spec.ts`, `packages/playwright/test/attach.spec.ts` — update assertions.

**CLI:**
- Modify: `packages/cli/src/commands/events.ts:46-47` — read `event.payloads` not `event.assets`.
- Modify: `packages/cli/src/index.ts:63-91` — remove the `assets` command entirely. Once events have named payloads, a flat asset listing has no clear user-facing purpose, and the by-path display is replaced by a new `introspect payload <event-id> <name>` command that speaks the user's vocabulary.
- Add: `introspect payload <event-id> <name>` command in `packages/cli/src/index.ts` — resolves one payload of one event and dumps it to stdout. Pipe-friendly for binary (`introspect payload e1 image > shot.png`).

**Plugins (each gets named payloads, no inline yet):**
- Modify: `plugins/plugin-network/src/index.ts` — `payloads: { body: asset }`.
- Modify: `plugins/plugin-network/test/network.spec.ts`.
- Modify: `plugins/plugin-redux/src/index.ts` — `payloads: { state: asset }`.
- Modify: `plugins/plugin-redux/src/reconstruct.ts` — read `event.payloads.state`.
- Modify: `plugins/plugin-redux/test/redux.spec.ts`.
- Modify: `plugins/plugin-debugger/src/index.ts` — `payloads: { value: asset }`.
- Modify: `plugins/plugin-debugger/test/debugger.spec.ts`.
- Modify: `plugins/plugin-indexeddb/src/index.ts` — named payloads per emit site (current code mutates `event.assets` directly at line 503; rewrite to use `payloads`).
- Modify: `plugins/plugin-indexeddb/test/indexeddb.spec.ts`.
- Modify: `plugins/plugin-solid-devtools/src/index.ts` — `payloads: { structure, dgraph, updates }`.
- Modify: `plugins/plugin-solid-devtools/test/solid-devtools.spec.ts`.
- Modify: `plugins/plugin-webgl/src/index.ts` — named payloads; binary frames pass returned `PayloadRef` through.
- Modify: `plugins/plugin-webgl/test/webgl.spec.ts`.

**Demos / viewer:**
- Modify: `demos/solid-streaming/src/App.tsx` — render from `event.payloads` (record entries).
- Modify: `demos/solid-streaming/src/hooks/useAssetContent.ts` — iterate payload entries, ignore inline variant for now (every payload is asset in Plan A but the resolver path must still work).

**Skills / docs:**
- Modify: `packages/cli/skills/introspect-plugin/skill.md` — sample code uses `payloads`.

---

## Strategy

This is a coordinated refactor. The TypeScript compiler is the source of truth for "did I miss a site." Workflow per task:

1. Make the type/code change.
2. Run `pnpm -w typecheck` (or the package's `pnpm build`) to surface every breakage.
3. Update broken sites in the same task or note them for the dedicated migration task.
4. Run the relevant test suite.
5. Commit.

For genuinely new behavior (`resolvePayload`, legacy normalizer), use strict TDD — write failing test first.

For mechanical renames (every plugin call site), the existing plugin spec tests are the regression net. Update tests and source together; if tests still pass against the updated assertion shape, the migration is correct.

---

## Task 1: Add `PayloadRef` and `PayloadFormat` types

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Locate the existing `AssetKind` and `AssetRef` definitions**

Open `packages/types/src/index.ts` and find:

```ts
export type AssetKind = 'json' | 'html' | 'text' | 'image' | 'binary'

export interface AssetRef {
  path: string
  kind: AssetKind
  size?: number
}
```

(Around lines 52–58.)

- [ ] **Step 2: Replace those definitions with `PayloadFormat` and `PayloadRef`**

Replace the `AssetKind` and `AssetRef` block with:

```ts
// ─── Payload reference ──────────────────────────────────────────────────────
//
// A payload is one named piece of data attached to an event. It is either:
//   - inline (the value lives in events.ndjson; implicitly JSON), or
//   - an asset (the value lives in the trace's assets/ directory on disk).
//
// `PayloadFormat` describes how the on-disk bytes should be parsed/rendered.

export type PayloadFormat = 'json' | 'html' | 'text' | 'image' | 'binary'

export interface PayloadInline {
  kind: 'inline'
  value: unknown
}

export interface PayloadAsset {
  kind: 'asset'
  format: PayloadFormat
  path: string
  size?: number
}

export type PayloadRef = PayloadInline | PayloadAsset
```

Do not delete usages of `AssetRef` / `AssetKind` yet — later tasks will catch them via the type checker.

- [ ] **Step 3: Run typecheck to enumerate breakages**

```bash
pnpm -w typecheck
```

Expected: type errors at every site that referenced `AssetRef` or `AssetKind`. This is the to-do list for later tasks. Do not try to fix them yet — just confirm the compiler is now angry, then move on.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "types: introduce PayloadRef / PayloadFormat to replace AssetRef"
```

---

## Task 2: Update `BaseEvent` and the typed events that pin asset shape

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Change `BaseEvent.assets` to `BaseEvent.payloads`**

Find:

```ts
export interface BaseEvent {
  id: string
  timestamp: number
  initiator?: string
  pageId?: string
  assets?: AssetRef[] // files written to the assets directory by this event
  summary?: string
}
```

Replace with:

```ts
export interface BaseEvent {
  id: string
  timestamp: number
  initiator?: string
  pageId?: string
  /** Named payloads attached to this event. Each is either inline or an asset reference. */
  payloads?: Record<string, PayloadRef>
  summary?: string
}
```

- [ ] **Step 2: Update typed events that previously pinned `assets: [AssetRef]`**

Search for `assets: [` inside the file:

```bash
grep -n "assets: \[" packages/types/src/index.ts
```

Expected hits include `ReduxSnapshotEvent` (around line 332). Replace each with a `payloads` record using the payload name we want for that event. Example:

```ts
export interface ReduxSnapshotEvent extends BaseEvent {
  type: 'redux.snapshot'
  payloads: { state: PayloadRef }
  metadata?: never
}
```

Use the payload names from the migration table in the spec:
- `redux.snapshot` → `state`
- (No other typed events currently pin `assets:`. If `grep` finds more, name them after their semantic role.)

- [ ] **Step 3: Run typecheck**

```bash
pnpm -w typecheck
```

Expected: still failing in many other packages; no _new_ errors inside `packages/types`.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "types: rename BaseEvent.assets to payloads (record of PayloadRef)"
```

---

## Task 3: Update `WriteAssetOptions` and `AssetWriter` signatures

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Locate `WriteAssetOptions` and `AssetWriter`**

Around line 712–832. They look roughly like:

```ts
export interface AssetWriter {
  writeAsset(opts: WriteAssetOptions): Promise<AssetRef>
}

export interface WriteAssetOptions {
  kind: AssetKind
  content: string | ArrayBufferView
  ext?: string
  // ...
}
```

(Open the file to see the full shape — keep all existing fields untouched except `kind`.)

- [ ] **Step 2: Rename `kind` → `format`, return `PayloadAsset`**

```ts
export interface AssetWriter {
  writeAsset(opts: WriteAssetOptions): Promise<PayloadAsset>
}

export interface WriteAssetOptions {
  format: PayloadFormat
  content: string | ArrayBufferView
  ext?: string
  // ...keep any other existing fields unchanged
}
```

The return type is the asset variant of the union (not `PayloadRef`), so calling code doesn't have to narrow before passing it into `emit`.

- [ ] **Step 3: Run typecheck**

```bash
pnpm -w typecheck
```

Expected: errors at every `writeAsset({ kind: ... })` call site. Note them mentally; later tasks fix them.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "types: rename WriteAssetOptions.kind to format; writeAsset returns PayloadAsset"
```

---

## Task 4: Update the write package implementation

**Files:**
- Modify: `packages/write/src/trace-writer.ts`
- Modify: `packages/write/src/trace.ts`
- Modify: `packages/write/src/memory.ts`
- Modify: `packages/write/test/trace-writer.test.ts`
- Modify: `packages/write/test/memory.test.ts`

- [ ] **Step 1: Update `trace-writer.ts`'s `writeAsset` to use `format` and return a `PayloadAsset`**

Find the `writeAsset` function (currently around line 34). It typically looks like:

```ts
export async function writeAsset(args: { kind: AssetKind; content: ...; traceDir: string; ... }): Promise<AssetRef> {
  // ...write file at <traceDir>/assets/<generated>.<ext>...
  return { path, kind, size }
}
```

Change the parameter and return:

```ts
export async function writeAsset(args: { format: PayloadFormat; content: ...; traceDir: string; ... }): Promise<PayloadAsset> {
  // ...write file at <traceDir>/assets/<generated>.<ext>...
  return { kind: 'asset', format, path, size }
}
```

Replace every reference to the old `kind` parameter inside the body with `format`. The returned object now carries the `kind: 'asset'` discriminator.

- [ ] **Step 2: Update `trace.ts` callers**

`trace.ts` wraps `writeAsset`. Find:

```ts
async writeAsset(options) {
  // ...
  return writeAsset({ kind: options.kind, content: options.content, ... })
}
```

Change to `format: options.format` so the new option name flows through.

- [ ] **Step 3: Update `memory.ts` adapter signature**

`memory.ts` defines an internal `Adapter.writeAsset(path, content)` for in-memory tests — it does not need to know about format/kind because the format never reaches the on-disk layer (it's metadata returned to the caller). No change needed beyond confirming that `memory.test.ts` does not reach into the deleted `kind` field on the returned ref. If it does, update those references in Step 5.

- [ ] **Step 4: Run write package build/typecheck**

```bash
pnpm --filter @introspection/write typecheck
```

Expected: zero errors inside `packages/write/src`.

- [ ] **Step 5: Update `packages/write/test/trace-writer.test.ts`**

Open the file and find every `writer.writeAsset({ kind: 'json', ... })` (around lines 113, 125, 132). Replace `kind:` with `format:` in those input objects. Then update assertions: tests asserting on the returned ref's `.kind === 'json'` etc. should now assert on `.format` for the format and `.kind === 'asset'` for the discriminator.

Example, before:
```ts
const ref = await writer.writeAsset({ kind: 'json', content: '{"hello":"world"}' })
expect(ref.kind).toBe('json')
expect(ref.path).toMatch(/\.json$/)
```

After:
```ts
const ref = await writer.writeAsset({ format: 'json', content: '{"hello":"world"}' })
expect(ref.kind).toBe('asset')
expect(ref.format).toBe('json')
expect(ref.path).toMatch(/\.json$/)
```

Apply the same pattern to the other tests in this file.

- [ ] **Step 6: Update `packages/write/test/memory.test.ts`**

Same pattern as Step 5 if the file references `kind` on returned refs. The internal adapter test (`adapter.writeAsset('asset.bin', buffer)`) uses the lower-level adapter API and does not change.

- [ ] **Step 7: Run write package tests**

```bash
pnpm --filter @introspection/write test
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add packages/write
git commit -m "write: writeAsset uses format, returns PayloadAsset"
```

---

## Task 5: Add `resolvePayload` to the read API (TDD)

**Files:**
- Modify: `packages/read/src/index.ts`
- Modify: `packages/read/test/trace-reader.test.ts`

- [ ] **Step 1: Write a failing test for `resolvePayload` on inline variants**

Open `packages/read/test/trace-reader.test.ts` and add at the bottom (inside the existing `describe`, or in a new one):

```ts
describe('resolvePayload', () => {
  it('returns the inline value verbatim', async () => {
    const reader = await openTrace(/* existing fixture path */)
    const value = await reader.resolvePayload({ kind: 'inline', value: { hello: 'world' } })
    expect(value).toEqual({ hello: 'world' })
  })

  it('reads and parses a json asset by format', async () => {
    const reader = await openTrace(traceWithAsset('hello.json', '{"hello":"world"}'))
    const value = await reader.resolvePayload({
      kind: 'asset',
      format: 'json',
      path: 'assets/hello.json',
    })
    expect(value).toEqual({ hello: 'world' })
  })

  it('returns raw bytes for binary assets', async () => {
    const reader = await openTrace(traceWithAsset('blob.bin', Buffer.from([1, 2, 3])))
    const value = await reader.resolvePayload({
      kind: 'asset',
      format: 'binary',
      path: 'assets/blob.bin',
    })
    expect(Buffer.isBuffer(value)).toBe(true)
    expect(Array.from(value as Buffer)).toEqual([1, 2, 3])
  })
})
```

`openTrace` and `traceWithAsset` are existing helpers — read the file's top to confirm names; adjust if they're called something else (e.g. `createTraceReader`, `withFixture`).

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pnpm --filter @introspection/read test -- --testNamePattern=resolvePayload
```

Expected: FAIL — `resolvePayload is not a function`.

- [ ] **Step 3: Implement `resolvePayload` in `packages/read/src/index.ts`**

Locate the public API surface of the reader (look for the existing `assets` API around line 166). Add a method on the same object:

```ts
async resolvePayload(ref: PayloadRef): Promise<unknown> {
  if (ref.kind === 'inline') return ref.value
  // asset variant
  const fullPath = path.join(traceDir, ref.path)
  const bytes = await fs.readFile(fullPath)
  switch (ref.format) {
    case 'json':
      return JSON.parse(bytes.toString('utf-8'))
    case 'html':
    case 'text':
      return bytes.toString('utf-8')
    case 'image':
    case 'binary':
      return bytes
  }
}
```

Use whatever `path`/`fs` imports the file already pulls in. Read the surrounding code to match style.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
pnpm --filter @introspection/read test -- --testNamePattern=resolvePayload
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/read
git commit -m "read: add resolvePayload(ref) returning inline value or parsed asset"
```

---

## Task 6: Drop the read-side asset listing API

**Files:**
- Modify: `packages/read/src/index.ts`
- Modify: `packages/read/test/trace-reader.test.ts`

The `assets.ls()` and `assets.metadata()` methods existed solely to power the CLI `assets` command, which is being removed in Task 15a. Drop them now (in lockstep with the type rename) rather than carrying dead code.

- [ ] **Step 1: Remove the `assets` API from the reader**

In `packages/read/src/index.ts` find the block around line 166:

```ts
assets: {
  list() { /* iterates events, collects event.assets refs */ },
  metadata(path) { /* finds an asset by path */ },
  // possibly readText / readJSON helpers
},
```

Delete the whole `assets:` property. If `readText` / `readJSON` (or similar) helpers live there and are used elsewhere, move them out as standalone reader methods or exports — search for callers first:

```bash
grep -rn "trace\.assets\|reader\.assets" packages/ plugins/ --include="*.ts" | grep -v "\.d\.ts\|/dist/"
```

If `trace.assets.readJSON` is still used (e.g. in `plugin-redux/src/reconstruct.ts`), expose `reader.resolvePayload` as the replacement before deleting the old API. The Task 10 (plugin-redux) migration already updates `reconstruct.ts` to use `resolvePayload`; ensure that runs before this delete or in the same task.

- [ ] **Step 2: Remove the corresponding tests**

In `packages/read/test/trace-reader.test.ts`, delete tests that exercise `trace.assets.ls()` or `trace.assets.metadata()`. Keep the `resolvePayload` tests added in Task 5.

- [ ] **Step 3: Run read package tests**

```bash
pnpm --filter @introspection/read test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/read
git commit -m "read: drop assets.ls/metadata API, superseded by resolvePayload"
```

---

## Task 7: Wire `PluginContext.writeAsset` typing in `attach.ts`

**Files:**
- Modify: `packages/playwright/src/attach.ts`
- Modify: `packages/playwright/test/attach.spec.ts`

- [ ] **Step 1: Update the `writeAsset` shims in `attach.ts`**

Find the four occurrences in `packages/playwright/src/attach.ts` (lines 121, 192, 202–203). Each currently looks like:

```ts
writeAsset: trace.writeAsset.bind(trace),
// or
async writeAsset(opts) { return trace.writeAsset(opts) }
```

The shape doesn't change — the underlying trace method's return type now flows through as `PayloadAsset`. Run typecheck and confirm no inline `AssetRef` annotations need updating.

```bash
pnpm --filter @introspection/playwright typecheck
```

Expected: clean inside `attach.ts` (some failures may persist in `proxy.ts` and tests — those are the next tasks).

- [ ] **Step 2: Update `attach.spec.ts` assertions**

In `packages/playwright/test/attach.spec.ts` find the test at line 151 (`ctx.writeAsset writes file and returns AssetRef`) and the inline `await ctx.writeAsset({ kind: 'json', ... })` calls at lines 158 and 192. Update:

- Test name: change "AssetRef" to "PayloadRef".
- Input objects: `kind:` → `format:`.
- Assertions on the returned ref: now expect `.kind === 'asset'` and `.format === 'json'`.

```ts
test('ctx.writeAsset writes file and returns PayloadRef asset variant', async ({ page }) => {
  // ...existing setup...
  const asset = await savedCtx!.writeAsset({ format: 'json', content: '{"ok":true}' })
  expect(asset.kind).toBe('asset')
  expect(asset.format).toBe('json')
  expect(asset.path).toMatch(/\.json$/)
})
```

- [ ] **Step 3: Run the playwright package's attach tests**

```bash
pnpm --filter @introspection/playwright test -- attach.spec
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/playwright/src/attach.ts packages/playwright/test/attach.spec.ts
git commit -m "playwright: wire PayloadAsset return type through ctx.writeAsset"
```

---

## Task 8: Migrate `playwright/src/proxy.ts` (screenshots)

**Files:**
- Modify: `packages/playwright/src/proxy.ts`
- Modify: `packages/playwright/test/proxy.spec.ts`

`proxy.ts` only emits screenshots (the `ARTIFACT_METHODS` set is `{'screenshot'}`); network response bodies are written by `plugin-network`, which is migrated separately in Task 9.

- [ ] **Step 1: Update the screenshot emit site in `proxy.ts`**

Around line 43, the current code does:

```ts
const asset = await writeAsset({ kind: 'image', content: result as Buffer, ext: 'png' })
emit({ type: 'playwright.screenshot', assets: [asset] })
```

Change to:

```ts
const asset = await writeAsset({ format: 'image', content: result as Buffer, ext: 'png' })
emit({ type: 'playwright.screenshot', payloads: { image: asset } })
```

(`asset` is already a valid `PayloadRef` — no wrapping.) Search the file for `assets:` and `kind:` to catch any other sites.

- [ ] **Step 2: Update `proxy.spec.ts` assertions**

In `packages/playwright/test/proxy.spec.ts` at lines 93 and 98:

Before:
```ts
expect(screenshotEvent.assets[0].kind).toBe('image')
const assetPath = join(traceDir, screenshotEvent.assets[0].path)
```

After:
```ts
const screenshot = screenshotEvent.payloads!.image
expect(screenshot.kind).toBe('asset')
expect(screenshot).toMatchObject({ kind: 'asset', format: 'image' })
const assetPath = join(traceDir, (screenshot as PayloadAsset).path)
```

Search the file for `.assets[` to catch all assertions.

- [ ] **Step 3: Run playwright package tests**

```bash
pnpm --filter @introspection/playwright test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/playwright
git commit -m "playwright: emit screenshots via payloads { image }"
```

---

## Task 9: Migrate `plugin-network`

**Files:**
- Modify: `plugins/plugin-network/src/index.ts`
- Modify: `plugins/plugin-network/test/network.spec.ts`

- [ ] **Step 1: Update the body-write site**

Around line 85:

Before:
```ts
const asset = await ctx.writeAsset({ kind: assetKind, content: body })
// ...later...
event.assets = [asset]
// (or the asset is set on the emitted event in some other way — read the surrounding code)
```

After:
```ts
const asset = await ctx.writeAsset({ format: assetKind, content: body })
// ...later, when emitting...
ctx.emit({ ..., payloads: { body: asset } })
```

If the existing code mutates an `event.assets` field directly, refactor to set `payloads: { body: asset }` instead. Confirm the variable named `assetKind` resolves to a `PayloadFormat` value (`'json' | 'binary' | ...`); rename to `format` if it improves clarity locally.

- [ ] **Step 2: Update `network.spec.ts` assertions (lines 98, 143)**

Before:
```ts
expect(bodyEvent.assets[0].kind).toBe('json')
```

After:
```ts
const body = bodyEvent.payloads!.body
expect(body.kind).toBe('asset')
expect(body).toMatchObject({ kind: 'asset', format: 'json' })
```

- [ ] **Step 3: Run the plugin's tests**

```bash
pnpm --filter @introspection/plugin-network test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add plugins/plugin-network
git commit -m "plugin-network: emit response bodies via payloads { body }"
```

---

## Task 10: Migrate `plugin-redux`

**Files:**
- Modify: `plugins/plugin-redux/src/index.ts`
- Modify: `plugins/plugin-redux/src/reconstruct.ts`
- Modify: `plugins/plugin-redux/test/redux.spec.ts`

- [ ] **Step 1: Update the snapshot emit site (around line 164)**

Before:
```ts
const ref = await ctx.writeAsset({ kind: 'json', content: JSON.stringify(state) })
await ctx.emit({ type: 'redux.snapshot', assets: [ref] })
```

After:
```ts
const ref = await ctx.writeAsset({ format: 'json', content: JSON.stringify(state) })
await ctx.emit({ type: 'redux.snapshot', payloads: { state: ref } })
```

- [ ] **Step 2: Update `reconstruct.ts` (line 40)**

Before:
```ts
const snapshotState = await assets.readJSON(snapshot.assets[0].path)
```

After: use the new resolver. The reconstructor should accept a `Reader` (or the existing assets API) — match whichever is in scope. If `assets` is the only API available, get the path from `snapshot.payloads.state`:

```ts
const ref = snapshot.payloads.state
if (ref.kind !== 'asset') throw new Error('redux.snapshot expected asset payload')
const snapshotState = await assets.readJSON(ref.path)
```

If the function has access to the reader (search for callers), prefer:

```ts
const snapshotState = await reader.resolvePayload(snapshot.payloads.state)
```

Pick the variant that matches the function's actual parameters; do not change the signature in this task.

- [ ] **Step 3: Update `redux.spec.ts` (lines 127–176)**

Replace every `snapshot.assets[0]` lookup with `snapshot.payloads.state` and update assertions:

```ts
const ref = snapshot.payloads.state
expect(ref.kind).toBe('asset')
expect(ref).toMatchObject({ kind: 'asset', format: 'json' })
const state = JSON.parse(await readFile(join(traceDir, (ref as PayloadAsset).path), 'utf-8'))
```

Apply at lines 127, 131, 150, 154, 176.

- [ ] **Step 4: Run plugin-redux tests**

```bash
pnpm --filter @introspection/plugin-redux test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-redux
git commit -m "plugin-redux: emit state snapshots via payloads { state }"
```

---

## Task 11: Migrate `plugin-debugger`

**Files:**
- Modify: `plugins/plugin-debugger/src/index.ts`
- Modify: `plugins/plugin-debugger/test/debugger.spec.ts`

- [ ] **Step 1: Update the capture emit site (around line 153)**

Before:
```ts
const asset = await ctx.writeAsset({ kind: 'json', content: ... })
await ctx.emit({ ..., assets: [asset] })
```

After:
```ts
const asset = await ctx.writeAsset({ format: 'json', content: ... })
await ctx.emit({ ..., payloads: { value: asset } })
```

Slot name `value` matches the spec's migration table.

- [ ] **Step 2: Update `debugger.spec.ts` (lines 57, 94, 127)**

Before:
```ts
const assetPath = captureEvent.assets[0].path
```

After:
```ts
const ref = captureEvent.payloads!.value
expect(ref.kind).toBe('asset')
const assetPath = (ref as PayloadAsset).path
```

- [ ] **Step 3: Run plugin tests**

```bash
pnpm --filter @introspection/plugin-debugger test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add plugins/plugin-debugger
git commit -m "plugin-debugger: emit captures via payloads { value }"
```

---

## Task 12: Migrate `plugin-indexeddb`

**Files:**
- Modify: `plugins/plugin-indexeddb/src/index.ts`
- Modify: `plugins/plugin-indexeddb/test/indexeddb.spec.ts`

- [ ] **Step 1: Audit the three `writeAsset` sites (lines 250, 293, 498) plus the direct `event.assets = [ref]` mutation at 503**

Read the surrounding code for each emit site. Identify, for each, a payload name describing what the value is. The spec suggests `stores`, `indexes`, `records` for the multi-asset case; the per-operation captures (add/get/getAll) likely just need a single payload named `value`.

- [ ] **Step 2: Replace each site with named-payload emits**

Pattern, for the manual capture (around line 498–503):

Before:
```ts
const ref = await ctx.writeAsset({ kind: 'json', content: ... })
event.assets = [ref]
```

After: do not mutate `event.assets` after the fact; build the event with `payloads`:

```ts
const ref = await ctx.writeAsset({ format: 'json', content: ... })
await ctx.emit({ type: '...', payloads: { value: ref } })
```

For each of the three sites (lines 250, 293, 498), pick a payload name based on what the payload represents. If unsure, `value` is the default; if the event has multiple assets per emit, use distinct names per the spec.

- [ ] **Step 3: Update `indexeddb.spec.ts` (lines 248, 298, 305, 397)**

Before:
```ts
const addValue = await readAsset(dir, add.assets[0].path)
```

After:
```ts
const ref = add.payloads!.value
expect(ref.kind).toBe('asset')
const addValue = await readAsset(dir, (ref as PayloadAsset).path)
```

Rename `value` to whatever payload name you chose in Step 2 if different.

- [ ] **Step 4: Run plugin tests**

```bash
pnpm --filter @introspection/plugin-indexeddb test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-indexeddb
git commit -m "plugin-indexeddb: emit captures via named payloads"
```

---

## Task 13: Migrate `plugin-solid-devtools`

**Files:**
- Modify: `plugins/plugin-solid-devtools/src/index.ts`
- Modify: `plugins/plugin-solid-devtools/test/solid-devtools.spec.ts`

- [ ] **Step 1: Replace the array push with a named record (lines 18–48)**

Before:
```ts
const assets = []
if (state.structure !== null) {
  assets.push(await context.writeAsset({ kind: 'json', content: JSON.stringify(state.structure), ext: 'json' }))
}
if (state.dgraph !== null) {
  assets.push(await context.writeAsset({ kind: 'json', content: JSON.stringify(state.dgraph), ext: 'json' }))
}
if (state.updates !== null) {
  assets.push(await context.writeAsset({ kind: 'json', content: JSON.stringify(state.updates), ext: 'json' }))
}
if (assets.length > 0) {
  await context.emit({ type: 'solid-devtools.capture', assets })
}
```

After:
```ts
const payloads: Record<string, PayloadRef> = {}
if (state.structure !== null) {
  payloads.structure = await context.writeAsset({ format: 'json', content: JSON.stringify(state.structure), ext: 'json' })
}
if (state.dgraph !== null) {
  payloads.dgraph = await context.writeAsset({ format: 'json', content: JSON.stringify(state.dgraph), ext: 'json' })
}
if (state.updates !== null) {
  payloads.updates = await context.writeAsset({ format: 'json', content: JSON.stringify(state.updates), ext: 'json' })
}
if (Object.keys(payloads).length > 0) {
  await context.emit({ type: 'solid-devtools.capture', payloads })
}
```

- [ ] **Step 2: Update `solid-devtools.spec.ts` (line 101)**

Before:
```ts
event.type === 'solid-devtools.capture' && event.assets && event.assets.length > 0
```

After:
```ts
event.type === 'solid-devtools.capture' && event.payloads && Object.keys(event.payloads).length > 0
```

If the test inspects specific assets by index, switch to named lookup (`event.payloads.structure`, etc.).

- [ ] **Step 3: Run plugin tests**

```bash
pnpm --filter @introspection/plugin-solid-devtools test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add plugins/plugin-solid-devtools
git commit -m "plugin-solid-devtools: emit captures via payloads { structure, dgraph, updates }"
```

---

## Task 14: Migrate `plugin-webgl`

**Files:**
- Modify: `plugins/plugin-webgl/src/index.ts`
- Modify: `plugins/plugin-webgl/test/webgl.spec.ts`

- [ ] **Step 1: Audit emit sites (lines 87, 96, 188 and any others)**

Read each. Frames are likely `format: 'image'` (binary), state objects are `'json'`. For each emit, pick a payload name reflecting what the payload represents (e.g. `frame`, `state`, `program`).

- [ ] **Step 2: Replace each `assets: [...]` with `payloads: { name: ref }`**

Apply the same pattern as the other plugins — `format:` instead of `kind:` on the writeAsset call, named payload on emit.

- [ ] **Step 3: Update `webgl.spec.ts` (line 211)**

Before:
```ts
expect(captureEvent.assets[0].kind).toBe('image')
```

After:
```ts
const frame = captureEvent.payloads!.frame  // or whatever payload name you chose
expect(frame.kind).toBe('asset')
expect(frame).toMatchObject({ kind: 'asset', format: 'image' })
```

Search the file for `.assets[` to catch other assertions.

- [ ] **Step 4: Run plugin tests**

```bash
pnpm --filter @introspection/plugin-webgl test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-webgl
git commit -m "plugin-webgl: emit frames and state via named payloads"
```

---

## Task 15: Update CLI rendering and remove the `assets` command

**Files:**
- Modify: `packages/cli/src/commands/events.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Replace the `event.assets` rendering at lines 46–47 of `events.ts`**

Before:
```ts
if (event.assets && event.assets.length > 0) {
  detail += ` [${event.assets.map(asset => `${asset.kind}:${asset.path}`).join(', ')}]`
}
```

After:
```ts
if (event.payloads) {
  const entries = Object.entries(event.payloads)
  if (entries.length > 0) {
    detail += ` [${entries.map(([name, ref]) => {
      if (ref.kind === 'inline') return `${name}:inline`
      return `${name}:${ref.format}:${ref.path}`
    }).join(', ')}]`
  }
}
```

This preserves the old per-asset rendering and adds payload names — useful since solid-devtools events used to print three unnamed entries.

- [ ] **Step 2: Remove the `assets` command from `packages/cli/src/index.ts`**

Delete the entire block at lines 63–91 (`program.command('assets')...`). The new `introspect payload <event-id> <name>` command (added in Task 15c) replaces the by-path display with one that speaks the user's vocabulary; the flat listing has no clear replacement and is dropped.

Also remove any imports made unused by this deletion (`createTraceReader` may still be used by other commands — check).

- [ ] **Step 3: Run CLI tests**

```bash
pnpm --filter @introspection/cli test
```

Expected: all green. Snapshot test failures from the events-rendering change are expected — update them to match the new output. Tests that asserted on the `assets` subcommand (if any) should be removed.

- [ ] **Step 4: Commit**

```bash
git add packages/cli
git commit -m "cli: render event.payloads with payload names; drop assets command"
```

---

## Task 15b: Update `introspect events` rendering and filter resolution

**Files:**
- Modify: `packages/cli/src/commands/events.ts`
- Modify: `packages/cli/src/index.ts` (pass the reader through to `formatEvents`, register `--payload` option)
- Modify: `packages/cli/test/events.test.ts` (or whichever file holds the events-command tests; create one if absent)

**Why this task exists:** the field rename from `assets` to `payloads` already happened in Task 15, but the command's rendering and filter behavior need three substantive changes:

1. **Text output stays compact.** Default text format renders one timeline line per event plus a one-line summary per payload (`state: json, 12.3KB` for assets, `state: <inline 0.4KB>` for inline). No values rendered. Text is for scanning; full values belong in `--format json` or in `introspect payload` (Task 15c).
2. **JSON output auto-resolves where meaningful.** Asset entries with text-ish formats (`json`, `text`, `html`) are augmented with a `value` field. Binary/image entries keep their metadata (`path`, `size`, `format`) and **do not get a `value` field at all** — bytes-as-JSON is a bad default and `null` would overload with "unresolvable." Inline entries already carry `value`. Filter expressions referencing `event.payloads.<binary>.value` get `undefined`, honestly.
3. **Filter expressions trigger resolution.** When `--filter <expr>` is provided, payloads are resolved before evaluation so expressions can reference `event.payloads.<name>.value` regardless of variant. Filter eval errors surface to stderr (not silently swallowed).

Plus a new option:

4. **`--payload <name>`** (repeatable or comma-separated): limits both rendering and resolution to listed payload names — useful for multi-payload events like solid-devtools captures. Unselected payloads are dropped from the output entirely (their metadata too — the user explicitly asked for a subset).

**Footgun to document.** Combining `--payload` with `--filter` can produce silent zero-match queries when the filter expression references a payload name not in the `--payload` allowlist (e.g. `--payload dgraph --filter 'event.payloads.state.value...'` — `state` is dropped before filter evaluation, so the filter sees `undefined` and excludes every event). The implementation should detect this where cheap (literal `event.payloads.<name>` access in the filter source) and warn to stderr; otherwise document the pitfall in the command's `--help` text.

- [ ] **Step 1: Write failing tests for the four behaviors**

In a CLI test file (existing or new — match the existing convention; e.g. `packages/cli/test/events.test.ts`):

```ts
import { formatEvents } from '../src/commands/events.js'
import type { TraceEvent } from '../src/types.js'

describe('events command rendering and filter resolution', () => {
  it('text format renders compact payload summaries (no values) and includes event id', async () => {
    const reader = mockReader({ 'assets/a.json': '{"user":"alice"}' })
    const events: TraceEvent[] = [
      {
        id: 'e1',
        type: 'redux.snapshot',
        timestamp: 100,
        payloads: { state: { kind: 'asset', format: 'json', path: 'assets/a.json', size: 17 } },
      } as any,
    ]
    const out = await formatEvents(events, { format: 'text' }, reader)
    expect(out).toContain('redux.snapshot')
    expect(out).toContain('e1')                        // id present so users can pipe to `payload e1 state`
    expect(out).toMatch(/state: json, 0\.0KB/)         // summary line
    expect(out).not.toContain('alice')                 // value NOT rendered in text
  })

  it('text format renders inline payloads with <inline ...> summary', async () => {
    const reader = mockReader({})
    const events: TraceEvent[] = [
      {
        id: 'e1',
        type: 'web-storage.snapshot',
        timestamp: 100,
        payloads: { state: { kind: 'inline', value: { theme: 'dark' } } },
      } as any,
    ]
    const out = await formatEvents(events, { format: 'text' }, reader)
    expect(out).toMatch(/state: <inline/)
    expect(out).not.toContain('"theme":')              // inline values NOT rendered in text
  })

  it('json format augments asset payloads with resolved value', async () => {
    const reader = mockReader({ 'assets/a.json': '{"user":"alice"}' })
    const events: TraceEvent[] = [
      {
        id: 'e1',
        type: 'redux.snapshot',
        timestamp: 100,
        payloads: { state: { kind: 'asset', format: 'json', path: 'assets/a.json', size: 17 } },
      } as any,
    ]
    const out = await formatEvents(events, { format: 'json' }, reader)
    const parsed = JSON.parse(out)
    expect(parsed[0].payloads.state).toMatchObject({
      kind: 'asset',
      format: 'json',
      path: 'assets/a.json',
      value: { user: 'alice' },
    })
  })

  it('json format does not augment binary payloads with a value field', async () => {
    const reader = mockReader({ 'assets/x.png': Buffer.from([0xff, 0xd8, 0xff]) })
    const events: TraceEvent[] = [
      {
        id: 'e1',
        type: 'playwright.screenshot',
        timestamp: 100,
        payloads: { image: { kind: 'asset', format: 'image', path: 'assets/x.png', size: 3 } },
      } as any,
    ]
    const out = await formatEvents(events, { format: 'json' }, reader)
    const parsed = JSON.parse(out)
    expect(parsed[0].payloads.image).toEqual({
      kind: 'asset',
      format: 'image',
      path: 'assets/x.png',
      size: 3,
    })
    expect('value' in parsed[0].payloads.image).toBe(false)
  })

  it('filter expressions match on resolved payload values', async () => {
    const reader = mockReader({
      'assets/a.json': '{"user":{"id":42}}',
      'assets/b.json': '{"user":{"id":7}}',
    })
    const events: TraceEvent[] = [
      { id: 'e1', type: 'redux.snapshot', timestamp: 1, payloads: { state: { kind: 'asset', format: 'json', path: 'assets/a.json', size: 18 } } } as any,
      { id: 'e2', type: 'redux.snapshot', timestamp: 2, payloads: { state: { kind: 'asset', format: 'json', path: 'assets/b.json', size: 18 } } } as any,
    ]
    const out = await formatEvents(events, { format: 'json', filter: 'event.payloads.state.value.user.id === 42' }, reader)
    expect(JSON.parse(out).map((e: any) => e.id)).toEqual(['e1'])
  })

  it('filter eval errors surface to stderr, not silent false', async () => {
    const reader = mockReader({})
    const events: TraceEvent[] = [
      { id: 'e1', type: 'mark', timestamp: 1, metadata: { label: 'x' } } as any,
    ]
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await formatEvents(events, { format: 'json', filter: 'this.is.bogus()' }, reader)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('filter error'))
    errSpy.mockRestore()
  })

  it('--payload limits resolution and rendering', async () => {
    const reader = mockReader({
      'assets/a.json': '{"x":1}',
      'assets/b.json': '{"y":2}',
    })
    const resolved: string[] = []
    reader.resolvePayload = async (ref: any) => {
      resolved.push(ref.path)
      const content = mockFiles[ref.path]
      return JSON.parse(content as string)
    }
    const events: TraceEvent[] = [
      {
        id: 'e1',
        type: 'solid-devtools.capture',
        timestamp: 1,
        payloads: {
          structure: { kind: 'asset', format: 'json', path: 'assets/a.json', size: 7 },
          dgraph:    { kind: 'asset', format: 'json', path: 'assets/b.json', size: 7 },
        },
      } as any,
    ]
    const out = await formatEvents(events, { format: 'json', payload: ['dgraph'] }, reader)
    expect(resolved).toEqual(['assets/b.json'])           // only the requested name resolved
    const parsed = JSON.parse(out)
    expect(parsed[0].payloads.dgraph.value).toEqual({ y: 2 })
    expect(parsed[0].payloads.structure.value).toBeUndefined()
  })
})

const mockFiles: Record<string, string | Buffer> = {}
function mockReader(files: Record<string, string | Buffer>) {
  Object.assign(mockFiles, files)
  return {
    async resolvePayload(ref: any) {
      if (ref.kind === 'inline') return ref.value
      const content = mockFiles[ref.path]
      if (content === undefined) throw new Error(`missing fixture: ${ref.path}`)
      switch (ref.format) {
        case 'json': return JSON.parse(content as string)
        case 'text':
        case 'html': return content as string
        case 'image':
        case 'binary': return content as Buffer
      }
    },
  }
}
```

- [ ] **Step 2: Run the tests, confirm they fail**

```bash
pnpm --filter @introspection/cli test -- --testNamePattern="events command rendering"
```

Expected: FAIL — `formatEvents` doesn't accept a reader, doesn't resolve, doesn't honor `--payload`, etc.

- [ ] **Step 3: Update `formatEvents` to accept a reader and apply the rendering rules**

In `packages/cli/src/commands/events.ts`:

```ts
import type { PayloadRef } from '@introspection/types'

interface PayloadResolver {
  resolvePayload(ref: PayloadRef): Promise<unknown>
}

const BINARY_FORMATS = new Set(['image', 'binary'])

export interface EventFilterOpts {
  type?: string
  after?: number
  before?: number
  since?: string
  last?: number
  filter?: string
  format?: 'text' | 'json'
  payload?: string[]            // names to include; undefined = all
}

function shouldResolveValues(opts: EventFilterOpts): boolean {
  // Resolve when emitting JSON (machine-readable should be complete) or
  // when a filter expression may reference .value.
  return opts.format === 'json' || Boolean(opts.filter)
}

async function resolveEventPayloads(
  event: TraceEvent,
  reader: PayloadResolver,
  opts: EventFilterOpts,
): Promise<TraceEvent> {
  if (!event.payloads) return event
  const wantedNames = opts.payload && opts.payload.length > 0 ? new Set(opts.payload) : null
  const resolveValues = shouldResolveValues(opts)
  const resolved: Record<string, PayloadRef & { value?: unknown }> = {}

  for (const [name, ref] of Object.entries(event.payloads)) {
    if (wantedNames && !wantedNames.has(name)) continue

    if (ref.kind === 'inline') {
      resolved[name] = ref       // already has value
      continue
    }
    if (!resolveValues) {
      resolved[name] = ref       // text mode without filter: keep as-is, summary-render later
      continue
    }
    if (BINARY_FORMATS.has(ref.format)) {
      resolved[name] = ref      // do not augment with value; metadata is the contract
      continue
    }
    try {
      const value = await reader.resolvePayload(ref)
      resolved[name] = { ...ref, value }
    } catch (err) {
      console.error(`[introspect] could not resolve payload '${name}' at ${ref.path}: ${(err as Error).message}`)
      resolved[name] = { ...ref, value: undefined }
    }
  }
  return { ...event, payloads: resolved }
}

export async function formatEvents(
  events: TraceEvent[],
  opts: EventFilterOpts,
  reader: PayloadResolver,
): Promise<string> {
  let filtered = applyEventFilters(events, opts)
  filtered = await Promise.all(filtered.map(event => resolveEventPayloads(event, reader, opts)))

  if (opts.filter) {
    filtered = filtered.filter(event => {
      try {
        return Boolean(runInNewContext(opts.filter!, { event }))
      } catch (err) {
        console.error(`[introspect] filter error on event ${event.id}: ${(err as Error).message}`)
        return false
      }
    })
  }

  if (opts.format === 'json') return JSON.stringify(filtered, null, 2)
  return formatTimeline(filtered)
}
```

Note `formatEvents` becomes async. Callers must `await`. The `payload` option lands on `EventFilterOpts` so `applyEventFilters` callers can pass it through.

- [ ] **Step 4: Update `formatTimeline` to render compact payload summaries (and include event id)**

```ts
export function formatTimeline(events: TraceEvent[]): string {
  return events.map(event => {
    const timestampStr = String(event.timestamp).padStart(6) + 'ms'
    const header = event.summary ? `${event.type} ${event.summary}` : event.type
    // Include event.id so users can follow up with `introspect payload <id> <name>`.
    const lines = [`[${timestampStr}] ${event.id} ${header}`]
    if (event.payloads) {
      for (const [name, ref] of Object.entries(event.payloads)) {
        lines.push(`  ${name}: ${formatPayloadSummary(ref)}`)
      }
    }
    return lines.join('\n')
  }).join('\n')
}

function formatPayloadSummary(ref: PayloadRef): string {
  if (ref.kind === 'inline') {
    const bytes = JSON.stringify(ref.value).length
    return `<inline ${(bytes / 1024).toFixed(1)}KB>`
  }
  // asset
  const kb = (ref.size / 1024).toFixed(1)
  if (BINARY_FORMATS.has(ref.format)) return `<binary, ${kb}KB, ${ref.path}>`
  return `${ref.format}, ${kb}KB`
}
```

Text format never renders values — that's `--format json` or `introspect payload`'s job. Summaries are deliberately one line each.

- [ ] **Step 5: Wire the reader through `packages/cli/src/index.ts` and add `--payload` option**

Find the `events` command definition (search for `program.command('events')`). Add the `--payload` option (commander supports comma/repeatable lists via a coerce function):

```ts
program.command('events')
  // ...existing options...
  .option('--payload <names>', 'comma-separated list of payload names to include', (v: string, prev: string[] = []) => prev.concat(v.split(',').map(s => s.trim()).filter(Boolean)))
  .action(async (opts) => {
    const baseDir = program.opts().dir as string
    const trace = await createTraceReader(baseDir, opts)
    const events = await trace.events.list()
    const output = await formatEvents(events, opts, trace)
    console.log(output)
  })
```

The reader already exposes `resolvePayload` from Task 5.

- [ ] **Step 6: Run tests, confirm they pass**

```bash
pnpm --filter @introspection/cli test
```

Expected: all green.

- [ ] **Step 7: Smoke test in a real trace**

```bash
introspect events --type 'redux.snapshot' --last 1
# Expected: timeline header + one-line `state: json, X.XKB` summary. No JSON dump.

introspect events --type 'redux.snapshot' --last 1 --format json
# Expected: JSON array; events[0].payloads.state has both metadata and a `value` field with the parsed state.

introspect events --type 'redux.snapshot' --filter 'event.payloads.state.value !== undefined' --last 1 --format json
# Expected: filter sees resolved values; matches.

introspect events --type 'solid-devtools.capture' --payload dgraph --last 1 --format json
# Expected: only the `dgraph` entry appears in payloads of the output event.
```

- [ ] **Step 8: Commit**

```bash
git add packages/cli
git commit -m "cli: events compact text + resolved json + --payload filter; surface filter errors"
```

---

## Task 15c: Add `introspect payload <event-id> <name>` command

**Files:**
- Modify: `packages/cli/src/index.ts` (register the command)
- Create: `packages/cli/src/commands/payload.ts` (handler)
- Create: `packages/cli/test/payload.test.ts`

**Why this task exists:** Task 15 deletes `introspect assets` and Task 15b's text format intentionally avoids rendering payload values. Users still need a one-shot way to see a single captured value — most importantly for binary content (screenshots, response body bytes) that the events command renders only as a placeholder. `introspect payload <event-id> <name>` is that surface, and it pipes cleanly: `introspect payload e1 image > shot.png`.

- [ ] **Step 1: Write failing tests**

`packages/cli/test/payload.test.ts`:

```ts
import { runPayloadCommand } from '../src/commands/payload.js'

describe('payload command', () => {
  it('prints pretty JSON for a json-format asset', async () => {
    const reader = mockReader(
      [{ id: 'e1', payloads: { state: { kind: 'asset', format: 'json', path: 'a.json', size: 17 } } }],
      { 'a.json': '{"user":"alice"}' },
    )
    const writer = captureStdout()
    await runPayloadCommand({ eventId: 'e1', name: 'state' }, reader, writer.stream)
    expect(writer.text()).toBe(JSON.stringify({ user: 'alice' }, null, 2) + '\n')
  })

  it('writes raw bytes for binary payloads', async () => {
    const reader = mockReader(
      [{ id: 'e1', payloads: { image: { kind: 'asset', format: 'image', path: 'x.png', size: 3 } } }],
      { 'x.png': Buffer.from([0xff, 0xd8, 0xff]) },
    )
    const writer = captureStdout()
    await runPayloadCommand({ eventId: 'e1', name: 'image' }, reader, writer.stream)
    expect(writer.bytes()).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
  })

  it('prints inline values directly', async () => {
    const reader = mockReader(
      [{ id: 'e1', payloads: { state: { kind: 'inline', value: { theme: 'dark' } } } }],
      {},
    )
    const writer = captureStdout()
    await runPayloadCommand({ eventId: 'e1', name: 'state' }, reader, writer.stream)
    expect(writer.text()).toBe(JSON.stringify({ theme: 'dark' }, null, 2) + '\n')
  })

  it('errors clearly when event id is unknown', async () => {
    const reader = mockReader([], {})
    const writer = captureStdout()
    await expect(runPayloadCommand({ eventId: 'missing', name: 'state' }, reader, writer.stream))
      .rejects.toThrow(/no event with id 'missing'/)
  })

  it('errors clearly when payload name is unknown on the event', async () => {
    const reader = mockReader(
      [{ id: 'e1', payloads: { state: { kind: 'inline', value: 1 } } }],
      {},
    )
    const writer = captureStdout()
    await expect(runPayloadCommand({ eventId: 'e1', name: 'body' }, reader, writer.stream))
      .rejects.toThrow(/event 'e1' has no payload named 'body'.*available: state/)
  })
})

function mockReader(events: any[], files: Record<string, string | Buffer>) { /* same shape as Task 15b's mock */ }
function captureStdout() { /* tiny helper that returns { stream: Writable, text(): string, bytes(): Buffer } */ }
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
pnpm --filter @introspection/cli test -- --testNamePattern="payload command"
```

Expected: FAIL — `runPayloadCommand` doesn't exist.

- [ ] **Step 3: Implement the command**

Create `packages/cli/src/commands/payload.ts`:

```ts
import type { Writable } from 'stream'
import type { TraceEvent } from '../types.js'
import type { PayloadRef } from '@introspection/types'

interface Reader {
  events: { list(): Promise<TraceEvent[]> }
  resolvePayload(ref: PayloadRef): Promise<unknown>
}

export interface PayloadCommandOpts {
  eventId: string
  name: string
}

export async function runPayloadCommand(opts: PayloadCommandOpts, reader: Reader, out: Writable): Promise<void> {
  const events = await reader.events.list()
  const event = events.find(e => e.id === opts.eventId)
  if (!event) throw new Error(`no event with id '${opts.eventId}'`)

  const payloads = event.payloads ?? {}
  const ref = payloads[opts.name]
  if (!ref) {
    const available = Object.keys(payloads).join(', ') || '(none)'
    throw new Error(`event '${opts.eventId}' has no payload named '${opts.name}' (available: ${available})`)
  }

  const value = await reader.resolvePayload(ref)

  // Binary: write bytes verbatim. Text/HTML: write string verbatim. JSON: pretty-print.
  if (Buffer.isBuffer(value)) {
    out.write(value)
    return
  }
  if (typeof value === 'string') {
    out.write(value)
    if (!value.endsWith('\n')) out.write('\n')
    return
  }
  out.write(JSON.stringify(value, null, 2) + '\n')
}
```

- [ ] **Step 4: Register the command in `packages/cli/src/index.ts`**

```ts
import { runPayloadCommand } from './commands/payload.js'

program.command('payload')
  .description('Print one named payload of one event to stdout')
  .argument('<event-id>')
  .argument('<name>')
  .option('--trace-id <id>')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (eventId: string, name: string, opts) => {
    const baseDir = program.opts().dir as string
    const trace = await createTraceReader(baseDir, opts)
    await runPayloadCommand({ eventId, name }, trace, process.stdout)
  })
```

- [ ] **Step 5: Run tests, confirm pass**

```bash
pnpm --filter @introspection/cli test
```

Expected: all green.

- [ ] **Step 6: Smoke test in a real trace**

```bash
# JSON state:
introspect payload <some-redux-snapshot-id> state | jq

# Binary screenshot:
introspect payload <some-screenshot-id> image > /tmp/shot.png && file /tmp/shot.png
# Expected: /tmp/shot.png: PNG image data, ...
```

- [ ] **Step 7: Commit**

```bash
git add packages/cli
git commit -m "cli: add payload <event-id> <name> command for one-shot payload retrieval"
```

---

## Task 16: Update demo viewers

**Files:**
- Modify: `demos/solid-streaming/src/App.tsx`
- Modify: `demos/solid-streaming/src/hooks/useAssetContent.ts`

- [ ] **Step 1: Update `App.tsx` rendering (lines 122–124)**

Before:
```tsx
<Show when={event.assets && event.assets.length > 0}>
  <For each={event.assets}>
    {asset => (...)}
  </For>
</Show>
```

After:
```tsx
<Show when={event.payloads && Object.keys(event.payloads).length > 0}>
  <For each={Object.entries(event.payloads ?? {})}>
    {([name, ref]) => (...) /* render `${name}: ${ref.kind === 'asset' ? ref.path : 'inline'}` */}
  </For>
</Show>
```

Adapt the rendered fragment to whatever fields it currently shows.

- [ ] **Step 2: Update `useAssetContent.ts` (lines 28–29)**

Before:
```ts
if (!event.assets) continue
for (const asset of event.assets) { ... }
```

After:
```ts
if (!event.payloads) continue
for (const ref of Object.values(event.payloads)) {
  if (ref.kind !== 'asset') continue   // inline payloads not relevant for asset content fetch
  // ...same body, using `ref.path` and `ref.format`
}
```

- [ ] **Step 3: Manually verify the demo still renders**

```bash
pnpm --filter @introspection/demo-solid-streaming dev
```

Open the printed URL, run a trace that produces events with payloads (the existing demo does this). Confirm asset entries still display.

- [ ] **Step 4: Commit**

```bash
git add demos/solid-streaming
git commit -m "demo-solid-streaming: render event.payloads"
```

---

## Task 17: Update plugin-author skill docs

**Files:**
- Modify: `packages/cli/skills/introspect-plugin/skill.md`

- [ ] **Step 1: Update the plugin context API summary at line 30**

Before:
```ts
writeAsset(opts: { kind: AssetKind; content: string | Buffer; ext?: string }): Promise<AssetRef>
```

After:
```ts
writeAsset(opts: { format: PayloadFormat; content: string | Buffer; ext?: string }): Promise<PayloadAsset>
```

- [ ] **Step 2: Update the example code at lines 75 and 128**

Before:
```ts
const asset = await ctx.writeAsset({ kind: 'json', content: JSON.stringify(body) })
// later
ctx.emit({ ..., assets: [asset] })
```

After:
```ts
const asset = await ctx.writeAsset({ format: 'json', content: JSON.stringify(body) })
// later — `asset` is already a PayloadRef
ctx.emit({ ..., payloads: { body: asset } })
```

(The payload name in your example should match the example's domain — the skill is illustrative, pick `body` or `value` as appropriate.)

- [ ] **Step 3: Add a "Payload naming" section near the top of the skill**

Add (under the API summary, before the existing examples):

```markdown
## Payload naming

Payload names are part of the public schema — users will write filters like
`event.payloads.state.value.user.id` and run `introspect payload <event-id> <name>`.
Inconsistent names across plugins make cross-plugin queries unreliable.

Canonical names by intent:

| Intent | Name |
|---|---|
| The captured "main thing" of a single-payload event | `value` |
| Application or framework state snapshot | `state` |
| Network response body (or any captured request/response body) | `body` |
| Captured image (screenshot, frame) | `image` |
| Captured HTML or DOM fragment | `html` |
| Multi-part captures | descriptive nouns (`structure`, `dgraph`, `updates`, ...) |

Rule of thumb: a name is a noun describing what the payload _is_, not what
produced it (`body` not `responseBody`, `state` not `reduxState`). Grep
existing usages before inventing a new name.
```

- [ ] **Step 4: Add the "kind footgun" warning**

Add (in the same skill, near the `emit` examples):

```markdown
## Footgun: payload values whose top-level shape is `{ kind: 'inline' | 'asset', ... }`

`emit({ payloads: { name: value } })` treats `value` as a `PayloadRef` if it
has a top-level `kind` of `'inline'` or `'asset'`, otherwise serializes it as
a bare value. If your captured value happens to use `kind` as a top-level
field with one of those literal strings, wrap with `await ctx.payload(value)`
to disambiguate:

    emit({
      type: 'my.event',
      payloads: {
        config: await ctx.payload({ kind: 'inline', settings: {...} }),
      },
    })
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/skills/introspect-plugin/skill.md
git commit -m "skill: document payloads API, naming convention, and kind-field footgun"
```

---

## Task 18: End-to-end smoke test against a real trace

**Files:**
- (no source changes) — verification only.

- [ ] **Step 1: Record a fresh trace running the test suite that exercises the most plugins**

```bash
pnpm test
# or whichever script runs the playwright integration suite that produces a .introspect/ trace
```

- [ ] **Step 2: Inspect the resulting `events.ndjson`**

```bash
ls .introspect
# pick the most recent trace
head -50 .introspect/<trace>/events.ndjson | jq 'select(.payloads != null)'
```

Expected: every event that previously had `assets: [...]` now has `payloads: { <name>: { kind: 'asset', format, path, ... } }`.

- [ ] **Step 3: Run the introspect CLI to confirm reads work**

```bash
introspect summary
introspect events --type 'redux.snapshot'
```

Expected: no errors. Each `redux.snapshot` event renders its `state` payload as a summary line.

- [ ] **Step 4: Confirm the removed `assets` command is gone, the new `payload` command works**

```bash
introspect assets
# Expected: command not found / unrecognized.

introspect payload <some-event-id> <some-payload-name>
# Expected: prints the resolved value (or pipes bytes) on the chosen event.
```

- [ ] **Step 5: Commit (if any incidental fixes were needed)**

If everything passed without changes, no commit needed. If you found and fixed a missed site, commit it as `chore: fix missed payloads migration in <file>` and re-run Step 1–3 until clean.

---

## Self-review

- **Spec coverage:**
  - Schema rename (`assets` → `payloads`) → Tasks 1, 2.
  - `PayloadRef` discriminated union → Task 1.
  - `AssetRef` removed as a named type → Task 1.
  - `WriteAssetOptions.kind` → `format` → Task 3.
  - `writeAsset` returns `PayloadAsset` → Tasks 3, 4.
  - `resolvePayload` on read API → Task 5.
  - Drop legacy `assets.ls()` / `assets.metadata()` API → Task 6.
  - Legacy trace normalization → **deliberately out of scope** (called out in the file map). Old `.introspect/` recordings won't read after this lands.
  - Every write-side migration (proxy + 6 plugins) → Tasks 8–14.
  - Read-side consumer migration (CLI events render + remove `assets` command, demos, skill docs) → Tasks 15–17.
  - `introspect events` rendering: compact text + auto-resolved JSON + filter triggers resolution + `--payload` option + filter errors to stderr → Task 15b.
  - `introspect payload <event-id> <name>` for one-shot retrieval (binary-safe, pipe-friendly) → Task 15c.
  - Payload naming convention (canonical names + rule of thumb) → spec section, surfaced to plugin authors via Task 17.
  - `PayloadAsset.size` non-optional → Task 1 / Task 4.
  - Missing-asset errors surface to stderr instead of silently rendering `<unresolved>` → Task 15b step 3.
  - End-to-end verification → Task 18.
  - Threshold mechanism / `ctx.payload` / `attach({ inlineUnder })` → **deferred to Plan B** (called out in the spec's "Out of scope for Plan A" framing). Plan A only ships the schema; the inline variant of `PayloadRef` is defined but never produced.
- **Placeholders:** None remaining.
- **Type consistency:**
  - `PayloadAsset.format` (not `kind` or `assetKind`) used consistently across tasks.
  - `PayloadRef` discriminator is `kind: 'inline' | 'asset'` everywhere.
  - `writeAsset` always called with `{ format: ..., content, ext? }` and its return is treated as a valid `PayloadRef`.
  - Slot names in the migration: `body` (network), `state` (redux), `value` (debugger, indexeddb single), `image` (screenshots), `frame` (webgl), `structure`/`dgraph`/`updates` (solid-devtools). Used consistently in plugin code and in CLI/test assertions.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-named-payloads-schema-migration.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task with review between tasks. Good fit for this plan because tasks are mechanical and fan out cleanly.

**2. Inline Execution** — execute tasks in this trace using executing-plans, batched with checkpoints.

**Which approach?**

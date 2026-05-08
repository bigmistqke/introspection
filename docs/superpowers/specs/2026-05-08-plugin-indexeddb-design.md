# `plugin-indexeddb` — Design

Captures IndexedDB activity (database lifecycle, schema changes, transactions, writes always; reads opt-in; schema snapshots, plus optional data snapshots) into the introspection trace.

Sibling to `plugin-web-storage`. Follows the same playbook: page-side prototype patching, single CDP binding for events, server-side CDP snapshot at install + bus triggers, top-of-realm install via `addInitScript` and `Runtime.evaluate`. Diverges where IndexedDB's surface area genuinely demands it (async ops, async transactions, much wider API).

## Why

IndexedDB is the standard heavy client-side store: PWAs, offline apps, sqlite-in-the-browser, drafts, queues. When something goes wrong — wrong data, missing data, schema mismatch, transaction abort — there's currently no first-class way to inspect what the app did. Today: open DevTools → Application → IndexedDB; or hand-instrument with `console.log`. A plugin makes IDB activity queryable via `introspect events --type 'idb.*'` like every other capture concern.

## Scope

In scope:
- Database lifecycle (open, upgradeneeded, close, deleteDatabase, versionchange).
- Schema definition (createObjectStore, deleteObjectStore, createIndex, deleteIndex).
- Transactions (begin, complete, abort, error).
- Writes (add, put, delete, clear) on object stores and via cursors.
- Reads (get, getAll, getKey, getAllKeys, count, openCursor, openKeyCursor) — **opt-in**.
- Snapshots: schema always; data optionally.

Out of scope:
- WebSQL (deprecated).
- LocalStorage / sessionStorage (covered by `plugin-web-storage`).
- HTTP cache, Cache Storage, cookies (separate planned plugins).

## Public API

```ts
import { indexedDB } from '@introspection/plugin-indexeddb'

attach(page, {
  plugins: [
    indexedDB(),                                 // writes + schema + transactions + snapshots
    indexedDB({ reads: true }),                  // also captures gets/cursors
    indexedDB({ dataSnapshots: true }),          // also dumps store contents at snapshot time
    indexedDB({ databases: ['app-db'] }),        // restrict to specific dbs
  ],
})
```

```ts
interface IndexedDBOptions {
  /** Capture reads (get/getAll/cursors/count). Default: false. */
  reads?: boolean

  /**
   * Include object-store contents in `idb.snapshot` events. Default: false
   * (schema only). When true, every snapshot dumps every store; this can
   * be expensive for large databases.
   */
  dataSnapshots?: boolean

  /**
   * Max bytes to inline a single value in write/read events. Larger values
   * are written to assets and referenced via `assets[0]`. Default: 4096.
   * Will be replaced by the generic payload-threshold helper once it lands
   * (see docs/superpowers/plans/2026-05-08-event-payload-size-threshold.md).
   */
  inlineValueLimit?: number

  /**
   * Restrict capture to specific origins. Default: ['*'] (all origins).
   * When the framework-level `origins` option lands (see
   * docs/superpowers/plans/2026-05-08-origins-option.md), this option
   * overrides the framework default.
   */
  origins?: string[]

  /** Restrict capture to specific database names. Default: all. */
  databases?: string[]

  verbose?: boolean
}
```

Defaults: writes + schema + transactions + schema-only snapshots; all origins; all databases; reads off; data snapshots off; 4096-byte value inlining.

## Event schema

Five event types added to `@introspection/types`.

```ts
export type IdbTransactionMode = 'readonly' | 'readwrite' | 'versionchange'

// ─── idb.database — open / upgradeneeded / close / deleteDatabase ──────────

export interface IdbDatabaseEvent extends BaseEvent {
  type: 'idb.database'
  metadata: {
    operation: 'open' | 'upgrade' | 'close' | 'delete'
    origin: string
    name: string
    /** Pre-op version. 0 if the database didn't exist. */
    oldVersion?: number
    /** Post-op version (after success). */
    newVersion?: number
    /** Outcome of an async op. Omitted for synchronous moments (close). */
    outcome?: 'success' | 'error' | 'blocked'
    error?: string
  }
}

// ─── idb.schema — createObjectStore / deleteObjectStore / createIndex /
//                  deleteIndex (only valid during upgradeneeded) ───────────

export interface IdbSchemaEvent extends BaseEvent {
  type: 'idb.schema'
  metadata: {
    operation:
      | 'createObjectStore' | 'deleteObjectStore'
      | 'createIndex'       | 'deleteIndex'
    origin: string
    database: string
    objectStore: string
    /** Index name when operation is createIndex/deleteIndex. */
    index?: string
    /** Object store config when creating. */
    keyPath?: string | string[] | null
    autoIncrement?: boolean
    /** Index config when creating. */
    unique?: boolean
    multiEntry?: boolean
  }
}

// ─── idb.transaction — begin / complete / abort / error ───────────────────

export interface IdbTransactionEvent extends BaseEvent {
  type: 'idb.transaction'
  metadata: {
    operation: 'begin' | 'complete' | 'abort' | 'error'
    origin: string
    database: string
    /** Synthetic id assigned at begin and propagated to all ops in this tx. */
    transactionId: string
    mode: IdbTransactionMode
    objectStoreNames: string[]
    /** Set on abort/error. */
    error?: string
  }
}

// ─── idb.write — add / put / delete / clear (object store and cursor) ─────

export interface IdbWriteEvent extends BaseEvent {
  type: 'idb.write'
  metadata: {
    operation: 'add' | 'put' | 'delete' | 'clear'
    origin: string
    database: string
    objectStore: string
    transactionId: string
    /** Keys: the explicit key arg, or the inferred keyPath value. Absent for clear. */
    key?: unknown
    /** The value passed to add/put. Absent for delete/clear. May be inline or asset. */
    value?: unknown
    /** Number of records affected (for clear, all of them — captured at op start). */
    affectedCount?: number
    /** Async outcome. */
    outcome: 'success' | 'error'
    error?: string
    /** ms timestamps inside the page realm; set by the wrapper. */
    requestedAt: number
    completedAt: number
  }
}

// ─── idb.read — get / getAll / getKey / getAllKeys / count / openCursor /
//                openKeyCursor (object store and index) ────────────────────

export interface IdbReadEvent extends BaseEvent {
  type: 'idb.read'
  metadata: {
    operation:
      | 'get' | 'getAll' | 'getKey' | 'getAllKeys'
      | 'count' | 'openCursor' | 'openKeyCursor'
    origin: string
    database: string
    objectStore: string
    /** Set when reading via index. */
    index?: string
    transactionId: string
    /** The query argument (key, key range, or cursor direction). */
    query?: unknown
    /** Number of records returned (for getAll/getAllKeys/count). */
    count?: number
    /** Result. May be inline or asset (for getAll, getAllKeys). Cursor walks
     *  emit one event per advance, with `value` being the current cursor value. */
    result?: unknown
    outcome: 'success' | 'error'
    error?: string
    requestedAt: number
    completedAt: number
  }
}

// ─── idb.snapshot — schema for every visible db; data when dataSnapshots: true

export interface IdbSnapshotEvent extends BaseEvent {
  type: 'idb.snapshot'
  metadata: {
    trigger: 'install' | 'manual' | 'js.error' | 'detach'
    origin: string
    /** One entry per database visible at trigger time. */
    databases: Array<{
      name: string
      version: number
      objectStores: Array<{
        name: string
        keyPath: string | string[] | null
        autoIncrement: boolean
        indexes: Array<{
          name: string
          keyPath: string | string[]
          unique: boolean
          multiEntry: boolean
        }>
        /** Records — present only when dataSnapshots: true. */
        records?: Array<{ key: unknown; value: unknown }>
      }>
    }>
  }
}
```

Notes:
- `transactionId` is synthetic. We assign one when `IDBDatabase.transaction()` is called and propagate it to every op observed within that transaction. This lets consumers correlate ops without needing browser-side IDs (which IDB doesn't expose).
- `value` and `result` are inline if `JSON.stringify(value).length <= inlineValueLimit`, otherwise they're written as a JSON asset and the `assets` field carries the ref. Non-JSON-serializable values (Blob, ArrayBuffer, structured-clone-only objects) are recorded as `{ __nonSerializable: 'Blob' | 'ArrayBuffer' | ... , size?: number }` placeholders inline.
- For `openCursor` we emit one `idb.read` event per cursor advance, not one per cursor open. That matches what consumers actually want to see (the records walked) and avoids modeling "cursor lifecycle" separately.

## Capture mechanism

All ongoing capture is **page-side** by patching the IndexedDB prototypes. Schema snapshots use server-side CDP. Single binding channel. Same architecture as `plugin-web-storage`.

### Page-side prototype patches

Installed via `Page.addScriptToEvaluateOnNewDocument` (covers future navigations, all frames) and additionally via `Runtime.evaluate` (covers the realm at install time).

Patched APIs:

- `IDBFactory.prototype.open` — wraps the resulting `IDBOpenDBRequest`:
  - listen for `upgradeneeded` → emit `idb.database` (operation: 'upgrade') with `oldVersion`/`newVersion`
  - listen for `success` → emit `idb.database` (operation: 'open', outcome: 'success')
  - listen for `blocked` / `error`
  - **Also wrap the returned `IDBDatabase`** so its methods are patched (transaction, close, createObjectStore, deleteObjectStore)
- `IDBFactory.prototype.deleteDatabase` — emit `idb.database` (operation: 'delete')
- `IDBDatabase.prototype.transaction` — assign a synthetic `transactionId`, emit `idb.transaction` (operation: 'begin'), and wrap the returned `IDBTransaction`:
  - listen for `complete` → emit `idb.transaction` (operation: 'complete')
  - listen for `abort` / `error` → emit with operation 'abort'/'error' and the error
  - **Patch the IDBObjectStore returned by `transaction.objectStore(name)`** so writes/reads carry the `transactionId`
- `IDBDatabase.prototype.close` — emit `idb.database` (operation: 'close')
- `IDBDatabase.prototype.createObjectStore` / `deleteObjectStore` — emit `idb.schema` (these are only valid in versionchange transactions, so they always have a transactionId)
- `IDBObjectStore.prototype.add` / `put` / `delete` / `clear` — wrap the returned `IDBRequest`:
  - emit `idb.write` at request start with `requestedAt`, hold onto a partial event
  - on `success` / `error` finalize with `completedAt`, `outcome`, and (for deletes) the affected count
- `IDBObjectStore.prototype.get` / `getAll` / `getKey` / `getAllKeys` / `count` / `openCursor` / `openKeyCursor` — **only when `reads: true`**, same wrap pattern → `idb.read`
- `IDBObjectStore.prototype.createIndex` / `deleteIndex` — emit `idb.schema`
- `IDBIndex.prototype.get` / `getAll` / `getKey` / `getAllKeys` / `count` / `openCursor` / `openKeyCursor` — same as object store but with `index` field set

The wrapper passes a JSON-stringified payload to the binding `__introspection_plugin_indexeddb`. Server-side handler parses, applies origin filter and database filter, optionally writes large values as assets, emits the event.

### Why one event at settle, not two

Each async IDB op has two natural moments: call (we know args) and settle (we know outcome + result). Emitting two events per op doubles the trace volume and forces consumers to join. We emit **one event at settle**, with a `requestedAt` timestamp recorded at the call site. If the page detaches before an op settles, we miss it — acceptable.

### Schema snapshots — server-side via CDP

At install and on each bus trigger:

```
const { databaseNames } = await cdpSession.send('IndexedDB.requestDatabaseNames', {
  securityOrigin,
})
for (const name of databaseNames) {
  const { databaseWithObjectStores } = await cdpSession.send('IndexedDB.requestDatabase', {
    securityOrigin, databaseName: name,
  })
  // databaseWithObjectStores has: name, version, objectStores: [{ name, keyPath, autoIncrement, indexes }]
}
```

When `dataSnapshots: true`, additionally per object store:

```
const { objectStoreDataEntries, hasMore } = await cdpSession.send('IndexedDB.requestData', {
  securityOrigin, databaseName, objectStoreName,
  indexName: '', skipCount: 0, pageSize: 1000,
})
```

We page through results and concatenate. Hard-cap at e.g. 50,000 records per store with a warning event if exceeded — protects the trace from unbounded dumps.

### Bus subscriptions

```ts
ctx.bus.on('manual',   () => snapshotOnce('manual'))
ctx.bus.on('js.error', () => snapshotOnce('js.error'))
ctx.bus.on('detach',   () => snapshotOnce('detach'))
```

Same pattern as `plugin-web-storage`. Will migrate to the unified `'snapshot'` trigger when `docs/superpowers/plans/2026-05-08-snapshot-bus-trigger-refactor.md` lands.

### Origin filtering

`origins` defaults to `['*']` (all). Plugin-level option will eventually override the framework-level default per `docs/superpowers/plans/2026-05-08-origins-option.md`. Server-side filter on the binding payload's `origin` field plus the snapshot loop's origin set.

The realm-crossing limitation applies — see `docs/prototype-patching-limits.md`.

## Bundled change: `plugin-web-storage` default

`plugin-web-storage`'s `origins` default also flips from "top-frame only" to `['*']` so that the two storage plugins behave consistently. Documented in the README and noted as a small breaking change. Existing users who relied on top-frame filtering opt back in via `webStorage({ origins: [topOrigin] })`.

## Package layout

```
plugins/plugin-indexeddb/
├── package.json
├── playwright.config.ts
├── README.md
├── src/index.ts          // exports indexedDB(options) — main entry
├── src/page-script.ts    // BROWSER_SCRIPT constant; kept separate so it stays readable
├── test/
│   ├── *.spec.ts         // Playwright integration tests
│   └── fixtures/         // small HTML fixtures
└── tsconfig.json
```

The page script is non-trivial (covers the full IDB surface) — splitting it into its own file keeps `index.ts` focused on the server-side handler and event mapping.

## Testing

Playwright integration tests against fixtures that:

- Open a fresh database with `onupgradeneeded` → assert one `idb.database` (open) event, one `idb.database` (upgrade) event, and `idb.schema` events for created object stores / indexes
- `add` / `put` / `delete` / `clear` on an object store → assert `idb.write` events with correct `key`, `value`, `outcome`, `transactionId` matching the wrapping transaction's begin event
- Trigger a transaction abort (e.g. constraint error on a unique index) → assert `idb.transaction` (operation: 'error' or 'abort') with `error` populated
- (with `reads: true`) `get` / `getAll` / `openCursor` walks → assert `idb.read` events including one per cursor advance
- (with `dataSnapshots: true`) snapshot at install → assert per-store `records` populated
- `js.error` mid-test → assert `idb.snapshot` with `trigger: 'js.error'`
- Multi-database test → assert `databases: ['only-this-one']` filter excludes the other
- Large value (>4096 bytes) → assert event has an `assets` ref instead of inline `value`

## Risks / open questions

- **`transactionId` correlation.** We assign the id at `IDBDatabase.transaction()` call time. Inside the transaction callback, every `IDBObjectStore` we hand back is the wrapped one carrying that id. Cursor objects also need to carry it. There's a corner where users hold an `IDBObjectStore` reference across transactions (illegal per spec, but possible at runtime for unwrapped references) — those ops would emit without a `transactionId`. We tag them `transactionId: 'unknown'` and continue.
- **`value` capture vs structured clone.** IDB stores structured-cloneable values, including Blobs, ArrayBuffers, and Maps/Sets. We attempt `JSON.stringify` and fall back to non-serializable placeholders. Lossy by design — full structured-clone serialization is out of scope for v1.
- **Cursor walks on huge stores.** A `openCursor` over a 1M-record store would emit 1M `idb.read` events. Reads are opt-in already, so users explicitly accept this cost. We don't add a per-cursor limit; if it bites, add one in v2.
- **Browser support.** All targeted browsers support modern IndexedDB. We don't shim older APIs. We do guard with `if (typeof IDBFactory === 'undefined') return;` so the script no-ops in environments without IDB.
- **Non-serializable keys.** Most keys are strings/numbers/Dates/arrays — all JSON-serializable. Edge cases (e.g. ArrayBuffer keys) become non-serializable placeholders.

## Related work

- `docs/superpowers/specs/2026-05-08-plugin-web-storage-design.md` — sibling plugin; this one mirrors its conventions where applicable.
- `docs/superpowers/plans/2026-05-08-snapshot-bus-trigger-refactor.md` — eventual unification of bus snapshot triggers.
- `docs/superpowers/plans/2026-05-08-event-payload-size-threshold.md` — generic inline-vs-asset helper; this plugin's `inlineValueLimit` is a precursor.
- `docs/superpowers/plans/2026-05-08-origins-option.md` — eventual framework-level `origins` config; this plugin's `origins` option fits that shape.
- `docs/prototype-patching-limits.md` — shared note on realm-crossing; linked from the plugin's README.

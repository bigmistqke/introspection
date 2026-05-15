# @introspection/plugin-indexeddb

Captures IndexedDB activity into the introspection trace: database lifecycle, schema changes, transactions, writes, and (opt-in) reads, plus periodic schema snapshots and (opt-in) data snapshots.

The plugin patches the IndexedDB prototypes page-side via `addInitScript`, so every realistic call path — `IDBObjectStore.add(...)`, transaction observation, cursor walks — is captured. Schema (and optional data) snapshots are emitted at install and on every bus trigger (`manual`, `js.error`, `detach`).

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Options](#options)
- [Events emitted](#events-emitted)
- [How values are stored](#how-values-are-stored)
- [How snapshots work](#how-snapshots-work)
- [Caveats](#caveats)

## Install

```bash
pnpm add -D @introspection/plugin-indexeddb
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { indexedDB } from '@introspection/plugin-indexeddb'

const handle = await attach(page, {
  plugins: [
    indexedDB(),                                  // writes + schema + transactions + snapshots
    // indexedDB({ reads: true })                 // also captures get / getAll / cursors / count
    // indexedDB({ dataSnapshots: true })         // also dumps store records on every snapshot
    // indexedDB({ databases: ['app-db'] })       // restrict to specific databases
  ],
})
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `reads` | `boolean` | `false` | Capture `get` / `getAll` / `getKey` / `getAllKeys` / `count` / `openCursor` / `openKeyCursor`. High volume; off by default. |
| `dataSnapshots` | `boolean` | `false` | Include object-store contents in snapshot events (written as a JSON asset). Can be expensive for large databases — capped at 50,000 records per store. |
| `origins` | `string[]` | `['*']` | Restrict capture to specific origins. The literal `'*'` matches everything. |
| `databases` | `string[]` | all | Restrict capture and snapshots to specific database names. |
| `verbose` | `boolean` | `false` | Verbose debug logs. |

## Events emitted

- `idb.database` — database lifecycle: `open`, `upgrade`, `close`, `delete`. Includes `oldVersion`, `newVersion`, and `outcome` (`'success' | 'error' | 'blocked'`).
- `idb.schema` — schema changes (only fire during `versionchange` transactions): `createObjectStore`, `deleteObjectStore`, `createIndex`, `deleteIndex`. Includes `keyPath`, `autoIncrement`, `unique`, `multiEntry`.
- `idb.transaction` — transaction lifecycle: `begin`, `complete`, `abort`, `error`. Each transaction has a synthetic `transactionId` propagated to every op observed within it.
- `idb.write` — writes: `add`, `put`, `delete`, `clear`. Values for `add` / `put` are written as JSON assets (see below). Deletes carry the `key` only; `clear` carries no key.
- `idb.read` — reads (only when `reads: true`). Cursor walks emit one event per advance.
- `idb.snapshot` — schema snapshot. With `dataSnapshots: true`, store records are bundled in the event's first asset.

## How values are stored

Every captured value (write payload, read result, snapshot data dump) is written to a JSON asset via `ctx.writeAsset` and referenced by the event's `assets[0]`. There is no inline value field in v1.

The shared follow-up note `docs/superpowers/plans/2026-05-08-event-payload-size-threshold.md` plans a generic helper that will let small values stay inline; once it lands, `plugin-indexeddb` will adopt it.

## How snapshots work

Schema snapshots are queried server-side via CDP `IndexedDB.requestDatabaseNames` / `requestDatabase`, so they include databases on disk from prior traces. Data snapshots (`dataSnapshots: true`) walk every store via the page's own IndexedDB API (`Runtime.evaluate` + cursor walk) — more robust than CDP's `requestData`, which is finicky about origins and indexes.

Snapshots are emitted automatically at install and whenever the introspection runtime fires `manual`, `js.error`, or `detach` on the bus — no API to call.

## Caveats

The plugin captures by patching the IndexedDB prototypes. This is robust against every realistic call site, but has the same realm-crossing limitation as every prototype-patching plugin in this repo: see [`docs/prototype-patching-limits.md`](../../docs/prototype-patching-limits.md). In practice, no application code triggers it.

`IDBObjectStore.prototype.put.toString()` etc. no longer return `[native code]` while the plugin is attached. Apps that sniff this will see our wrapper.

Holding an `IDBObjectStore` reference across transactions (illegal per spec but possible at runtime for raw references) results in writes tagged `transactionId: 'unknown'`.

Cursor walks on huge stores emit one event per advance. With `reads: true` enabled, walking a 1M-record store produces 1M events — opt in deliberately.

# `plugin-indexeddb` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@introspection/plugin-indexeddb` per the spec at `docs/superpowers/specs/2026-05-08-plugin-indexeddb-design.md`. Captures IndexedDB activity (database lifecycle, schema, transactions, writes; reads/data snapshots opt-in) into the introspection trace.

**Architecture:** Page-side prototype patching of the IDB API surface (`IDBFactory`, `IDBDatabase`, `IDBObjectStore`, `IDBIndex`, `IDBTransaction`, `IDBRequest`) via `Page.addScriptToEvaluateOnNewDocument` + `Runtime.evaluate`. Single CDP `Runtime.addBinding` channel ferries event payloads to the server side. Schema (and optional data) snapshots use server-side CDP `IndexedDB.requestDatabaseNames` / `requestDatabase` / `requestData` at install time and on `manual` / `js.error` / `detach` bus triggers. All captured values live in JSON assets via `ctx.writeAsset`, referenced by the standard `assets` field on each event.

**Tech Stack:** TypeScript, Playwright, CDP (`Runtime.addBinding`, `IndexedDB.*`, `Page.frameNavigated`), `tsup` build, `pnpm` workspaces. Sibling reference plugin: `@introspection/plugin-web-storage`.

---

## File Structure

New package at `plugins/plugin-indexeddb/`:

- `plugins/plugin-indexeddb/package.json` — workspace manifest mirroring `plugin-web-storage`'s.
- `plugins/plugin-indexeddb/tsconfig.json` — extends `tsconfig.base.json`.
- `plugins/plugin-indexeddb/playwright.config.ts` — same shape as siblings.
- `plugins/plugin-indexeddb/src/index.ts` — public entry. Exports `indexedDB(options)`. Houses the server-side handler: parses binding payloads, applies origin/database filters, writes assets, emits trace events. Manages bus subscriptions and snapshot logic.
- `plugins/plugin-indexeddb/src/page-script.ts` — exports the `BROWSER_SCRIPT` constant containing the IIFE that patches the IDB prototypes. Kept separate from `index.ts` because it's non-trivial (~250–350 lines) and reads as page-realm code, not Node code.
- `plugins/plugin-indexeddb/test/indexeddb.spec.ts` — Playwright integration tests.
- `plugins/plugin-indexeddb/test/fixtures/index.html` — fixture page that loads no databases at start.
- `plugins/plugin-indexeddb/README.md` — follows `docs/PLUGIN_README_TEMPLATE.md`.

Modified:
- `packages/types/src/index.ts` — adds `IdbDatabaseEvent`, `IdbSchemaEvent`, `IdbTransactionEvent`, `IdbWriteEvent`, `IdbReadEvent`, `IdbSnapshotEvent` and registers them in `TraceEventMap`.
- `plugins/plugin-web-storage/src/index.ts` — flips default `origins` from top-frame-only to `['*']` (consistency change bundled with this plan, per spec).
- `plugins/plugin-web-storage/README.md` — note the default change.
- `plugins/plugin-web-storage/test/web-storage.spec.ts` — drop the now-obsolete origin filter test that asserted top-frame-default; keep the explicit-origins test.
- `docs/prototype-patching-limits.md` — confirm `plugin-indexeddb` listed (already present).

Out of scope here:
- `plugin-defaults` — `indexedDB` is opt-in.
- CLI changes — `introspect events --type 'idb.*'` already works generically.

## Working directory

All commands assume `cwd = /Users/puckey/rg/introspection` unless otherwise stated.

## Implementation note: timestamps and ordering

Single-channel through one CDP binding preserves FIFO delivery, mirroring `plugin-web-storage`. We use server-side `ctx.timestamp()` on receipt; the page-side `requestedAt` / `completedAt` fields on `idb.write` / `idb.read` are derived from `performance.now()` at the call site and at request settle, so consumers can see the latency of each IDB op without relying on the event's outer `timestamp`.

---

## Task 1: Add event types to `@introspection/types`

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Insert the IDB event interfaces and register them in `TraceEventMap`**

In `packages/types/src/index.ts`, find the block:

```ts
// ─── Plugin events: web-storage ─────────────────────────────────────────────
```

Insert immediately **before** that block (so IDB sits between redux and web-storage):

```ts
// ─── Plugin events: indexeddb ───────────────────────────────────────────────

export type IdbTransactionMode = 'readonly' | 'readwrite' | 'versionchange'

export interface IdbDatabaseEvent extends BaseEvent {
  type: 'idb.database'
  metadata: {
    operation: 'open' | 'upgrade' | 'close' | 'delete'
    origin: string
    name: string
    oldVersion?: number
    newVersion?: number
    outcome?: 'success' | 'error' | 'blocked'
    error?: string
  }
}

export interface IdbSchemaEvent extends BaseEvent {
  type: 'idb.schema'
  metadata: {
    operation:
      | 'createObjectStore' | 'deleteObjectStore'
      | 'createIndex' | 'deleteIndex'
    origin: string
    database: string
    objectStore: string
    index?: string
    keyPath?: string | string[] | null
    autoIncrement?: boolean
    unique?: boolean
    multiEntry?: boolean
  }
}

export interface IdbTransactionEvent extends BaseEvent {
  type: 'idb.transaction'
  metadata: {
    operation: 'begin' | 'complete' | 'abort' | 'error'
    origin: string
    database: string
    transactionId: string
    mode: IdbTransactionMode
    objectStoreNames: string[]
    error?: string
  }
}

export interface IdbWriteEvent extends BaseEvent {
  type: 'idb.write'
  metadata: {
    operation: 'add' | 'put' | 'delete' | 'clear'
    origin: string
    database: string
    objectStore: string
    transactionId: string
    key?: unknown
    affectedCount?: number
    outcome: 'success' | 'error'
    error?: string
    requestedAt: number
    completedAt: number
  }
}

export interface IdbReadEvent extends BaseEvent {
  type: 'idb.read'
  metadata: {
    operation:
      | 'get' | 'getAll' | 'getKey' | 'getAllKeys'
      | 'count' | 'openCursor' | 'openKeyCursor'
    origin: string
    database: string
    objectStore: string
    index?: string
    transactionId: string
    query?: unknown
    count?: number
    outcome: 'success' | 'error'
    error?: string
    requestedAt: number
    completedAt: number
  }
}

export interface IdbSnapshotEvent extends BaseEvent {
  type: 'idb.snapshot'
  metadata: {
    trigger: 'install' | 'manual' | 'js.error' | 'detach'
    origin: string
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
      }>
    }>
  }
}

```

In the `TraceEventMap`, find:

```ts
  // Web storage
  'webStorage.write': WebStorageWriteEvent
```

Insert immediately **before** that line:

```ts
  // IndexedDB
  'idb.database': IdbDatabaseEvent
  'idb.schema': IdbSchemaEvent
  'idb.transaction': IdbTransactionEvent
  'idb.write': IdbWriteEvent
  'idb.read': IdbReadEvent
  'idb.snapshot': IdbSnapshotEvent
```

- [ ] **Step 2: Typecheck the types package**

Run: `pnpm --filter @introspection/types typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "types: add idb.* event types"
```

---

## Task 2: Scaffold the `plugin-indexeddb` package

**Files:**
- Create: `plugins/plugin-indexeddb/package.json`
- Create: `plugins/plugin-indexeddb/tsconfig.json`
- Create: `plugins/plugin-indexeddb/playwright.config.ts`
- Create: `plugins/plugin-indexeddb/src/index.ts`
- Create: `plugins/plugin-indexeddb/src/page-script.ts`
- Create: `plugins/plugin-indexeddb/test/fixtures/index.html`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@introspection/plugin-indexeddb",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@introspection/utils": "workspace:*",
    "@introspection/types": "workspace:*"
  },
  "devDependencies": {
    "@playwright/test": "^1.40.0",
    "@introspection/playwright": "workspace:*",
    "@introspection/plugin-js-error": "workspace:*",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  use: {
    headless: true,
  },
})
```

- [ ] **Step 4: Create empty `src/page-script.ts` placeholder**

```ts
// Page-realm IIFE that patches the IndexedDB API surface and ferries events
// to the host via the Runtime binding. Filled in by Task 4 onwards.

export const BROWSER_SCRIPT = `
(function() {
  if (typeof IDBFactory === 'undefined') return;
})();
`
```

- [ ] **Step 5: Create initial `src/index.ts` skeleton**

```ts
import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { BROWSER_SCRIPT } from './page-script.js'

export type {
  IdbDatabaseEvent,
  IdbSchemaEvent,
  IdbTransactionEvent,
  IdbWriteEvent,
  IdbReadEvent,
  IdbSnapshotEvent,
  IdbTransactionMode,
} from '@introspection/types'

export interface IndexedDBOptions {
  /** Capture reads (get/getAll/cursors/count). Default: false. */
  reads?: boolean
  /** Include object-store contents in `idb.snapshot` events. Default: false. */
  dataSnapshots?: boolean
  /** Restrict capture to specific origins. Default: ['*']. */
  origins?: string[]
  /** Restrict capture to specific database names. Default: all. */
  databases?: string[]
  verbose?: boolean
}

export function indexedDB(options?: IndexedDBOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-indexeddb', options?.verbose ?? false)
  const captureReads = options?.reads ?? false
  const dataSnapshots = options?.dataSnapshots ?? false
  const origins = options?.origins ?? ['*']
  const databases = options?.databases

  return {
    name: 'indexeddb',
    description: 'Captures IndexedDB activity (database lifecycle, schema, transactions, writes; reads + data snapshots opt-in)',
    events: {
      'idb.database': 'Database lifecycle (open / upgrade / close / delete)',
      'idb.schema': 'Schema definition (createObjectStore / deleteObjectStore / createIndex / deleteIndex)',
      'idb.transaction': 'Transaction lifecycle (begin / complete / abort / error)',
      'idb.write': 'Write op (add / put / delete / clear)',
      'idb.read': 'Read op (get / getAll / cursors / count); only when reads: true',
      'idb.snapshot': 'Schema (and optional data) snapshot at install + bus triggers',
    },
    async install(_ctx: PluginContext): Promise<void> {
      debug('installing', { captureReads, dataSnapshots, origins, databases })
      // Filled in by later tasks.
      void BROWSER_SCRIPT
    },
  }
}
```

- [ ] **Step 6: Create the test fixture**

`plugins/plugin-indexeddb/test/fixtures/index.html`:

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>indexeddb fixture</title></head>
<body>
<!-- Empty fixture. Tests open / mutate databases via page.evaluate. -->
</body>
</html>
```

- [ ] **Step 7: Install workspace dependencies**

Run: `pnpm install`
Expected: PASS — pnpm wires the new package into the workspace graph.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @introspection/plugin-indexeddb typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add plugins/plugin-indexeddb pnpm-lock.yaml
git commit -m "plugin-indexeddb: scaffold package"
```

---

## Task 3: Test + implement install-time schema snapshot

This task gives the simplest end-to-end loop: a schema snapshot at install proves the CDP IndexedDB domain works.

**Files:**
- Create: `plugins/plugin-indexeddb/test/indexeddb.spec.ts`
- Modify: `plugins/plugin-indexeddb/src/index.ts`

- [ ] **Step 1: Write the install-snapshot test**

`plugins/plugin-indexeddb/test/indexeddb.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { attach } from '@introspection/playwright'
import { indexedDB } from '../src/index.js'

const FIXTURE = 'file://' + fileURLToPath(new URL('./fixtures/index.html', import.meta.url))

let dir: string
test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-idb-'))
})
test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function readEvents(outDir: string) {
  const entries = await readdir(outDir)
  const ndjson = await readFile(join(outDir, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

async function readAsset(outDir: string, path: string) {
  const entries = await readdir(outDir)
  return JSON.parse(await readFile(join(outDir, entries[0], path), 'utf-8'))
}

async function openDatabase(page: import('@playwright/test').Page, name: string, version: number, schema: string) {
  // schema is JS code that runs in onupgradeneeded with `db` in scope.
  await page.evaluate(([name, version, schema]) => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name as string, version as number)
      req.onupgradeneeded = (ev) => {
        const db = (ev.target as IDBOpenDBRequest).result
        // eslint-disable-next-line no-new-func
        new Function('db', schema as string)(db)
      }
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
  }, [name, version, schema] as const)
}

test('emits an install snapshot containing pre-existing databases', async ({ page }) => {
  await page.goto(FIXTURE)
  await openDatabase(page, 'fixture-db', 1, `
    db.createObjectStore('users', { keyPath: 'id' })
    db.createObjectStore('posts', { autoIncrement: true })
  `)

  const handle = await attach(page, { outDir: dir, plugins: [indexedDB()] })
  await new Promise(r => setTimeout(r, 150))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'idb.snapshot')
  const installSnapshot = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'install')

  expect(installSnapshot).toBeDefined()
  const fixtureDb = installSnapshot.metadata.databases.find((d: { name: string }) => d.name === 'fixture-db')
  expect(fixtureDb).toBeDefined()
  expect(fixtureDb.version).toBe(1)
  expect(fixtureDb.objectStores.map((s: { name: string }) => s.name).sort()).toEqual(['posts', 'users'])

  const usersStore = fixtureDb.objectStores.find((s: { name: string }) => s.name === 'users')
  expect(usersStore.keyPath).toBe('id')
  expect(usersStore.autoIncrement).toBe(false)
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "install snapshot"`
Expected: FAIL — `installSnapshot` is `undefined` because the plugin doesn't emit anything yet.

- [ ] **Step 3: Implement install-time schema snapshot**

Replace the body of `install()` in `plugins/plugin-indexeddb/src/index.ts` so the file becomes:

```ts
import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { BROWSER_SCRIPT } from './page-script.js'

export type {
  IdbDatabaseEvent,
  IdbSchemaEvent,
  IdbTransactionEvent,
  IdbWriteEvent,
  IdbReadEvent,
  IdbSnapshotEvent,
  IdbTransactionMode,
} from '@introspection/types'

export interface IndexedDBOptions {
  reads?: boolean
  dataSnapshots?: boolean
  origins?: string[]
  databases?: string[]
  verbose?: boolean
}

type SnapshotTrigger = 'install' | 'manual' | 'js.error' | 'detach'

interface CdpDatabaseWithStores {
  name: string
  version: number
  objectStores: Array<{
    name: string
    keyPath?: { type: string; string?: string; array?: string[] } | null
    autoIncrement: boolean
    indexes: Array<{
      name: string
      keyPath: { type: string; string?: string; array?: string[] }
      unique: boolean
      multiEntry: boolean
    }>
  }>
}

function unwrapKeyPath(kp?: { type: string; string?: string; array?: string[] } | null): string | string[] | null {
  if (!kp) return null
  if (kp.type === 'string') return kp.string ?? ''
  if (kp.type === 'array') return kp.array ?? []
  return null
}

export function indexedDB(options?: IndexedDBOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-indexeddb', options?.verbose ?? false)
  const captureReads = options?.reads ?? false
  const dataSnapshots = options?.dataSnapshots ?? false
  const origins = options?.origins ?? ['*']
  const databasesFilter = options?.databases

  function originAllowed(origin: string): boolean {
    if (origins.includes('*')) return true
    return origins.includes(origin)
  }

  return {
    name: 'indexeddb',
    description: 'Captures IndexedDB activity (database lifecycle, schema, transactions, writes; reads + data snapshots opt-in)',
    events: {
      'idb.database': 'Database lifecycle (open / upgrade / close / delete)',
      'idb.schema': 'Schema definition (createObjectStore / deleteObjectStore / createIndex / deleteIndex)',
      'idb.transaction': 'Transaction lifecycle (begin / complete / abort / error)',
      'idb.write': 'Write op (add / put / delete / clear)',
      'idb.read': 'Read op (get / getAll / cursors / count); only when reads: true',
      'idb.snapshot': 'Schema (and optional data) snapshot at install + bus triggers',
    },
    async install(ctx: PluginContext): Promise<void> {
      debug('installing', { captureReads, dataSnapshots, origins, databasesFilter })
      void BROWSER_SCRIPT // page-side patching wired in Task 4

      let topOrigin: string | undefined

      try {
        await ctx.cdpSession.send('Page.enable')
        const frameTree = await ctx.cdpSession.send('Page.getFrameTree') as {
          frameTree: { frame: { url: string; securityOrigin?: string } }
        }
        const root = frameTree.frameTree.frame
        topOrigin = root.securityOrigin ?? (() => {
          try { return new URL(root.url).origin } catch { return undefined }
        })()
        debug('top origin', topOrigin)
      } catch (err) {
        debug('failed to determine top origin', (err as Error).message)
      }

      ctx.cdpSession.on('Page.frameNavigated', (rawParams) => {
        const params = rawParams as { frame: { id: string; parentId?: string; url: string; securityOrigin?: string } }
        if (params.frame.parentId) return
        topOrigin = params.frame.securityOrigin ?? (() => {
          try { return new URL(params.frame.url).origin } catch { return undefined }
        })()
        debug('top origin updated', topOrigin)
      })

      async function snapshotOnce(trigger: SnapshotTrigger): Promise<void> {
        const targetOrigins = origins.includes('*')
          ? (topOrigin ? [topOrigin] : [])
          : origins
        for (const origin of targetOrigins) {
          if (!originAllowed(origin)) continue

          let names: string[] = []
          try {
            const r = await ctx.cdpSession.send('IndexedDB.requestDatabaseNames', {
              securityOrigin: origin,
            }) as { databaseNames: string[] }
            names = r.databaseNames
          } catch (err) {
            debug('requestDatabaseNames failed', origin, (err as Error).message)
            continue
          }

          if (databasesFilter) names = names.filter(n => databasesFilter.includes(n))

          const databases: Array<{
            name: string
            version: number
            objectStores: Array<{
              name: string
              keyPath: string | string[] | null
              autoIncrement: boolean
              indexes: Array<{ name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }>
            }>
          }> = []

          for (const name of names) {
            try {
              const r = await ctx.cdpSession.send('IndexedDB.requestDatabase', {
                securityOrigin: origin, databaseName: name,
              }) as { databaseWithObjectStores: CdpDatabaseWithStores }
              const db = r.databaseWithObjectStores
              databases.push({
                name: db.name,
                version: db.version,
                objectStores: db.objectStores.map(s => ({
                  name: s.name,
                  keyPath: unwrapKeyPath(s.keyPath),
                  autoIncrement: s.autoIncrement,
                  indexes: s.indexes.map(i => ({
                    name: i.name,
                    keyPath: (unwrapKeyPath(i.keyPath) ?? '') as string | string[],
                    unique: i.unique,
                    multiEntry: i.multiEntry,
                  })),
                })),
              })
            } catch (err) {
              debug('requestDatabase failed', origin, name, (err as Error).message)
            }
          }

          await ctx.emit({
            type: 'idb.snapshot',
            metadata: { trigger, origin, databases },
          })
        }
      }

      await snapshotOnce('install')
    },
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "install snapshot"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-indexeddb
git commit -m "plugin-indexeddb: install-time schema snapshot via CDP IndexedDB domain"
```

---

## Task 4: Test + implement page-side wrapper bootstrap

Bring up the page-side script with the binding wired but no operations patched yet. After this task, `BROWSER_SCRIPT` runs in the page and can call the binding; subsequent tasks fill in the actual op patches.

**Files:**
- Modify: `plugins/plugin-indexeddb/src/page-script.ts`
- Modify: `plugins/plugin-indexeddb/src/index.ts`

- [ ] **Step 1: Replace the placeholder `page-script.ts` with the bootstrap**

```ts
// Page-realm IIFE. Runs in every navigated frame via addInitScript and once
// in the current realm via Runtime.evaluate at install time.
//
// Communicates with the host via window['__introspection_plugin_indexeddb'],
// a Runtime.addBinding installed server-side. Each call sends a JSON string
// describing one event-relevant moment.

export const BROWSER_SCRIPT = `
(function() {
  var BINDING = '__introspection_plugin_indexeddb';
  if (typeof IDBFactory === 'undefined') return;
  if (window[BINDING + '_installed']) return;
  window[BINDING + '_installed'] = true;

  var SETTINGS_KEY = BINDING + '_settings';
  var settings = window[SETTINGS_KEY] || { reads: false };

  var txCounter = 0;
  function nextTxId() {
    txCounter += 1;
    return 'tx-' + txCounter + '-' + Date.now();
  }

  function emit(payload) {
    try {
      payload.origin = location.origin;
      var binding = window[BINDING];
      if (typeof binding === 'function') binding(JSON.stringify(payload));
    } catch (_) { /* swallow */ }
  }

  function safeJSON(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return undefined; }
  }

  // Capture-surface patches are added by subsequent code paths in this script.
  // Exposed via window so future patches can compose:
  window[BINDING + '_emit'] = emit;
  window[BINDING + '_nextTxId'] = nextTxId;
  window[BINDING + '_safeJSON'] = safeJSON;
  window[BINDING + '_settings'] = settings;
})();
`
```

- [ ] **Step 2: Wire the binding and inject the script in `install()`**

In `plugins/plugin-indexeddb/src/index.ts`, add the binding setup and script injection. Insert immediately after the `Page.frameNavigated` subscription, **before** the `snapshotOnce` definition:

```ts
      const BINDING_NAME = '__introspection_plugin_indexeddb'

      type PagePayload = { origin: string; kind: string; [k: string]: unknown }

      function handlePagePayload(_payload: PagePayload): void {
        // Filled in by Task 5 onwards.
      }

      await ctx.cdpSession.send('Runtime.addBinding', { name: BINDING_NAME })
      ctx.cdpSession.on('Runtime.bindingCalled', (rawParams) => {
        const params = rawParams as { name: string; payload: string }
        if (params.name !== BINDING_NAME) return
        try {
          const payload = JSON.parse(params.payload) as PagePayload
          handlePagePayload(payload)
        } catch (err) {
          debug('binding parse error', (err as Error).message)
        }
      })

      const settingsToggle =
        `window['${BINDING_NAME}_settings'] = ${JSON.stringify({ reads: captureReads })};`
      await ctx.cdpSession.send('Page.addScriptToEvaluateOnNewDocument', {
        source: settingsToggle + BROWSER_SCRIPT,
      })

      // Init scripts only run on future navigations; also evaluate now to
      // patch the existing realm.
      try {
        await ctx.cdpSession.send('Runtime.evaluate', {
          expression: settingsToggle + BROWSER_SCRIPT,
          awaitPromise: false,
        })
      } catch (err) {
        debug('current-realm patch failed', (err as Error).message)
      }
```

- [ ] **Step 3: Add a smoke test that the binding round-trips**

Append to `plugins/plugin-indexeddb/test/indexeddb.spec.ts`:

```ts
test('binding round-trips a manually-emitted payload', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB({ verbose: true })] })

  // Sanity: the page-side helpers exist after install.
  const ok = await page.evaluate(() => {
    return typeof (window as unknown as { __introspection_plugin_indexeddb_emit?: unknown })
      .__introspection_plugin_indexeddb_emit === 'function'
  })
  expect(ok).toBe(true)

  await handle.detach()
})
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "binding round-trips"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-indexeddb
git commit -m "plugin-indexeddb: page-side script + CDP binding bootstrap"
```

---

## Task 5: Test + implement database lifecycle capture

Capture `idb.database` events for `open` (success/error/blocked), `upgradeneeded` (with versions), `close`, and `deleteDatabase`.

**Files:**
- Modify: `plugins/plugin-indexeddb/src/page-script.ts`
- Modify: `plugins/plugin-indexeddb/src/index.ts`
- Modify: `plugins/plugin-indexeddb/test/indexeddb.spec.ts`

- [ ] **Step 1: Append the test**

Append to `plugins/plugin-indexeddb/test/indexeddb.spec.ts`:

```ts
test('captures database open, upgradeneeded, close, and delete', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB()] })

  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('lifecycle-db', 2)
      req.onupgradeneeded = (ev) => {
        const db = (ev.target as IDBOpenDBRequest).result
        db.createObjectStore('store-a', { keyPath: 'id' })
      }
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
  })

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('lifecycle-db')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  }))

  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const lifecycle = events.filter((e: { type: string; metadata: { name?: string } }) =>
    e.type === 'idb.database' && e.metadata.name === 'lifecycle-db'
  )
  const ops = lifecycle.map((e: { metadata: { operation: string } }) => e.metadata.operation)
  expect(ops).toContain('upgrade')
  expect(ops).toContain('open')
  expect(ops).toContain('close')
  expect(ops).toContain('delete')

  const upgrade = lifecycle.find((e: { metadata: { operation: string } }) => e.metadata.operation === 'upgrade')
  expect(upgrade.metadata.oldVersion).toBe(0)
  expect(upgrade.metadata.newVersion).toBe(2)

  const open = lifecycle.find((e: { metadata: { operation: string } }) => e.metadata.operation === 'open')
  expect(open.metadata.outcome).toBe('success')
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "open, upgradeneeded"`
Expected: FAIL — no `idb.database` events emitted.

- [ ] **Step 3: Patch IDBFactory.open and deleteDatabase, plus IDBDatabase.close, in `page-script.ts`**

Replace `BROWSER_SCRIPT` body in `plugins/plugin-indexeddb/src/page-script.ts` so the file becomes:

```ts
export const BROWSER_SCRIPT = `
(function() {
  var BINDING = '__introspection_plugin_indexeddb';
  if (typeof IDBFactory === 'undefined') return;
  if (window[BINDING + '_installed']) return;
  window[BINDING + '_installed'] = true;

  var SETTINGS_KEY = BINDING + '_settings';
  var settings = window[SETTINGS_KEY] || { reads: false };

  var txCounter = 0;
  function nextTxId() {
    txCounter += 1;
    return 'tx-' + txCounter + '-' + Date.now();
  }

  function emit(payload) {
    try {
      payload.origin = location.origin;
      var binding = window[BINDING];
      if (typeof binding === 'function') binding(JSON.stringify(payload));
    } catch (_) { /* swallow */ }
  }

  function safeJSON(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return undefined; }
  }

  window[BINDING + '_emit'] = emit;
  window[BINDING + '_nextTxId'] = nextTxId;
  window[BINDING + '_safeJSON'] = safeJSON;
  window[BINDING + '_settings'] = settings;

  // ─── IDBFactory.open ─────────────────────────────────────────────────────
  var origOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function(name, version) {
    var req = origOpen.apply(this, arguments);
    var oldVersion;
    req.addEventListener('upgradeneeded', function(ev) {
      oldVersion = ev.oldVersion;
      emit({
        kind: 'database',
        operation: 'upgrade',
        name: String(name),
        oldVersion: ev.oldVersion,
        newVersion: ev.newVersion
      });
    });
    req.addEventListener('blocked', function(ev) {
      emit({
        kind: 'database',
        operation: 'open',
        name: String(name),
        outcome: 'blocked',
        oldVersion: oldVersion
      });
    });
    req.addEventListener('success', function() {
      emit({
        kind: 'database',
        operation: 'open',
        name: String(name),
        outcome: 'success',
        newVersion: req.result ? req.result.version : version
      });
    });
    req.addEventListener('error', function() {
      emit({
        kind: 'database',
        operation: 'open',
        name: String(name),
        outcome: 'error',
        error: req.error ? String(req.error.name + ': ' + req.error.message) : 'unknown'
      });
    });
    return req;
  };

  // ─── IDBFactory.deleteDatabase ──────────────────────────────────────────
  var origDelete = IDBFactory.prototype.deleteDatabase;
  IDBFactory.prototype.deleteDatabase = function(name) {
    var req = origDelete.apply(this, arguments);
    req.addEventListener('success', function() {
      emit({ kind: 'database', operation: 'delete', name: String(name), outcome: 'success' });
    });
    req.addEventListener('error', function() {
      emit({
        kind: 'database', operation: 'delete', name: String(name), outcome: 'error',
        error: req.error ? String(req.error.name + ': ' + req.error.message) : 'unknown'
      });
    });
    req.addEventListener('blocked', function() {
      emit({ kind: 'database', operation: 'delete', name: String(name), outcome: 'blocked' });
    });
    return req;
  };

  // ─── IDBDatabase.close ──────────────────────────────────────────────────
  var origClose = IDBDatabase.prototype.close;
  IDBDatabase.prototype.close = function() {
    var name = this.name;
    var version = this.version;
    var result = origClose.apply(this, arguments);
    emit({ kind: 'database', operation: 'close', name: String(name), oldVersion: version });
    return result;
  };
})();
`
```

- [ ] **Step 4: Implement the server-side handler for the `database` kind**

In `plugins/plugin-indexeddb/src/index.ts`, replace the placeholder `handlePagePayload` with one that handles `database` payloads. Update the `PagePayload` type and the function:

```ts
      type DatabasePayload = {
        origin: string
        kind: 'database'
        operation: 'open' | 'upgrade' | 'close' | 'delete'
        name: string
        oldVersion?: number
        newVersion?: number
        outcome?: 'success' | 'error' | 'blocked'
        error?: string
      }

      type PagePayload = DatabasePayload // expanded by later tasks

      function handlePagePayload(payload: PagePayload): void {
        if (!originAllowed(payload.origin)) return
        if (payload.kind === 'database') {
          if (databasesFilter && !databasesFilter.includes(payload.name)) return
          const md: {
            operation: 'open' | 'upgrade' | 'close' | 'delete'
            origin: string
            name: string
            oldVersion?: number
            newVersion?: number
            outcome?: 'success' | 'error' | 'blocked'
            error?: string
          } = {
            operation: payload.operation,
            origin: payload.origin,
            name: payload.name,
          }
          if (payload.oldVersion !== undefined) md.oldVersion = payload.oldVersion
          if (payload.newVersion !== undefined) md.newVersion = payload.newVersion
          if (payload.outcome) md.outcome = payload.outcome
          if (payload.error) md.error = payload.error
          void ctx.emit({ type: 'idb.database', metadata: md })
          return
        }
      }
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "open, upgradeneeded"`
Expected: PASS.

- [ ] **Step 6: Re-run the install snapshot test**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "install snapshot"`
Expected: PASS — still works.

- [ ] **Step 7: Commit**

```bash
git add plugins/plugin-indexeddb
git commit -m "plugin-indexeddb: capture database lifecycle (open/upgrade/close/delete)"
```

---

## Task 6: Test + implement schema events (createObjectStore / deleteObjectStore / createIndex / deleteIndex)

**Files:**
- Modify: `plugins/plugin-indexeddb/src/page-script.ts`
- Modify: `plugins/plugin-indexeddb/src/index.ts`
- Modify: `plugins/plugin-indexeddb/test/indexeddb.spec.ts`

- [ ] **Step 1: Append the test**

```ts
test('captures schema events: createObjectStore and createIndex', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB()] })

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('schema-db', 1)
    req.onupgradeneeded = (ev) => {
      const db = (ev.target as IDBOpenDBRequest).result
      const store = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true })
      store.createIndex('by-name', 'name', { unique: false })
      store.createIndex('by-tag', 'tags', { multiEntry: true })
    }
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  }))

  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const schema = events.filter((e: { type: string }) => e.type === 'idb.schema')

  const createStore = schema.find((e: { metadata: { operation: string; objectStore: string } }) =>
    e.metadata.operation === 'createObjectStore' && e.metadata.objectStore === 'items'
  )
  expect(createStore).toBeDefined()
  expect(createStore.metadata.keyPath).toBe('id')
  expect(createStore.metadata.autoIncrement).toBe(true)

  const byName = schema.find((e: { metadata: { operation: string; index?: string } }) =>
    e.metadata.operation === 'createIndex' && e.metadata.index === 'by-name'
  )
  expect(byName).toBeDefined()
  expect(byName.metadata.unique).toBe(false)
  expect(byName.metadata.objectStore).toBe('items')

  const byTag = schema.find((e: { metadata: { operation: string; index?: string } }) =>
    e.metadata.operation === 'createIndex' && e.metadata.index === 'by-tag'
  )
  expect(byTag.metadata.multiEntry).toBe(true)
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "schema events"`
Expected: FAIL — no `idb.schema` events emitted.

- [ ] **Step 3: Patch IDBDatabase.createObjectStore / deleteObjectStore and IDBObjectStore.createIndex / deleteIndex**

Append to `BROWSER_SCRIPT` (just before the closing `})()`) in `plugins/plugin-indexeddb/src/page-script.ts`:

```js
  // ─── Schema (only valid in versionchange transactions) ──────────────────
  function keyPathOf(kp) {
    if (kp == null) return null;
    if (Array.isArray(kp)) return kp.slice();
    return String(kp);
  }

  var origCreateStore = IDBDatabase.prototype.createObjectStore;
  IDBDatabase.prototype.createObjectStore = function(name, options) {
    var store = origCreateStore.apply(this, arguments);
    emit({
      kind: 'schema',
      operation: 'createObjectStore',
      database: String(this.name),
      objectStore: String(name),
      keyPath: keyPathOf(store.keyPath),
      autoIncrement: !!store.autoIncrement
    });
    return store;
  };

  var origDeleteStore = IDBDatabase.prototype.deleteObjectStore;
  IDBDatabase.prototype.deleteObjectStore = function(name) {
    var result = origDeleteStore.apply(this, arguments);
    emit({
      kind: 'schema',
      operation: 'deleteObjectStore',
      database: String(this.name),
      objectStore: String(name)
    });
    return result;
  };

  var origCreateIndex = IDBObjectStore.prototype.createIndex;
  IDBObjectStore.prototype.createIndex = function(name, keyPath, options) {
    var index = origCreateIndex.apply(this, arguments);
    var dbName = (this.transaction && this.transaction.db) ? this.transaction.db.name : '';
    emit({
      kind: 'schema',
      operation: 'createIndex',
      database: String(dbName),
      objectStore: String(this.name),
      index: String(name),
      keyPath: keyPathOf(keyPath),
      unique: !!index.unique,
      multiEntry: !!index.multiEntry
    });
    return index;
  };

  var origDeleteIndex = IDBObjectStore.prototype.deleteIndex;
  IDBObjectStore.prototype.deleteIndex = function(name) {
    var result = origDeleteIndex.apply(this, arguments);
    var dbName = (this.transaction && this.transaction.db) ? this.transaction.db.name : '';
    emit({
      kind: 'schema',
      operation: 'deleteIndex',
      database: String(dbName),
      objectStore: String(this.name),
      index: String(name)
    });
    return result;
  };
```

- [ ] **Step 4: Extend the server-side handler with schema payloads**

In `plugins/plugin-indexeddb/src/index.ts`, extend the `PagePayload` union and add a branch in `handlePagePayload`:

```ts
      type SchemaPayload = {
        origin: string
        kind: 'schema'
        operation: 'createObjectStore' | 'deleteObjectStore' | 'createIndex' | 'deleteIndex'
        database: string
        objectStore: string
        index?: string
        keyPath?: string | string[] | null
        autoIncrement?: boolean
        unique?: boolean
        multiEntry?: boolean
      }

      type PagePayload = DatabasePayload | SchemaPayload
```

Then add a new branch in `handlePagePayload`, after the `database` branch:

```ts
        if (payload.kind === 'schema') {
          if (databasesFilter && !databasesFilter.includes(payload.database)) return
          const md: {
            operation: 'createObjectStore' | 'deleteObjectStore' | 'createIndex' | 'deleteIndex'
            origin: string
            database: string
            objectStore: string
            index?: string
            keyPath?: string | string[] | null
            autoIncrement?: boolean
            unique?: boolean
            multiEntry?: boolean
          } = {
            operation: payload.operation,
            origin: payload.origin,
            database: payload.database,
            objectStore: payload.objectStore,
          }
          if (payload.index !== undefined) md.index = payload.index
          if (payload.keyPath !== undefined) md.keyPath = payload.keyPath
          if (payload.autoIncrement !== undefined) md.autoIncrement = payload.autoIncrement
          if (payload.unique !== undefined) md.unique = payload.unique
          if (payload.multiEntry !== undefined) md.multiEntry = payload.multiEntry
          void ctx.emit({ type: 'idb.schema', metadata: md })
          return
        }
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "schema events"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/plugin-indexeddb
git commit -m "plugin-indexeddb: capture schema events (createObjectStore/createIndex etc.)"
```

---

## Task 7: Test + implement transaction lifecycle

**Files:**
- Modify: `plugins/plugin-indexeddb/src/page-script.ts`
- Modify: `plugins/plugin-indexeddb/src/index.ts`
- Modify: `plugins/plugin-indexeddb/test/indexeddb.spec.ts`

- [ ] **Step 1: Append the test**

```ts
test('captures transaction begin and complete', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB()] })

  await openDatabase(page, 'tx-db', 1, `db.createObjectStore('items', { keyPath: 'id' })`)

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('tx-db', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('items', 'readwrite')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    req.onerror = () => reject(req.error)
  }))

  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const txEvents = events.filter((e: { type: string }) => e.type === 'idb.transaction')

  const begin = txEvents.find((e: { metadata: { operation: string } }) => e.metadata.operation === 'begin')
  expect(begin).toBeDefined()
  expect(begin.metadata.mode).toBe('readwrite')
  expect(begin.metadata.objectStoreNames).toEqual(['items'])
  expect(begin.metadata.database).toBe('tx-db')

  const complete = txEvents.find((e: { metadata: { operation: string; transactionId: string } }) =>
    e.metadata.operation === 'complete' && e.metadata.transactionId === begin.metadata.transactionId
  )
  expect(complete).toBeDefined()
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "transaction begin"`
Expected: FAIL — no `idb.transaction` events.

- [ ] **Step 3: Patch IDBDatabase.transaction**

Append to `BROWSER_SCRIPT`:

```js
  // ─── IDBDatabase.transaction ────────────────────────────────────────────
  // Stash the synthetic tx id on the transaction object so subsequent
  // wrappers (objectStore, request) can find it.
  var TX_ID_KEY = '__introspection_idb_tx_id__';

  var origTransaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function(stores, mode) {
    var tx = origTransaction.apply(this, arguments);
    var transactionId = nextTxId();
    try {
      Object.defineProperty(tx, TX_ID_KEY, { value: transactionId, configurable: true });
    } catch (_) { /* DOM objects are tricky — fall back to bracket assignment */
      tx[TX_ID_KEY] = transactionId;
    }
    var names = Array.prototype.slice.call(tx.objectStoreNames || []);
    var dbName = String(this.name);
    var actualMode = tx.mode;

    emit({
      kind: 'transaction',
      operation: 'begin',
      database: dbName,
      transactionId: transactionId,
      mode: actualMode,
      objectStoreNames: names
    });

    tx.addEventListener('complete', function() {
      emit({
        kind: 'transaction', operation: 'complete', database: dbName,
        transactionId: transactionId, mode: actualMode, objectStoreNames: names
      });
    });
    tx.addEventListener('abort', function() {
      emit({
        kind: 'transaction', operation: 'abort', database: dbName,
        transactionId: transactionId, mode: actualMode, objectStoreNames: names,
        error: tx.error ? String(tx.error.name + ': ' + tx.error.message) : undefined
      });
    });
    tx.addEventListener('error', function() {
      emit({
        kind: 'transaction', operation: 'error', database: dbName,
        transactionId: transactionId, mode: actualMode, objectStoreNames: names,
        error: tx.error ? String(tx.error.name + ': ' + tx.error.message) : 'unknown'
      });
    });

    return tx;
  };
```

Also: when an `upgradeneeded` event fires, the transaction is created internally by the browser, not via `IDBDatabase.transaction`. To capture the schema operations within an upgrade, hook the request's `transaction` getter result. Add this immediately after the `IDBFactory.prototype.open` patch (still inside the IIFE):

```js
  // For open's implicit versionchange transaction, tag it the same way so
  // schema ops can find a transactionId. Run lazily on upgradeneeded.
  // (We extend the open patch; instead of editing it, register a one-time
  // tagger here.)
  var origAddListener = IDBOpenDBRequest.prototype.addEventListener;
  // No-op: keeping this comment to anchor the spot. The tagging is done
  // inside the open patch's upgradeneeded listener — extended below.
```

The simplest fix is to update the open patch directly. Replace the existing `req.addEventListener('upgradeneeded', ...)` block in the open patch with this version that also tags the transaction:

```js
    req.addEventListener('upgradeneeded', function(ev) {
      oldVersion = ev.oldVersion;
      var tx = req.transaction;
      if (tx) {
        var transactionId = nextTxId();
        try {
          Object.defineProperty(tx, TX_ID_KEY, { value: transactionId, configurable: true });
        } catch (_) {
          tx[TX_ID_KEY] = transactionId;
        }
        var dbName = String(name);
        var names = Array.prototype.slice.call(tx.objectStoreNames || []);
        emit({
          kind: 'transaction', operation: 'begin', database: dbName,
          transactionId: transactionId, mode: 'versionchange', objectStoreNames: names
        });
        tx.addEventListener('complete', function() {
          emit({
            kind: 'transaction', operation: 'complete', database: dbName,
            transactionId: transactionId, mode: 'versionchange', objectStoreNames: names
          });
        });
        tx.addEventListener('abort', function() {
          emit({
            kind: 'transaction', operation: 'abort', database: dbName,
            transactionId: transactionId, mode: 'versionchange', objectStoreNames: names,
            error: tx.error ? String(tx.error.name + ': ' + tx.error.message) : undefined
          });
        });
      }
      emit({
        kind: 'database',
        operation: 'upgrade',
        name: String(name),
        oldVersion: ev.oldVersion,
        newVersion: ev.newVersion
      });
    });
```

This keeps the `TX_ID_KEY` constant declaration outside the patch — make sure `var TX_ID_KEY = '__introspection_idb_tx_id__';` lives near the top of the IIFE (at the same level as `txCounter`). Move that declaration if it isn't already there.

- [ ] **Step 4: Extend the server-side handler with transaction payloads**

Add the type and branch in `plugins/plugin-indexeddb/src/index.ts`. Update the `PagePayload` union:

```ts
      type TransactionPayload = {
        origin: string
        kind: 'transaction'
        operation: 'begin' | 'complete' | 'abort' | 'error'
        database: string
        transactionId: string
        mode: 'readonly' | 'readwrite' | 'versionchange'
        objectStoreNames: string[]
        error?: string
      }

      type PagePayload = DatabasePayload | SchemaPayload | TransactionPayload
```

Add a branch in `handlePagePayload`:

```ts
        if (payload.kind === 'transaction') {
          if (databasesFilter && !databasesFilter.includes(payload.database)) return
          const md: {
            operation: 'begin' | 'complete' | 'abort' | 'error'
            origin: string
            database: string
            transactionId: string
            mode: 'readonly' | 'readwrite' | 'versionchange'
            objectStoreNames: string[]
            error?: string
          } = {
            operation: payload.operation,
            origin: payload.origin,
            database: payload.database,
            transactionId: payload.transactionId,
            mode: payload.mode,
            objectStoreNames: payload.objectStoreNames,
          }
          if (payload.error) md.error = payload.error
          void ctx.emit({ type: 'idb.transaction', metadata: md })
          return
        }
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "transaction begin"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/plugin-indexeddb
git commit -m "plugin-indexeddb: capture transaction lifecycle (begin/complete/abort/error)"
```

---

## Task 8: Test + implement write capture (add / put / delete / clear) with assets

**Files:**
- Modify: `plugins/plugin-indexeddb/src/page-script.ts`
- Modify: `plugins/plugin-indexeddb/src/index.ts`
- Modify: `plugins/plugin-indexeddb/test/indexeddb.spec.ts`

- [ ] **Step 1: Append the test**

```ts
test('captures add/put/delete/clear with values written to assets', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB()] })

  await openDatabase(page, 'writes-db', 1, `db.createObjectStore('items', { keyPath: 'id' })`)

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('writes-db', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('items', 'readwrite')
      const store = tx.objectStore('items')
      store.add({ id: 1, name: 'first' })
      store.put({ id: 2, name: 'second' })
      store.delete(1)
      store.clear()
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    req.onerror = () => reject(req.error)
  }))

  await new Promise(r => setTimeout(r, 250))
  await handle.detach()

  const events = await readEvents(dir)
  const writes = events.filter((e: { type: string; metadata: { database?: string } }) =>
    e.type === 'idb.write' && e.metadata.database === 'writes-db'
  )
  expect(writes).toHaveLength(4)

  const ops = writes.map((e: { metadata: { operation: string } }) => e.metadata.operation)
  expect(ops).toEqual(['add', 'put', 'delete', 'clear'])

  for (const w of writes) {
    expect(w.metadata.outcome).toBe('success')
    expect(typeof w.metadata.transactionId).toBe('string')
    expect(w.metadata.transactionId.length).toBeGreaterThan(0)
  }

  // add and put have value assets; delete and clear do not.
  const add = writes[0]
  expect(add.assets).toHaveLength(1)
  const addValue = await readAsset(dir, add.assets[0].path)
  expect(addValue).toEqual({ id: 1, name: 'first' })

  const put = writes[1]
  expect(put.assets).toHaveLength(1)

  const del = writes[2]
  expect(del.assets ?? []).toHaveLength(0)
  expect(del.metadata.key).toBe(1)

  const clr = writes[3]
  expect(clr.assets ?? []).toHaveLength(0)
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "add/put/delete/clear"`
Expected: FAIL — no `idb.write` events.

- [ ] **Step 3: Patch IDBObjectStore.add/put/delete/clear**

Append to `BROWSER_SCRIPT`:

```js
  // ─── Object store writes ────────────────────────────────────────────────
  function txContext(store) {
    var tx = store.transaction;
    var transactionId = (tx && tx[TX_ID_KEY]) || 'unknown';
    var dbName = (tx && tx.db) ? String(tx.db.name) : '';
    return { transactionId: transactionId, database: dbName };
  }

  function wrapWriteRequest(req, base) {
    var requestedAt = performance.now();
    base.requestedAt = requestedAt;
    req.addEventListener('success', function() {
      base.completedAt = performance.now();
      base.outcome = 'success';
      if (base.operation === 'clear') {
        // affectedCount unknown — don't include
      }
      emit(base);
    });
    req.addEventListener('error', function() {
      base.completedAt = performance.now();
      base.outcome = 'error';
      base.error = req.error ? String(req.error.name + ': ' + req.error.message) : 'unknown';
      emit(base);
    });
  }

  function inferKey(store, value, explicitKey) {
    if (explicitKey !== undefined) return explicitKey;
    if (store.keyPath != null) {
      try {
        if (Array.isArray(store.keyPath)) {
          return store.keyPath.map(function(p) { return value && value[p]; });
        }
        return value && value[store.keyPath];
      } catch (_) { return undefined; }
    }
    return undefined;
  }

  var origAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function(value, key) {
    var ctx = txContext(this);
    var req = origAdd.apply(this, arguments);
    var inferred = inferKey(this, value, key);
    wrapWriteRequest(req, {
      kind: 'write', operation: 'add',
      database: ctx.database, objectStore: String(this.name),
      transactionId: ctx.transactionId,
      key: safeJSON(inferred),
      value: safeJSON(value),
    });
    return req;
  };

  var origPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value, key) {
    var ctx = txContext(this);
    var req = origPut.apply(this, arguments);
    var inferred = inferKey(this, value, key);
    wrapWriteRequest(req, {
      kind: 'write', operation: 'put',
      database: ctx.database, objectStore: String(this.name),
      transactionId: ctx.transactionId,
      key: safeJSON(inferred),
      value: safeJSON(value),
    });
    return req;
  };

  var origDelete = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function(key) {
    var ctx = txContext(this);
    var req = origDelete.apply(this, arguments);
    wrapWriteRequest(req, {
      kind: 'write', operation: 'delete',
      database: ctx.database, objectStore: String(this.name),
      transactionId: ctx.transactionId,
      key: safeJSON(key),
    });
    return req;
  };

  var origClear = IDBObjectStore.prototype.clear;
  IDBObjectStore.prototype.clear = function() {
    var ctx = txContext(this);
    var req = origClear.apply(this, arguments);
    wrapWriteRequest(req, {
      kind: 'write', operation: 'clear',
      database: ctx.database, objectStore: String(this.name),
      transactionId: ctx.transactionId,
    });
    return req;
  };
```

- [ ] **Step 4: Extend the server-side handler with write payloads (writes value to asset)**

Add to `PagePayload` and `handlePagePayload`:

```ts
      type WritePayload = {
        origin: string
        kind: 'write'
        operation: 'add' | 'put' | 'delete' | 'clear'
        database: string
        objectStore: string
        transactionId: string
        key?: unknown
        value?: unknown
        outcome: 'success' | 'error'
        error?: string
        requestedAt: number
        completedAt: number
      }

      type PagePayload =
        | DatabasePayload
        | SchemaPayload
        | TransactionPayload
        | WritePayload
```

Replace the synchronous `void ctx.emit(...)` calls inside `handlePagePayload` with awaitable versions where assets are involved. The function becomes async:

```ts
      async function handlePagePayload(payload: PagePayload): Promise<void> {
        if (!originAllowed(payload.origin)) return
        if (payload.kind === 'database') {
          if (databasesFilter && !databasesFilter.includes(payload.name)) return
          const md: {
            operation: 'open' | 'upgrade' | 'close' | 'delete'
            origin: string
            name: string
            oldVersion?: number
            newVersion?: number
            outcome?: 'success' | 'error' | 'blocked'
            error?: string
          } = {
            operation: payload.operation,
            origin: payload.origin,
            name: payload.name,
          }
          if (payload.oldVersion !== undefined) md.oldVersion = payload.oldVersion
          if (payload.newVersion !== undefined) md.newVersion = payload.newVersion
          if (payload.outcome) md.outcome = payload.outcome
          if (payload.error) md.error = payload.error
          await ctx.emit({ type: 'idb.database', metadata: md })
          return
        }
        if (payload.kind === 'schema') {
          if (databasesFilter && !databasesFilter.includes(payload.database)) return
          const md: {
            operation: 'createObjectStore' | 'deleteObjectStore' | 'createIndex' | 'deleteIndex'
            origin: string
            database: string
            objectStore: string
            index?: string
            keyPath?: string | string[] | null
            autoIncrement?: boolean
            unique?: boolean
            multiEntry?: boolean
          } = {
            operation: payload.operation,
            origin: payload.origin,
            database: payload.database,
            objectStore: payload.objectStore,
          }
          if (payload.index !== undefined) md.index = payload.index
          if (payload.keyPath !== undefined) md.keyPath = payload.keyPath
          if (payload.autoIncrement !== undefined) md.autoIncrement = payload.autoIncrement
          if (payload.unique !== undefined) md.unique = payload.unique
          if (payload.multiEntry !== undefined) md.multiEntry = payload.multiEntry
          await ctx.emit({ type: 'idb.schema', metadata: md })
          return
        }
        if (payload.kind === 'transaction') {
          if (databasesFilter && !databasesFilter.includes(payload.database)) return
          const md: {
            operation: 'begin' | 'complete' | 'abort' | 'error'
            origin: string
            database: string
            transactionId: string
            mode: 'readonly' | 'readwrite' | 'versionchange'
            objectStoreNames: string[]
            error?: string
          } = {
            operation: payload.operation,
            origin: payload.origin,
            database: payload.database,
            transactionId: payload.transactionId,
            mode: payload.mode,
            objectStoreNames: payload.objectStoreNames,
          }
          if (payload.error) md.error = payload.error
          await ctx.emit({ type: 'idb.transaction', metadata: md })
          return
        }
        if (payload.kind === 'write') {
          if (databasesFilter && !databasesFilter.includes(payload.database)) return
          const md: {
            operation: 'add' | 'put' | 'delete' | 'clear'
            origin: string
            database: string
            objectStore: string
            transactionId: string
            key?: unknown
            outcome: 'success' | 'error'
            error?: string
            requestedAt: number
            completedAt: number
          } = {
            operation: payload.operation,
            origin: payload.origin,
            database: payload.database,
            objectStore: payload.objectStore,
            transactionId: payload.transactionId,
            outcome: payload.outcome,
            requestedAt: payload.requestedAt,
            completedAt: payload.completedAt,
          }
          if (payload.key !== undefined) md.key = payload.key
          if (payload.error) md.error = payload.error

          const assets = []
          if (payload.value !== undefined && (payload.operation === 'add' || payload.operation === 'put')) {
            const ref = await ctx.writeAsset({
              kind: 'json',
              content: JSON.stringify(payload.value),
              ext: 'json',
            })
            assets.push(ref)
          }
          await ctx.emit({ type: 'idb.write', metadata: md, ...(assets.length && { assets }) })
          return
        }
      }
```

Update the `Runtime.bindingCalled` handler to await the (now async) handler — wrap the call in a tracked async op so the writer flushes:

```ts
      ctx.cdpSession.on('Runtime.bindingCalled', (rawParams) => {
        const params = rawParams as { name: string; payload: string }
        if (params.name !== BINDING_NAME) return
        ctx.track(async () => {
          try {
            const payload = JSON.parse(params.payload) as PagePayload
            await handlePagePayload(payload)
          } catch (err) {
            debug('binding parse/handle error', (err as Error).message)
          }
        })
      })
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "add/put/delete/clear"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/plugin-indexeddb
git commit -m "plugin-indexeddb: capture writes (add/put/delete/clear); values to assets"
```

---

## Task 9: Test + implement read capture (opt-in)

**Files:**
- Modify: `plugins/plugin-indexeddb/src/page-script.ts`
- Modify: `plugins/plugin-indexeddb/src/index.ts`
- Modify: `plugins/plugin-indexeddb/test/indexeddb.spec.ts`

- [ ] **Step 1: Append the test**

```ts
test('captures get and getAll when reads option is enabled', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB({ reads: true })] })

  await openDatabase(page, 'reads-db', 1, `db.createObjectStore('items', { keyPath: 'id' })`)

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('reads-db', 1)
    req.onsuccess = () => {
      const db = req.result
      const writeTx = db.transaction('items', 'readwrite')
      writeTx.objectStore('items').put({ id: 1, name: 'one' })
      writeTx.objectStore('items').put({ id: 2, name: 'two' })
      writeTx.oncomplete = () => {
        const readTx = db.transaction('items', 'readonly')
        const store = readTx.objectStore('items')
        store.get(1)
        store.getAll()
        readTx.oncomplete = () => { db.close(); resolve() }
        readTx.onerror = () => { db.close(); reject(readTx.error) }
      }
      writeTx.onerror = () => { db.close(); reject(writeTx.error) }
    }
    req.onerror = () => reject(req.error)
  }))

  await new Promise(r => setTimeout(r, 250))
  await handle.detach()

  const events = await readEvents(dir)
  const reads = events.filter((e: { type: string }) => e.type === 'idb.read')
  expect(reads.length).toBeGreaterThanOrEqual(2)

  const get = reads.find((e: { metadata: { operation: string } }) => e.metadata.operation === 'get')
  expect(get).toBeDefined()
  expect(get.assets).toHaveLength(1)
  const getResult = await readAsset(dir, get.assets[0].path)
  expect(getResult).toEqual({ id: 1, name: 'one' })

  const getAll = reads.find((e: { metadata: { operation: string } }) => e.metadata.operation === 'getAll')
  expect(getAll).toBeDefined()
  expect(getAll.metadata.count).toBe(2)
  expect(getAll.assets).toHaveLength(1)
  const getAllResult = await readAsset(dir, getAll.assets[0].path)
  expect(getAllResult).toHaveLength(2)
})

test('does not capture reads by default', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB()] })

  await openDatabase(page, 'no-reads-db', 1, `db.createObjectStore('items', { keyPath: 'id' })`)
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('no-reads-db', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('items', 'readonly')
      tx.objectStore('items').get(1)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    req.onerror = () => reject(req.error)
  }))

  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const reads = events.filter((e: { type: string }) => e.type === 'idb.read')
  expect(reads).toHaveLength(0)
})
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "get and getAll|does not capture reads"`
Expected: First fails, second passes (no reads emitted is what default does).

- [ ] **Step 3: Patch IDBObjectStore + IDBIndex read methods**

Append to `BROWSER_SCRIPT`:

```js
  // ─── Reads (opt-in) ────────────────────────────────────────────────────
  function wrapReadRequest(req, base) {
    var requestedAt = performance.now();
    base.requestedAt = requestedAt;
    req.addEventListener('success', function() {
      base.completedAt = performance.now();
      base.outcome = 'success';
      var result = req.result;
      if (base.operation === 'count') {
        base.count = typeof result === 'number' ? result : undefined;
      } else if (base.operation === 'getAll' || base.operation === 'getAllKeys') {
        base.count = Array.isArray(result) ? result.length : undefined;
        base.value = safeJSON(result);
      } else if (base.operation === 'openCursor' || base.operation === 'openKeyCursor') {
        // Cursor results: emit one event per advance.
        if (result == null) {
          base.value = null;
          emit(base);
          return;
        }
        // First advance: emit, then subscribe to subsequent advances.
        var advanceCount = 0;
        var emitCursor = function() {
          var snapshot = Object.assign({}, base);
          snapshot.completedAt = performance.now();
          snapshot.value = safeJSON({ key: result.key, primaryKey: result.primaryKey, value: result.value });
          snapshot.count = ++advanceCount;
          emit(snapshot);
        };
        emitCursor();
        var origContinue = result.continue;
        result.continue = function() {
          var ret = origContinue.apply(result, arguments);
          // Re-listen on the request for next advance.
          var onNext = function() {
            req.removeEventListener('success', onNext);
            if (req.result == null) return;
            emitCursor();
            req.addEventListener('success', onNext);
          };
          req.addEventListener('success', onNext);
          return ret;
        };
        return;
      } else {
        // get / getKey
        base.value = safeJSON(result);
      }
      emit(base);
    });
    req.addEventListener('error', function() {
      base.completedAt = performance.now();
      base.outcome = 'error';
      base.error = req.error ? String(req.error.name + ': ' + req.error.message) : 'unknown';
      emit(base);
    });
  }

  function readPatchFor(proto, isIndex) {
    var origGet = proto.get;
    proto.get = function(key) {
      if (!settings.reads) return origGet.apply(this, arguments);
      var ctx = txContext(isIndex ? this.objectStore : this);
      var req = origGet.apply(this, arguments);
      wrapReadRequest(req, {
        kind: 'read', operation: 'get',
        database: ctx.database,
        objectStore: String(isIndex ? this.objectStore.name : this.name),
        index: isIndex ? String(this.name) : undefined,
        transactionId: ctx.transactionId,
        query: safeJSON(key),
      });
      return req;
    };

    var origGetAll = proto.getAll;
    if (origGetAll) {
      proto.getAll = function() {
        if (!settings.reads) return origGetAll.apply(this, arguments);
        var ctx = txContext(isIndex ? this.objectStore : this);
        var req = origGetAll.apply(this, arguments);
        wrapReadRequest(req, {
          kind: 'read', operation: 'getAll',
          database: ctx.database,
          objectStore: String(isIndex ? this.objectStore.name : this.name),
          index: isIndex ? String(this.name) : undefined,
          transactionId: ctx.transactionId,
          query: safeJSON(arguments[0]),
        });
        return req;
      };
    }

    var origGetKey = proto.getKey;
    if (origGetKey) {
      proto.getKey = function(key) {
        if (!settings.reads) return origGetKey.apply(this, arguments);
        var ctx = txContext(isIndex ? this.objectStore : this);
        var req = origGetKey.apply(this, arguments);
        wrapReadRequest(req, {
          kind: 'read', operation: 'getKey',
          database: ctx.database,
          objectStore: String(isIndex ? this.objectStore.name : this.name),
          index: isIndex ? String(this.name) : undefined,
          transactionId: ctx.transactionId,
          query: safeJSON(key),
        });
        return req;
      };
    }

    var origGetAllKeys = proto.getAllKeys;
    if (origGetAllKeys) {
      proto.getAllKeys = function() {
        if (!settings.reads) return origGetAllKeys.apply(this, arguments);
        var ctx = txContext(isIndex ? this.objectStore : this);
        var req = origGetAllKeys.apply(this, arguments);
        wrapReadRequest(req, {
          kind: 'read', operation: 'getAllKeys',
          database: ctx.database,
          objectStore: String(isIndex ? this.objectStore.name : this.name),
          index: isIndex ? String(this.name) : undefined,
          transactionId: ctx.transactionId,
          query: safeJSON(arguments[0]),
        });
        return req;
      };
    }

    var origCount = proto.count;
    if (origCount) {
      proto.count = function() {
        if (!settings.reads) return origCount.apply(this, arguments);
        var ctx = txContext(isIndex ? this.objectStore : this);
        var req = origCount.apply(this, arguments);
        wrapReadRequest(req, {
          kind: 'read', operation: 'count',
          database: ctx.database,
          objectStore: String(isIndex ? this.objectStore.name : this.name),
          index: isIndex ? String(this.name) : undefined,
          transactionId: ctx.transactionId,
          query: safeJSON(arguments[0]),
        });
        return req;
      };
    }

    var origOpenCursor = proto.openCursor;
    if (origOpenCursor) {
      proto.openCursor = function() {
        if (!settings.reads) return origOpenCursor.apply(this, arguments);
        var ctx = txContext(isIndex ? this.objectStore : this);
        var req = origOpenCursor.apply(this, arguments);
        wrapReadRequest(req, {
          kind: 'read', operation: 'openCursor',
          database: ctx.database,
          objectStore: String(isIndex ? this.objectStore.name : this.name),
          index: isIndex ? String(this.name) : undefined,
          transactionId: ctx.transactionId,
          query: safeJSON(arguments[0]),
        });
        return req;
      };
    }

    var origOpenKeyCursor = proto.openKeyCursor;
    if (origOpenKeyCursor) {
      proto.openKeyCursor = function() {
        if (!settings.reads) return origOpenKeyCursor.apply(this, arguments);
        var ctx = txContext(isIndex ? this.objectStore : this);
        var req = origOpenKeyCursor.apply(this, arguments);
        wrapReadRequest(req, {
          kind: 'read', operation: 'openKeyCursor',
          database: ctx.database,
          objectStore: String(isIndex ? this.objectStore.name : this.name),
          index: isIndex ? String(this.name) : undefined,
          transactionId: ctx.transactionId,
          query: safeJSON(arguments[0]),
        });
        return req;
      };
    }
  }

  readPatchFor(IDBObjectStore.prototype, false);
  readPatchFor(IDBIndex.prototype, true);
```

- [ ] **Step 4: Extend the server-side handler with read payloads**

Add to `PagePayload` and `handlePagePayload`:

```ts
      type ReadPayload = {
        origin: string
        kind: 'read'
        operation: 'get' | 'getAll' | 'getKey' | 'getAllKeys' | 'count' | 'openCursor' | 'openKeyCursor'
        database: string
        objectStore: string
        index?: string
        transactionId: string
        query?: unknown
        value?: unknown
        count?: number
        outcome: 'success' | 'error'
        error?: string
        requestedAt: number
        completedAt: number
      }

      type PagePayload =
        | DatabasePayload
        | SchemaPayload
        | TransactionPayload
        | WritePayload
        | ReadPayload
```

Add a branch in `handlePagePayload`, after the write branch:

```ts
        if (payload.kind === 'read') {
          if (!captureReads) return
          if (databasesFilter && !databasesFilter.includes(payload.database)) return
          const md: {
            operation: ReadPayload['operation']
            origin: string
            database: string
            objectStore: string
            index?: string
            transactionId: string
            query?: unknown
            count?: number
            outcome: 'success' | 'error'
            error?: string
            requestedAt: number
            completedAt: number
          } = {
            operation: payload.operation,
            origin: payload.origin,
            database: payload.database,
            objectStore: payload.objectStore,
            transactionId: payload.transactionId,
            outcome: payload.outcome,
            requestedAt: payload.requestedAt,
            completedAt: payload.completedAt,
          }
          if (payload.index !== undefined) md.index = payload.index
          if (payload.query !== undefined) md.query = payload.query
          if (payload.count !== undefined) md.count = payload.count
          if (payload.error) md.error = payload.error

          const assets = []
          if (payload.value !== undefined) {
            const ref = await ctx.writeAsset({
              kind: 'json',
              content: JSON.stringify(payload.value),
              ext: 'json',
            })
            assets.push(ref)
          }
          await ctx.emit({ type: 'idb.read', metadata: md, ...(assets.length && { assets }) })
          return
        }
```

- [ ] **Step 5: Run the tests, verify both pass**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "get and getAll|does not capture reads"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/plugin-indexeddb
git commit -m "plugin-indexeddb: capture reads (opt-in) including cursors"
```

---

## Task 10: Test + implement bus-triggered snapshots (manual / js.error / detach) and dataSnapshots option

**Files:**
- Modify: `plugins/plugin-indexeddb/src/index.ts`
- Modify: `plugins/plugin-indexeddb/test/indexeddb.spec.ts`

- [ ] **Step 1: Append the bus tests**

```ts
import { jsError } from '@introspection/plugin-js-error'

test('emits a snapshot on handle.snapshot()', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB()] })

  await openDatabase(page, 'snap-db', 1, `db.createObjectStore('items', { keyPath: 'id' })`)
  await handle.snapshot()
  await new Promise(r => setTimeout(r, 150))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'idb.snapshot')

  const manual = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'manual')
  expect(manual).toBeDefined()
  expect(manual.metadata.databases.some((d: { name: string }) => d.name === 'snap-db')).toBe(true)

  const detach = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'detach')
  expect(detach).toBeDefined()
})

test('emits a snapshot on js.error', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB(), jsError()] })

  await page.evaluate(() => { setTimeout(() => { throw new Error('boom') }, 0) })
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'idb.snapshot')
  const onError = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'js.error')
  expect(onError).toBeDefined()
})

test('dataSnapshots: true includes store records on the snapshot asset', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB({ dataSnapshots: true })] })

  await openDatabase(page, 'data-snap-db', 1, `db.createObjectStore('items', { keyPath: 'id' })`)
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('data-snap-db', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('items', 'readwrite')
      tx.objectStore('items').put({ id: 'a', val: 1 })
      tx.objectStore('items').put({ id: 'b', val: 2 })
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  }))

  await handle.snapshot()
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const manual = events.find((e: { type: string; metadata: { trigger: string } }) =>
    e.type === 'idb.snapshot' && e.metadata.trigger === 'manual'
  )
  expect(manual).toBeDefined()
  expect(manual.assets).toHaveLength(1)

  const data = await readAsset(dir, manual.assets[0].path)
  // Asset shape: Array<{ database, objectStore, records }>
  const dataDb = data.find((d: { database: string }) => d.database === 'data-snap-db')
  expect(dataDb).toBeDefined()
  const items = dataDb.records
  expect(items.map((r: { key: string }) => r.key).sort()).toEqual(['a', 'b'])
})
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "snapshot on|dataSnapshots"`
Expected: FAIL — bus subscriptions not wired and `dataSnapshots` not implemented.

- [ ] **Step 3: Wire bus subscriptions and the `dataSnapshots` option**

In `plugins/plugin-indexeddb/src/index.ts`, replace the `snapshotOnce` definition with one that supports data snapshots and writes records to an asset:

```ts
      async function snapshotOnce(trigger: SnapshotTrigger): Promise<void> {
        const targetOrigins = origins.includes('*')
          ? (topOrigin ? [topOrigin] : [])
          : origins
        for (const origin of targetOrigins) {
          if (!originAllowed(origin)) continue

          let names: string[] = []
          try {
            const r = await ctx.cdpSession.send('IndexedDB.requestDatabaseNames', {
              securityOrigin: origin,
            }) as { databaseNames: string[] }
            names = r.databaseNames
          } catch (err) {
            debug('requestDatabaseNames failed', origin, (err as Error).message)
            continue
          }

          if (databasesFilter) names = names.filter(n => databasesFilter.includes(n))

          const databases: Array<{
            name: string
            version: number
            objectStores: Array<{
              name: string
              keyPath: string | string[] | null
              autoIncrement: boolean
              indexes: Array<{ name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }>
            }>
          }> = []

          const dataPayload: Array<{
            database: string
            objectStore: string
            records: Array<{ key: unknown; value: unknown }>
          }> = []

          for (const name of names) {
            try {
              const r = await ctx.cdpSession.send('IndexedDB.requestDatabase', {
                securityOrigin: origin, databaseName: name,
              }) as { databaseWithObjectStores: CdpDatabaseWithStores }
              const db = r.databaseWithObjectStores
              databases.push({
                name: db.name,
                version: db.version,
                objectStores: db.objectStores.map(s => ({
                  name: s.name,
                  keyPath: unwrapKeyPath(s.keyPath),
                  autoIncrement: s.autoIncrement,
                  indexes: s.indexes.map(i => ({
                    name: i.name,
                    keyPath: (unwrapKeyPath(i.keyPath) ?? '') as string | string[],
                    unique: i.unique,
                    multiEntry: i.multiEntry,
                  })),
                })),
              })

              if (dataSnapshots) {
                for (const store of db.objectStores) {
                  const records: Array<{ key: unknown; value: unknown }> = []
                  let skipCount = 0
                  let hasMore = true
                  const PAGE = 1000
                  const HARD_CAP = 50_000
                  while (hasMore && records.length < HARD_CAP) {
                    const r2 = await ctx.cdpSession.send('IndexedDB.requestData', {
                      securityOrigin: origin, databaseName: name, objectStoreName: store.name,
                      indexName: '', skipCount, pageSize: PAGE,
                    }) as { objectStoreDataEntries: Array<{ key: { value: unknown }; primaryKey: { value: unknown }; value: { value: unknown } }>; hasMore: boolean }
                    for (const e of r2.objectStoreDataEntries) {
                      records.push({ key: e.primaryKey?.value ?? e.key?.value, value: e.value?.value })
                    }
                    skipCount += r2.objectStoreDataEntries.length
                    hasMore = r2.hasMore
                  }
                  dataPayload.push({ database: name, objectStore: store.name, records })
                }
              }
            } catch (err) {
              debug('requestDatabase/data failed', origin, name, (err as Error).message)
            }
          }

          const event: { type: 'idb.snapshot'; metadata: { trigger: SnapshotTrigger; origin: string; databases: typeof databases }; assets?: import('@introspection/types').AssetRef[] } = {
            type: 'idb.snapshot',
            metadata: { trigger, origin, databases },
          }
          if (dataSnapshots) {
            const ref = await ctx.writeAsset({
              kind: 'json',
              content: JSON.stringify(dataPayload),
              ext: 'json',
            })
            event.assets = [ref]
          }
          await ctx.emit(event)
        }
      }
```

Append the bus subscriptions at the very end of `install()` (after `snapshotOnce('install')`):

```ts
      ctx.bus.on('manual', async () => {
        debug('snapshot triggered: manual')
        await snapshotOnce('manual')
      })
      ctx.bus.on('js.error', async () => {
        debug('snapshot triggered: js.error')
        await snapshotOnce('js.error')
      })
      ctx.bus.on('detach', async () => {
        debug('snapshot triggered: detach')
        await snapshotOnce('detach')
      })
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "snapshot on|dataSnapshots"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-indexeddb
git commit -m "plugin-indexeddb: bus-triggered snapshots + dataSnapshots option"
```

---

## Task 11: Test + verify databases-filter option

**Files:**
- Modify: `plugins/plugin-indexeddb/test/indexeddb.spec.ts`

The implementation already filters by `databasesFilter` in every emit branch and in the snapshot loop. We just need a test.

- [ ] **Step 1: Append the test**

```ts
test('databases option restricts capture and snapshot to the listed db', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, {
    outDir: dir,
    plugins: [indexedDB({ databases: ['only-this-db'] })],
  })

  await openDatabase(page, 'only-this-db', 1, `db.createObjectStore('a', { keyPath: 'id' })`)
  await openDatabase(page, 'ignore-me', 1, `db.createObjectStore('b', { keyPath: 'id' })`)

  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const dbEvents = events.filter((e: { type: string }) => e.type === 'idb.database')
  for (const e of dbEvents) {
    expect(e.metadata.name).toBe('only-this-db')
  }

  const installSnapshot = events.find((e: { type: string; metadata: { trigger: string } }) =>
    e.type === 'idb.snapshot' && e.metadata.trigger === 'install'
  )
  expect(installSnapshot).toBeDefined()
  // The install snapshot ran before either db existed (we attached first),
  // so this assertion is about the detach snapshot.
  const detach = events.find((e: { type: string; metadata: { trigger: string } }) =>
    e.type === 'idb.snapshot' && e.metadata.trigger === 'detach'
  )
  expect(detach).toBeDefined()
  expect(detach.metadata.databases.map((d: { name: string }) => d.name)).toEqual(['only-this-db'])
})
```

- [ ] **Step 2: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test -g "databases option"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add plugins/plugin-indexeddb/test/indexeddb.spec.ts
git commit -m "plugin-indexeddb: test databases-filter option"
```

---

## Task 12: Flip `plugin-web-storage` default `origins` to `['*']`

**Files:**
- Modify: `plugins/plugin-web-storage/src/index.ts`
- Modify: `plugins/plugin-web-storage/README.md`
- Modify: `plugins/plugin-web-storage/test/web-storage.spec.ts`

- [ ] **Step 1: Update the default in `plugin-web-storage/src/index.ts`**

Find the lines (near the top of `webStorage()`):

```ts
  const explicitOrigins = options?.origins
```

Replace the `originAllowed` function and the `snapshotOnce` `targetOrigins` line so the default is `['*']`. The new behaviour:

```ts
  const origins = options?.origins ?? ['*']
  // ...
  function originAllowed(origin: string): boolean {
    if (origins.includes('*')) return true
    return origins.includes(origin)
  }
```

In the existing `snapshotOnce`, replace:

```ts
        const targetOrigins = explicitOrigins ?? (topOrigin ? [topOrigin] : [])
```

with:

```ts
        const targetOrigins = origins.includes('*')
          ? (topOrigin ? [topOrigin] : [])
          : origins
```

Replace any remaining references to `explicitOrigins` with `origins`. The `topOrigin` tracking stays — when `'*'` is the only entry, we still need a concrete origin to query for snapshots.

- [ ] **Step 2: Update the README**

Replace the `origins` row in the options table in `plugins/plugin-web-storage/README.md`:

```markdown
| `origins` | `string[]` | `['*']` (all origins) | Restrict capture to specific origins. The literal `'*'` matches everything. |
```

- [ ] **Step 3: Update the existing top-frame-origin test**

In `plugins/plugin-web-storage/test/web-storage.spec.ts`, find the test:

```ts
test('default filter: top-frame origin is captured', async ({ page }) => {
```

Rename and adjust its assertion to reflect the new default. Replace the test body so it asserts that any origin is captured (because `['*']` is now the default):

```ts
test('default filter: all origins captured (default ["*"])', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [webStorage()] })

  await page.evaluate(() => localStorage.setItem('top', '1'))
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const writes = events.filter((e: { type: string; metadata: { key?: string } }) =>
    e.type === 'webStorage.write' && e.metadata.key === 'top'
  )
  expect(writes).toHaveLength(1)
})
```

(The other origin-filter test — `explicit origins option excludes writes from non-listed origins` — still works as-is and remains the negative-case verification.)

- [ ] **Step 4: Run plugin-web-storage tests**

Run: `pnpm --filter @introspection/plugin-web-storage exec playwright test`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-web-storage
git commit -m "plugin-web-storage: default origins to ['*'] for consistency with plugin-indexeddb"
```

---

## Task 13: Write the README

**Files:**
- Create: `plugins/plugin-indexeddb/README.md`

- [ ] **Step 1: Write the README**

```markdown
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

\`\`\`bash
pnpm add -D @introspection/plugin-indexeddb
\`\`\`

## Usage

\`\`\`ts
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
\`\`\`

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

Snapshots are queried server-side via CDP `IndexedDB.requestDatabaseNames` / `requestDatabase` (and, when `dataSnapshots: true`, `requestData`), so they include databases on disk from prior traces. They're emitted automatically at install and whenever the introspection runtime fires `manual`, `js.error`, or `detach` on the bus — no API to call.

## Caveats

The plugin captures by patching the IndexedDB prototypes. This is robust against every realistic call site, but has the same realm-crossing limitation as every prototype-patching plugin in this repo: see [`docs/prototype-patching-limits.md`](../../docs/prototype-patching-limits.md). In practice, no application code triggers it.

`Storage.prototype` aside: `IDBObjectStore.prototype.put.toString()` etc. no longer return `[native code]` while the plugin is attached. Apps that sniff this will see our wrapper.

Holding an `IDBObjectStore` reference across transactions (illegal per spec but possible at runtime for raw references) results in writes tagged `transactionId: 'unknown'`.

Cursor walks on huge stores emit one event per advance. With `reads: true` enabled, walking a 1M-record store produces 1M events — opt in deliberately.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/plugin-indexeddb/README.md
git commit -m "plugin-indexeddb: README"
```

---

## Task 14: Final verification

- [ ] **Step 1: Workspace-wide typecheck**

Run: `pnpm -r typecheck`
Expected: all packages PASS.

- [ ] **Step 2: Workspace-wide build**

Run: `pnpm -r build`
Expected: all packages build cleanly.

- [ ] **Step 3: Run plugin-indexeddb tests**

Run: `pnpm --filter @introspection/plugin-indexeddb exec playwright test`
Expected: all tests PASS (≥10).

- [ ] **Step 4: Run plugin-web-storage tests (regression check)**

Run: `pnpm --filter @introspection/plugin-web-storage exec playwright test`
Expected: all 8 tests PASS.

- [ ] **Step 5: Final commit (only if cleanup is needed)**

If the verification surfaces any fixes, commit them with a focused message. Otherwise no commit needed.

---

## Self-review notes (carried out at write time)

- **Spec coverage:** every section of the spec maps to a task. Public API → Task 2; event types → Task 1; capture mechanism (page-side patching) → Tasks 4-9; install snapshot → Task 3; bus snapshots → Task 10; data snapshots option → Task 10; databases filter → Task 11; origin filter → Task 12 (web-storage default flip is bundled here); README + caveats → Task 13.
- **Type consistency:** `indexedDB` factory name, `IndexedDBOptions`, `idb.*` event types, `__introspection_plugin_indexeddb` binding name, `TX_ID_KEY = '__introspection_idb_tx_id__'`, and the `kind` discriminators (`'database' | 'schema' | 'transaction' | 'write' | 'read'`) are used consistently across all tasks.
- **No placeholders:** every code block contains real code, every command has expected output. The page script is built up over tasks 4-9; each step gives the exact insertion point and code.
- **Transaction id propagation gotcha:** the implementation relies on `IDBTransaction` carrying a hidden `__introspection_idb_tx_id__` property set by our `IDBDatabase.transaction` patch (and also by the `upgradeneeded` patch for versionchange transactions). All write/read patches read it via `txContext`. This is an explicit design decision — documented in the spec and risks section.
- **Async handler:** Task 8 turns `handlePagePayload` async (because writes call `ctx.writeAsset`) and routes binding calls through `ctx.track(...)` so the writer flushes before detach. Read handler in Task 9 follows the same pattern.
- **Known gap:** if a page holds an `IDBObjectStore` reference across transactions and the wrapped `transaction.objectStore(name)` returns a different reference each time, the second call's ops will tag `transactionId: 'unknown'`. Spec accepts this; not in scope to fix.

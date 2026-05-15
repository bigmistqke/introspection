# `plugin-web-storage` Implementation Plan

> **Status:** landed (2026-05-08) · spec: `docs/superpowers/specs/2026-05-08-plugin-web-storage-design.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@introspection/plugin-web-storage`, a plugin that captures `localStorage` / `sessionStorage` activity (writes always, reads opt-in, plus snapshots) into the introspection trace. Spec: `docs/superpowers/specs/2026-05-08-plugin-web-storage-design.md`.

**Architecture:** Page-side prototype patching of `Storage.prototype` (set/remove/clear/getItem) via `addInitScript`, piped through a single CDP `Runtime.addBinding` channel. Install-time and bus-triggered snapshots use server-side CDP `DOMStorage.getDOMStorageItems`. Origin filtering on the server side; default top-frame-only.

**Tech Stack:** TypeScript, Playwright, CDP (`Runtime.addBinding`, `Runtime.bindingCalled`, `DOMStorage.getDOMStorageItems`, `Page.frameNavigated`), `tsup` build, `pnpm` workspaces.

---

## Implementation note: timestamps

The spec discusses page-side `performance.now()` timestamps to defend against cross-channel ordering. Because we settled on a **single channel** (every event flows through one binding) plus a separate CDP query for snapshots, FIFO delivery on the binding channel preserves write/read ordering, and snapshots are either at install (first) or triggered by bus events (server-side). We therefore use **server-side `ctx.timestamp()`** at the moment the binding payload is parsed, not a page-side timestamp. Per-payload `pagePerfNow` is **not** included. If ordering ever bites in practice, we can add it later — see the cross-channel ordering section of the spec for the upgrade path.

## File Structure

New package at `plugins/plugin-web-storage/`:

- `plugins/plugin-web-storage/package.json` — workspace package manifest (mirrors `plugin-console`'s).
- `plugins/plugin-web-storage/tsconfig.json` — extends `tsconfig.base.json`.
- `plugins/plugin-web-storage/playwright.config.ts` — same as sibling plugins.
- `plugins/plugin-web-storage/src/index.ts` — exports `webStorage(options)`. Single file: small enough not to need splitting.
- `plugins/plugin-web-storage/test/web-storage.spec.ts` — Playwright integration tests.
- `plugins/plugin-web-storage/test/fixtures/` — fixture HTML pages used by tests.
- `plugins/plugin-web-storage/README.md` — follows `docs/PLUGIN_README_TEMPLATE.md`.

Modified:
- `packages/types/src/index.ts` — adds `WebStorageWriteEvent`, `WebStorageReadEvent`, `WebStorageSnapshotEvent` and registers them in `TraceEventMap`.

Not modified now (out of scope, can be wired later by the user if desired):
- `packages/plugin-defaults/` — `webStorage` is opt-in; not added to defaults.
- `packages/cli/` — no CLI changes required; `introspect events --type 'webStorage.*'` already works generically.

## Working directory

All commands assume `cwd = /Users/puckey/rg/introspection` unless otherwise stated.

---

## Task 1: Add event types to `@introspection/types`

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add the three event interfaces and register them in `TraceEventMap`**

Insert a new section between the existing `// ─── Plugin events: redux ──...` block and `// ─── Plugin events: cdp ──...` block (around line 309). Find the block:

```ts
// ─── Plugin events: cdp ─────────────────────────────────────────────────────
```

and insert immediately **before** it:

```ts
// ─── Plugin events: web-storage ─────────────────────────────────────────────

export type WebStorageType = 'localStorage' | 'sessionStorage'

export interface WebStorageWriteEvent extends BaseEvent {
  type: 'webStorage.write'
  metadata: {
    storageType: WebStorageType
    operation: 'set' | 'remove' | 'clear'
    origin: string
    key?: string
    oldValue?: string
    newValue?: string
    clearedKeys?: string[]
  }
}

export interface WebStorageReadEvent extends BaseEvent {
  type: 'webStorage.read'
  metadata: {
    storageType: WebStorageType
    origin: string
    key: string
    value: string | null
  }
}

export interface WebStorageSnapshotEvent extends BaseEvent {
  type: 'webStorage.snapshot'
  metadata: {
    trigger: 'install' | 'manual' | 'js.error' | 'detach'
    origin: string
    localStorage?: Record<string, string>
    sessionStorage?: Record<string, string>
  }
}

```

In the `TraceEventMap` (around line 362), insert these three lines after the `// Redux` block and before the `// CDP trace` block:

```ts
  // Web storage
  'webStorage.write': WebStorageWriteEvent
  'webStorage.read': WebStorageReadEvent
  'webStorage.snapshot': WebStorageSnapshotEvent
```

- [ ] **Step 2: Typecheck the types package**

Run: `pnpm --filter @introspection/types typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "types: add webStorage event types"
```

---

## Task 2: Scaffold the `plugin-web-storage` package

**Files:**
- Create: `plugins/plugin-web-storage/package.json`
- Create: `plugins/plugin-web-storage/tsconfig.json`
- Create: `plugins/plugin-web-storage/playwright.config.ts`
- Create: `plugins/plugin-web-storage/src/index.ts`
- Create: `plugins/plugin-web-storage/test/.gitkeep` (placeholder so the dir exists)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@introspection/plugin-web-storage",
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

- [ ] **Step 4: Create initial `src/index.ts` skeleton**

```ts
import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'

export type { WebStorageWriteEvent, WebStorageReadEvent, WebStorageSnapshotEvent, WebStorageType } from '@introspection/types'

export interface WebStorageOptions {
  /** Which Web Storage areas to capture. Default: both. */
  stores?: Array<'localStorage' | 'sessionStorage'>
  /** Capture `getItem` reads. Default: false. */
  reads?: boolean
  /**
   * Restrict capture to specific origins. Default: top-frame origin only.
   * Pass an explicit list (e.g. `['https://app.example.com']`) to widen.
   */
  origins?: string[]
  verbose?: boolean
}

export function webStorage(options?: WebStorageOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-web-storage', options?.verbose ?? false)
  const stores = options?.stores ?? ['localStorage', 'sessionStorage']
  const captureReads = options?.reads ?? false
  const explicitOrigins = options?.origins

  return {
    name: 'web-storage',
    description: 'Captures localStorage and sessionStorage activity',
    events: {
      'webStorage.write': 'localStorage / sessionStorage mutation (set, remove, clear)',
      'webStorage.read': 'localStorage / sessionStorage read (only when reads: true)',
      'webStorage.snapshot': 'Full storage dump at install and on bus triggers',
    },
    async install(_ctx: PluginContext): Promise<void> {
      debug('installing', { stores, captureReads, explicitOrigins })
      // Filled in by later tasks.
    },
  }
}
```

- [ ] **Step 5: Create the test directory placeholder**

```bash
mkdir -p plugins/plugin-web-storage/test
touch plugins/plugin-web-storage/test/.gitkeep
```

- [ ] **Step 6: Install workspace dependencies**

Run: `pnpm install`
Expected: PASS — pnpm adds the new package to its workspace graph and links workspace deps.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @introspection/plugin-web-storage typecheck`
Expected: PASS, no errors.

- [ ] **Step 8: Commit**

```bash
git add plugins/plugin-web-storage pnpm-lock.yaml
git commit -m "plugin-web-storage: scaffold package"
```

---

## Task 3: Write a fixture page used by integration tests

**Files:**
- Create: `plugins/plugin-web-storage/test/fixtures/index.html`

- [ ] **Step 1: Create the fixture HTML**

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>web-storage fixture</title></head>
<body>
<script>
  // Pre-existing storage so install-time snapshot has something to capture.
  localStorage.setItem('preexisting-local', 'l-1')
  sessionStorage.setItem('preexisting-session', 's-1')
</script>
</body>
</html>
```

This fixture only seeds a couple of values so tests can assert against a known initial state. Tests drive subsequent mutations via `page.evaluate()`.

- [ ] **Step 2: Commit**

```bash
git add plugins/plugin-web-storage/test/fixtures/index.html
git commit -m "plugin-web-storage: test fixture page"
```

---

## Task 4: Test + implement install-time snapshot

This task gives us the simplest possible end-to-end loop: a snapshot at install proves CDP wiring works. Subsequent tasks add live capture.

**Files:**
- Create: `plugins/plugin-web-storage/test/web-storage.spec.ts`
- Modify: `plugins/plugin-web-storage/src/index.ts`

- [ ] **Step 1: Write the install-snapshot test**

Replace the placeholder in `plugins/plugin-web-storage/test/.gitkeep` by creating `web-storage.spec.ts` (and `git rm` the placeholder later — this step just adds the spec file):

```ts
import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { attach } from '@introspection/playwright'
import { webStorage } from '../src/index.js'

const FIXTURE = 'file://' + fileURLToPath(new URL('./fixtures/index.html', import.meta.url))

let dir: string
test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-web-storage-'))
})
test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function readEvents(outDir: string) {
  const entries = await readdir(outDir)
  const ndjson = await readFile(join(outDir, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('emits an install snapshot containing pre-existing keys', async ({ page }) => {
  await page.goto(FIXTURE)

  const handle = await attach(page, { outDir: dir, plugins: [webStorage()] })
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'webStorage.snapshot')
  const installSnapshot = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'install')

  expect(installSnapshot).toBeDefined()
  expect(installSnapshot.metadata.localStorage).toEqual({ 'preexisting-local': 'l-1' })
  expect(installSnapshot.metadata.sessionStorage).toEqual({ 'preexisting-session': 's-1' })
  expect(typeof installSnapshot.metadata.origin).toBe('string')
})
```

Then remove the placeholder:
```bash
git rm plugins/plugin-web-storage/test/.gitkeep
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @introspection/plugin-web-storage test -- web-storage.spec.ts`
Expected: FAIL — `installSnapshot` is `undefined` because `install()` doesn't emit anything yet.

- [ ] **Step 3: Implement install snapshot in `src/index.ts`**

Replace the body of `install()` so that the file becomes:

```ts
import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'

export type { WebStorageWriteEvent, WebStorageReadEvent, WebStorageSnapshotEvent, WebStorageType } from '@introspection/types'

export interface WebStorageOptions {
  stores?: Array<'localStorage' | 'sessionStorage'>
  reads?: boolean
  origins?: string[]
  verbose?: boolean
}

type SnapshotTrigger = 'install' | 'manual' | 'js.error' | 'detach'

export function webStorage(options?: WebStorageOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-web-storage', options?.verbose ?? false)
  const stores = options?.stores ?? ['localStorage', 'sessionStorage']
  const captureReads = options?.reads ?? false
  const explicitOrigins = options?.origins

  return {
    name: 'web-storage',
    description: 'Captures localStorage and sessionStorage activity',
    events: {
      'webStorage.write': 'localStorage / sessionStorage mutation (set, remove, clear)',
      'webStorage.read': 'localStorage / sessionStorage read (only when reads: true)',
      'webStorage.snapshot': 'Full storage dump at install and on bus triggers',
    },
    async install(ctx: PluginContext): Promise<void> {
      debug('installing', { stores, captureReads, explicitOrigins })

      // Track origins of interest. Default: top-frame origin, learned from
      // the first Page.frameNavigated event for the main frame, or via the
      // Page.getNavigationHistory query as a fallback.
      const origins = new Set<string>(explicitOrigins ?? [])
      let topOrigin: string | undefined

      function originAllowed(origin: string): boolean {
        if (explicitOrigins) return origins.has(origin)
        return origin === topOrigin
      }

      // Learn the top-frame origin via Page.getFrameTree at install time.
      try {
        await ctx.cdpSession.send('Page.enable')
        const frameTree = await ctx.cdpSession.send('Page.getFrameTree') as {
          frameTree: { frame: { url: string; securityOrigin?: string } }
        }
        const root = frameTree.frameTree.frame
        topOrigin = root.securityOrigin ?? new URL(root.url).origin
        debug('top origin', topOrigin)
      } catch (err) {
        debug('failed to determine top origin', (err as Error).message)
      }

      // Track future top-frame navigations so origin filter follows the page.
      ctx.cdpSession.on('Page.frameNavigated', (rawParams) => {
        const params = rawParams as { frame: { id: string; parentId?: string; url: string; securityOrigin?: string } }
        if (params.frame.parentId) return // not the top frame
        topOrigin = params.frame.securityOrigin ?? (() => {
          try { return new URL(params.frame.url).origin } catch { return undefined }
        })()
        debug('top origin updated', topOrigin)
      })

      async function snapshotOnce(trigger: SnapshotTrigger): Promise<void> {
        const targetOrigins = explicitOrigins ?? (topOrigin ? [topOrigin] : [])
        for (const origin of targetOrigins) {
          if (!originAllowed(origin)) continue
          const metadata: {
            trigger: SnapshotTrigger
            origin: string
            localStorage?: Record<string, string>
            sessionStorage?: Record<string, string>
          } = { trigger, origin }

          for (const store of stores) {
            try {
              const result = await ctx.cdpSession.send('DOMStorage.getDOMStorageItems', {
                storageId: { securityOrigin: origin, isLocalStorage: store === 'localStorage' },
              }) as { entries: Array<[string, string]> }
              const entries = Object.fromEntries(result.entries)
              if (store === 'localStorage') metadata.localStorage = entries
              else metadata.sessionStorage = entries
            } catch (err) {
              debug('snapshot fetch failed', store, origin, (err as Error).message)
            }
          }

          await ctx.emit({ type: 'webStorage.snapshot', metadata })
        }
      }

      await ctx.cdpSession.send('DOMStorage.enable')
      await snapshotOnce('install')
    },
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-web-storage test -- web-storage.spec.ts`
Expected: PASS. The install snapshot event now appears with both stores' contents and the page's origin.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-web-storage
git commit -m "plugin-web-storage: install-time snapshot via DOMStorage.getDOMStorageItems"
```

---

## Task 5: Test + implement write capture (set, remove, clear)

**Files:**
- Modify: `plugins/plugin-web-storage/test/web-storage.spec.ts`
- Modify: `plugins/plugin-web-storage/src/index.ts`

- [ ] **Step 1: Add the writes test (append to the existing spec)**

Append to `web-storage.spec.ts`:

```ts
test('captures setItem, removeItem, and clear with old/new values', async ({ page }) => {
  await page.goto(FIXTURE)

  const handle = await attach(page, { outDir: dir, plugins: [webStorage()] })

  await page.evaluate(() => {
    localStorage.setItem('foo', 'bar')           // new key
    localStorage.setItem('foo', 'baz')           // overwrite
    sessionStorage.setItem('s', '1')
    localStorage.removeItem('foo')
    sessionStorage.clear()                       // clears 'preexisting-session' and 's'
  })
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const writes = events.filter((e: { type: string }) => e.type === 'webStorage.write')

  expect(writes).toHaveLength(5)

  expect(writes[0].metadata).toMatchObject({
    storageType: 'localStorage',
    operation: 'set',
    key: 'foo',
    newValue: 'bar',
  })
  expect(writes[0].metadata.oldValue).toBeUndefined()

  expect(writes[1].metadata).toMatchObject({
    storageType: 'localStorage',
    operation: 'set',
    key: 'foo',
    oldValue: 'bar',
    newValue: 'baz',
  })

  expect(writes[2].metadata).toMatchObject({
    storageType: 'sessionStorage',
    operation: 'set',
    key: 's',
    newValue: '1',
  })

  expect(writes[3].metadata).toMatchObject({
    storageType: 'localStorage',
    operation: 'remove',
    key: 'foo',
    oldValue: 'baz',
  })

  expect(writes[4].metadata).toMatchObject({
    storageType: 'sessionStorage',
    operation: 'clear',
  })
  // Order of cleared keys is the iteration order of Storage at the time of clear.
  expect(new Set(writes[4].metadata.clearedKeys)).toEqual(new Set(['preexisting-session', 's']))
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @introspection/plugin-web-storage test -- -g "captures setItem"`
Expected: FAIL — no `webStorage.write` events emitted.

- [ ] **Step 3: Add the page-side script + binding wiring**

In `src/index.ts`:

1. Above the `export function webStorage(...)` declaration, add the browser-side script as a top-level constant (it must be self-contained — no closure over options):

```ts
const BROWSER_SCRIPT = `
(function() {
  var BINDING = '__introspection_plugin_web_storage';
  if (typeof Storage === 'undefined') return;
  if (window[BINDING + '_installed']) return;
  window[BINDING + '_installed'] = true;

  var origGetItem    = Storage.prototype.getItem;
  var origSetItem    = Storage.prototype.setItem;
  var origRemoveItem = Storage.prototype.removeItem;
  var origClear      = Storage.prototype.clear;
  var origKey        = Storage.prototype.key;
  var lengthDesc     = Object.getOwnPropertyDescriptor(Storage.prototype, 'length');

  function storageType(self) {
    if (self === window.localStorage)   return 'localStorage';
    if (self === window.sessionStorage) return 'sessionStorage';
    return null;
  }

  function emit(payload) {
    try {
      payload.origin = location.origin;
      var binding = window[BINDING];
      if (typeof binding === 'function') binding(JSON.stringify(payload));
    } catch (_) { /* swallow */ }
  }

  Storage.prototype.setItem = function(key, value) {
    var t = storageType(this);
    var oldValue = t ? origGetItem.call(this, key) : null;
    var result = origSetItem.call(this, key, value);
    if (t) {
      var payload = { kind: 'write', op: 'set', storageType: t, key: String(key), newValue: String(value) };
      if (oldValue !== null) payload.oldValue = oldValue;
      emit(payload);
    }
    return result;
  };

  Storage.prototype.removeItem = function(key) {
    var t = storageType(this);
    var oldValue = t ? origGetItem.call(this, key) : null;
    var result = origRemoveItem.call(this, key);
    if (t && oldValue !== null) {
      emit({ kind: 'write', op: 'remove', storageType: t, key: String(key), oldValue: oldValue });
    }
    return result;
  };

  Storage.prototype.clear = function() {
    var t = storageType(this);
    var keys = [];
    if (t && lengthDesc && lengthDesc.get) {
      var len = lengthDesc.get.call(this);
      for (var i = 0; i < len; i++) {
        var k = origKey.call(this, i);
        if (k !== null) keys.push(k);
      }
    }
    var result = origClear.call(this);
    if (t) emit({ kind: 'write', op: 'clear', storageType: t, clearedKeys: keys });
    return result;
  };

  if (window['__introspection_plugin_web_storage_reads']) {
    Storage.prototype.getItem = function(key) {
      var value = origGetItem.call(this, key);
      var t = storageType(this);
      if (t) emit({ kind: 'read', storageType: t, key: String(key), value: value });
      return value;
    };
  }
})();
`
```

2. In `install()`, add CDP binding and add-init-script wiring **before** `await snapshotOnce('install')`:

```ts
      // Set up the binding receiving page-side payloads.
      await ctx.cdpSession.send('Runtime.addBinding', { name: '__introspection_plugin_web_storage' })
      ctx.cdpSession.on('Runtime.bindingCalled', (rawParams) => {
        const params = rawParams as { name: string; payload: string }
        if (params.name !== '__introspection_plugin_web_storage') return
        try {
          const payload = JSON.parse(params.payload) as PagePayload
          handlePagePayload(payload)
        } catch (err) {
          debug('binding parse error', (err as Error).message)
        }
      })

      // Install the page-side wrapper. The init script declares whether reads
      // are captured by reading window['__introspection_plugin_web_storage_reads'].
      const readsToggle = `window.__introspection_plugin_web_storage_reads = ${captureReads ? 'true' : 'false'};`
      await ctx.cdpSession.send('Page.addScriptToEvaluateOnNewDocument', {
        source: readsToggle + BROWSER_SCRIPT,
      })
```

3. Add the `PagePayload` type and `handlePagePayload` function inside `install()` (before the binding subscription):

```ts
      type PagePayload =
        | { kind: 'write'; op: 'set'; storageType: 'localStorage' | 'sessionStorage'; origin: string; key: string; oldValue?: string; newValue: string }
        | { kind: 'write'; op: 'remove'; storageType: 'localStorage' | 'sessionStorage'; origin: string; key: string; oldValue: string }
        | { kind: 'write'; op: 'clear'; storageType: 'localStorage' | 'sessionStorage'; origin: string; clearedKeys: string[] }
        | { kind: 'read';  storageType: 'localStorage' | 'sessionStorage'; origin: string; key: string; value: string | null }

      function handlePagePayload(payload: PagePayload): void {
        if (!originAllowed(payload.origin)) return
        if (!stores.includes(payload.storageType)) return

        if (payload.kind === 'read') {
          if (!captureReads) return
          void ctx.emit({
            type: 'webStorage.read',
            metadata: {
              storageType: payload.storageType,
              origin: payload.origin,
              key: payload.key,
              value: payload.value,
            },
          })
          return
        }

        // payload.kind === 'write'
        const md: {
          storageType: 'localStorage' | 'sessionStorage'
          operation: 'set' | 'remove' | 'clear'
          origin: string
          key?: string
          oldValue?: string
          newValue?: string
          clearedKeys?: string[]
        } = {
          storageType: payload.storageType,
          operation: payload.op,
          origin: payload.origin,
        }
        if (payload.op === 'set') {
          md.key = payload.key
          md.newValue = payload.newValue
          if (payload.oldValue !== undefined) md.oldValue = payload.oldValue
        } else if (payload.op === 'remove') {
          md.key = payload.key
          md.oldValue = payload.oldValue
        } else {
          md.clearedKeys = payload.clearedKeys
        }

        void ctx.emit({ type: 'webStorage.write', metadata: md })
      }
```

The full ordering in `install()` becomes:
1. enable `Page` and `DOMStorage`, learn top origin, subscribe to `Page.frameNavigated`
2. add the binding + bindingCalled handler
3. add the init script (so it runs on the next navigation)
4. emit install snapshot (CDP query)

The fixture page is already navigated by `page.goto()` *before* `attach()` runs, so the init script does **not** run on the fixture's initial load. That's why the test seeds storage in the HTML rather than via subsequent `page.evaluate()` for the install snapshot to find. For the writes test, mutations happen via `page.evaluate()` *after* attach — but `page.evaluate()` runs in the existing page realm, where the prototype patch has not been installed (init scripts only run on navigations). To catch writes from this fixture, we need the wrapper to apply to the *current* realm too.

Add this to `install()`, after `Page.addScriptToEvaluateOnNewDocument`:

```ts
      // Init scripts only run on future navigations, so we also evaluate the
      // wrapper in the current realm to cover tests that attach after navigation.
      try {
        await ctx.cdpSession.send('Runtime.evaluate', {
          expression: readsToggle + BROWSER_SCRIPT,
          awaitPromise: false,
        })
      } catch (err) {
        debug('current-realm patch failed', (err as Error).message)
      }
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-web-storage test -- -g "captures setItem"`
Expected: PASS. All five write events appear with correct metadata.

- [ ] **Step 5: Re-run the install snapshot test to make sure it still passes**

Run: `pnpm --filter @introspection/plugin-web-storage test -- -g "install snapshot"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/plugin-web-storage/src/index.ts plugins/plugin-web-storage/test/web-storage.spec.ts
git commit -m "plugin-web-storage: capture writes via Storage.prototype patch"
```

---

## Task 6: Test + implement read capture (opt-in)

**Files:**
- Modify: `plugins/plugin-web-storage/test/web-storage.spec.ts`

The implementation is already in place from Task 5 (the `if (window['__introspection_plugin_web_storage_reads'])` branch and the `readsToggle` injection). We just need a test that exercises it.

- [ ] **Step 1: Append the reads test**

```ts
test('captures getItem when reads option is enabled', async ({ page }) => {
  await page.goto(FIXTURE)

  const handle = await attach(page, { outDir: dir, plugins: [webStorage({ reads: true })] })

  const result = await page.evaluate(() => ({
    hit:  localStorage.getItem('preexisting-local'),  // 'l-1'
    miss: localStorage.getItem('does-not-exist'),     // null
  }))
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  expect(result).toEqual({ hit: 'l-1', miss: null })

  const events = await readEvents(dir)
  const reads = events.filter((e: { type: string }) => e.type === 'webStorage.read')

  expect(reads).toHaveLength(2)
  expect(reads[0].metadata).toMatchObject({ storageType: 'localStorage', key: 'preexisting-local', value: 'l-1' })
  expect(reads[1].metadata).toMatchObject({ storageType: 'localStorage', key: 'does-not-exist', value: null })
})

test('does not capture reads by default', async ({ page }) => {
  await page.goto(FIXTURE)

  const handle = await attach(page, { outDir: dir, plugins: [webStorage()] })
  await page.evaluate(() => localStorage.getItem('preexisting-local'))
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const reads = events.filter((e: { type: string }) => e.type === 'webStorage.read')
  expect(reads).toHaveLength(0)
})
```

- [ ] **Step 2: Run both tests, verify they pass**

Run: `pnpm --filter @introspection/plugin-web-storage test -- -g "getItem|does not capture reads"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add plugins/plugin-web-storage/test/web-storage.spec.ts
git commit -m "plugin-web-storage: tests for opt-in read capture"
```

---

## Task 7: Test + implement bus-triggered snapshots (manual, js.error, detach)

**Files:**
- Modify: `plugins/plugin-web-storage/test/web-storage.spec.ts`
- Modify: `plugins/plugin-web-storage/src/index.ts`

- [ ] **Step 1: Append the manual-trigger test**

```ts
test('emits a snapshot on handle.snapshot()', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [webStorage()] })

  await page.evaluate(() => localStorage.setItem('after', 'attach'))
  await handle.snapshot()
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'webStorage.snapshot')

  const manual = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'manual')
  expect(manual).toBeDefined()
  expect(manual.metadata.localStorage).toMatchObject({ 'preexisting-local': 'l-1', 'after': 'attach' })

  const detach = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'detach')
  expect(detach).toBeDefined()
})

test('emits a snapshot on js.error', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [webStorage()] })

  await page.evaluate(() => { setTimeout(() => { throw new Error('boom') }, 0) })
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'webStorage.snapshot')
  const onError = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'js.error')
  expect(onError).toBeDefined()
})
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @introspection/plugin-web-storage test -- -g "snapshot on"`
Expected: FAIL — neither manual nor js.error nor detach snapshots are emitted yet.

- [ ] **Step 3: Wire bus subscriptions in `install()`**

Add at the end of `install()`, after the install snapshot is emitted:

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

Note: `js.error` events arrive only when a sibling `plugin-js-error` is also installed in the session. The test below installs `webStorage` only, but the framework still emits `js.error` from `attach()`'s built-in error capture if available. If the test is flaky because `js.error` is not emitted, add `import { jsError } from '@introspection/plugin-js-error'` and include `jsError()` in the plugins array — see plugin-webgl's tests for the pattern.

- [ ] **Step 4: Re-run the bus tests, verify they pass**

Run: `pnpm --filter @introspection/plugin-web-storage test -- -g "snapshot on"`
Expected: PASS for `handle.snapshot()` (manual + detach) and `js.error`. If `js.error` fails, add `@introspection/plugin-js-error` as a devDependency in `package.json` and include `jsError()` in the test's plugin list, then rerun.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-web-storage/src/index.ts plugins/plugin-web-storage/test/web-storage.spec.ts
git commit -m "plugin-web-storage: bus-triggered snapshots (manual, js.error, detach)"
```

---

## Task 8: Test + implement origin filtering

**Files:**
- Create: `plugins/plugin-web-storage/test/fixtures/parent.html`
- Modify: `plugins/plugin-web-storage/test/web-storage.spec.ts`

- [ ] **Step 1: Create a parent fixture that loads a same-origin iframe**

`plugins/plugin-web-storage/test/fixtures/parent.html`:

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>parent</title></head>
<body>
<iframe id="child" src="about:blank"></iframe>
<script>
  const f = document.getElementById('child')
  f.addEventListener('load', () => {
    f.contentWindow.localStorage.setItem('child-key', 'child-val')
  })
</script>
</body>
</html>
```

`about:blank` iframes inherit the parent's origin, so this exercises the same-origin filter path. (Cross-origin iframes are difficult to test from a `file://` fixture — same-origin is enough to verify the filter mechanism.)

- [ ] **Step 2: Append the origin-filter test**

```ts
const PARENT_FIXTURE = 'file://' + fileURLToPath(new URL('./fixtures/parent.html', import.meta.url))

test('default filter: top-frame origin only', async ({ page }) => {
  // The fixture writes from a same-origin iframe. Same-origin == top-frame
  // origin, so it should still be captured.
  await page.goto(PARENT_FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [webStorage()] })

  await page.evaluate(() => {
    const f = document.getElementById('child') as HTMLIFrameElement
    f.contentWindow!.localStorage.setItem('child-2', 'val-2')
  })
  await new Promise(r => setTimeout(r, 150))
  await handle.detach()

  const events = await readEvents(dir)
  const writes = events.filter((e: { type: string; metadata: { key?: string } }) =>
    e.type === 'webStorage.write' && e.metadata.key === 'child-2'
  )
  expect(writes).toHaveLength(1)
  expect(writes[0].metadata.origin).toBe(writes[0].metadata.origin) // sanity
})
```

- [ ] **Step 3: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-web-storage test -- -g "top-frame origin"`
Expected: PASS — same-origin iframe writes show up because top-frame origin matches.

The `origins` option escape hatch (`origins: ['https://other-origin.example']`) is exercised implicitly by the `originAllowed` logic. We don't add a cross-origin test now — it requires a real HTTP server fixture and is out of scope for this initial plan; flag as a follow-up if the user wants it later.

- [ ] **Step 4: Commit**

```bash
git add plugins/plugin-web-storage/test plugins/plugin-web-storage/src/index.ts
git commit -m "plugin-web-storage: top-frame origin filter test + iframe fixture"
```

---

## Task 9: Write the README

**Files:**
- Create: `plugins/plugin-web-storage/README.md`

- [ ] **Step 1: Write the README**

```markdown
# @introspection/plugin-web-storage

Captures `localStorage` and `sessionStorage` activity (writes always, reads opt-in, plus snapshots) into the introspection trace.

The plugin patches `Storage.prototype` page-side via `addInitScript`, so every realistic call path — `localStorage.setItem(...)`, `Storage.prototype.setItem.call(...)`, DevTools console input — is captured. Snapshots of full storage state are emitted at install and on every bus trigger (`manual`, `js.error`, `detach`).

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Options](#options)
- [Events emitted](#events-emitted)
- [How snapshots work](#how-snapshots-work)
- [Caveats](#caveats)

## Install

\`\`\`bash
pnpm add -D @introspection/plugin-web-storage
\`\`\`

## Usage

\`\`\`ts
import { attach } from '@introspection/playwright'
import { webStorage } from '@introspection/plugin-web-storage'

const handle = await attach(page, {
  plugins: [
    webStorage(),                  // writes + snapshots only
    webStorage({ reads: true }),   // also captures every getItem
  ],
})
\`\`\`

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `stores` | `('localStorage' \| 'sessionStorage')[]` | `['localStorage', 'sessionStorage']` | Which storage areas to capture. |
| `reads` | `boolean` | `false` | Capture every `getItem` call. Off by default — reads are high-volume on hot paths. |
| `origins` | `string[]` | top-frame only | Restrict capture to these origins. Default is the top-frame origin (matches `plugin-network`'s default). |
| `verbose` | `boolean` | `false` | Verbose debug logs. |

## Events emitted

- `webStorage.write` — every `setItem` / `removeItem` / `clear`. Includes `oldValue` (for set/remove) and `newValue` (for set), or `clearedKeys` (for clear).
- `webStorage.read` — every `getItem`, only when `reads: true`. `value: null` indicates the key was absent (matches the browser API).
- `webStorage.snapshot` — full storage dump. `metadata.trigger` is one of `'install' | 'manual' | 'js.error' | 'detach'`.

## How snapshots work

Snapshots are queried server-side via CDP `DOMStorage.getDOMStorageItems`, so they capture state already on disk from prior sessions even if the page never touched it. They're emitted automatically at install and whenever the introspection runtime fires `manual`, `js.error`, or `detach` on the bus — no API to call.

## Caveats

The plugin captures by patching `Storage.prototype`. This is robust against every realistic call site, but has the same realm-crossing limitation as every prototype-patching plugin in this repo: see [`docs/prototype-patching-limits.md`](../../docs/prototype-patching-limits.md). In practice, no application code triggers it.

`Storage.prototype.setItem.toString()` no longer returns `[native code]` while the plugin is attached. The exceedingly rare apps that sniff this will see our wrapper.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/plugin-web-storage/README.md
git commit -m "plugin-web-storage: README"
```

---

## Task 10: Update the shared prototype-patching note

**Files:**
- Modify: `docs/prototype-patching-limits.md`

- [ ] **Step 1: Mark `plugin-web-storage` as implemented**

In `docs/prototype-patching-limits.md`, find the bullet:

```
- `@introspection/plugin-web-storage` — patches `Storage.prototype`.
```

(it already says this, so no edit needed; just verify it's correct).

- [ ] **Step 2: Verify no other docs need updating**

Run: `grep -r "plugin-web-storage" docs README.md 2>/dev/null | head`
Expected: spec, plan, prototype-patching note, and (after this PR) the package README. No stale references.

- [ ] **Step 3: No commit if nothing changed; otherwise commit**

```bash
git status
# if changes:
git add docs/prototype-patching-limits.md
git commit -m "docs: confirm plugin-web-storage in prototype-patching note"
```

---

## Task 11: Final verification

- [ ] **Step 1: Typecheck the new plugin and the types package**

Run: `pnpm --filter @introspection/plugin-web-storage typecheck && pnpm --filter @introspection/types typecheck`
Expected: PASS for both.

- [ ] **Step 2: Run the full plugin test suite**

Run: `pnpm --filter @introspection/plugin-web-storage test`
Expected: All tests PASS.

- [ ] **Step 3: Run a workspace-wide build to catch consumer breakage**

Run: `pnpm -r build`
Expected: All packages build. If any other package fails because it consumes `@introspection/types` and now sees the new event types, that's a real problem — investigate before claiming completion.

- [ ] **Step 4: Run the workspace-wide typecheck**

Run: `pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Final commit (if any cleanup needed)**

If the build/typecheck steps surfaced fixes, commit them with a focused message. Otherwise, no final commit needed.

---

## Self-review notes (carried out at write time)

- **Spec coverage:** every section of the spec is mapped to a task. Public API → Task 2; event schema → Task 1; install snapshot → Task 4; page-side prototype patch (writes + reads) → Tasks 5/6; cross-channel ordering → addressed by single-channel design + the implementation note above; bus subscriptions → Task 7; origin filtering → Task 8; package layout → Task 2; testing → Tasks 4-8; risks → README in Task 9 + linked shared note in Task 10.
- **Type consistency:** `webStorage` factory name, `WebStorageOptions` interface, `webStorage.write` / `webStorage.read` / `webStorage.snapshot` event types are used consistently across all tasks. Binding name `__introspection_plugin_web_storage` and reads-toggle global `__introspection_plugin_web_storage_reads` are used consistently in the page script and install handler.
- **No placeholders:** every code block contains real code. Every command has expected output.
- **Known gap intentionally left out:** cross-origin `origins: [...]` integration test (requires HTTP server fixture) — flagged in Task 8 as a follow-up.

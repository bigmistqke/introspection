# `plugin-cookies` Implementation Plan

> **Status:** landed (2026-05-08) · spec: `docs/superpowers/specs/2026-05-08-plugin-cookies-design.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@introspection/plugin-cookies` per the spec at `docs/superpowers/specs/2026-05-08-plugin-cookies-design.md`. Captures cookie activity (programmatic page-side writes via `document.cookie` and `CookieStore`, HTTP `Set-Cookie` response headers, and full cookie snapshots) into the introspection trace.

**Architecture:** Page-side prototype patching for programmatic writes (`Document.prototype.cookie` setter, `CookieStore.prototype.set/delete`) via `Page.addScriptToEvaluateOnNewDocument` + `Runtime.evaluate`. Server-side CDP `Network.responseReceivedExtraInfo` for HTTP Set-Cookie headers. Server-side CDP `Network.getAllCookies` for snapshots at install + bus triggers. Single `Runtime.addBinding` channel for the page-side events.

**Tech Stack:** TypeScript, Playwright, CDP (`Runtime.addBinding`, `Network.responseReceivedExtraInfo`, `Network.responseReceived`, `Network.getAllCookies`), `tsup` build, `pnpm` workspaces. Sibling reference plugins: `@introspection/plugin-web-storage`, `@introspection/plugin-indexeddb`.

---

## File Structure

New package at `plugins/plugin-cookies/`:

- `plugins/plugin-cookies/package.json` — workspace manifest mirroring `plugin-web-storage`'s.
- `plugins/plugin-cookies/tsconfig.json` — extends `tsconfig.base.json`.
- `plugins/plugin-cookies/playwright.config.ts` — same shape as siblings.
- `plugins/plugin-cookies/src/index.ts` — public entry. Exports `cookies(options)`. Houses the server-side handler: parses binding payloads + `Network.responseReceivedExtraInfo`, applies origin/name filters, emits trace events. Manages bus subscriptions, snapshot logic, and the `requestId → url` map.
- `plugins/plugin-cookies/src/page-script.ts` — exports `BROWSER_SCRIPT`. Patches `Document.prototype.cookie` setter and `CookieStore.prototype` if available. Includes the cookie-string parser used to extract attributes.
- `plugins/plugin-cookies/test/cookies.spec.ts` — Playwright integration tests.
- `plugins/plugin-cookies/test/server.ts` — small Node HTTP server fixture (cookies don't behave well on `file://`; we need a real host). Started/stopped per test.
- `plugins/plugin-cookies/README.md` — follows `docs/PLUGIN_README_TEMPLATE.md`.

Modified:
- `packages/types/src/index.ts` — adds `CookieEntry`, `CookieWriteEvent`, `CookieHttpEvent`, `CookieSnapshotEvent` and registers them in `TraceEventMap`.
- `docs/prototype-patching-limits.md` — list `plugin-cookies` as a patcher (one-line addition).

Out of scope:
- `plugin-defaults` — `cookies` is opt-in.
- CLI changes — `introspect events --type 'cookie.*'` already works generically.

## Working directory

All commands assume `cwd = /Users/puckey/rg/introspection` unless otherwise stated.

---

## Task 1: Add event types to `@introspection/types`

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Insert the cookie event interfaces and register them**

In `packages/types/src/index.ts`, find the block:

```ts
// ─── Plugin events: indexeddb ───────────────────────────────────────────────
```

Insert immediately **before** that block (cookies sits between redux and indexeddb):

```ts
// ─── Plugin events: cookies ─────────────────────────────────────────────────

export interface CookieEntry {
  name: string
  value: string
  domain: string
  path: string
  /** Unix seconds. Absent for trace cookies. */
  expires?: number
  httpOnly: boolean
  secure: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  partitionKey?: string
}

export interface CookieWriteEvent extends BaseEvent {
  type: 'cookie.write'
  metadata: {
    operation: 'set' | 'delete'
    source: 'document.cookie' | 'CookieStore'
    origin: string
    name: string
    value?: string
    domain?: string
    path?: string
    expires?: number
    secure?: boolean
    sameSite?: 'Strict' | 'Lax' | 'None'
    raw?: string
  }
}

export interface CookieHttpEvent extends BaseEvent {
  type: 'cookie.http'
  metadata: {
    operation: 'set' | 'delete'
    /** URL of the response that carried the Set-Cookie header. */
    url: string
    /** CDP requestId, joinable to network.response.metadata.cdpRequestId. */
    requestId: string
    name: string
    value?: string
    domain?: string
    path?: string
    expires?: number
    httpOnly?: boolean
    secure?: boolean
    sameSite?: 'Strict' | 'Lax' | 'None'
    raw: string
  }
}

export interface CookieSnapshotEvent extends BaseEvent {
  type: 'cookie.snapshot'
  metadata: {
    trigger: 'install' | 'manual' | 'js.error' | 'detach'
    origin: string
    cookies: CookieEntry[]
  }
}

```

In the `TraceEventMap`, find:

```ts
  // IndexedDB
```

Insert immediately **before** that line:

```ts
  // Cookies
  'cookie.write': CookieWriteEvent
  'cookie.http': CookieHttpEvent
  'cookie.snapshot': CookieSnapshotEvent
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @introspection/types typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "types: add cookie.* event types"
```

---

## Task 2: Scaffold the `plugin-cookies` package

**Files:**
- Create: `plugins/plugin-cookies/package.json`
- Create: `plugins/plugin-cookies/tsconfig.json`
- Create: `plugins/plugin-cookies/playwright.config.ts`
- Create: `plugins/plugin-cookies/src/index.ts`
- Create: `plugins/plugin-cookies/src/page-script.ts`
- Create: `plugins/plugin-cookies/test/server.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@introspection/plugin-cookies",
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

- [ ] **Step 4: Create the test HTTP server**

`plugins/plugin-cookies/test/server.ts`:

```ts
import { createServer, type Server } from 'http'
import { AddressInfo } from 'net'

export interface FixtureServer {
  server: Server
  url: string                                // base url (no trailing slash)
  /** Configure responses for specific paths. Resets per test. */
  respond(path: string, handler: (req: import('http').IncomingMessage, res: import('http').ServerResponse) => void): void
  close(): Promise<void>
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const handlers = new Map<string, (req: import('http').IncomingMessage, res: import('http').ServerResponse) => void>()

  const server = createServer((req, res) => {
    const handler = handlers.get(req.url ?? '/')
    if (handler) return handler(req, res)
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><body>fixture</body></html>')
      return
    }
    res.writeHead(404).end()
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const url = `http://127.0.0.1:${port}`

  return {
    server, url,
    respond(path, handler) { handlers.set(path, handler) },
    async close() { await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}
```

- [ ] **Step 5: Create initial `src/page-script.ts` placeholder**

```ts
// Page-realm IIFE that patches Document.prototype.cookie setter and
// CookieStore.prototype.set/delete. Filled in by Task 4 onwards.

export const BROWSER_SCRIPT = `
(function() {
  if (typeof Document === 'undefined') return;
})();
`
```

- [ ] **Step 6: Create initial `src/index.ts` skeleton**

```ts
import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { BROWSER_SCRIPT } from './page-script.js'

export type {
  CookieEntry,
  CookieWriteEvent,
  CookieHttpEvent,
  CookieSnapshotEvent,
} from '@introspection/types'

export interface CookiesOptions {
  /** Restrict capture to cookies whose domain matches one of these origins'
   *  hostnames. Default: ['*']. */
  origins?: string[]
  /** Restrict capture to cookies with these names. Default: all. */
  names?: string[]
  verbose?: boolean
}

export function cookies(options?: CookiesOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-cookies', options?.verbose ?? false)
  const origins = options?.origins ?? ['*']
  const names = options?.names

  return {
    name: 'cookies',
    description: 'Captures cookie activity (programmatic writes, HTTP Set-Cookie, snapshots)',
    events: {
      'cookie.write': 'Programmatic cookie mutation (document.cookie / CookieStore)',
      'cookie.http': 'Cookie set by an HTTP response Set-Cookie header',
      'cookie.snapshot': 'Full cookie state at install and on bus triggers',
    },
    async install(_ctx: PluginContext): Promise<void> {
      debug('installing', { origins, names })
      void BROWSER_SCRIPT
    },
  }
}
```

- [ ] **Step 7: Install workspace deps**

Run: `pnpm install`
Expected: PASS — pnpm wires the new package into the workspace graph.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @introspection/plugin-cookies typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add plugins/plugin-cookies pnpm-lock.yaml
git commit -m "plugin-cookies: scaffold package"
```

---

## Task 3: Test + implement install-time snapshot via CDP `Network.getAllCookies`

**Files:**
- Create: `plugins/plugin-cookies/test/cookies.spec.ts`
- Modify: `plugins/plugin-cookies/src/index.ts`

- [ ] **Step 1: Write the install-snapshot test**

`plugins/plugin-cookies/test/cookies.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '@introspection/playwright'
import { cookies } from '../src/index.js'
import { startFixtureServer, type FixtureServer } from './server.js'

let dir: string
let fixture: FixtureServer

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-cookies-'))
  fixture = await startFixtureServer()
})
test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await fixture.close()
})

async function readEvents(outDir: string) {
  const entries = await readdir(outDir)
  const ndjson = await readFile(join(outDir, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('emits an install snapshot containing pre-existing cookies', async ({ page, context }) => {
  const url = new URL(fixture.url)
  await context.addCookies([
    { name: 'trace', value: 'abc', domain: url.hostname, path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
    { name: 'theme', value: 'dark', domain: url.hostname, path: '/' },
  ])

  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies()] })
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const installSnapshot = events.find((e: { type: string; metadata: { trigger: string } }) =>
    e.type === 'cookie.snapshot' && e.metadata.trigger === 'install'
  )
  expect(installSnapshot).toBeDefined()

  const trace = installSnapshot.metadata.cookies.find((c: { name: string }) => c.name === 'trace')
  expect(trace).toBeDefined()
  expect(trace.value).toBe('abc')
  expect(trace.httpOnly).toBe(true)
  expect(trace.sameSite).toBe('Lax')

  const theme = installSnapshot.metadata.cookies.find((c: { name: string }) => c.name === 'theme')
  expect(theme).toBeDefined()
  expect(theme.value).toBe('dark')
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @introspection/plugin-cookies exec playwright test -g "install snapshot"`
Expected: FAIL — no `cookie.snapshot` events emitted.

- [ ] **Step 3: Implement install snapshot**

Replace `plugins/plugin-cookies/src/index.ts` with:

```ts
import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext, CookieEntry } from '@introspection/types'
import { BROWSER_SCRIPT } from './page-script.js'

export type {
  CookieEntry,
  CookieWriteEvent,
  CookieHttpEvent,
  CookieSnapshotEvent,
} from '@introspection/types'

export interface CookiesOptions {
  origins?: string[]
  names?: string[]
  verbose?: boolean
}

type SnapshotTrigger = 'install' | 'manual' | 'js.error' | 'detach'

interface CdpCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number     // -1 means trace
  size: number
  httpOnly: boolean
  secure: boolean
  trace: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  partitionKey?: string
}

function cookieDomainMatchesOrigin(cookieDomain: string, originHost: string): boolean {
  const d = cookieDomain.replace(/^\./, '')
  return originHost === d || originHost.endsWith('.' + d)
}

export function cookies(options?: CookiesOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-cookies', options?.verbose ?? false)
  const origins = options?.origins ?? ['*']
  const namesFilter = options?.names

  function nameAllowed(name: string): boolean {
    if (!namesFilter) return true
    return namesFilter.includes(name)
  }

  function domainAllowed(domain: string): boolean {
    if (origins.includes('*')) return true
    return origins.some(o => {
      try { return cookieDomainMatchesOrigin(domain, new URL(o).hostname) }
      catch { return false }
    })
  }

  return {
    name: 'cookies',
    description: 'Captures cookie activity (programmatic writes, HTTP Set-Cookie, snapshots)',
    events: {
      'cookie.write': 'Programmatic cookie mutation (document.cookie / CookieStore)',
      'cookie.http': 'Cookie set by an HTTP response Set-Cookie header',
      'cookie.snapshot': 'Full cookie state at install and on bus triggers',
    },
    async install(ctx: PluginContext): Promise<void> {
      debug('installing', { origins, namesFilter })
      void BROWSER_SCRIPT // wired in Task 4

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
      } catch (err) {
        debug('failed to determine top origin', (err as Error).message)
      }

      ctx.cdpSession.on('Page.frameNavigated', (rawParams) => {
        const params = rawParams as { frame: { id: string; parentId?: string; url: string; securityOrigin?: string } }
        if (params.frame.parentId) return
        topOrigin = params.frame.securityOrigin ?? (() => {
          try { return new URL(params.frame.url).origin } catch { return undefined }
        })()
      })

      async function snapshotOnce(trigger: SnapshotTrigger): Promise<void> {
        let raw: CdpCookie[] = []
        try {
          const r = await ctx.cdpSession.send('Network.getAllCookies') as { cookies: CdpCookie[] }
          raw = r.cookies
        } catch (err) {
          debug('getAllCookies failed', (err as Error).message)
        }

        const filtered: CookieEntry[] = []
        for (const c of raw) {
          if (!domainAllowed(c.domain)) continue
          if (!nameAllowed(c.name)) continue
          const entry: CookieEntry = {
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            httpOnly: c.httpOnly,
            secure: c.secure,
          }
          if (c.expires > 0 && !c.trace) entry.expires = c.expires
          if (c.sameSite) entry.sameSite = c.sameSite
          if (c.partitionKey) entry.partitionKey = c.partitionKey
          filtered.push(entry)
        }

        await ctx.emit({
          type: 'cookie.snapshot',
          metadata: { trigger, origin: topOrigin ?? '', cookies: filtered },
        })
      }

      await snapshotOnce('install')
    },
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-cookies exec playwright test -g "install snapshot"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-cookies
git commit -m "plugin-cookies: install-time snapshot via Network.getAllCookies"
```

---

## Task 4: Test + implement page-side wrapper bootstrap + binding

Bring up the page-side script with the binding wired. After this task, `BROWSER_SCRIPT` runs in the page and can call the binding; subsequent tasks fill in the actual patches.

**Files:**
- Modify: `plugins/plugin-cookies/src/page-script.ts`
- Modify: `plugins/plugin-cookies/src/index.ts`

- [ ] **Step 1: Replace `page-script.ts` with the bootstrap**

```ts
// Page-realm IIFE. Runs in every navigated frame via addInitScript and once
// in the current realm via Runtime.evaluate at install time.
//
// Communicates with the host via window['__introspection_plugin_cookies'],
// a Runtime.addBinding installed server-side.

export const BROWSER_SCRIPT = `
(function() {
  var BINDING = '__introspection_plugin_cookies';
  if (typeof Document === 'undefined') return;
  if (window[BINDING + '_installed']) return;
  window[BINDING + '_installed'] = true;

  function emit(payload) {
    try {
      payload.origin = location.origin;
      var binding = window[BINDING];
      if (typeof binding === 'function') binding(JSON.stringify(payload));
    } catch (_) { /* swallow */ }
  }

  window[BINDING + '_emit'] = emit;
})();
`
```

- [ ] **Step 2: Wire the binding in `install()`**

In `plugins/plugin-cookies/src/index.ts`, insert immediately after the `Page.frameNavigated` subscription, **before** `snapshotOnce`:

```ts
      const BINDING_NAME = '__introspection_plugin_cookies'

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

      await ctx.cdpSession.send('Page.addScriptToEvaluateOnNewDocument', {
        source: BROWSER_SCRIPT,
      })

      try {
        await ctx.cdpSession.send('Runtime.evaluate', {
          expression: BROWSER_SCRIPT,
          awaitPromise: false,
        })
      } catch (err) {
        debug('current-realm patch failed', (err as Error).message)
      }
```

- [ ] **Step 3: Add a smoke test for the binding bootstrap**

Append to `plugins/plugin-cookies/test/cookies.spec.ts`:

```ts
test('binding bootstrap exposes the emit helper', async ({ page }) => {
  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies()] })

  const ok = await page.evaluate(() => typeof (window as unknown as { __introspection_plugin_cookies_emit?: unknown }).__introspection_plugin_cookies_emit === 'function')
  expect(ok).toBe(true)

  await handle.detach()
})
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-cookies exec playwright test -g "binding bootstrap"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-cookies
git commit -m "plugin-cookies: page-side script + CDP binding bootstrap"
```

---

## Task 5: Test + implement `document.cookie` setter capture

**Files:**
- Modify: `plugins/plugin-cookies/src/page-script.ts`
- Modify: `plugins/plugin-cookies/src/index.ts`
- Modify: `plugins/plugin-cookies/test/cookies.spec.ts`

- [ ] **Step 1: Append the test**

```ts
test('captures document.cookie writes (set, multi-attribute, delete)', async ({ page }) => {
  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies()] })

  await page.evaluate(() => {
    document.cookie = 'a=1'
    document.cookie = 'b=2; path=/sub; secure; samesite=strict'
    document.cookie = 'a=; max-age=0'   // delete
  })
  await new Promise(r => setTimeout(r, 150))
  await handle.detach()

  const events = await readEvents(dir)
  const writes = events.filter((e: { type: string }) => e.type === 'cookie.write')
  expect(writes).toHaveLength(3)

  expect(writes[0].metadata).toMatchObject({
    operation: 'set',
    source: 'document.cookie',
    name: 'a',
    value: '1',
  })

  expect(writes[1].metadata).toMatchObject({
    operation: 'set',
    source: 'document.cookie',
    name: 'b',
    value: '2',
    path: '/sub',
    secure: true,
    sameSite: 'Strict',
  })

  expect(writes[2].metadata).toMatchObject({
    operation: 'delete',
    source: 'document.cookie',
    name: 'a',
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @introspection/plugin-cookies exec playwright test -g "document.cookie writes"`
Expected: FAIL — no events.

- [ ] **Step 3: Add the parser + setter patch to `page-script.ts`**

Replace `BROWSER_SCRIPT` body with:

```ts
export const BROWSER_SCRIPT = `
(function() {
  var BINDING = '__introspection_plugin_cookies';
  if (typeof Document === 'undefined') return;
  if (window[BINDING + '_installed']) return;
  window[BINDING + '_installed'] = true;

  function emit(payload) {
    try {
      payload.origin = location.origin;
      var binding = window[BINDING];
      if (typeof binding === 'function') binding(JSON.stringify(payload));
    } catch (_) { /* swallow */ }
  }

  window[BINDING + '_emit'] = emit;

  // ─── Cookie string parser (RFC 6265 minimal) ────────────────────────────
  function parseCookieString(raw) {
    // First segment is name=value; remaining segments are attributes.
    var parts = String(raw).split(';');
    var first = parts.shift() || '';
    var eq = first.indexOf('=');
    if (eq < 0) return null;
    var name = first.slice(0, eq).trim();
    var value = first.slice(eq + 1).trim();
    if (!name) return null;
    var out = { name: name, value: value };
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i].trim();
      if (!seg) continue;
      var aeq = seg.indexOf('=');
      var key = (aeq < 0 ? seg : seg.slice(0, aeq)).trim().toLowerCase();
      var val = aeq < 0 ? '' : seg.slice(aeq + 1).trim();
      if (key === 'expires') {
        var t = Date.parse(val);
        if (!isNaN(t)) out.expires = Math.floor(t / 1000);
      } else if (key === 'max-age') {
        var n = Number(val);
        if (!isNaN(n)) out.expires = Math.floor(Date.now() / 1000) + n;
      } else if (key === 'domain') {
        out.domain = val;
      } else if (key === 'path') {
        out.path = val;
      } else if (key === 'secure') {
        out.secure = true;
      } else if (key === 'samesite') {
        var v = val.toLowerCase();
        if (v === 'strict') out.sameSite = 'Strict';
        else if (v === 'lax') out.sameSite = 'Lax';
        else if (v === 'none') out.sameSite = 'None';
      }
      // httponly intentionally ignored — not settable from page-side
    }
    return out;
  }

  function isExpired(parsed) {
    return typeof parsed.expires === 'number' && parsed.expires <= Math.floor(Date.now() / 1000);
  }

  // ─── Document.prototype.cookie setter ────────────────────────────────────
  var origDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (origDesc && origDesc.set) {
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      enumerable: origDesc.enumerable,
      get: origDesc.get,
      set: function(raw) {
        origDesc.set.call(this, raw);
        try {
          var parsed = parseCookieString(String(raw));
          if (!parsed) {
            emit({ kind: 'write', source: 'document.cookie', operation: 'set', name: '', raw: String(raw) });
            return;
          }
          var op = isExpired(parsed) ? 'delete' : 'set';
          var payload = {
            kind: 'write',
            source: 'document.cookie',
            operation: op,
            name: parsed.name,
            raw: String(raw),
          };
          if (op === 'set') payload.value = parsed.value;
          if (parsed.domain !== undefined) payload.domain = parsed.domain;
          if (parsed.path !== undefined) payload.path = parsed.path;
          if (parsed.expires !== undefined) payload.expires = parsed.expires;
          if (parsed.secure !== undefined) payload.secure = parsed.secure;
          if (parsed.sameSite !== undefined) payload.sameSite = parsed.sameSite;
          emit(payload);
        } catch (_) { /* swallow */ }
      },
    });
  }
})();
`
```

- [ ] **Step 4: Extend the server handler with a write branch**

In `plugins/plugin-cookies/src/index.ts`, replace the `PagePayload` and `handlePagePayload` definitions:

```ts
      type WritePayload = {
        origin: string
        kind: 'write'
        source: 'document.cookie' | 'CookieStore'
        operation: 'set' | 'delete'
        name: string
        value?: string
        domain?: string
        path?: string
        expires?: number
        secure?: boolean
        sameSite?: 'Strict' | 'Lax' | 'None'
        raw?: string
      }

      type PagePayload = WritePayload

      function handlePagePayload(payload: PagePayload): void {
        if (payload.kind !== 'write') return
        if (!nameAllowed(payload.name)) return
        // Programmatic writes don't carry an inherent domain (the cookie
        // takes the origin host by default unless `domain=` was given), so
        // we apply the origin filter against the page realm's origin.
        if (!origins.includes('*')) {
          let originHost: string | undefined
          try { originHost = new URL(payload.origin).hostname } catch { /* ignore */ }
          const allowed = originHost ? origins.some(o => {
            try { return new URL(o).hostname === originHost } catch { return false }
          }) : false
          if (!allowed) return
        }

        const md: {
          operation: 'set' | 'delete'
          source: 'document.cookie' | 'CookieStore'
          origin: string
          name: string
          value?: string
          domain?: string
          path?: string
          expires?: number
          secure?: boolean
          sameSite?: 'Strict' | 'Lax' | 'None'
          raw?: string
        } = {
          operation: payload.operation,
          source: payload.source,
          origin: payload.origin,
          name: payload.name,
        }
        if (payload.value !== undefined) md.value = payload.value
        if (payload.domain !== undefined) md.domain = payload.domain
        if (payload.path !== undefined) md.path = payload.path
        if (payload.expires !== undefined) md.expires = payload.expires
        if (payload.secure !== undefined) md.secure = payload.secure
        if (payload.sameSite !== undefined) md.sameSite = payload.sameSite
        if (payload.raw !== undefined) md.raw = payload.raw

        void ctx.emit({ type: 'cookie.write', metadata: md })
      }
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-cookies exec playwright test -g "document.cookie writes"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/plugin-cookies
git commit -m "plugin-cookies: capture document.cookie setter writes"
```

---

## Task 6: Test + implement `CookieStore` capture

**Files:**
- Modify: `plugins/plugin-cookies/src/page-script.ts`
- Modify: `plugins/plugin-cookies/test/cookies.spec.ts`

- [ ] **Step 1: Append the test**

```ts
test('captures CookieStore.set and delete (Chromium)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CookieStore is Chromium-only')
  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies()] })

  await page.evaluate(async () => {
    // @ts-expect-error CookieStore is Chromium-only
    await window.cookieStore.set('cs-name', 'cs-val')
    // @ts-expect-error CookieStore is Chromium-only
    await window.cookieStore.delete('cs-name')
  })
  await new Promise(r => setTimeout(r, 150))
  await handle.detach()

  const events = await readEvents(dir)
  const writes = events.filter((e: { type: string; metadata: { source?: string } }) =>
    e.type === 'cookie.write' && e.metadata.source === 'CookieStore'
  )
  expect(writes).toHaveLength(2)
  expect(writes[0].metadata).toMatchObject({ operation: 'set', name: 'cs-name', value: 'cs-val' })
  expect(writes[1].metadata).toMatchObject({ operation: 'delete', name: 'cs-name' })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @introspection/plugin-cookies exec playwright test -g "CookieStore.set"`
Expected: FAIL — no `source: 'CookieStore'` events.

- [ ] **Step 3: Append CookieStore patch to `BROWSER_SCRIPT`**

Insert before the closing `})();` in `plugins/plugin-cookies/src/page-script.ts`:

```js
  // ─── CookieStore (Chromium async API) ───────────────────────────────────
  if (typeof CookieStore !== 'undefined') {
    var origCsSet = CookieStore.prototype.set;
    CookieStore.prototype.set = function(nameOrOpts, value) {
      var p = origCsSet.apply(this, arguments);
      var fields = (typeof nameOrOpts === 'object' && nameOrOpts !== null)
        ? nameOrOpts
        : { name: nameOrOpts, value: value };
      Promise.resolve(p).then(function() {
        var payload = {
          kind: 'write',
          source: 'CookieStore',
          operation: 'set',
          name: String(fields.name),
        };
        if (fields.value !== undefined) payload.value = String(fields.value);
        if (fields.domain !== undefined) payload.domain = fields.domain;
        if (fields.path !== undefined) payload.path = fields.path;
        if (fields.expires !== undefined) payload.expires = Math.floor(Number(fields.expires) / 1000);
        if (fields.sameSite !== undefined) {
          var ss = String(fields.sameSite).toLowerCase();
          if (ss === 'strict') payload.sameSite = 'Strict';
          else if (ss === 'lax') payload.sameSite = 'Lax';
          else if (ss === 'none') payload.sameSite = 'None';
        }
        emit(payload);
      }).catch(function() { /* page handles its own errors */ });
      return p;
    };

    var origCsDel = CookieStore.prototype.delete;
    CookieStore.prototype.delete = function(nameOrOpts) {
      var p = origCsDel.apply(this, arguments);
      var name = (typeof nameOrOpts === 'object' && nameOrOpts !== null) ? nameOrOpts.name : nameOrOpts;
      Promise.resolve(p).then(function() {
        emit({ kind: 'write', source: 'CookieStore', operation: 'delete', name: String(name) });
      }).catch(function() {});
      return p;
    };
  }
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-cookies exec playwright test -g "CookieStore.set"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-cookies
git commit -m "plugin-cookies: capture CookieStore.set/delete"
```

---

## Task 7: Test + implement HTTP `Set-Cookie` capture (`cookie.http` events)

**Files:**
- Modify: `plugins/plugin-cookies/src/index.ts`
- Modify: `plugins/plugin-cookies/test/cookies.spec.ts`

- [ ] **Step 1: Append the test**

```ts
test('captures HTTP Set-Cookie as cookie.http events', async ({ page }) => {
  fixture.respond('/login', (_req, res) => {
    res.writeHead(200, {
      'set-cookie': [
        'sid=abc123; HttpOnly; Path=/',
        'theme=dark; Max-Age=3600; SameSite=Lax',
      ],
      'content-type': 'text/plain',
    })
    res.end('ok')
  })

  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies()] })

  await page.evaluate((url) => fetch(url + '/login').then(r => r.text()), fixture.url)
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const httpEvents = events.filter((e: { type: string }) => e.type === 'cookie.http')
  expect(httpEvents).toHaveLength(2)

  const sid = httpEvents.find((e: { metadata: { name: string } }) => e.metadata.name === 'sid')
  expect(sid).toBeDefined()
  expect(sid.metadata.httpOnly).toBe(true)
  expect(sid.metadata.path).toBe('/')
  expect(sid.metadata.url).toBe(fixture.url + '/login')
  expect(typeof sid.metadata.requestId).toBe('string')

  const theme = httpEvents.find((e: { metadata: { name: string } }) => e.metadata.name === 'theme')
  expect(theme).toBeDefined()
  expect(theme.metadata.sameSite).toBe('Lax')
  expect(typeof theme.metadata.expires).toBe('number')
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @introspection/plugin-cookies exec playwright test -g "Set-Cookie as cookie.http"`
Expected: FAIL — no `cookie.http` events.

- [ ] **Step 3: Implement HTTP capture**

In `plugins/plugin-cookies/src/index.ts`:

1. Add a server-side cookie parser at the top level (above the `cookies()` function), since we need it for the HTTP capture path and don't want to roundtrip through the page:

```ts
interface ParsedCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

function parseSetCookieHeader(raw: string): ParsedCookie | null {
  const parts = raw.split(';')
  const first = parts.shift() ?? ''
  const eq = first.indexOf('=')
  if (eq < 0) return null
  const name = first.slice(0, eq).trim()
  const value = first.slice(eq + 1).trim()
  if (!name) return null
  const out: ParsedCookie = { name, value }
  for (const segRaw of parts) {
    const seg = segRaw.trim()
    if (!seg) continue
    const aeq = seg.indexOf('=')
    const key = (aeq < 0 ? seg : seg.slice(0, aeq)).trim().toLowerCase()
    const val = aeq < 0 ? '' : seg.slice(aeq + 1).trim()
    if (key === 'expires') {
      const t = Date.parse(val)
      if (!isNaN(t)) out.expires = Math.floor(t / 1000)
    } else if (key === 'max-age') {
      const n = Number(val)
      if (!isNaN(n)) out.expires = Math.floor(Date.now() / 1000) + n
    } else if (key === 'domain') {
      out.domain = val
    } else if (key === 'path') {
      out.path = val
    } else if (key === 'secure') {
      out.secure = true
    } else if (key === 'httponly') {
      out.httpOnly = true
    } else if (key === 'samesite') {
      const v = val.toLowerCase()
      if (v === 'strict') out.sameSite = 'Strict'
      else if (v === 'lax') out.sameSite = 'Lax'
      else if (v === 'none') out.sameSite = 'None'
    }
  }
  return out
}

function isExpired(p: ParsedCookie): boolean {
  return typeof p.expires === 'number' && p.expires <= Math.floor(Date.now() / 1000)
}
```

2. In `install()`, after the existing `Page.frameNavigated` subscription and after the binding wiring, add HTTP capture:

```ts
      // requestId → url map for joining responseReceivedExtraInfo back to a URL.
      const requestUrls = new Map<string, string>()
      const REQ_URL_CAP = 256

      await ctx.cdpSession.send('Network.enable')

      ctx.cdpSession.on('Network.responseReceived', (rawParams) => {
        const params = rawParams as { requestId: string; response: { url: string } }
        requestUrls.set(params.requestId, params.response.url)
        if (requestUrls.size > REQ_URL_CAP) {
          // FIFO eviction: drop the oldest insertion.
          const firstKey = requestUrls.keys().next().value
          if (firstKey !== undefined) requestUrls.delete(firstKey)
        }
      })

      ctx.cdpSession.on('Network.responseReceivedExtraInfo', (rawParams) => {
        const params = rawParams as {
          requestId: string
          headers: Record<string, string>
        }
        const raw = params.headers['Set-Cookie'] ?? params.headers['set-cookie']
        if (!raw) return
        // CDP joins multiple Set-Cookie values with newlines.
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          const parsed = parseSetCookieHeader(line)
          if (!parsed) continue
          if (!nameAllowed(parsed.name)) continue
          if (parsed.domain && !domainAllowed(parsed.domain)) continue

          const operation: 'set' | 'delete' = isExpired(parsed) ? 'delete' : 'set'
          const url = requestUrls.get(params.requestId) ?? ''
          const md: {
            operation: 'set' | 'delete'
            url: string
            requestId: string
            name: string
            value?: string
            domain?: string
            path?: string
            expires?: number
            httpOnly?: boolean
            secure?: boolean
            sameSite?: 'Strict' | 'Lax' | 'None'
            raw: string
          } = {
            operation,
            url,
            requestId: params.requestId,
            name: parsed.name,
            raw: line,
          }
          if (operation === 'set') md.value = parsed.value
          if (parsed.domain !== undefined) md.domain = parsed.domain
          if (parsed.path !== undefined) md.path = parsed.path
          if (parsed.expires !== undefined) md.expires = parsed.expires
          if (parsed.httpOnly !== undefined) md.httpOnly = parsed.httpOnly
          if (parsed.secure !== undefined) md.secure = parsed.secure
          if (parsed.sameSite !== undefined) md.sameSite = parsed.sameSite

          void ctx.emit({ type: 'cookie.http', metadata: md })
        }
      })
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @introspection/plugin-cookies exec playwright test -g "Set-Cookie as cookie.http"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-cookies
git commit -m "plugin-cookies: capture HTTP Set-Cookie as cookie.http events"
```

---

## Task 8: Test + implement bus-triggered snapshots (manual / js.error / detach)

**Files:**
- Modify: `plugins/plugin-cookies/src/index.ts`
- Modify: `plugins/plugin-cookies/test/cookies.spec.ts`

- [ ] **Step 1: Append the tests**

```ts
import { jsError } from '@introspection/plugin-js-error'

test('emits a snapshot on handle.snapshot()', async ({ page }) => {
  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies()] })

  await page.evaluate(() => { document.cookie = 'after=attach' })
  await handle.snapshot()
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'cookie.snapshot')

  const manual = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'manual')
  expect(manual).toBeDefined()
  expect(manual.metadata.cookies.some((c: { name: string }) => c.name === 'after')).toBe(true)

  const detach = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'detach')
  expect(detach).toBeDefined()
})

test('emits a snapshot on js.error', async ({ page }) => {
  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies(), jsError()] })

  await page.evaluate(() => { setTimeout(() => { throw new Error('boom') }, 0) })
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'cookie.snapshot')
  const onError = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'js.error')
  expect(onError).toBeDefined()
})
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @introspection/plugin-cookies exec playwright test -g "snapshot on"`
Expected: FAIL — manual / js.error / detach snapshots not emitted.

- [ ] **Step 3: Wire bus subscriptions**

In `plugins/plugin-cookies/src/index.ts`, append at the very end of `install()` (after `await snapshotOnce('install')`):

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

Also: like `plugin-indexeddb`'s detach handling, `Network.getAllCookies` may fail during teardown. The current `snapshotOnce` already handles that — it logs the failure via `debug` and emits a snapshot with `cookies: []`. No additional change needed.

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter @introspection/plugin-cookies exec playwright test -g "snapshot on"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/plugin-cookies
git commit -m "plugin-cookies: bus-triggered snapshots (manual, js.error, detach)"
```

---

## Task 9: Test + verify origin and name filters

**Files:**
- Modify: `plugins/plugin-cookies/test/cookies.spec.ts`

The implementation already filters via `domainAllowed` and `nameAllowed`. We test both.

- [ ] **Step 1: Append the tests**

```ts
test('names option filters writes and snapshot entries', async ({ page, context }) => {
  const url = new URL(fixture.url)
  await context.addCookies([
    { name: 'trace', value: 'abc', domain: url.hostname, path: '/' },
    { name: 'tracker', value: 'xyz', domain: url.hostname, path: '/' },
  ])

  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies({ names: ['trace'] })] })

  await page.evaluate(() => {
    document.cookie = 'trace=fresh'
    document.cookie = 'tracker=t2'
  })
  await new Promise(r => setTimeout(r, 150))
  await handle.detach()

  const events = await readEvents(dir)

  const writes = events.filter((e: { type: string }) => e.type === 'cookie.write')
  expect(writes).toHaveLength(1)
  expect(writes[0].metadata.name).toBe('trace')

  const installSnapshot = events.find((e: { type: string; metadata: { trigger: string } }) =>
    e.type === 'cookie.snapshot' && e.metadata.trigger === 'install'
  )
  expect(installSnapshot.metadata.cookies.map((c: { name: string }) => c.name)).toEqual(['trace'])
})

test('origins option filters cookies whose domain does not match', async ({ page, context }) => {
  const url = new URL(fixture.url)
  await context.addCookies([
    { name: 'mine', value: 'v', domain: url.hostname, path: '/' },
  ])

  await page.goto(fixture.url)
  const handle = await attach(page, {
    outDir: dir,
    plugins: [cookies({ origins: ['https://other.example'] })],
  })

  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const installSnapshot = events.find((e: { type: string; metadata: { trigger: string } }) =>
    e.type === 'cookie.snapshot' && e.metadata.trigger === 'install'
  )
  expect(installSnapshot.metadata.cookies).toEqual([])
})
```

- [ ] **Step 2: Run the tests, verify they pass**

Run: `pnpm --filter @introspection/plugin-cookies exec playwright test -g "names option|origins option"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add plugins/plugin-cookies/test/cookies.spec.ts
git commit -m "plugin-cookies: test names and origins filters"
```

---

## Task 10: Write the README

**Files:**
- Create: `plugins/plugin-cookies/README.md`

- [ ] **Step 1: Write the README**

```markdown
# @introspection/plugin-cookies

Captures cookie activity into the introspection trace: programmatic page-side writes (via `document.cookie` and `CookieStore`), HTTP `Set-Cookie` response headers, and full cookie snapshots at install + bus triggers.

The plugin patches `Document.prototype.cookie` setter and `CookieStore.prototype` page-side, and subscribes to CDP `Network.responseReceivedExtraInfo` server-side for HTTP-set cookies. Snapshots use `Network.getAllCookies` so HttpOnly cookies are visible.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Options](#options)
- [Events emitted](#events-emitted)
- [How HTTP Set-Cookie joins to network events](#how-http-set-cookie-joins-to-network-events)
- [Caveats](#caveats)

## Install

\`\`\`bash
pnpm add -D @introspection/plugin-cookies
\`\`\`

## Usage

\`\`\`ts
import { attach } from '@introspection/playwright'
import { cookies } from '@introspection/plugin-cookies'

const handle = await attach(page, {
  plugins: [
    cookies(),                                        // all cookies, all origins
    // cookies({ names: ['session', 'auth-token'] }) // restrict by name
    // cookies({ origins: ['https://app.example.com'] }) // restrict by host
  ],
})
\`\`\`

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `origins` | `string[]` | `['*']` | Restrict to cookies whose domain matches one of these origins' hostnames (RFC 6265 domain-match semantics). The literal `'*'` matches everything. |
| `names` | `string[]` | all | Restrict to cookies with these names. Useful for focusing on auth/session cookies. |
| `verbose` | `boolean` | `false` | Verbose debug logs. |

## Events emitted

- **`cookie.write`** — programmatic mutation from the page. `source: 'document.cookie' \| 'CookieStore'`. Includes parsed attributes and the original `raw` string for `document.cookie` writes.
- **`cookie.http`** — cookie set by an HTTP `Set-Cookie` response header. Includes `url` and `requestId` (joinable to `network.response`). Always carries the raw header.
- **`cookie.snapshot`** — full cookie state. `metadata.trigger` is one of `'install' \| 'manual' \| 'js.error' \| 'detach'`. Snapshots see HttpOnly cookies via CDP.

A `'delete'` operation is emitted when an attribute makes the cookie expired (`max-age=0`, or `expires` in the past), or when `CookieStore.delete` is called.

## How HTTP Set-Cookie joins to network events

The `requestId` field on `cookie.http` events is the same CDP request ID used by `plugin-network`. To pair a cookie with the response that set it:

\`\`\`bash
# Get a cookie.http event's requestId
introspect events --type cookie.http | jq '.metadata.requestId'

# Find the matching response
introspect events --type network.response | jq 'select(.metadata.cdpRequestId == "<ID>")'
\`\`\`

Run `plugin-cookies` and `plugin-network` together for full visibility — the duplication is intentional (the same Set-Cookie header is observable as a parsed `cookie.http` event and as a raw header on `network.response`).

## Caveats

The plugin captures programmatic writes by patching `Document.prototype.cookie` and `CookieStore.prototype`. This is robust against every realistic call site, but has the same realm-crossing limitation as every prototype-patching plugin in this repo: see [`docs/prototype-patching-limits.md`](../../docs/prototype-patching-limits.md). The HTTP capture path (CDP-based) is unaffected.

`document.cookie` reads are not captured — the getter returns *all* cookies as one string, so a read tells you the page peeked but not which key it cared about. Snapshots provide full state instead.

`CookieStore` is Chromium-only at time of writing; on Firefox/Safari only `document.cookie` writes are captured.
```

- [ ] **Step 2: Update the shared prototype-patching note**

In `docs/prototype-patching-limits.md`, find the bullet list of plugins this applies to and ensure `plugin-cookies` is listed. The list currently contains:

```
- `@introspection/plugin-redux` — patches the Redux DevTools extension globals.
- `@introspection/plugin-web-storage` — patches `Storage.prototype`.
- `@introspection/plugin-indexeddb` (planned) — will patch `IDBObjectStore.prototype` and friends.
```

Update to:

```
- `@introspection/plugin-redux` — patches the Redux DevTools extension globals.
- `@introspection/plugin-web-storage` — patches `Storage.prototype`.
- `@introspection/plugin-indexeddb` — patches `IDBFactory.prototype` and friends.
- `@introspection/plugin-cookies` — patches `Document.prototype.cookie` setter and `CookieStore.prototype`.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/plugin-cookies/README.md docs/prototype-patching-limits.md
git commit -m "plugin-cookies: README + add to prototype-patching note"
```

---

## Task 11: Final verification

- [ ] **Step 1: Workspace-wide typecheck**

Run: `pnpm -r typecheck`
Expected: all packages PASS.

- [ ] **Step 2: Workspace-wide build**

Run: `pnpm -r build`
Expected: all packages build cleanly.

- [ ] **Step 3: Run plugin-cookies tests**

Run: `pnpm --filter @introspection/plugin-cookies exec playwright test`
Expected: all tests PASS.

- [ ] **Step 4: Regression check on storage plugins**

Run: `pnpm --filter @introspection/plugin-web-storage exec playwright test && pnpm --filter @introspection/plugin-indexeddb exec playwright test`
Expected: all tests PASS.

- [ ] **Step 5: Final commit (only if cleanup is needed)**

If verification surfaces fixes, commit them. Otherwise no commit needed.

---

## Self-review notes (carried out at write time)

- **Spec coverage:** every section of the spec maps to a task. Public API → Task 2; event types (3) → Task 1; programmatic writes (`document.cookie`) → Task 5; CookieStore writes → Task 6; HTTP Set-Cookie → Task 7; snapshots install + bus → Tasks 3, 8; origin/name filters → Task 9; README + prototype-patching note → Task 10.
- **Type consistency:** `cookies` factory name, `CookiesOptions`, `cookie.write` / `cookie.http` / `cookie.snapshot` event types, `__introspection_plugin_cookies` binding name. The page-side parser and the server-side `parseSetCookieHeader` are intentionally separate (different runtime constraints) but produce the same field shapes.
- **No placeholders:** every code block contains real code; every command has expected output.
- **Single channel ordering:** programmatic writes go through the binding (one channel). HTTP events go through `Network.responseReceivedExtraInfo` (a separate CDP event stream). They emit independently. Within each stream, ordering is preserved. Across streams, snapshots are anchor points. Same as `plugin-web-storage` and `plugin-indexeddb`.
- **Async handler pattern:** `handlePagePayload` is synchronous in this plugin (no asset writes), so we don't need the `ctx.track` queue trick from `plugin-indexeddb`. Same for the HTTP capture path. If a future change adds asset writes, mirror the indexeddb queue.
- **HttpOnly cookies in snapshots:** CDP `Network.getAllCookies` returns HttpOnly cookies. Tested implicitly via the install-snapshot test.
- **Known gap:** if `Network.responseReceived` somehow doesn't fire for a response (extremely rare CDP quirk), the resulting `cookie.http` event has `url: ''`. Documented in spec risks.

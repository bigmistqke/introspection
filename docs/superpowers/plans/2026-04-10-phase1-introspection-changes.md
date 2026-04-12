# Phase 1: Introspection Changes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the introspection playwright package with screenshot asset capture, custom session IDs, test lifecycle events with titlePath, and a new plugin-redux package.

**Architecture:** The proxy gets extended to handle artifact-producing methods (screenshot). AttachOptions gains an `id` field. The fixture emits `playwright.test.start` and enriches `playwright.result` with `titlePath`. A new `plugin-redux` package captures store dispatches via the push bridge.

**Tech Stack:** TypeScript, Playwright, `@introspection/core`, `@introspection/types`

**Spec:** `docs/specs/2026-04-10-vitest-to-playwright-migration-design.md` (phases 1a–1d)

**Pre-existing issues:** The test files in `packages/playwright/test/` have broken imports (`../src/plugins/defaults.js` should be `@introspection/plugin-defaults`, and `@introspection/plugin-network`/`@introspection/plugin-js-error` are missing from devDependencies). Fix these before starting. Add `@introspection/plugin-network` and `@introspection/plugin-js-error` to `packages/playwright/package.json` devDependencies, and change `../src/plugins/defaults.js` to `@introspection/plugin-defaults` in both `attach.spec.ts` and `fixture.spec.ts`. Run `pnpm install` after.

---

### Task 1: Extend proxy to handle screenshot with writeAsset

**Files:**
- Modify: `packages/playwright/src/proxy.ts`
- Modify: `packages/playwright/src/attach.ts:124` (where `createPageProxy` is called)
- Modify: `packages/types/src/index.ts` (add `PlaywrightScreenshotEvent`)
- Test: `packages/playwright/test/proxy.spec.ts`

- [ ] **Step 1: Add `PlaywrightScreenshotEvent` type**

In `packages/types/src/index.ts`, after the `PlaywrightResultEvent` interface:

```typescript
export interface PlaywrightScreenshotEvent extends BaseEvent {
  type: 'playwright.screenshot'
  data: { path: string; viewport?: { width: number; height: number } }
}
```

Add to `TraceEventMap`:

```typescript
'playwright.screenshot': PlaywrightScreenshotEvent
```

- [ ] **Step 2: Run typecheck to confirm type addition compiles**

Run: `pnpm --filter @introspection/types typecheck`
Expected: PASS

- [ ] **Step 3: Write the failing test for screenshot proxy**

In `packages/playwright/test/proxy.spec.ts`, add:

```typescript
test('proxied page.screenshot() saves asset and emits playwright.screenshot event', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>screenshot test</body></html>' })
  )
  const handle = await attach(page, { outDir: dir })
  await handle.page.goto('http://localhost:9999/')
  const buffer = await handle.page.screenshot()
  expect(buffer).toBeInstanceOf(Buffer)
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const screenshotEvent = events.find((e: { type: string }) => e.type === 'playwright.screenshot')
  expect(screenshotEvent).toBeDefined()
  expect(screenshotEvent.source).toBe('playwright')
  expect(screenshotEvent.data.path).toContain('screenshot')
  expect(screenshotEvent.data.viewport).toBeDefined()

  // Verify the asset file exists
  const entries = await readdir(dir)
  const sessionDir = join(dir, entries[0])
  const assetPath = join(sessionDir, screenshotEvent.data.path)
  const assetContent = await readFile(assetPath)
  expect(assetContent.length).toBeGreaterThan(0)
})
```

Add `readFile` to the existing `readdir` import at the top of the file.

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @introspection/playwright test -- --grep "screenshot"`
Expected: FAIL — screenshot is not intercepted, no `playwright.screenshot` event emitted

- [ ] **Step 5: Extend `createPageProxy` signature to accept `writeAsset`**

In `packages/playwright/src/proxy.ts`:

This is a full replacement of `packages/playwright/src/proxy.ts`:

```typescript
import type { TraceEvent, EventSource } from '@introspection/types'
import type { Page } from '@playwright/test'

const TRACKED_METHODS = new Set([
  'click', 'fill', 'goto', 'press', 'selectOption', 'check',
  'uncheck', 'hover', 'dragAndDrop', 'evaluate', 'waitForURL', 'waitForSelector',
])

const ARTIFACT_METHODS = new Set(['screenshot'])

type EmitFn = (event: Omit<TraceEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) => void

type WriteAssetFn = (options: {
  kind: string
  content: string | Buffer
  ext?: string
  metadata: { timestamp: number; [key: string]: unknown }
  source?: EventSource
}) => Promise<string>

export interface PageProxyOptions {
  emit: EmitFn
  writeAsset: WriteAssetFn
  timestamp: () => number
  page: Page
}

export function createPageProxy(options: PageProxyOptions): Page {
  const { emit, writeAsset, timestamp, page } = options
  return new Proxy(page, {
    get(target, prop) {
      const original = target[prop as keyof Page]
      if (typeof original !== 'function') return original

      if (TRACKED_METHODS.has(prop as string)) {
        return (...args: unknown[]) => {
          emit({
            type: 'playwright.action',
            source: 'playwright',
            data: { method: prop as string, args: sanitizeArgs(args) },
          })
          return (original as Function).apply(target, args)
        }
      }

      if (ARTIFACT_METHODS.has(prop as string)) {
        return async (...args: unknown[]) => {
          const result = await (original as Function).apply(target, args)
          if (prop === 'screenshot') {
            const viewport = target.viewportSize()
            const path = await writeAsset({
              kind: 'screenshot',
              content: result as Buffer,
              ext: 'png',
              metadata: {
                timestamp: timestamp(),
                ...(viewport ? { viewport } : {}),
              },
              source: 'playwright',
            })
            emit({
              type: 'playwright.screenshot',
              source: 'playwright',
              data: {
                path,
                ...(viewport ? { viewport } : {}),
              },
            })
          }
          return result
        }
      }

      return original
    },
  })
}

function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map(arg => {
    if (arg === null || arg === undefined) return arg
    if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') return arg
    if (typeof arg === 'object') {
      try { return JSON.parse(JSON.stringify(arg)) } catch { return '[unserializable]' }
    }
    return '[function]'
  })
}
```

- [ ] **Step 6: Update `attach.ts` to use new `createPageProxy` signature**

In `packages/playwright/src/attach.ts`, change line 124 from:

```typescript
const proxiedPage = createPageProxy(page, (event) => emit(event))
```

to:

```typescript
const proxiedPage = createPageProxy({
  emit: (event) => emit(event),
  writeAsset: async (options) => writeAsset({
    directory: outDir, name: sessionId,
    kind: options.kind, content: options.content, ext: options.ext,
    metadata: options.metadata, source: options.source ?? 'playwright',
  }),
  timestamp,
  page,
})
```

- [ ] **Step 7: Run the screenshot test to verify it passes**

Run: `pnpm --filter @introspection/playwright test -- --grep "screenshot"`
Expected: PASS

- [ ] **Step 8: Run all proxy tests to verify no regressions**

Run: `pnpm --filter @introspection/playwright test -- proxy.spec`
Expected: All pass

- [ ] **Step 9: Run all tests to verify no regressions**

Run: `pnpm --filter @introspection/playwright test`
Expected: All pass

- [ ] **Step 10: Commit**

```bash
git add packages/playwright/src/proxy.ts packages/playwright/src/attach.ts packages/types/src/index.ts packages/playwright/test/proxy.spec.ts
git commit -m "feat(playwright): extend proxy to capture screenshots as assets"
```

---

### Task 2: Add custom session ID support

**Files:**
- Modify: `packages/playwright/src/attach.ts` (add `id` to `AttachOptions`)
- Test: `packages/playwright/test/attach.spec.ts`

- [ ] **Step 1: Write the failing test**

In `packages/playwright/test/attach.spec.ts`, add:

```typescript
test('custom session ID is used as directory name', async ({ page }) => {
  const customId = 'browser-desktop--loading--prepare-page'
  const handle = await attach(page, { outDir: dir, id: customId, plugins: [] })
  await handle.detach()
  const entries = await readdir(dir)
  expect(entries).toContain(customId)
  const meta = JSON.parse(await readFile(join(dir, customId, 'meta.json'), 'utf-8'))
  expect(meta.id).toBe(customId)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @introspection/playwright test -- --grep "custom session ID"`
Expected: FAIL — `id` not recognized in `AttachOptions`

- [ ] **Step 3: Write the failing test for duplicate ID error**

```typescript
test('duplicate session ID throws an error', async ({ page }) => {
  const customId = 'duplicate-test'
  const handle1 = await attach(page, { outDir: dir, id: customId, plugins: [] })
  await handle1.detach()
  await expect(attach(page, { outDir: dir, id: customId, plugins: [] }))
    .rejects.toThrow()
})
```

- [ ] **Step 4: Implement custom session ID in `attach.ts`**

In `packages/playwright/src/attach.ts`, change the `AttachOptions` interface:

```typescript
export interface AttachOptions {
  outDir?: string
  id?: string
  testTitle?: string
  workerIndex?: number
  plugins?: IntrospectionPlugin[]
  verbose?: boolean
}
```

Change line 19 from:

```typescript
const sessionId = randomUUID()
```

to:

```typescript
const sessionId = opts.id ?? randomUUID()
```

- [ ] **Step 5: Add duplicate ID check in `initSessionDir`**

In `packages/core/src/session-writer.ts`, in the `initSessionDir` function, before creating the directory, add a check:

```typescript
import { writeFile, mkdir, appendFile, readFile, stat } from 'fs/promises'
```

Then in `initSessionDir`, before `await mkdir(...)`:

```typescript
const exists = await stat(sessionDir).then(() => true, () => false)
if (exists) throw new Error(`Session directory already exists: ${sessionDir}`)
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `pnpm --filter @introspection/playwright test -- --grep "session ID"`
Expected: Both PASS

- [ ] **Step 7: Run all tests**

Run: `pnpm --filter @introspection/playwright test`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add packages/playwright/src/attach.ts packages/core/src/session-writer.ts packages/playwright/test/attach.spec.ts
git commit -m "feat(playwright): support custom session IDs with duplicate detection"
```

---

### Task 3: Add test lifecycle events with titlePath

**Files:**
- Modify: `packages/types/src/index.ts` (add `PlaywrightTestStartEvent`, extend `PlaywrightResultEvent`)
- Modify: `packages/playwright/src/fixture.ts`
- Modify: `packages/playwright/src/attach.ts` (add `titlePath` to `AttachOptions` and `DetachResult`)
- Test: `packages/playwright/test/fixture.spec.ts`

- [ ] **Step 1: Add `PlaywrightTestStartEvent` type and extend `PlaywrightResultEvent`**

In `packages/types/src/index.ts`:

Add after `PlaywrightActionEvent`:

```typescript
export interface PlaywrightTestStartEvent extends BaseEvent {
  type: 'playwright.test.start'
  data: { titlePath: string[] }
}
```

Change `PlaywrightResultEvent` to:

```typescript
export interface PlaywrightResultEvent extends BaseEvent {
  type: 'playwright.result'
  data: { status?: 'passed' | 'failed' | 'timedOut' | 'skipped'; duration?: number; error?: string; titlePath?: string[] }
}
```

Add to `TraceEventMap`:

```typescript
'playwright.test.start': PlaywrightTestStartEvent
```

- [ ] **Step 2: Extend `AttachOptions` and `DetachResult`**

In `packages/types/src/index.ts`, change `DetachResult`:

```typescript
export interface DetachResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped'
  duration?: number
  error?: string
  titlePath?: string[]
}
```

In `packages/playwright/src/attach.ts`, add `titlePath` to `AttachOptions`:

```typescript
export interface AttachOptions {
  outDir?: string
  id?: string
  testTitle?: string
  titlePath?: string[]
  workerIndex?: number
  plugins?: IntrospectionPlugin[]
  verbose?: boolean
}
```

After the `debug('attach', ...)` line, add:

```typescript
if (opts.titlePath) {
  emit({ type: 'playwright.test.start', source: 'playwright', data: { titlePath: opts.titlePath } })
}
```

Note: place this after the push bridge setup and plugin installation block (just before `const proxiedPage = ...`). This means the `playwright.test.start` event is emitted during `attach()`, which the fixture calls before `use()` — so it appears in the session before any test actions.

- [ ] **Step 3: Update the fixture to pass `titlePath`**

In `packages/playwright/src/fixture.ts`, change the `attach` call:

```typescript
const handle = await attach(page, {
  testTitle: testInfo.title,
  titlePath: testInfo.titlePath,
  workerIndex: testInfo.workerIndex,
  plugins: opts.plugins,
  ...(opts.outDir ? { outDir: opts.outDir } : {}),
})
```

And change the `detach` call:

```typescript
await handle.detach({ status, duration: testInfo.duration, error: testInfo.error?.message, titlePath: testInfo.titlePath })
```

- [ ] **Step 4: Write the failing test**

In `packages/playwright/test/fixture.spec.ts`, the existing `test.afterAll` reads `entries[0]` but there will now be multiple sessions. Rewrite the `test.afterAll` to read ALL session directories and collect ALL events:

```typescript
test.afterAll(() => {
  const entries = readdirSync(outDir).filter(entry => !entry.startsWith('.'))
  expect(entries.length).toBeGreaterThan(0)

  // Collect events from all sessions
  const allEvents: Record<string, unknown>[] = []
  for (const entry of entries) {
    const sessionDir = join(outDir, entry)
    const meta = JSON.parse(readFileSync(join(sessionDir, 'meta.json'), 'utf-8'))
    expect(meta.endedAt).toBeDefined()
    const ndjson = readFileSync(join(sessionDir, 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    allEvents.push(...events)
  }

  const mark = allEvents.find((event: { type: string }) => event.type === 'mark')
  expect(mark).toBeDefined()
  expect(mark.data.label).toBe('step 1')

  const playwrightResult = allEvents.find((event: { type: string }) => event.type === 'playwright.result')
  expect(playwrightResult).toBeDefined()
  expect(playwrightResult.data.status).toBe('passed')
  expect(playwrightResult.data.titlePath).toBeDefined()

  const testStart = allEvents.find((event: { type: string }) => event.type === 'playwright.test.start')
  expect(testStart).toBeDefined()
  expect(testStart.data.titlePath).toBeDefined()
  expect(Array.isArray(testStart.data.titlePath)).toBe(true)

  rmSync(outDir, { recursive: true, force: true })
})
```

Also add a second test before `test.afterAll`:

```typescript
test('fixture emits playwright.test.start with titlePath', async ({ introspect }) => {
  // just needs to run — the afterAll checks the events across all sessions
})
```

- [ ] **Step 5: Run tests to verify failure**

Run: `pnpm --filter @introspection/playwright test -- fixture.spec`
Expected: FAIL — no `playwright.test.start` event found

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @introspection/playwright test -- fixture.spec`
Expected: PASS

- [ ] **Step 7: Run all tests**

Run: `pnpm --filter @introspection/playwright test`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/index.ts packages/playwright/src/attach.ts packages/playwright/src/fixture.ts packages/playwright/test/fixture.spec.ts
git commit -m "feat(playwright): emit test lifecycle events with titlePath"
```

---

### Task 4: Create `plugin-redux`

**Files:**
- Create: `packages/plugin-redux/package.json`
- Create: `packages/plugin-redux/tsconfig.json`
- Create: `packages/plugin-redux/src/index.ts`
- Create: `packages/plugin-redux/src/event-types.ts`
- Test: `packages/playwright/test/attach.spec.ts` (test via push bridge in existing test infra)

- [ ] **Step 1: Scaffold the package**

Check an existing plugin for the package structure:

```bash
ls packages/plugin-console/
cat packages/plugin-console/package.json
cat packages/plugin-console/tsconfig.json
```

- [ ] **Step 2: Create `packages/plugin-redux/package.json`**

```json
{
  "name": "@introspection/plugin-redux",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js"
    },
    "./event-types": {
      "types": "./src/event-types.ts",
      "import": "./dist/event-types.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts src/event-types.ts --format esm --dts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@introspection/types": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 3: Create `packages/plugin-redux/tsconfig.json`**

Copy from `packages/plugin-console/tsconfig.json` — it should extend the root tsconfig.

- [ ] **Step 4: Create `packages/plugin-redux/src/event-types.ts`**

```typescript
import type { BaseEvent } from '@introspection/types'

export interface ReduxDispatchEvent extends BaseEvent {
  type: 'redux.dispatch'
  data: { action: string; payload?: unknown; stateBefore?: unknown; stateAfter?: unknown }
}

declare module '@introspection/types' {
  interface TraceEventMap {
    'redux.dispatch': ReduxDispatchEvent
  }
}
```

- [ ] **Step 5: Create `packages/plugin-redux/src/index.ts`**

```typescript
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import './event-types.js'

export type { ReduxDispatchEvent } from './event-types.js'

export interface ReduxPluginOptions {
  /** Capture state before/after each dispatch. Can be expensive. Default: false */
  captureState?: boolean
}

export function redux(options?: ReduxPluginOptions): IntrospectionPlugin {
  const captureState = options?.captureState ?? false

  // Browser-side script that patches the global store's dispatch.
  // Expects the app to expose the store on a known global (e.g. window.__REDUX_STORE__).
  // Pushes dispatch events via the introspection push bridge.
  const script = `
    (function() {
      function patchStore(store) {
        if (store.__introspect_patched__) return;
        store.__introspect_patched__ = true;
        var originalDispatch = store.dispatch;
        store.dispatch = function(action) {
          var event = {
            type: 'redux.dispatch',
            data: { action: action.type || String(action) }
          };
          if (action.payload !== undefined) {
            try { event.data.payload = JSON.parse(JSON.stringify(action.payload)); } catch(e) {}
          }
          ${captureState ? `
          try { event.data.stateBefore = JSON.parse(JSON.stringify(store.getState())); } catch(e) {}
          ` : ''}
          var result = originalDispatch.apply(store, arguments);
          ${captureState ? `
          try { event.data.stateAfter = JSON.parse(JSON.stringify(store.getState())); } catch(e) {}
          ` : ''}
          if (window.__introspect_push__) {
            window.__introspect_push__(JSON.stringify(event));
          }
          return result;
        };
      }

      // Patch immediately if store exists
      if (window.__REDUX_STORE__) patchStore(window.__REDUX_STORE__);

      // Watch for store to be set later
      var existing = window.__REDUX_STORE__;
      Object.defineProperty(window, '__REDUX_STORE__', {
        get: function() { return existing; },
        set: function(store) {
          existing = store;
          if (store) patchStore(store);
        },
        configurable: true
      });
    })();
  `

  return {
    name: 'redux',
    description: 'Captures store dispatches from Redux, Zustand, Valtio, and Redux DevTools–compatible libraries',
    events: {
      'redux.dispatch': 'Store dispatch with action type and optional payload/state',
    },
    script,
    async install(_context: PluginContext): Promise<void> {
      // All work is done browser-side via the script
    },
  }
}
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @introspection/plugin-redux typecheck`
Expected: PASS

- [ ] **Step 7: Write the integration test**

In `packages/playwright/test/attach.spec.ts`, add:

```typescript
test('plugin-redux captures dispatch events via push bridge', async ({ page }) => {
  // Import at top of file: import { redux } from '@introspection/plugin-redux'
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' })
  )
  const handle = await attach(page, { outDir: dir, plugins: [redux()] })
  await handle.page.goto('http://localhost:9999/')

  // Simulate a Redux store in the browser
  await page.evaluate(() => {
    const store = {
      dispatch(action: { type: string; payload?: unknown }) { return action },
      getState() { return { count: 0 } },
    };
    (window as unknown as Record<string, unknown>).__REDUX_STORE__ = store
    // Give the defineProperty setter time to patch
    setTimeout(() => {
      store.dispatch({ type: 'INCREMENT', payload: { amount: 1 } })
    }, 50)
  })

  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const dispatch = events.find((event: { type: string }) => event.type === 'redux.dispatch')
  expect(dispatch).toBeDefined()
  expect(dispatch.data.action).toBe('INCREMENT')
  expect(dispatch.data.payload).toEqual({ amount: 1 })
})
```

- [ ] **Step 8: Add `@introspection/plugin-redux` dependency to playwright package**

In `packages/playwright/package.json`, add to `devDependencies`:

```json
"@introspection/plugin-redux": "workspace:*"
```

Run: `pnpm install`

- [ ] **Step 9: Run the test**

Run: `pnpm --filter @introspection/playwright test -- --grep "plugin-redux"`
Expected: PASS

- [ ] **Step 10: Run all tests**

Run: `pnpm --filter @introspection/playwright test`
Expected: All pass

- [ ] **Step 11: Commit**

```bash
git add packages/plugin-redux/ packages/playwright/test/attach.spec.ts packages/playwright/package.json pnpm-lock.yaml
git commit -m "feat: add plugin-redux for capturing store dispatches"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All packages pass

- [ ] **Step 2: Run typecheck across all packages**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Build all packages**

Run: `pnpm build`
Expected: Clean build

# Phase 3+4: Observability Migration & Viewer Rewrite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all custom observability (testLogger, __testLog, createGlobalPage handlers) with introspection as the single source of truth. Rewrite the integration-tests-viewer to read from introspection sessions.

**Architecture:** Wire `@introspection/playwright` into the integration tests via `createGlobalPage`. The introspection proxy captures screenshots, plugins capture console/network/errors via CDP. Remove all Playwright `.on()` handlers, pino logging, and manifest.jsonl writing. The viewer reads introspection session directories instead.

**Tech Stack:** `@introspection/playwright`, `@introspection/plugin-console`, `@introspection/plugin-network`, `@introspection/plugin-js-error`, `@introspection/plugin-redux`

**Spec:** `docs/specs/2026-04-10-vitest-to-playwright-migration-design.md` (Phase 3 + Phase 4)

**Working directory:** `/Users/puckey/rg/develop/.worktrees/phase3-observability`

---

### Task 1: Wire introspection into integration-tests

Add `@introspection/playwright` and plugins as dependencies. Create a module that manages the introspection session lifecycle alongside `createGlobalPage`.

**Files:**
- Modify: `services/integration-tests/package.json` (add introspection deps)
- Create: `services/integration-tests/util/introspection.ts`
- Modify: `services/integration-tests/util/index.ts` (export introspection)
- Modify: `services/integration-tests/util/createGlobalPage.ts` (call attach after page creation)
- Modify: `services/integration-tests/setup.ts` (call detach in afterEach)

- [ ] **Step 1: Add dependencies**

```bash
cd /Users/puckey/rg/develop/.worktrees/phase3-observability
pnpm -F @rg/integration-tests add -D @introspection/playwright @introspection/plugin-console @introspection/plugin-network @introspection/plugin-js-error @introspection/plugin-redux @introspection/plugin-defaults
```

Note: These are workspace packages from the introspection monorepo. If they're not resolvable as workspace deps, add them via file path or publish first. The implementer should check how the monorepo is set up.

- [ ] **Step 2: Create `util/introspection.ts`**

This module manages the introspection handle lifecycle. It's separate from `createGlobalPage` to keep concerns clean.

```typescript
import { attach } from '@introspection/playwright'
import { consolePlugin } from '@introspection/plugin-console'
import { network } from '@introspection/plugin-network'
import { jsError } from '@introspection/plugin-js-error'
import { redux } from '@introspection/plugin-redux'
import type { IntrospectHandle } from '@introspection/types'
import type { Page } from 'playwright'

let currentHandle: IntrospectHandle | undefined

const plugins = [
  consolePlugin(),
  network(),
  jsError(),
  redux(),
]

export async function attachIntrospection(page: Page, options: {
  outDir: string
  id?: string
  testTitle?: string
}): Promise<IntrospectHandle> {
  // Detach previous session if page was recreated mid-test
  if (currentHandle) {
    await currentHandle.detach().catch(() => {})
    currentHandle = undefined
  }

  const handle = await attach(page, {
    outDir: options.outDir,
    id: options.id,
    testTitle: options.testTitle,
    plugins,
  })

  currentHandle = handle
  return handle
}

export async function detachIntrospection(result?: {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped'
  duration?: number
  error?: string
  titlePath?: string[]
}): Promise<void> {
  if (!currentHandle) return
  await currentHandle.detach(result)
  currentHandle = undefined
}

export function getCurrentHandle(): IntrospectHandle | undefined {
  return currentHandle
}
```

- [ ] **Step 3: Wire attach into `createGlobalPage`**

In `createGlobalPage.ts`, after `global.page = await global.context.newPage()` and after all the `addInitScript` calls (mock date, flags), but BEFORE the `.on()` handlers, add:

```typescript
import { attachIntrospection } from './introspection.ts'
import { logsDirectory } from '~/logs/config.ts'
```

Then after the `addInitScript` blocks and `exposeFunction('__testLog', ...)`, add:

```typescript
if (logsDirectory) {
  const handle = await attachIntrospection(global.page, {
    outDir: logsDirectory,
    testTitle: 'unknown', // will be set by fixture/afterEach
  })
  // Replace global.page with the introspection-proxied page
  global.page = handle.page
}
```

This means all subsequent `global.page.screenshot()` calls flow through the introspection proxy.

- [ ] **Step 4: Wire detach into `setup.ts`**

In `setup.ts`, add a `test.afterEach` that detaches with test status:

```typescript
import { detachIntrospection } from '~/util/introspection.ts'

export function setup() {
  // ... existing afterAll ...

  test.afterEach(async ({}, testInfo) => {
    const knownStatuses = ['passed', 'failed', 'timedOut', 'skipped'] as const
    const status = (knownStatuses as readonly string[]).includes(testInfo.status ?? '')
      ? testInfo.status as typeof knownStatuses[number]
      : 'failed' as const
    await detachIntrospection({
      status,
      duration: testInfo.duration,
      error: testInfo.errors?.[0]?.message,
      titlePath: testInfo.titlePath,
    })
  })

  testLogger.setup()
  setupLogs()
}
```

- [ ] **Step 5: Verify test listing still works**

```bash
cd /Users/puckey/rg/develop/.worktrees/phase3-observability
pnpm -F @rg/integration-tests exec npx playwright test platforms/browser-desktop/tests/balloon.test.ts --list
```

Expected: Tests list without errors.

- [ ] **Step 6: Commit**

```bash
HUSKY=0 git commit -am "feat(integration-tests): wire introspection into test infrastructure"
```

---

### Task 2: Gut `createGlobalPage` — remove all observability code

Remove everything that introspection plugins now handle.

**Files:**
- Modify: `services/integration-tests/util/createGlobalPage.ts`

- [ ] **Step 1: Remove the Playwright debug logger hook**

Delete lines 19-49 (the `debugLogger` monkey-patch). This was a fragile internal hook — Playwright Test's `--trace on` provides equivalent debugging.

- [ ] **Step 2: Remove the `__testLog` bridge**

Delete `await global.page.exposeFunction('__testLog', ...)` (line ~255). The introspection push bridge (`__introspect_push__`) replaces this.

- [ ] **Step 3: Remove the fetch error wrapper from addInitScript**

In the mock date `addInitScript` callback, remove the entire fetch wrapper (lines ~198-233). The `plugin-network` captures fetch errors via CDP.

Keep the MockDate class and the flag injection `addInitScript` — those stay.

- [ ] **Step 4: Remove all `.on()` event handlers**

Delete the entire block from `global.page.on('framenavigated', ...)` through `.on('console', ...)` (lines ~264-391). These are replaced by:
- `framenavigated` → not needed (introspection tracks navigation)
- `pageerror` → `plugin-js-error`
- `request`/`response` → `plugin-network`
- `console` → `plugin-console`

- [ ] **Step 5: Remove unused imports**

After removing the handlers, these imports become unused:
- `testLogger` from `~/logs/index.ts`
- `logWhitelist`, `logs` from `./logs.ts`
- `logger` from `./misc.ts`
- `formatJson`, `isNotNullish`, `serializeError` from `@rg/util`
- `createRequire` from `node:module`
- `path` from `node:path`
- `Request` type from `playwright`

Keep: `env`, `isString` from `@rg/util`, `retry` from `p-retry`, `chromium`, `devices` from `playwright`, `DEFAULT_MOCK_DATE` from `./constants.ts`.

- [ ] **Step 6: Remove the `id` variable**

Delete `const id = Math.random().toString(36).slice(2, 6)` — was only used for log formatting.

- [ ] **Step 7: Verify the gutted file compiles**

The remaining `createGlobalPage` should only contain:
- `launchBrowser()` — browser launch config
- Browser/context reuse logic
- Mock date `addInitScript`
- Flag injection `addInitScript`
- Storage clearing
- Introspection attach call

```bash
cd /Users/puckey/rg/develop/.worktrees/phase3-observability
pnpm -F @rg/integration-tests exec tsc --noEmit --skipLibCheck 2>&1 | head -20
```

- [ ] **Step 8: Commit**

```bash
HUSKY=0 git commit -am "feat(integration-tests): gut createGlobalPage observability code"
```

---

### Task 3: Remove `testLogger` and pino logging infrastructure

**Files:**
- Modify: `services/integration-tests/logs/index.ts` (gut entirely)
- Modify: `services/integration-tests/setup.ts` (remove testLogger.setup())
- Modify: `services/integration-tests/util/logs.ts` (may need adjustment)

- [ ] **Step 1: Gut `logs/index.ts`**

The `testLogger` object with its pino logger, beforeEach/afterEach for log files, screenshot capturing, and manifest.jsonl writing — all of this is replaced by introspection.

Remove the entire `testLogger` object and its `setup()` method. The screenshots are now captured by the introspection proxy (via `page.screenshot()` in the afterEach), and logs are in `events.ndjson`.

The file should export nothing or just a minimal shim if other files still reference `testLogger`. Check all consumers:

```bash
grep -rn "testLogger" services/integration-tests/ --include="*.ts" | grep -v node_modules | grep -v logs/index.ts
```

If consumers exist (like `createGlobalPage`, `app-ios/settings.ts`), either remove those references first or provide a no-op shim.

- [ ] **Step 2: Update `setup.ts`**

Remove `testLogger.setup()` call and the `testLogger` import.

- [ ] **Step 3: Remove pino dependency if no longer used**

```bash
grep -rn "from 'pino'" services/integration-tests/ --include="*.ts" | grep -v node_modules
```

If only `logs/index.ts` used it, remove pino from package.json.

- [ ] **Step 4: Commit**

```bash
HUSKY=0 git commit -am "feat(integration-tests): remove testLogger and pino logging"
```

---

### Task 4: Frontend cleanup — remove `__testLog`

**Files:**
- Modify: `services/frontend/src/store/logger.ts`
- Modify: `services/frontend/src/emitter/emitter.ts`
- Modify: `services/frontend/src/types/window.d.ts` (remove __testLog type)
- Modify: `services/integration-tests/types/index.d.ts` (remove __testLog type)

- [ ] **Step 1: Remove `__testLog` from `logger.ts`**

Remove the `window.__testLog?.({ ... })` calls. Keep the `console.log` calls — `plugin-console` captures those via CDP. Keep the `isPlaywright` check — it controls reduced logging.

The dispatch logger should just do `console.log(...)` without `__testLog`.

- [ ] **Step 2: Remove `__testLog` from `emitter.ts`**

Remove `window.__testLog?.({ ... })` call. The `console.log` call stays — `plugin-console` captures it.

- [ ] **Step 3: Remove `__testLog` type declarations**

In `services/frontend/src/types/window.d.ts` and `services/integration-tests/types/index.d.ts`, remove the `__testLog` function declaration from the Window interface.

- [ ] **Step 4: Verify no remaining `__testLog` references**

```bash
grep -rn "__testLog" services/ --include="*.ts" | grep -v node_modules
```

Expected: No results.

- [ ] **Step 5: Commit**

```bash
HUSKY=0 git commit -am "feat(frontend): remove __testLog bridge, replaced by introspection plugins"
```

---

### Task 5: Add screenshot afterEach via introspection

The old `logs/index.ts` took screenshots after each test (with light/dark mode pairs). With introspection, `page.screenshot()` goes through the proxy and is captured as an asset. We need an afterEach that takes screenshots.

**Files:**
- Modify: `services/integration-tests/setup.ts`

- [ ] **Step 1: Add screenshot afterEach**

In `setup.ts`, add a `test.afterEach` that takes a screenshot via `global.page`. Since `global.page` is the introspection-proxied page, the screenshot is automatically captured as an introspection asset.

```typescript
test.afterEach(async ({}, testInfo) => {
  const { page } = global
  if (!page) return

  // Light mode screenshot
  await page.screenshot()

  // Dark mode screenshot if dm is enabled
  if (dm) {
    const currentMode = await getAppearanceMode().catch(() => undefined)
    if (currentMode) {
      await page.evaluate((mode: string) => {
        document.documentElement.dataset['mode'] = mode
      }, 'dark')
      await page.screenshot()
      await page.evaluate((mode: string) => {
        document.documentElement.dataset['mode'] = mode
      }, currentMode)
    }
  }
})
```

Import `dm` from `~/logs/config.ts` and `getAppearanceMode` from `~/util/index.ts`.

Note: the introspection detach afterEach (from Task 1) must run AFTER this screenshot afterEach. Playwright runs afterEach hooks in reverse registration order — so register the screenshot afterEach BEFORE the detach afterEach in `setup.ts`.

- [ ] **Step 2: Commit**

```bash
HUSKY=0 git commit -am "feat(integration-tests): add screenshot capture via introspection proxy"
```

---

### Task 6: Rewrite viewer middleware to read introspection sessions

The viewer's middleware reads `manifest.jsonl` and `meta.json`. Replace with reading introspection session directories.

**Files:**
- Modify: `services/integration-tests-viewer/middleware/index.ts`
- Modify: `services/integration-tests/logs/parse.ts` (add session parsing utilities)

- [ ] **Step 1: Add session parsing utilities to `logs/parse.ts`**

This file is shared between integration-tests and the viewer (it's exported via package.json `exports`). Add functions that parse introspection session data:

```typescript
export interface SessionMeta {
  id: string
  startedAt: number
  endedAt?: number
  label?: string
}

export interface SessionEvent {
  id: string
  type: string
  timestamp: number
  source: string
  data: Record<string, unknown>
}

export function parseSessionMeta(raw: string): SessionMeta {
  try {
    const parsed = JSON.parse(raw)
    return { id: parsed.id, startedAt: parsed.startedAt, endedAt: parsed.endedAt, label: parsed.label }
  } catch {
    return { id: 'unknown', startedAt: 0 }
  }
}

export function parseEventsNdjson(raw: string): SessionEvent[] {
  return raw.trim().split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line) }
    catch { return null }
  }).filter(Boolean) as SessionEvent[]
}

export function extractManifestEntryFromSession(
  sessionDirectory: string,
  sessionMeta: SessionMeta,
  events: SessionEvent[]
): ManifestEntry | undefined {
  const testStart = events.find(event => event.type === 'playwright.test.start')
  const testResult = events.find(event => event.type === 'playwright.result')
  const screenshot = events.find(event => event.type === 'playwright.screenshot')

  if (!testStart) return undefined

  const titlePath = (testStart.data.titlePath as string[]) ?? []
  const name = titlePath[titlePath.length - 1] ?? sessionMeta.label ?? 'unknown'
  const suites = titlePath.slice(1, -1) // Remove root empty string and leaf test name

  const status = (testResult?.data as Record<string, unknown>)?.status as string | undefined
  const state = status === 'passed' ? 'pass' : status === 'failed' ? 'fail' : status

  const screenshotPath = screenshot ? (screenshot.data as Record<string, unknown>).path as string : undefined
  const viewport = screenshot ? (screenshot.data as Record<string, unknown>).viewport as { width: number; height: number } | undefined : undefined

  return {
    path: sessionDirectory,
    name,
    suites,
    state,
    screenshot: screenshotPath ? `${sessionDirectory}/${screenshotPath}` : undefined,
    viewport,
  }
}
```

- [ ] **Step 2: Update viewer middleware `queryjob`**

In `services/integration-tests-viewer/middleware/index.ts`, rewrite the `queryjob` function to read session directories instead of `manifest.jsonl`:

Read all subdirectories of the job directory. For each one that contains `meta.json` (indicating it's a session), read `meta.json` and `events.ndjson`, then extract a manifest entry using the new utility.

The `meta.json` at the job root level stays — it still contains run-level git metadata.

- [ ] **Step 3: Update the `mountLogs` middleware to serve session assets**

Session screenshots are at `<session-id>/assets/<filename>.png`. The middleware needs to serve these. The current `mountLogs` already serves arbitrary files from the logs directory — session assets are just deeper paths. This should work without changes, but verify.

- [ ] **Step 4: Commit**

```bash
HUSKY=0 git commit -am "feat(integration-tests-viewer): read from introspection sessions"
```

---

### Task 7: CronitorReporter reads from introspection

The CronitorReporter was already ported to Playwright's Reporter interface in Phase 2. The spec says it should read from introspection sessions. Currently it counts pass/fail from Playwright's `onTestEnd`. This is actually fine — Playwright's reporter API gives us the same data. No change needed unless we want it to read from events.ndjson specifically.

**Decision:** Keep the Playwright Reporter API — it already provides pass/fail/duration without needing to parse introspection files. Skip this task.

---

### Task 8: Final verification

- [ ] **Step 1: Verify test listing**

```bash
cd /Users/puckey/rg/develop/.worktrees/phase3-observability
pnpm -F @rg/integration-tests exec npx playwright test platforms/browser-desktop --list
```

Expected: Tests list without errors.

- [ ] **Step 2: Verify no remaining __testLog references**

```bash
grep -rn "__testLog" services/ --include="*.ts" | grep -v node_modules
```

- [ ] **Step 3: Verify no remaining testLogger references**

```bash
grep -rn "testLogger" services/integration-tests/ --include="*.ts" | grep -v node_modules | grep -v "logs/index.ts"
```

- [ ] **Step 4: Verify createGlobalPage has no .on() handlers**

```bash
grep "\.on(" services/integration-tests/util/createGlobalPage.ts
```

Expected: No results.

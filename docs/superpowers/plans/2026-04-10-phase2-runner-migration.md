# Phase 2: Vitest → Playwright Test Runner Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Vitest with Playwright Test as the test runner for `services/integration-tests`, preserving the suite-as-function pattern and all existing test behavior.

**Architecture:** Keep `global.page` for all utility functions (minimizes blast radius). Replace the runner (vitest→playwright), the wrappers (describe/it→test.describe/test), and the configuration. A codemod script handles the ~150 file mechanical renames. The `createGlobalPage` function stays intact — it's called from a fixture that sets `global.page`. Phase 3 will gut the observability code from it.

**Tech Stack:** Playwright Test, TypeScript, `tinyspy` (vi.fn replacement)

**Spec:** `docs/specs/2026-04-10-vitest-to-playwright-migration-design.md` (Phase 2)

**Working directory:** `/Users/puckey/rg/develop/services/integration-tests`

---

### Task 1: Create mock utility to replace `vi.fn()`

The `app-ios/settings.ts` uses `vi.fn()` ~30 times for native channel mocks. Playwright Test has no built-in mock functions. Create a thin wrapper around `tinyspy`.

**Files:**
- Create: `services/integration-tests/util/mock.ts`
- Modify: `services/integration-tests/package.json` (add `tinyspy` dependency)

- [ ] **Step 1: Install tinyspy**

```bash
cd /Users/puckey/rg/develop
pnpm -F @rg/integration-tests add -D tinyspy
```

- [ ] **Step 2: Create `util/mock.ts`**

```typescript
import { spy } from 'tinyspy'

export interface MockFunction<TArgs extends unknown[] = unknown[], TReturn = unknown> {
  (...args: TArgs): TReturn
  calls: TArgs[]
  returns: TReturn[]
  reset(): void
}

export function createMock<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  implementation?: (...args: TArgs) => TReturn
): MockFunction<TArgs, TReturn> {
  const spyInstance = spy(implementation ?? (() => undefined as TReturn))
  const mock = ((...args: TArgs) => spyInstance(...args)) as MockFunction<TArgs, TReturn>
  Object.defineProperty(mock, 'calls', { get: () => spyInstance.calls })
  Object.defineProperty(mock, 'returns', { get: () => spyInstance.returns })
  mock.reset = () => spyInstance.reset()
  return mock
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/puckey/rg/develop && pnpm -F @rg/integration-tests exec tsc --noEmit --skipLibCheck`
Expected: No errors for the new file

- [ ] **Step 4: Commit**

```bash
cd /Users/puckey/rg/develop
git add services/integration-tests/util/mock.ts services/integration-tests/package.json pnpm-lock.yaml
git commit -m "feat(integration-tests): add createMock utility to replace vi.fn"
```

---

### Task 2: Create `playwright.config.ts`

**Files:**
- Create: `services/integration-tests/playwright.config.ts`

- [ ] **Step 1: Create the config**

```typescript
import path from 'node:path'
import os from 'os'
import { defineConfig } from '@playwright/test'

const threads = process.env.INTEGRATION_TESTS_THREADS
  ? Number(process.env.INTEGRATION_TESTS_THREADS)
  : Math.ceil(os.cpus().length - 2)

export default defineConfig({
  testDir: './platforms',
  testMatch: '**/*.test.ts',
  fullyParallel: false,
  workers: threads,
  timeout: process.env.NT ? 20 * 24 * 60 * 60_000 : 60_000,
  globalSetup: './globalSetup.ts',
  reporter: process.env.INTEGRATION_TESTS_LOGS_DIRECTORY
    ? [
        ['./reporters/CronitorReporter.ts', { id: '2NKI7X' }],
        ['list'],
        ['json', { outputFile: path.join(process.env.INTEGRATION_TESTS_LOGS_DIRECTORY, 'results.json') }],
      ]
    : [['list']],
  use: {
    headless: process.env.HEADLESS !== 'false',
  },
})
```

Note: The exact reporter format may need adjustment when CronitorReporter is ported (Task 4). The config is intentionally minimal — it replaces `vitest.config.ts` settings only.

- [ ] **Step 2: Install `@playwright/test` as dependency**

```bash
cd /Users/puckey/rg/develop
pnpm -F @rg/integration-tests add -D @playwright/test
```

- [ ] **Step 3: Commit**

```bash
git add services/integration-tests/playwright.config.ts services/integration-tests/package.json pnpm-lock.yaml
git commit -m "feat(integration-tests): add playwright.config.ts"
```

---

### Task 3: Port `globalSetup.ts` to Playwright Test format

The current `globalSetup.ts` uses Vitest's `context.provide('logsDirectory', ...)`. Playwright Test's globalSetup communicates via `process.env` instead.

**Files:**
- Modify: `services/integration-tests/globalSetup.ts`
- Modify: `services/integration-tests/logs/globalSetup.ts` (remove `context.provide`)

- [ ] **Step 1: Update `logs/globalSetup.ts`**

Change the `globalSetupLogs` function signature and body. Remove `context.provide('logsDirectory', logsDirectory)` — the `logsDirectory` is already derived from `process.env.INTEGRATION_TESTS_LOGS_DIRECTORY` in `logs/config.ts`, so no provide/inject is needed. The value is available to workers via the environment variable directly.

Remove the `context` parameter entirely:

```typescript
export async function globalSetupLogs() {
  if (isNotNullish(logsDirectory)) {
    await fse.mkdirp(logsDirectory);
    await fse.writeFile(
      path.join(logsDirectory, 'meta.json'),
      JSON.stringify({
        commitSha,
        branch,
        dirty,
        dm,
        timestamp: new Date().toISOString()
      })
    );
    cleanupPromise = cleanupOldRuns(
      path.dirname(logsDirectory),
      logsDirectory
    ).catch(() => {});
  }
}
```

- [ ] **Step 2: Update `globalSetup.ts`**

Change to match Playwright Test's globalSetup format (export `default` function, no `context` parameter):

```typescript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { globalSetupLogs, globalTeardownLogs } from './logs/globalSetup.ts';

const killBrowsers = () =>
  promisify(exec)('pkill -f "chromium"').catch(() => {});

async function globalSetup() {
  process.on('SIGINT', () => {
    void killBrowsers().then(() => process.exit());
  });
  await Promise.all([globalSetupLogs(), killBrowsers()]);
}

async function globalTeardown() {
  await globalTeardownLogs();
  await killBrowsers();
}

export { globalSetup as setup, globalTeardown as teardown };
```

Note: Playwright Test expects `setup` and `teardown` named exports from globalSetup files (or a default export for setup only).

- [ ] **Step 3: Refactor `logs/index.ts` to remove all Vitest dependencies**

This file has deep Vitest coupling — `inject()`, `TestContext`, `context.task.result`, `beforeEach(context => ...)`. It needs a full refactor.

**3a. Replace inject with direct config import:**

Remove `import { afterEach, beforeEach, inject } from '~/util/vitest.ts'` and the `TestContext` type import.

Replace with:
```typescript
import { test } from '@playwright/test'
import { logsDirectory } from './config.ts'
```

Replace `getLogsDirectory()` with:
```typescript
function getLogsDirectory() {
  return logsDirectory
}
```

Remove `logsDirectoryInjected` flag and mutable `logsDirectory` variable.

**3b. Refactor `testLogger.setup()` to use Playwright's `testInfo`:**

Vitest's `beforeEach(context => ...)` passes a context with `context.task`. Playwright's `test.beforeEach` passes `({ }, testInfo)`.

The `getContextNames(context)` and `getFullContextBaseDir(context)` utilities in `logs/utils.ts` work with Vitest's `TestContext`. These need to be updated (or new equivalents created) that work with Playwright's `TestInfo`.

Key mapping:
- `context.task.name` → `testInfo.title`
- `context.task.suite?.name` → `testInfo.titlePath` (array of describe + test names)
- `context.task.result?.state` → `testInfo.status` (available in afterEach)
- `context.task.result?.errors` → `testInfo.errors`

The refactored `testLogger.setup()` should use `test.beforeEach` and `test.afterEach`:

```typescript
test.beforeEach(async ({}, testInfo) => {
  const dir = getFullContextBaseDir(testInfo)
  // ... rest of beforeEach using testInfo instead of context
})

test.afterEach(async ({}, testInfo) => {
  // Use testInfo.status instead of getEffectiveState(context)
  // Use testInfo.titlePath instead of getContextNames(context)
  // Use testInfo.errors instead of context.task.result?.errors
  // ... rest of afterEach
})
```

**3c. Update `logs/utils.ts` helpers:**

The `getContextNames`, `getEffectiveState`, `getFullContextBaseDir`, `getFullContextBaseName` functions need overloaded versions or replacements that accept `TestInfo` from `@playwright/test`. Read the current implementations to understand the mapping.

**Important:** This is the most complex subtask in Task 3. The implementer should read `logs/utils.ts` and `logs/index.ts` fully before making changes. The `getOutputDirectory` method on `testLogger` also uses `TestContext`.

- [ ] **Step 4: Remove `global.d.ts` vitest provide/inject types**

In `services/integration-tests/global.d.ts`, remove the Vitest `ProvidedContext` declaration:

```typescript
export * from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    logsDirectory: string;
  }
}
```

This entire file can be deleted if that's its only content. If it has other declarations, only remove the vitest parts.

- [ ] **Step 5: Commit**

```bash
git add services/integration-tests/globalSetup.ts services/integration-tests/logs/globalSetup.ts services/integration-tests/logs/index.ts services/integration-tests/global.d.ts
git commit -m "feat(integration-tests): port globalSetup to Playwright Test format"
```

---

### Task 4: Port `CronitorReporter` to Playwright's Reporter interface

**Files:**
- Modify: `services/integration-tests/reporters/CronitorReporter.ts`

- [ ] **Step 1: Rewrite the reporter**

```typescript
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter'
import { cronitor } from '@rg/cronitor'
import { env } from '@rg/util'

export default class CronitorReporter implements Reporter {
  private client: ReturnType<typeof cronitor> | undefined
  private passedCount = 0
  private failedCount = 0
  private totalDuration = 0

  constructor(options?: { id?: string }) {
    const id = options?.id ?? '2NKI7X'
    if (env('CI', undefined)) {
      this.client = cronitor(id)
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === 'passed') this.passedCount++
    else if (result.status === 'failed' || result.status === 'timedOut') this.failedCount++
    this.totalDuration += result.duration
  }

  async onEnd(result: FullResult) {
    if (!this.client) return
    await this.client.complete({
      count: this.passedCount + this.failedCount,
      errorCount: this.failedCount,
      duration: this.totalDuration,
    })
  }
}
```

- [ ] **Step 2: Update `playwright.config.ts` reporter entry**

The config from Task 2 references the reporter as a path. Playwright Test reporters that use `export default` are referenced by file path. Ensure the config entry is:

```typescript
['./reporters/CronitorReporter.ts', { id: '2NKI7X' }],
```

- [ ] **Step 3: Commit**

```bash
git add services/integration-tests/reporters/CronitorReporter.ts
git commit -m "feat(integration-tests): port CronitorReporter to Playwright Reporter interface"
```

---

### Task 5: Create `util/playwright.ts` replacing `util/vitest.ts`

This is the central wrapper file. Currently `util/vitest.ts` re-exports vitest primitives and wraps `describe`/`it` with bail logic. Replace with Playwright Test equivalents.

**Files:**
- Create: `services/integration-tests/util/playwright.ts`

- [ ] **Step 1: Create the new utility file**

```typescript
import { test as playwrightTest, expect as playwrightExpect } from '@playwright/test'

export const test = playwrightTest
export const it = playwrightTest
export const expect = playwrightExpect
export const describe = playwrightTest.describe
export const beforeAll = playwrightTest.beforeAll
export const afterAll = playwrightTest.afterAll
export const beforeEach = playwrightTest.beforeEach
export const afterEach = playwrightTest.afterEach
```

Note: Playwright Test doesn't have `vi`, `inject`, `Mock`, `RunnerTestSuite`, or `TestContext` — any imports of those from vitest need to be removed from consuming files.

The custom bail logic (`Scope`/`bailed`/`onAfterIt`) is dropped entirely — leaf describes will use `test.describe.configure({ mode: 'serial' })` instead.

- [ ] **Step 2: Do NOT delete `util/vitest.ts` yet**

It will be removed after all consumers are migrated. Both files coexist temporarily.

- [ ] **Step 3: Commit**

```bash
git add services/integration-tests/util/playwright.ts
git commit -m "feat(integration-tests): add util/playwright.ts with Playwright Test re-exports"
```

---

### Task 6: Proof of concept — migrate `balloon` suite + browser-desktop test

Migrate one complete suite end-to-end to prove the approach works before batch migration.

**Files:**
- Modify: `services/integration-tests/suites/balloon.ts`
- Modify: `services/integration-tests/platforms/browser-desktop/tests/balloon.test.ts`

- [ ] **Step 1: Migrate `suites/balloon.ts`**

Replace all imports from `~/util/index.ts` that come from vitest. The key changes:

1. Replace `import { describe, it, expect, ... } from '~/util/index.ts'` — keep the non-vitest utilities (`click`, `expectSelectorFound`, etc.) but import `test` from `@playwright/test` for `describe`/`it`/`expect`:

```typescript
import { test, expect } from '@playwright/test'
```

2. Replace `describe(` with `test.describe(` throughout
3. Replace `it(` with `test(` throughout
4. For leaf describes (those containing `test()` calls directly), add `test.describe.configure({ mode: 'serial' })` as the first line inside the callback
5. Keep `global.page` usage — all util functions still reference it

Example transformation for the opening of balloon.ts:

```typescript
import { test, expect } from '@playwright/test'
import { jestSelector } from '@rg/jest-id'
import type { TestSettings } from '~/types.ts'
import { page1 } from '~/settings.ts'
import {
  click,
  corsHeaders,
  expectPathname,
  expectSelectorFound,
  expectSelectorHidden,
  expectSelectorMissing,
  getApiContentUrl,
  gotoUrl,
  performSkipWelcomeTests,
  startRequestInterception
} from '~/util/index.ts'

function testExpectBalloonHud() {
  test('Balloon HUD is visible', async () => {
    await expectSelectorFound(jestSelector.balloonRideHud())
  })
  // ... rest similarly
}

export const balloon = async ({ createPage, baseUrl }: TestSettings) => {
  test.describe('Balloon Ride Suite', () => {
    test.describe('Load from /balloon-ride enters radiogarden in balloon mode', () => {
      test.describe.configure({ mode: 'serial' })
      test('Open page from /balloon-ride', async () => {
        await createPage()
        await gotoUrl(`${baseUrl}/balloon-ride`)
      })
      performSkipWelcomeTests()
      testExpectBalloonHud()
      // ...
    })
  })
}
```

Key pattern: any function that calls `it()` like `itExpectBalloonHud` gets renamed to use `test()` instead.

- [ ] **Step 2: Migrate `platforms/browser-desktop/tests/balloon.test.ts`**

Currently:
```typescript
import { setup } from '~/setup.ts'
import { balloon as test } from '~/suites/balloon.ts'
import { settings } from '../settings.ts'
setup()
void test(settings)
```

The `setup()` call installs `afterAll` cleanup for the browser. In Playwright Test, this becomes part of the test infrastructure. For now, keep the setup but update imports:

```typescript
import { setup } from '~/setup.ts'
import { balloon } from '~/suites/balloon.ts'
import { settings } from '../settings.ts'
setup()
void balloon(settings)
```

Note: renamed the import from `balloon as test` to just `balloon` to avoid shadowing Playwright's `test`.

- [ ] **Step 3: Update `setup.ts` to use Playwright imports**

Currently imports `afterAll` from `~/util/index.ts` (which re-exports from vitest). In Playwright Test, `test.afterAll` only works when called during test file execution (from test file scope or a describe block). Since `setup()` is called at the top of each test file, and each test file IS a test module that Playwright discovers, this works — the registration happens during the file's execution phase.

Change to import from `@playwright/test`:

```typescript
import { test } from '@playwright/test'
import { testLogger } from './logs/index.ts'

export function setup() {
  test.afterAll(async () => {
    if (global.context) {
      await global.context.close().catch(() => {})
    }
    if (global.browser) {
      await global.browser.close().catch(() => {})
      // @ts-expect-error
      global.page = undefined
    }
  })
  testLogger.setup()
}
```

Note: This works because `setup()` is called at module scope in each test file (e.g., `balloon.test.ts` calls `setup()` at the top level). Playwright Test processes the file and registers the `afterAll` during its collection phase.

- [ ] **Step 4: Update `util/logs.ts` to use Playwright imports**

Replace imports from `./vitest.ts` with Playwright equivalents:

```typescript
import { env, formatJson } from '@rg/util'
import { test } from '@playwright/test'

// ... logWhitelist and logs unchanged ...

export function allowSuitePageLogs() {
  test.beforeAll(() => {
    allowLogs = true
  })
  test.afterAll(() => {
    allowLogs = false
  })
}
```

The `onAfterIt` callback pattern is replaced by `test.afterEach`. Change the bottom of the file:

```typescript
test.afterEach(() => {
  try {
    if (SHOULD_CHECK_LOGS && !allowLogs && logs.length > 0) {
      throw new Error(
        `Expected no logs but received ${logs.length}:\n${formatJson(logs)}`
      )
    }
  } finally {
    logs.length = 0
  }
})
```

Note: This `test.afterEach` must be registered at module load time (top-level), matching the current `onAfterIt` behavior.

- [ ] **Step 5: Update `util/perform.ts` imports**

Replace `import { describe, it } from './vitest.ts'` with:

```typescript
import { test } from '@playwright/test'
```

Then replace `describe(` with `test.describe(` and `it(` with `test(` throughout the file.

- [ ] **Step 6: Update `util/index.ts` barrel export**

Change the line `export * from './vitest.ts'` to `export * from './playwright.ts'`. This ensures existing `import { describe, it, expect } from '~/util/index.ts'` imports across suite files still resolve — they'll get the Playwright versions.

- [ ] **Step 7: Run the migrated test**

```bash
cd /Users/puckey/rg/develop
pnpm -F @rg/integration-tests exec npx playwright test platforms/browser-desktop/tests/balloon.test.ts
```

Expected: The test should execute under Playwright Test. It may fail if the dev server isn't running — that's expected. The goal is to verify the runner picks up the test and the imports resolve.

- [ ] **Step 8: Commit**

```bash
git add services/integration-tests/suites/balloon.ts services/integration-tests/platforms/browser-desktop/tests/balloon.test.ts services/integration-tests/setup.ts services/integration-tests/util/logs.ts services/integration-tests/util/perform.ts services/integration-tests/util/index.ts services/integration-tests/logs/utils.ts
git commit -m "feat(integration-tests): migrate balloon suite to Playwright Test (proof of concept)"
```

---

### Task 7: Write and run codemod script for suite file migration

With the proof of concept validated, write a codemod script that mechanically transforms remaining suite files.

**Files:**
- Create: `services/integration-tests/scripts/migrate-to-playwright.ts`

- [ ] **Step 1: Create the codemod script**

The script performs these transformations on each suite `.ts` file:

1. Replace `import { ... describe, ... it, ... } from '~/util/index.ts'` — remove `describe` and `it` from the import, add `import { test } from '@playwright/test'` if not present
2. Replace `describe(` with `test.describe(` (but not `test.describe.configure`)
3. Replace standalone `it(` with `test(` (but not inside strings)
4. Replace `import { ... describe, ... it, ... } from './vitest.ts'` similarly
5. For each leaf `test.describe(` block (heuristic: contains `test(` calls), add `test.describe.configure({ mode: 'serial' })` as the first statement

The script should output what it changed for each file so the developer can review.

```typescript
#!/usr/bin/env tsx
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const suitesDir = join(__dirname, '..', 'suites')
const utilDir = join(__dirname, '..', 'util')

function findTsFiles(directory: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) results.push(...findTsFiles(fullPath))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) results.push(fullPath)
  }
  return results
}

function migrateFile(filePath: string): boolean {
  let content = readFileSync(filePath, 'utf-8')
  const original = content

  // Skip files that are already migrated
  if (content.includes("from '@playwright/test'")) return false

  // Skip files that don't use describe or it from vitest
  if (!content.includes('describe(') && !content.includes('it(')) return false

  // Add playwright import if needed
  if (!content.includes("from '@playwright/test'")) {
    // Add after the last import line
    const lines = content.split('\n')
    let lastImportIndex = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('import ')) lastImportIndex = i
    }
    if (lastImportIndex >= 0) {
      lines.splice(lastImportIndex + 1, 0, "import { test, expect } from '@playwright/test'")
      content = lines.join('\n')
    }
  }

  // Remove describe and it from ~/util/index.ts imports
  content = content.replace(
    /(import\s*\{[^}]*)\bdescribe\b,?\s*/g,
    '$1'
  )
  content = content.replace(
    /(import\s*\{[^}]*)\bit\b,?\s*/g,
    '$1'
  )
  // Clean up trailing commas and empty imports
  content = content.replace(/,\s*}/g, ' }')
  content = content.replace(/{\s*,/g, '{ ')

  // Replace describe( with test.describe(
  content = content.replace(/\bdescribe\(/g, 'test.describe(')

  // Replace it( with test( — but not inside strings
  content = content.replace(/\bit\(/g, 'test(')

  // Replace it.skip( with test.skip(
  content = content.replace(/\bit\.skip\(/g, 'test.skip(')

  if (content === original) return false
  writeFileSync(filePath, content)
  return true
}

const files = findTsFiles(suitesDir)
let changed = 0
for (const file of files) {
  if (migrateFile(file)) {
    console.log(`Migrated: ${relative(process.cwd(), file)}`)
    changed++
  }
}
console.log(`\nDone. ${changed} files migrated.`)
```

The codemod must also handle **direct `'vitest'` imports** found in ~9 suite files (e.g. `suites/i18n/*.ts`, `suites/favorites/transfer.ts`). Add this transformation:

```typescript
// Replace direct vitest imports
content = content.replace(
  /import\s*\{([^}]*)\}\s*from\s*['"]vitest['"]/g,
  (match, imports) => {
    const items = imports.split(',').map((i: string) => i.trim()).filter(Boolean)
    const vitestOnly = new Set(['vi', 'inject', 'test', 'Mock', 'RunnerTestSuite', 'TestContext'])
    const kept = items.filter((i: string) => !vitestOnly.has(i.replace(/\s+as\s+.*/, '')))
    if (kept.length === 0) return "import { test, expect } from '@playwright/test'"
    return `import { ${kept.join(', ')} } from '@playwright/test'`
  }
)
```

Note: This is a rough codemod — the implementer should verify it handles edge cases (multi-line imports, already-migrated files, etc.). It intentionally does NOT add `test.describe.configure({ mode: 'serial' })` — that requires human judgment about which describes are leaf describes.

- [ ] **Step 2: Run the codemod**

```bash
cd /Users/puckey/rg/develop/services/integration-tests
npx tsx scripts/migrate-to-playwright.ts
```

- [ ] **Step 3: Review the changes**

```bash
git diff services/integration-tests/suites/
```

Manually verify a few files look correct. Fix any codemod artifacts (empty imports, double imports, etc.).

- [ ] **Step 4: Add `test.describe.configure({ mode: 'serial' })` to leaf describes**

This requires manual judgment. Go through each suite file and add the configure call to describes that contain `test()` calls directly (these are the "scenario" describes with sequential actions).

Heuristic: if a `test.describe(` callback contains `test(` calls (not nested inside another `test.describe(`), it's a leaf describe.

- [ ] **Step 5: Commit**

```bash
git add services/integration-tests/suites/ services/integration-tests/scripts/migrate-to-playwright.ts
git commit -m "feat(integration-tests): migrate all suite files to Playwright Test"
```

---

### Task 8: Migrate platform settings — replace `vi.fn()` with `createMock()`

**Files:**
- Modify: `services/integration-tests/platforms/app-ios/settings.ts`
- Modify: `services/integration-tests/util/index.ts` (export createMock)

- [ ] **Step 1: Export `createMock` from `util/index.ts`**

Add to `services/integration-tests/util/index.ts`:

```typescript
export * from './mock.ts'
```

- [ ] **Step 2: Replace `vi.fn()` in `app-ios/settings.ts`**

Replace `import { ... vi } from '~/util/index.ts'` with `import { ... createMock } from '~/util/index.ts'`.

Then replace every `vi.fn(` with `createMock(` and every `vi.fn()` with `createMock()`.

Also update the `MockedChannelFunctions` type in `types.ts`. Currently:

```typescript
import type { Mock } from '~/util/index.ts'

type MockedChannelFunctions = {
  [key in keyof NativeChannelFunctions]: Mock<
    ReturningPromise<NativeChannelFunctions[key]>
  >
}
```

Change to:

```typescript
import type { MockFunction } from '~/util/index.ts'

type MockedChannelFunctions = {
  [key in keyof NativeChannelFunctions]: MockFunction<
    Parameters<NativeChannelFunctions[key]>,
    ReturnType<NativeChannelFunctions[key]>
  >
}
```

Note: The exact generic parameter mapping depends on how `MockFunction` is typed. The implementer should verify this compiles.

- [ ] **Step 3: Check other platform settings for `vi.fn` usage**

```bash
grep -r "vi\." services/integration-tests/platforms/*/settings.ts
```

If other platform settings files use `vi`, migrate them too.

- [ ] **Step 4: Commit**

```bash
git add services/integration-tests/platforms/ services/integration-tests/util/index.ts services/integration-tests/types.ts
git commit -m "feat(integration-tests): replace vi.fn with createMock in platform settings"
```

---

### Task 9: Migrate test files

The test files are minimal (3-5 lines each). They need to stop importing `setup` if it's been refactored, and rename any `as test` aliases to avoid shadowing.

**Files:**
- Modify: all 107 `*.test.ts` files across `platforms/`

- [ ] **Step 1: Write a codemod for test files**

The transformation is simple: rename `as test` imports to avoid shadowing `@playwright/test`'s `test`:

```bash
# Find and fix shadowed test imports
cd /Users/puckey/rg/develop/services/integration-tests
grep -rl "as test}" platforms/ | while read f; do
  sed -i '' 's/as test}/as runTest}/g; s/void test(/void runTest(/g' "$f"
done
```

Or write it as a proper script if the sed approach is insufficient.

- [ ] **Step 2: Review the changes**

```bash
git diff platforms/
```

- [ ] **Step 3: Commit**

```bash
git add services/integration-tests/platforms/
git commit -m "feat(integration-tests): migrate test files to avoid Playwright test shadowing"
```

---

### Task 10: Remove Vitest configuration and old files

**Files:**
- Delete: `services/integration-tests/vitest.config.ts`
- Delete: `services/integration-tests/util/vitest.ts`
- Modify: `services/integration-tests/package.json` (remove vitest dependency, update test script)

- [ ] **Step 1: Update `package.json` test script**

Change the `test` script from vitest to playwright:

```json
"test": "playwright test"
```

Remove `vitest` from dependencies if it's a direct dependency of this package (it may come from `@rg/tooling`).

- [ ] **Step 2: Delete old files**

```bash
rm services/integration-tests/vitest.config.ts
rm services/integration-tests/util/vitest.ts
```

- [ ] **Step 3: Verify no remaining vitest imports**

```bash
grep -r "from 'vitest'" services/integration-tests/ --include="*.ts" | grep -v node_modules | grep -v vitest.config
grep -r "from '~/util/vitest" services/integration-tests/ --include="*.ts" | grep -v node_modules
```

Fix any remaining references.

- [ ] **Step 4: Commit**

```bash
git add -u services/integration-tests/
git commit -m "feat(integration-tests): remove Vitest config and old vitest wrapper"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run the full test suite under Playwright Test**

```bash
cd /Users/puckey/rg/develop
pnpm -F @rg/integration-tests exec npx playwright test --list
```

This lists all discovered tests without running them. Verify the count matches expectations (~107 test files discovered).

- [ ] **Step 2: Run a subset to verify execution**

```bash
pnpm -F @rg/integration-tests exec npx playwright test platforms/browser-desktop/tests/balloon.test.ts
```

Note: Full test execution requires the dev server running. The acceptance criteria is that the runner discovers and attempts to run the tests, not that all tests pass (that depends on the server being available).

- [ ] **Step 3: Verify no vitest references remain**

```bash
grep -r "vitest" services/integration-tests/ --include="*.ts" | grep -v node_modules | grep -v "migrate-to-playwright"
```

Expected: No results (or only comments/docs mentioning vitest historically).

- [ ] **Step 4: Typecheck**

```bash
cd /Users/puckey/rg/develop
pnpm -F @rg/integration-tests exec tsc --noEmit --skipLibCheck
```

Expected: Clean

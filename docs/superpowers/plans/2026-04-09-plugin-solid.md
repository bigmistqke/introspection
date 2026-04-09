# SolidJS Devtools Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `@introspection/plugin-solid` that captures SolidJS reactive state (component tree, reactive updates, dependency graph) by running the `@solid-devtools/debugger` against the app's existing devtools setup hooks.

**Architecture:** Browser IIFE detects `SolidDevtools$$`, initializes the bundled debugger, and forwards events via the push bridge. Server side orchestrates config delivery and trigger-mode asset captures. Streamed events flow automatically through the push bridge (framework-handled, same as WebGL). Dual tsup build (browser IIFE + node ESM), same pattern as `plugin-webgl`.

**Tech Stack:** TypeScript, tsup (dual config), `@solid-devtools/debugger`, introspection plugin system

**Spec:** `docs/superpowers/specs/2026-04-09-solid-devtools-plugin-design.md`

---

## File Structure

```
packages/plugin-solid/
  src/
    index.ts              # Plugin factory, config types, server-side orchestration, type re-exports
    browser.ts            # Browser IIFE: detect SolidDevtools$$, init debugger, forward events
    iife.d.ts             # Type declaration for *.iife.js text imports
  test/
    solid-devtools.spec.ts
  test-app/               # Minimal SolidJS app for integration testing
    index.html
    src/index.tsx
    vite.config.ts
  tsup.browser.config.ts  # IIFE build bundling @solid-devtools/debugger
  tsup.node.config.ts     # ESM build with text-loader for .iife.js
  playwright.config.ts
  tsconfig.json
  package.json
```

---

### Task 1: Spike — verify `@solid-devtools/debugger` subscription API

Before building the plugin, we need to confirm how to subscribe to the debugger's output messages programmatically. This is open question #1 from the spec.

**Files:**
- Read: `node_modules/@solid-devtools/debugger/` (source inspection)
- Modify: `docs/superpowers/specs/2026-04-09-solid-devtools-plugin-design.md`

- [ ] **Step 1: Install the debugger package temporarily for inspection**

```bash
cd /Users/puckey/rg/introspection
pnpm add -w @solid-devtools/debugger --save-dev
```

This is a temporary workspace-root install for source inspection only. It will be removed after the spike; the real dependency lives in `packages/plugin-solid/package.json` (Task 2).

- [ ] **Step 2: Read the debugger's main entry point and exports**

Find the package's entry point from its `package.json`, then read the source to identify:
- What `useDebugger()` returns (or equivalent factory function)
- How the Chrome extension subscribes to output messages
- Whether there's a callback/listener API or if it only works via postMessage

Look for: `useDebugger`, `createDebugger`, `outputHandler`, `listen`, `on`, `emit`, `postMessage`.

- [ ] **Step 3: Document findings**

Update `docs/superpowers/specs/2026-04-09-solid-devtools-plugin-design.md` open question #1 with the findings:
- The exact function to call to initialize the debugger
- The exact API to subscribe to output messages (method name, callback shape)
- Any initialization requirements (does it need a specific setup state?)

If the API doesn't support direct subscription, document the alternative approach (e.g., intercepting postMessage, or using internal APIs).

- [ ] **Step 4: Remove temporary workspace-root install**

```bash
cd /Users/puckey/rg/introspection
pnpm remove -w @solid-devtools/debugger
```

- [ ] **Step 5: Commit findings**

```bash
git add docs/superpowers/specs/2026-04-09-solid-devtools-plugin-design.md
git commit -m "docs: document solid-devtools debugger subscription API findings"
```

---

### Task 2: Scaffold the package

**Files:**
- Create: `packages/plugin-solid/package.json`
- Create: `packages/plugin-solid/tsconfig.json`
- Create: `packages/plugin-solid/tsup.browser.config.ts`
- Create: `packages/plugin-solid/tsup.node.config.ts`
- Create: `packages/plugin-solid/src/iife.d.ts`
- Create: `packages/plugin-solid/playwright.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@introspection/plugin-solid",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup --config tsup.browser.config.ts && tsup --config tsup.node.config.ts",
    "test": "playwright test"
  },
  "dependencies": {
    "@solid-devtools/debugger": "^0.28.1",
    "@introspection/types": "workspace:*",
    "@introspection/plugin-js-errors": "workspace:*"
  },
  "devDependencies": {
    "@introspection/playwright": "workspace:*",
    "@playwright/test": "^1.40.0",
    "solid-js": "^1.9.0",
    "solid-devtools": "^0.30.0",
    "vite": "^6.0.0",
    "vite-plugin-solid": "^2.11.0",
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
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `src/iife.d.ts`**

```typescript
declare module '*.iife.js' {
  const content: string
  export default content
}
```

- [ ] **Step 4: Create `tsup.browser.config.ts`**

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { browser: 'src/browser.ts' },
  outDir: 'dist',
  format: ['iife'],
  globalName: '__introspect_solid_browser__',
  platform: 'browser',
  minify: false,
  outExtension: () => ({ js: '.iife.js' }),
  noExternal: [/.*/],
})
```

- [ ] **Step 5: Create `tsup.node.config.ts`**

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  dts: true,
  esbuildOptions(options) {
    options.loader = { ...options.loader, '.iife.js': 'text' }
  },
})
```

- [ ] **Step 6: Create `playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  use: {
    headless: true,
  },
})
```

- [ ] **Step 7: Install dependencies**

```bash
cd /Users/puckey/rg/introspection
pnpm install
```

- [ ] **Step 8: Commit scaffold**

```bash
git add packages/plugin-solid/
git commit -m "feat(plugin-solid): scaffold package with dual tsup config"
```

---

### Task 3: Browser script — detection and debugger initialization

**Files:**
- Create: `packages/plugin-solid/src/browser.ts`

This task creates the browser IIFE with detection and debugger init. The exact `useDebugger()` call and subscription API depend on Task 1 findings.

- [ ] **Step 1: Write the browser script**

Create `packages/plugin-solid/src/browser.ts` with:

1. IIFE wrapper (same pattern as WebGL `browser.ts`)
2. `push()` helper calling `window.__introspect_push__()` — streamed events pushed here are automatically recorded by the framework as plugin trace events (no server-side `ctx.emit()` needed)
3. `SolidDevtools$$` detection via `Object.defineProperty` interception:
   - Check if `SolidDevtools$$` already exists on `globalThis`
   - If not, use `Object.defineProperty` to intercept when it's set
   - Once detected, call the debugger initialization (from Task 1 findings)
   - If not detected after the `load` event, push a `solid.warning` event
4. Config storage and `configure()` method — until called, buffer all events
5. Debugger output subscription (from Task 1 findings):
   - For `'stream'` mode event types: push immediately via `push()`
   - For `'trigger'` mode event types: buffer latest state in memory
   - For `'off'` mode event types: ignore
6. `getState()` API returning latest buffered state for trigger-mode captures
7. Public API on `window.__introspect_plugins__.solid`:
   - `configure(options)` — receive config from server
   - `getState()` — return buffered state for trigger captures

- [ ] **Step 2: Verify the browser IIFE builds**

```bash
cd /Users/puckey/rg/introspection/packages/plugin-solid
pnpm run build
```

Expected: `dist/browser.iife.js` exists and contains the bundled IIFE with the debugger inlined.

- [ ] **Step 3: Commit browser script**

```bash
git add packages/plugin-solid/src/browser.ts
git commit -m "feat(plugin-solid): add browser script with detection and event forwarding"
```

---

### Task 4: Server-side plugin — config types and factory

**Files:**
- Create: `packages/plugin-solid/src/index.ts`

- [ ] **Step 1: Write the server-side plugin**

Create `packages/plugin-solid/src/index.ts` with:

1. Text import of browser IIFE: `import BROWSER_SCRIPT from '../dist/browser.iife.js'`
2. Side-effect import: `import '@introspection/plugin-js-errors'` (brings `'js.error'` `BusPayloadMap` augmentation into scope, same pattern as `plugin-webgl/src/index.ts:6`)
3. Type re-exports from `@solid-devtools/debugger` for consumers parsing trace data (spec requirement)
4. `SolidCaptureMode` type: `'stream' | 'trigger' | 'off'`
5. `SolidDevtoolsOptions` interface with `structureUpdates`, `nodeUpdates`, `dependencyGraph` fields (all optional, with defaults)
6. `solidDevtools(options?)` factory function returning `IntrospectionPlugin`:
   - `name: 'solid'`
   - `script: BROWSER_SCRIPT`
   - `install(ctx)`:
     - Merge options with defaults: `{ structureUpdates: 'stream', nodeUpdates: 'off', dependencyGraph: 'trigger' }`
     - Call `ctx.page.evaluate()` to invoke `window.__introspect_plugins__.solid.configure(resolvedOptions)`
     - **No `ctx.emit()` for streamed events** — push bridge handles this automatically
     - Register bus listeners for `'manual'`, `'js.error'`, `'detach'`
     - On each trigger: call `ctx.page.evaluate()` to invoke `getState()`, then `ctx.writeAsset()` for each trigger-mode event type:
       - `kind: 'solid-structure'`, `.json` — latest component tree state
       - `kind: 'solid-dgraph'`, `.json` — latest dependency graph
       - `kind: 'solid-updates'`, `.json` — latest reactive node update batch
     - Include `timestamp` and trigger name in asset metadata

Reference `packages/plugin-webgl/src/index.ts` for the exact `captureState` / bus listener / `writeAsset` pattern.

- [ ] **Step 2: Verify the full build succeeds**

```bash
cd /Users/puckey/rg/introspection/packages/plugin-solid
pnpm run build
```

Expected: Both `dist/browser.iife.js` and `dist/index.js` + `dist/index.d.ts` exist.

- [ ] **Step 3: Commit server-side plugin**

```bash
git add packages/plugin-solid/src/index.ts
git commit -m "feat(plugin-solid): add server-side plugin with config and trigger captures"
```

---

### Task 5: Integration tests

**Files:**
- Create: `packages/plugin-solid/test-app/index.html`
- Create: `packages/plugin-solid/test-app/src/index.tsx`
- Create: `packages/plugin-solid/test-app/vite.config.ts`
- Create: `packages/plugin-solid/test/solid-devtools.spec.ts`

- [ ] **Step 1: Create minimal SolidJS test app**

Create `test-app/index.html`:
```html
<!DOCTYPE html>
<html>
<head><title>Solid Test</title></head>
<body><div id="app"></div><script type="module" src="/src/index.tsx"></script></body>
</html>
```

Create `test-app/vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import devtools from 'solid-devtools/vite'

export default defineConfig({
  plugins: [devtools(), solidPlugin()],
  root: __dirname,
})
```

Create `test-app/src/index.tsx`:
```tsx
import 'solid-devtools'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'

function Counter() {
  const [count, setCount] = createSignal(0)
  return <button onClick={() => setCount(count() + 1)}>Count: {count()}</button>
}

render(() => <Counter />, document.getElementById('app')!)
```

- [ ] **Step 2: Write the integration tests**

Create `test/solid-devtools.spec.ts` following the `makeSession`/`endSession` helper pattern from `packages/plugin-webgl/test/webgl.spec.ts`:

```typescript
import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { solidDevtools } from '../dist/index.js'
import { attach } from '@introspection/playwright'
import type { IntrospectHandle } from '@introspection/types'
import { createServer, type ViteDevServer } from 'vite'

// ─── Test helpers ─────────────────────────────────────────────────────────────

async function startVite(): Promise<{ server: ViteDevServer; port: number }> {
  const server = await createServer({
    configFile: join(__dirname, '..', 'test-app', 'vite.config.ts'),
  })
  await server.listen(0)
  const address = server.httpServer!.address() as { port: number }
  return { server, port: address.port }
}

async function makeSession(page: Page, options?: Parameters<typeof solidDevtools>[0]) {
  const outDir = await mkdtemp(join(tmpdir(), 'introspect-solid-'))
  const plugin = solidDevtools(options)
  const handle = await attach(page, { outDir, plugins: [plugin] })
  return { outDir, plugin, handle }
}

async function endSession(handle: IntrospectHandle, outDir: string) {
  await handle.detach()
  try {
    const [sessionId] = await readdir(outDir)
    const raw = await readFile(join(outDir, sessionId, 'events.ndjson'), 'utf-8')
    return raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('streams structure updates for a SolidJS app', async ({ page }) => {
  const { server, port } = await startVite()
  try {
    const { outDir, handle } = await makeSession(page, { structureUpdates: 'stream' })
    await page.goto(`http://localhost:${port}`)
    await page.waitForSelector('button')

    const events = await endSession(handle, outDir)
    const structureEvents = events.filter(
      (event: { type: string }) => event.type === 'solid.structure'
    )
    expect(structureEvents.length).toBeGreaterThan(0)
    expect(structureEvents[0].source).toBe('plugin')
  } finally {
    await server.close()
  }
})

test('captures dependency graph asset on manual trigger', async ({ page }) => {
  const { server, port } = await startVite()
  try {
    const { outDir, handle } = await makeSession(page, {
      dependencyGraph: 'trigger',
      structureUpdates: 'off',
      nodeUpdates: 'off',
    })
    await page.goto(`http://localhost:${port}`)
    await page.waitForSelector('button')
    await handle.snapshot()  // triggers 'manual' bus event

    const events = await endSession(handle, outDir)
    const dgraphAsset = events.find(
      (event: { type: string; data?: { kind: string } }) =>
        event.type === 'asset' && event.data?.kind === 'solid-dgraph'
    )
    expect(dgraphAsset).toBeDefined()
    expect(dgraphAsset.source).toBe('plugin')
  } finally {
    await server.close()
  }
})

test('emits warning when SolidDevtools$$ is missing', async ({ page }) => {
  const { outDir, handle } = await makeSession(page)
  await page.setContent('<html><body><h1>No Solid here</h1></body></html>')
  // Wait for detection timeout
  await page.waitForTimeout(3000)

  const events = await endSession(handle, outDir)
  const warning = events.find(
    (event: { type: string }) => event.type === 'solid.warning'
  )
  expect(warning).toBeDefined()
  expect(warning.source).toBe('plugin')
  expect(warning.data.message).toContain('SolidDevtools$$')
})
```

- [ ] **Step 3: Build the plugin before running tests**

```bash
cd /Users/puckey/rg/introspection/packages/plugin-solid
pnpm run build
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/puckey/rg/introspection/packages/plugin-solid
pnpm test
```

Expected: All tests pass. If failures, debug and fix.

- [ ] **Step 5: Commit tests**

```bash
git add packages/plugin-solid/test-app/ packages/plugin-solid/test/
git commit -m "test(plugin-solid): add integration tests with minimal SolidJS app"
```

---

### Task 6: Final build verification and cleanup

**Files:**
- Modify: `packages/plugin-solid/package.json` (if needed)

- [ ] **Step 1: Clean build from scratch**

```bash
cd /Users/puckey/rg/introspection/packages/plugin-solid
rm -rf dist
pnpm run build
```

Expected: Both `dist/browser.iife.js` and `dist/index.js` + `dist/index.d.ts` exist.

- [ ] **Step 2: Run all plugin tests**

```bash
cd /Users/puckey/rg/introspection/packages/plugin-solid
pnpm test
```

Expected: All tests pass.

- [ ] **Step 3: Run the full monorepo build to check for regressions**

```bash
cd /Users/puckey/rg/introspection
pnpm build
pnpm test
```

Expected: All packages build and test successfully.

- [ ] **Step 4: Commit any remaining changes**

```bash
git add packages/plugin-solid/
git commit -m "feat(plugin-solid): complete v1 SolidJS devtools plugin"
```

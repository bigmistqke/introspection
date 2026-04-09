# Performance Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `@introspection/plugin-performance` — a passive plugin that captures Core Web Vitals, resource timing, long tasks, layout shifts, and paint timing as trace events via browser-side `PerformanceObserver`.

**Architecture:** Browser-side IIFE registers `PerformanceObserver` instances and pushes entries through the `__introspect_push__` bridge. Node-side is minimal — factory function returns plugin metadata and the compiled browser script. No CDP domains needed.

**Tech Stack:** TypeScript, tsup (dual IIFE + ESM build), Playwright (tests), PerformanceObserver API

**Spec:** `docs/superpowers/specs/2026-04-09-plugin-performance-design.md`

---

### Task 1: Package scaffolding

**Files:**
- Create: `packages/plugin-performance/package.json`
- Create: `packages/plugin-performance/tsconfig.json`
- Create: `packages/plugin-performance/tsup.browser.config.ts`
- Create: `packages/plugin-performance/tsup.node.config.ts`
- Create: `packages/plugin-performance/playwright.config.ts`
- Create: `packages/plugin-performance/src/index.ts` (stub)
- Create: `packages/plugin-performance/src/browser.ts` (stub)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@introspection/plugin-performance",
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
    "@introspection/types": "workspace:*"
  },
  "devDependencies": {
    "@introspection/playwright": "workspace:*",
    "@playwright/test": "^1.40.0",
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

- [ ] **Step 3: Create `tsup.browser.config.ts`**

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { browser: 'src/browser.ts' },
  outDir: 'dist',
  format: ['iife'],
  globalName: '__introspect_performance_browser__',
  platform: 'browser',
  minify: false,
  outExtension: () => ({ js: '.iife.js' }),
  noExternal: [/.*/],
})
```

- [ ] **Step 4: Create `tsup.node.config.ts`**

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

- [ ] **Step 5: Create `playwright.config.ts`**

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

- [ ] **Step 6: Create stub `src/index.ts`**

```typescript
import type { IntrospectionPlugin } from '@introspection/types'

export interface PerformanceOptions {
  resources?: boolean
  longTasks?: boolean
}

export function performance(_options?: PerformanceOptions): IntrospectionPlugin {
  return {
    name: 'performance',
    description: 'Captures Core Web Vitals, resource timing, long tasks, layout shifts, and paint timing',
    events: {
      'perf.cwv': 'Core Web Vital entry (LCP, CLS, or INP)',
      'perf.resource': 'Resource timing entry with full waterfall breakdown',
      'perf.long-task': 'Long task (>50ms) with script attribution',
      'perf.layout-shift': 'Individual layout shift with score and affected elements',
      'perf.paint': 'First Paint or First Contentful Paint timing',
    },
    options: {
      resources: { description: 'Capture resource timing entries', value: _options?.resources ?? true },
      longTasks: { description: 'Capture long tasks >50ms', value: _options?.longTasks ?? true },
    },

    async install(): Promise<void> {
      // no-op — browser script handles everything via __introspect_push__
    },
  }
}
```

- [ ] **Step 7: Create stub `src/browser.ts`**

```typescript
;(() => {
  window.__introspect_plugins__ = window.__introspect_plugins__ || {}
  ;(window.__introspect_plugins__ as Record<string, unknown>).performance = {}
})()
```

- [ ] **Step 8: Install dependencies and verify build**

Run: `cd /Users/puckey/rg/introspection && pnpm install && pnpm -r --filter @introspection/plugin-performance run build`
Expected: Build succeeds, `dist/browser.iife.js` and `dist/index.js` created.

- [ ] **Step 9: Commit**

```bash
git add packages/plugin-performance/
git commit -m "feat(plugin-performance): scaffold package with stubs"
```

---

### Task 2: Browser script — paint timing events

Start with the simplest observer: paint timing (FP and FCP). This validates the full pipeline — browser script → push bridge → NDJSON events.

**Files:**
- Modify: `packages/plugin-performance/src/browser.ts`
- Create: `packages/plugin-performance/test/performance.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/plugin-performance/test/performance.spec.ts`:

```typescript
import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { performance } from '../dist/index.js'
import { attach } from '@introspection/playwright'
import type { IntrospectHandle } from '@introspection/types'

async function makeSession(page: Page, options?: Parameters<typeof performance>[0]) {
  const outDir = await mkdtemp(join(tmpdir(), 'introspect-perf-'))
  const plugin = performance(options)
  const handle = await attach(page, { outDir, plugins: [plugin] })
  return { outDir, handle }
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

test('emits perf.paint events for FP and FCP on navigation', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><h1>Hello</h1></body></html>',
    })
  )

  const { outDir, handle } = await makeSession(page)
  await handle.page.goto('http://localhost:9999/')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const paintEvents = events.filter((event: { type: string }) => event.type === 'perf.paint')

  expect(paintEvents.length).toBeGreaterThanOrEqual(1)
  const fcp = paintEvents.find((event: { data: { name: string } }) => event.data.name === 'first-contentful-paint')
  expect(fcp).toBeDefined()
  expect(fcp.source).toBe('plugin')
  expect(typeof fcp.data.startTime).toBe('number')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "emits perf.paint"`
Expected: FAIL — no `perf.paint` events emitted (browser script is a stub).

- [ ] **Step 3: Implement paint observer in browser script**

Update `packages/plugin-performance/src/browser.ts`:

```typescript
;(() => {
  function push(type: string, data: Record<string, unknown>): void {
    ;(window as unknown as { __introspect_push__: (payload: string) => void }).__introspect_push__(
      JSON.stringify({ type, data })
    )
  }

  function observePaint(): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        push('perf.paint', {
          name: entry.name,
          startTime: entry.startTime,
        })
      }
    })
    observer.observe({ type: 'paint', buffered: true })
  }

  observePaint()

  window.__introspect_plugins__ = window.__introspect_plugins__ || {}
  ;(window.__introspect_plugins__ as Record<string, unknown>).performance = {}
})()
```

- [ ] **Step 4: Wire the browser script into the plugin**

Update `packages/plugin-performance/src/index.ts` to import and expose the IIFE:

```typescript
import BROWSER_SCRIPT from '../dist/browser.iife.js'
import type { IntrospectionPlugin } from '@introspection/types'

export interface PerformanceOptions {
  resources?: boolean
  longTasks?: boolean
}

export function performance(options?: PerformanceOptions): IntrospectionPlugin {
  return {
    name: 'performance',
    description: 'Captures Core Web Vitals, resource timing, long tasks, layout shifts, and paint timing',
    events: {
      'perf.cwv': 'Core Web Vital entry (LCP, CLS, or INP)',
      'perf.resource': 'Resource timing entry with full waterfall breakdown',
      'perf.long-task': 'Long task (>50ms) with script attribution',
      'perf.layout-shift': 'Individual layout shift with score and affected elements',
      'perf.paint': 'First Paint or First Contentful Paint timing',
    },
    options: {
      resources: { description: 'Capture resource timing entries', value: options?.resources ?? true },
      longTasks: { description: 'Capture long tasks >50ms', value: options?.longTasks ?? true },
    },
    script: BROWSER_SCRIPT,

    async install(): Promise<void> {
      // no-op — browser script handles everything via __introspect_push__
    },
  }
}
```

- [ ] **Step 5: Rebuild and run test**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "emits perf.paint"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-performance/
git commit -m "feat(plugin-performance): paint timing observer (FP, FCP)"
```

---

### Task 3: Browser script — LCP events

**Files:**
- Modify: `packages/plugin-performance/src/browser.ts`
- Modify: `packages/plugin-performance/test/performance.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `performance.spec.ts`:

```typescript
test('emits perf.cwv event with metric lcp on navigation', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" width="500" height="500" /></body></html>',
    })
  )

  const { outDir, handle } = await makeSession(page)
  await handle.page.goto('http://localhost:9999/')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const lcpEvents = events.filter(
    (event: { type: string; data: { metric: string } }) =>
      event.type === 'perf.cwv' && event.data.metric === 'lcp'
  )

  expect(lcpEvents.length).toBeGreaterThanOrEqual(1)
  const lcp = lcpEvents[0]
  expect(lcp.source).toBe('plugin')
  expect(typeof lcp.data.value).toBe('number')
  expect(typeof lcp.data.startTime).toBe('number')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "emits perf.cwv event with metric lcp"`
Expected: FAIL — no `perf.cwv` events.

- [ ] **Step 3: Add LCP observer to browser script**

Add to `browser.ts` before the `window.__introspect_plugins__` line:

```typescript
  function observeLcp(): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const lcpEntry = entry as PerformanceLargestContentfulPaint
        push('perf.cwv', {
          metric: 'lcp',
          value: lcpEntry.renderTime || lcpEntry.loadTime,
          element: lcpEntry.element?.tagName?.toLowerCase(),
          url: lcpEntry.url || undefined,
          size: lcpEntry.size,
          startTime: lcpEntry.startTime,
        })
      }
    })
    observer.observe({ type: 'largest-contentful-paint', buffered: true })
  }

  observeLcp()
```

Note: `PerformanceLargestContentfulPaint` is a browser global type. The IIFE targets the browser platform so this is available.

- [ ] **Step 4: Rebuild and run test**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "emits perf.cwv event with metric lcp"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-performance/
git commit -m "feat(plugin-performance): LCP observer"
```

---

### Task 4: Browser script — layout shift events

**Files:**
- Modify: `packages/plugin-performance/src/browser.ts`
- Modify: `packages/plugin-performance/test/performance.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `performance.spec.ts`:

```typescript
test('emits perf.layout-shift events when layout shifts occur', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body>
        <div id="target" style="position:relative;top:0;width:100px;height:100px;background:red"></div>
        <script>
          setTimeout(() => {
            document.getElementById('target').style.top = '200px';
          }, 100);
        </script>
      </body></html>`,
    })
  )

  const { outDir, handle } = await makeSession(page)
  await handle.page.goto('http://localhost:9999/')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const shiftEvents = events.filter((event: { type: string }) => event.type === 'perf.layout-shift')

  expect(shiftEvents.length).toBeGreaterThanOrEqual(1)
  const shift = shiftEvents[0]
  expect(shift.source).toBe('plugin')
  expect(typeof shift.data.score).toBe('number')
  expect(typeof shift.data.hadRecentInput).toBe('boolean')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "emits perf.layout-shift"`
Expected: FAIL

- [ ] **Step 3: Add layout shift observer to browser script**

Add to `browser.ts`:

```typescript
  function selectorForElement(element: Element | null): string | undefined {
    if (!element) return undefined
    if (element.id) return `#${element.id}`
    const tag = element.tagName.toLowerCase()
    const classes = Array.from(element.classList).join('.')
    return classes ? `${tag}.${classes}` : tag
  }

  function observeLayoutShift(): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const layoutShift = entry as LayoutShift
        push('perf.layout-shift', {
          score: layoutShift.value,
          hadRecentInput: layoutShift.hadRecentInput,
          sources: (layoutShift.sources || []).map((source) => ({
            selector: selectorForElement(source.node),
            previousRect: {
              x: source.previousRect.x,
              y: source.previousRect.y,
              width: source.previousRect.width,
              height: source.previousRect.height,
            },
            currentRect: {
              x: source.currentRect.x,
              y: source.currentRect.y,
              width: source.currentRect.width,
              height: source.currentRect.height,
            },
          })),
        })
      }
    })
    observer.observe({ type: 'layout-shift', buffered: true })
  }

  observeLayoutShift()
```

- [ ] **Step 4: Rebuild and run test**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "emits perf.layout-shift"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-performance/
git commit -m "feat(plugin-performance): layout shift observer"
```

---

### Task 5: Browser script — INP events

**Files:**
- Modify: `packages/plugin-performance/src/browser.ts`
- Modify: `packages/plugin-performance/test/performance.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `performance.spec.ts`:

```typescript
test('emits perf.cwv event with metric inp on user interaction', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><button id="btn" onclick="let x=0;for(let i=0;i<1e6;i++)x+=i;">Click</button></body></html>',
    })
  )

  const { outDir, handle } = await makeSession(page)
  await handle.page.goto('http://localhost:9999/')
  await handle.page.click('#btn')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const inpEvents = events.filter(
    (event: { type: string; data: { metric: string } }) =>
      event.type === 'perf.cwv' && event.data.metric === 'inp'
  )

  expect(inpEvents.length).toBeGreaterThanOrEqual(1)
  expect(typeof inpEvents[0].data.value).toBe('number')
  expect(typeof inpEvents[0].data.startTime).toBe('number')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "emits perf.cwv event with metric inp"`
Expected: FAIL

- [ ] **Step 3: Add INP observer to browser script**

Add to `browser.ts`:

```typescript
  function observeInp(): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const eventEntry = entry as PerformanceEventTiming
        push('perf.cwv', {
          metric: 'inp',
          value: eventEntry.duration,
          startTime: eventEntry.startTime,
        })
      }
    })
    observer.observe({ type: 'event', buffered: true, durationThreshold: 0 } as PerformanceObserverInit)
  }

  observeInp()
```

- [ ] **Step 4: Rebuild and run test**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "emits perf.cwv event with metric inp"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-performance/
git commit -m "feat(plugin-performance): INP observer"
```

---

### Task 6: Browser script — resource timing events

**Files:**
- Modify: `packages/plugin-performance/src/browser.ts`
- Modify: `packages/plugin-performance/test/performance.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `performance.spec.ts`:

```typescript
test('emits perf.resource events for loaded resources', async ({ page }) => {
  await page.route('**/*', (route) => {
    if (route.request().url().includes('style.css')) {
      route.fulfill({ status: 200, contentType: 'text/css', body: 'body { color: red; }' })
    } else {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><head><link rel="stylesheet" href="/style.css"></head><body>Hello</body></html>',
      })
    }
  })

  const { outDir, handle } = await makeSession(page)
  await handle.page.goto('http://localhost:9999/')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const resourceEvents = events.filter((event: { type: string }) => event.type === 'perf.resource')

  expect(resourceEvents.length).toBeGreaterThanOrEqual(1)
  const cssResource = resourceEvents.find((event: { data: { name: string } }) =>
    event.data.name.includes('style.css')
  )
  expect(cssResource).toBeDefined()
  expect(cssResource.source).toBe('plugin')
  expect(typeof cssResource.data.transferSize).toBe('number')
  expect(typeof cssResource.data.total).toBe('number')
  expect(typeof cssResource.data.initiatorType).toBe('string')
})

test('suppresses perf.resource events when resources option is false', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>Hello</body></html>',
    })
  )

  const { outDir, handle } = await makeSession(page, { resources: false })
  await handle.page.goto('http://localhost:9999/')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const resourceEvents = events.filter((event: { type: string }) => event.type === 'perf.resource')
  expect(resourceEvents.length).toBe(0)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "perf.resource"`
Expected: FAIL

- [ ] **Step 3: Add resource timing observer to browser script**

The browser script needs to know the options. The node-side injects them by prepending a config variable to the script.

Update `packages/plugin-performance/src/index.ts` — change the `script` property:

```typescript
    script: `var __introspect_perf_config__=${JSON.stringify({ resources: options?.resources ?? true, longTasks: options?.longTasks ?? true })};${BROWSER_SCRIPT}`,
```

Add to `browser.ts`, reading config:

```typescript
  const config = (window as unknown as { __introspect_perf_config__: { resources: boolean; longTasks: boolean } }).__introspect_perf_config__ ?? { resources: true, longTasks: true }

  function observeResource(): void {
    if (!config.resources) return
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const resource = entry as PerformanceResourceTiming
        push('perf.resource', {
          name: resource.name,
          initiatorType: resource.initiatorType,
          transferSize: resource.transferSize,
          encodedBodySize: resource.encodedBodySize,
          decodedBodySize: resource.decodedBodySize,
          dns: resource.domainLookupEnd - resource.domainLookupStart,
          tcp: resource.connectEnd - resource.connectStart,
          tls: resource.secureConnectionStart > 0 ? resource.connectEnd - resource.secureConnectionStart : 0,
          ttfb: resource.responseStart - resource.requestStart,
          download: resource.responseEnd - resource.responseStart,
          total: resource.responseEnd - resource.startTime,
          renderBlocking: (resource as Record<string, unknown>).renderBlockingStatus as string | undefined,
        })
      }
    })
    observer.observe({ type: 'resource', buffered: true })
  }

  observeResource()
```

- [ ] **Step 4: Rebuild and run tests**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "perf.resource"`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-performance/
git commit -m "feat(plugin-performance): resource timing observer with opt-out"
```

---

### Task 7: Browser script — long task events

**Files:**
- Modify: `packages/plugin-performance/src/browser.ts`
- Modify: `packages/plugin-performance/test/performance.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `performance.spec.ts`:

```typescript
test('emits perf.long-task events for tasks exceeding 50ms', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body><script>
        const start = Date.now();
        while (Date.now() - start < 100) {} // block for 100ms
      </script></body></html>`,
    })
  )

  const { outDir, handle } = await makeSession(page)
  await handle.page.goto('http://localhost:9999/')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const longTaskEvents = events.filter((event: { type: string }) => event.type === 'perf.long-task')

  expect(longTaskEvents.length).toBeGreaterThanOrEqual(1)
  expect(longTaskEvents[0].source).toBe('plugin')
  expect(typeof longTaskEvents[0].data.duration).toBe('number')
  expect(longTaskEvents[0].data.duration).toBeGreaterThanOrEqual(50)
})

test('suppresses perf.long-task events when longTasks option is false', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body><script>
        const start = Date.now();
        while (Date.now() - start < 100) {}
      </script></body></html>`,
    })
  )

  const { outDir, handle } = await makeSession(page, { longTasks: false })
  await handle.page.goto('http://localhost:9999/')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const longTaskEvents = events.filter((event: { type: string }) => event.type === 'perf.long-task')
  expect(longTaskEvents.length).toBe(0)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "long-task"`
Expected: FAIL

- [ ] **Step 3: Add long task observer to browser script**

Add to `browser.ts`:

```typescript
  function observeLongTask(): void {
    if (!config.longTasks) return
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const attribution = (entry as unknown as { attribution?: Array<{ containerSrc?: string }> }).attribution
        push('perf.long-task', {
          duration: entry.duration,
          startTime: entry.startTime,
          attribution: attribution?.[0]?.containerSrc || 'unknown',
        })
      }
    })
    observer.observe({ type: 'longtask', buffered: true })
  }

  observeLongTask()
```

- [ ] **Step 4: Rebuild and run tests**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "long-task"`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-performance/
git commit -m "feat(plugin-performance): long task observer with opt-out"
```

---

### Task 8: Browser script — CLS aggregate event

**Files:**
- Modify: `packages/plugin-performance/src/browser.ts`
- Modify: `packages/plugin-performance/test/performance.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `performance.spec.ts`:

```typescript
test('emits perf.cwv event with metric cls for layout shifts without recent input', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body>
        <div id="target" style="position:relative;top:0;width:100px;height:100px;background:red"></div>
        <script>
          setTimeout(() => {
            document.getElementById('target').style.top = '200px';
          }, 100);
        </script>
      </body></html>`,
    })
  )

  const { outDir, handle } = await makeSession(page)
  await handle.page.goto('http://localhost:9999/')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const clsEvents = events.filter(
    (event: { type: string; data: { metric: string } }) =>
      event.type === 'perf.cwv' && event.data.metric === 'cls'
  )

  expect(clsEvents.length).toBeGreaterThanOrEqual(1)
  expect(typeof clsEvents[0].data.value).toBe('number')
  expect(clsEvents[0].data.value).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "emits perf.cwv event with metric cls"`
Expected: FAIL

- [ ] **Step 3: Emit CLS cwv events from the existing layout shift observer**

In the `observeLayoutShift` function in `browser.ts`, add CLS emission for shifts without recent input:

```typescript
  function observeLayoutShift(): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const layoutShift = entry as LayoutShift
        push('perf.layout-shift', {
          score: layoutShift.value,
          hadRecentInput: layoutShift.hadRecentInput,
          sources: (layoutShift.sources || []).map((source) => ({
            selector: selectorForElement(source.node),
            previousRect: {
              x: source.previousRect.x,
              y: source.previousRect.y,
              width: source.previousRect.width,
              height: source.previousRect.height,
            },
            currentRect: {
              x: source.currentRect.x,
              y: source.currentRect.y,
              width: source.currentRect.width,
              height: source.currentRect.height,
            },
          })),
        })
        if (!layoutShift.hadRecentInput) {
          push('perf.cwv', {
            metric: 'cls',
            value: layoutShift.value,
            startTime: layoutShift.startTime,
          })
        }
      }
    })
    observer.observe({ type: 'layout-shift', buffered: true })
  }
```

- [ ] **Step 4: Rebuild and run test**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test test/performance.spec.ts -g "emits perf.cwv event with metric cls"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-performance/
git commit -m "feat(plugin-performance): CLS events from layout shift observer"
```

---

### Task 9: Run full test suite and verify navigation recovery

**Files:**
- Modify: `packages/plugin-performance/test/performance.spec.ts`

- [ ] **Step 1: Write a navigation recovery test**

Add to `performance.spec.ts`:

```typescript
test('re-captures events after navigation', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><h1>Page</h1></body></html>',
    })
  )

  const { outDir, handle } = await makeSession(page)
  await handle.page.goto('http://localhost:9999/')
  await new Promise(resolve => setTimeout(resolve, 300))
  await handle.page.goto('http://localhost:9999/other')
  await new Promise(resolve => setTimeout(resolve, 300))

  const events = await endSession(handle, outDir)
  const paintEvents = events.filter((event: { type: string }) => event.type === 'perf.paint')

  // Should have paint events from both navigations
  expect(paintEvents.length).toBeGreaterThanOrEqual(2)
})
```

- [ ] **Step 2: Rebuild and run full test suite**

Run: `cd /Users/puckey/rg/introspection && pnpm -r --filter @introspection/plugin-performance run build && cd packages/plugin-performance && npx playwright test`
Expected: All tests PASS

- [ ] **Step 3: Run the full monorepo test suite to check for regressions**

Run: `cd /Users/puckey/rg/introspection && pnpm run build && pnpm run test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-performance/
git commit -m "test(plugin-performance): navigation recovery and full suite pass"
```

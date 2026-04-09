# Plugin: Performance (`@introspection/plugin-performance`)

## Purpose

Capture raw browser performance data as trace events during Playwright test runs. Provides the underlying data needed to diagnose Core Web Vitals issues (e.g. "LCP is >4s, why?") without scoring or auditing — raw entries that a human or AI agent can interpret from the trace.

## Scope

- Core Web Vitals entries (LCP, CLS, INP)
- Resource timing waterfall
- Long tasks with attribution
- Layout shifts with affected elements
- Paint timing (FP, FCP)

**Out of scope:** Lighthouse scoring, aggregated CWV values (e.g. windowed CLS), diagnostics/opportunities. See `docs/POSSIBILITIES.md` for future work.

## Plugin API

```ts
import { performance } from '@introspection/plugin-performance'

const handle = await attach(page, {
  plugins: [performance()]
})
```

### Options

```ts
interface PerformanceOptions {
  resources?: boolean  // capture resource timing entries (default: true)
  longTasks?: boolean  // capture long tasks >50ms (default: true)
}
```

CWV entries (LCP, CLS, INP), layout shifts, and paint timing are always captured. Resources and long tasks are optional since they can be noisy.

### Plugin metadata

```ts
{
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
    resources: { description: 'Capture resource timing entries', value: true },
    longTasks: { description: 'Capture long tasks >50ms', value: true },
  },
}
```

No public methods — the plugin is passive. It observes automatically once installed.

## Event shapes

### `perf.cwv`

One event per LCP, CLS, or INP entry observed by `PerformanceObserver`.

```ts
{
  type: 'perf.cwv',
  data: {
    metric: 'lcp' | 'cls' | 'inp',
    value: number,            // ms for lcp/inp, score for cls
    element?: string,         // CSS selector of LCP element or shift source
    url?: string,             // resource URL for LCP (if image/video)
    size?: number,            // LCP element size in px²
    startTime: number,        // performance.now() of the entry
  }
}
```

### `perf.resource`

One event per resource loaded on the page.

```ts
{
  type: 'perf.resource',
  data: {
    name: string,             // resource URL
    initiatorType: string,    // 'script', 'link', 'img', 'fetch', etc.
    transferSize: number,
    encodedBodySize: number,
    decodedBodySize: number,
    dns: number,              // timing breakdown in ms
    tcp: number,
    tls: number,
    ttfb: number,
    download: number,
    total: number,
    renderBlocking?: string,  // 'render-blocking' | 'non-blocking'
  }
}
```

### `perf.long-task`

One event per long task (>50ms).

```ts
{
  type: 'perf.long-task',
  data: {
    duration: number,         // ms
    startTime: number,
    attribution: string,      // script URL or 'unknown'
  }
}
```

### `perf.layout-shift`

One event per layout shift.

```ts
{
  type: 'perf.layout-shift',
  data: {
    score: number,
    hadRecentInput: boolean,
    sources: Array<{
      selector: string,
      previousRect: DOMRect,
      currentRect: DOMRect,
    }>,
  }
}
```

### `perf.paint`

One event each for First Paint and First Contentful Paint.

```ts
{
  type: 'perf.paint',
  data: {
    name: 'first-paint' | 'first-contentful-paint',
    startTime: number,
  }
}
```

## Architecture

### File structure

```
packages/plugin-performance/
├── src/
│   ├── index.ts          # factory function, install(), plugin metadata
│   └── browser.ts        # PerformanceObserver IIFE (compiled by tsup)
├── test/
│   └── performance.spec.ts
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

### Data collection

All data is collected via browser-side `PerformanceObserver` instances, pushed through the existing `__introspect_push__` bridge. No CDP domains are enabled by this plugin.

**Browser script (`browser.ts`):**

- Registers on `window.__introspect_plugins__.performance`
- Creates `PerformanceObserver` instances with `{ buffered: true }` to catch entries from before the script ran
- Observers registered for: `largest-contentful-paint`, `layout-shift`, `event` (INP), `resource`, `longtask`, `paint`
- Each entry calls `window.__introspect_push__(JSON.stringify({ type, data }))` with the relevant event type and extracted fields
- Reads config (resources/longTasks flags) from options passed during script setup

### Install flow

1. `performance(options?)` factory returns plugin with compiled browser IIFE as `script`
2. `install(ctx)` — no-op. The browser script is injected via `plugin.script` (handled by `attach()`'s `addInitScript`). No CDP domains to enable.

### Navigation recovery

The browser script is injected via `addInitScript`, so it re-runs on every navigation automatically. No `addSubscription()` needed — there are no watches to re-apply (unlike WebGL).

### Bus integration

None. The plugin doesn't react to `manual` or `detach` triggers — `PerformanceObserver` entries are pushed as they occur. There is no accumulated state to snapshot on demand.

### Dependencies

- `@introspection/types` — plugin interfaces
- No dependency on `@introspection/core` (no CDP normalizers or snapshot logic needed)

## Testing

Tests run against real browsers via Playwright (per project conventions). Test cases:

- Navigate to a page with a known large image → verify `perf.cwv` event with `metric: 'lcp'` is emitted with element/URL attribution
- Navigate to a page with render-blocking scripts → verify `perf.resource` events include `renderBlocking` field
- Navigate to a page that triggers layout shifts → verify `perf.layout-shift` events with scores and source selectors
- Verify `perf.paint` events for FP and FCP are emitted on any navigation
- Verify `resources: false` suppresses `perf.resource` events
- Verify `longTasks: false` suppresses `perf.long-task` events
- Verify events are re-captured after a same-page navigation (script re-injection)

# @introspection/plugin-performance

Introspection plugin that captures Core Web Vitals, resource timing, long tasks, layout shifts, and paint events via the Performance API.

Automatically records performance metrics, resource waterfall, long tasks >50ms, layout shifts, and paint events throughout the page lifecycle. Useful for identifying performance bottlenecks, validating Core Web Vitals, and correlating performance issues with user interactions.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Options](#options)
- [Events emitted](#events-emitted)

## Install

```bash
pnpm add -D @introspection/plugin-performance
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { performance } from '@introspection/plugin-performance'

const handle = await attach(page, { plugins: [performance()] })

await handle.page.goto('/')
await handle.detach()
```

## Options

```ts
performance({
  resources?: boolean   // capture resource timing entries; default: true
  longTasks?: boolean   // capture long tasks >50ms; default: true
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `resources` | `boolean` | `true` | Capture resource timing entries |
| `longTasks` | `boolean` | `true` | Capture long tasks >50ms |

## Events emitted

### Core Web Vitals

`perf.cwv` — LCP, CLS (excluding user-triggered shifts), and INP:

```ts
{
  id: string
  timestamp: number
  type: 'perf.cwv',
  metadata: {
    metric: 'lcp' | 'cls' | 'inp',
    value: number,         // milliseconds
    startTime?: number,    // for CLS and INP
    element?: string,      // CSS selector for LCP element
    url?: string,          // LCP image URL
    size?: number,         // LCP element size
  }
}
```

### Resource timing

`perf.resource` — Full waterfall breakdown for each loaded resource:

```ts
{
  id: string
  timestamp: number
  type: 'perf.resource',
  metadata: {
    name: string,              // resource URL
    initiatorType: string,     // 'link', 'script', 'img', etc.
    transferSize: number,
    encodedBodySize: number,
    decodedBodySize: number,
    dns: number,              // DNS lookup time (ms)
    tcp: number,              // TCP handshake time (ms)
    tls: number,              // TLS handshake time (ms)
    ttfb: number,             // Time to First Byte (ms)
    download: number,         // Response download time (ms)
    total: number,            // Total time (ms)
    renderBlocking?: string,  // 'blocking' | 'non-blocking'
  }
}
```

### Long tasks

`perf.long-task` — Any task blocking the main thread for >50ms:

```ts
{
  id: string
  timestamp: number
  type: 'perf.long-task',
  metadata: {
    duration: number,   // task duration in ms
    startTime: number,
    attribution: string, // container src if attributable to an iframe
  }
}
```

### Layout shifts

`perf.layout-shift` — Individual shift events with source elements:

```ts
{
  id: string
  timestamp: number
  type: 'perf.layout-shift',
  metadata: {
    score: number,
    hadRecentInput: boolean,
    sources: Array<{
      selector: string,          // CSS selector of shifted element
      previousRect: { x, y, width, height },
      currentRect: { x, y, width, height },
    }>
  }
}
```

### Paint

`perf.paint` — First Paint and First Contentful Paint:

```ts
{
  id: string
  timestamp: number
  type: 'perf.paint',
  metadata: {
    name: 'first-paint' | 'first-contentful-paint',
    startTime: number,
  }
}
```

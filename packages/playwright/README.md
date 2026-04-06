# @introspection/playwright

Attaches CDP-based tracing to a Playwright `Page`. Captures network requests, JS errors, DOM snapshots, and Playwright actions into a structured NDJSON session on disk.

## Install

```bash
pnpm add -D @introspection/playwright
```

## Usage

```ts
import { attach } from '@introspection/playwright'

const handle = await attach(page, { testTitle: 'my test' })

await handle.page.goto('/')
handle.mark('step', { extra: 'data' })
await handle.snapshot()           // capture DOM + scope manually
await handle.detach()             // finalize session
```

Use `handle.page` (the proxy-wrapped page) instead of the original — it records Playwright actions as events.

## `attach(page, opts?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `outDir` | `string` | `'.introspect'` | Directory to write session files |
| `testTitle` | `string` | `'unknown test'` | Label in session metadata |
| `workerIndex` | `number` | — | Playwright worker index |
| `plugins` | `IntrospectionPlugin[]` | `[]` | Browser-side plugins |
| `verbose` | `boolean` | `false` | Log lifecycle events to stderr |

## Fixture

For automatic attach/detach wired to test result status:

```ts
// fixtures.ts
import { introspectFixture } from '@introspection/playwright/fixture'
export const { test, expect } = introspectFixture({ outDir: '.introspect' })
```

```ts
// my.spec.ts
import { test, expect } from './fixtures'

test('example', async ({ page, introspect }) => {
  await page.goto('/')
  introspect.mark('loaded')
  // detach is called automatically on completion
})
```

The `introspect` fixture value is the `IntrospectHandle`. `detach` is called with `{ status, duration, error }` from `testInfo` automatically.

## Exports

```ts
import { attach } from '@introspection/playwright'
import { introspectFixture } from '@introspection/playwright/fixture'
```

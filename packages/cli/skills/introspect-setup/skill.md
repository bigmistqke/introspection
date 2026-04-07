---
name: introspect-setup
description: Use when adding introspection to a project for the first time
---

# Setting up introspection

## 1. Install packages

```bash
# Host adapter + standard plugins
pnpm add -D @introspection/playwright @introspection/plugin-network @introspection/plugin-js-errors

# Optional domain-specific plugins
pnpm add -D @introspection/plugin-webgl
```

Available plugins:

| Plugin | Package | What it captures |
|---|---|---|
| `network()` | `@introspection/plugin-network` | HTTP requests, responses, bodies |
| `jsErrors()` | `@introspection/plugin-js-errors` | Exceptions with scope locals and DOM snapshots |
| `webgl()` | `@introspection/plugin-webgl` | WebGL state, uniforms, draw calls, canvas PNGs |

`defaults()` from `@introspection/playwright` bundles `network()` + `jsErrors()` for convenience.

## 2. Attach in Playwright tests

```ts
import { test } from '@playwright/test'
import { attach, defaults } from '@introspection/playwright'

test('my test', async ({ page }) => {
  const handle = await attach(page, {
    outDir: '.introspect',   // default — where session traces are written
    testTitle: 'my test',    // optional human-readable name
    plugins: defaults(),     // network capture + JS error capture
  })

  await page.goto('/')
  handle.mark('user submitted form')  // optional semantic markers

  await handle.snapshot()   // optional manual snapshot
  await handle.detach()
})
```

`handle.page` is a proxy-wrapped version of `page` that tracks Playwright actions as events. Use it instead of `page` directly if you want action tracking.

## 3. WebGL plugin (optional)

```ts
import { webgl } from '@introspection/plugin-webgl'

const plugin = webgl()
const handle = await attach(page, { plugins: [...defaults(), plugin] })

await plugin.watch({ event: 'uniform', name: 'u_time', valueChanged: true })
await plugin.watch({ event: 'draw' })
await plugin.watch({ event: 'texture-bind' })

await plugin.captureCanvas()   // capture canvas PNG without full GL state
await handle.snapshot()        // captures full GL state + canvas PNG per context
```

## 4. Verify

```bash
# Run a test, then:
ls .introspect/           # should contain session subdirectories
introspect list           # lists sessions with ID, duration, label
introspect summary        # plain-language overview of the most recent session
```

If `.introspect/` is empty or missing:
- Confirm `attach(page)` is called before `page.goto()`
- Confirm `handle.detach()` is called at the end of the test

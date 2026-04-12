---
name: introspect-setup
description: Use when adding introspection to a project for the first time
---

# Setting up introspection

## 1. Install packages

```bash
# Host adapter + standard plugins
pnpm add -D @introspection/playwright @introspection/plugin-network @introspection/plugin-js-error @introspection/plugin-console

# Optional domain-specific plugins
pnpm add -D @introspection/plugin-webgl
```

Available plugins:

| Plugin | Package | What it captures |
|---|---|---|
| `network()` | `@introspection/plugin-network` | HTTP requests, responses, bodies |
| `jsError()` | `@introspection/plugin-js-error` | JS exceptions, emits bus('js.error') |
| `debuggerPlugin()` | `@introspection/plugin-debugger` | Scope locals on exceptions, breakpoints, and `capture()` calls |
| `consolePlugin()` | `@introspection/plugin-console` | Browser console output |
| `webgl()` | `@introspection/plugin-webgl` | WebGL state, uniforms, draw calls, canvas PNGs |
| `solidDevtools()` | `@introspection/plugin-solid-devtools` | SolidJS component tree and reactive updates |
| `performance()` | `@introspection/plugin-performance` | Core Web Vitals, resource timing, long tasks |
| `redux()` | `@introspection/plugin-redux` | Store dispatches from Redux, Zustand, Valtio, and Redux DevTools–compatible libraries (action + optional state) |
| `cdp()` | `@introspection/plugin-cdp` | Raw CDP commands and events (instrumentation/debugging) |

`defaults()` from `@introspection/plugin-defaults` bundles `network()` + `jsError()` + `debuggerPlugin()` + `consolePlugin()` for convenience.

## 2. Attach in Playwright tests

```ts
import { test } from '@playwright/test'
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'
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

## 4. Debugger plugin and capture()

The debugger plugin can capture local variables at arbitrary points in your code:

```ts
import { capture } from '@introspection/plugin-debugger/client'

function calculate() {
  const result = heavyComputation()
  capture('after calculation')  // pauses, captures locals, resumes
  return result
}
```

Scopes are written to a `scopes` asset with the label as the `message` field.

## 5. Verify

```bash
# Run a test, then:
ls .introspect/           # should contain session subdirectories
introspect list           # lists sessions with ID, duration, label
introspect summary        # plain-language overview of the most recent session
```

If `.introspect/` is empty or missing:
- Confirm `attach(page)` is called before `page.goto()`
- Confirm `handle.detach()` is called at the end of the test

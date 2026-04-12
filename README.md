# @introspection

Introspection is a Playwright-integrated tracing framework. A session records a stream of typed trace events — network requests and responses, JS errors with scope locals, DOM snapshots, Playwright actions — and their associated assets to disk as NDJSON. **Plugins are the unit of feature capture**, each subscribing to Chrome DevTools Protocol (CDP) events or page state.

When an end-to-end test fails, the usual debugging loop is: read the error, guess what the app was doing, add more logs or breakpoints, re-run. With a trace on disk, you can query the recorded session instead of re-running the test.

Introspection is built primarily for AI-assisted debugging — the trace gives a model the full execution context to reason about — but the same trace is queryable by humans too, via the [`introspect`](packages/cli/README.md) CLI or programmatically through [`@introspection/read`](packages/read/README.md).

---

## Table of contents

- [How it works](#how-it-works)
- [Packages](#packages)
- [Plugins](#plugins)
- [Quick start](#quick-start)
- [Session format](#session-format)
- [Continuous releases](#continuous-releases)

---

## How it works

`attach(page, { plugins })` opens a CDP session alongside the Playwright test. Plugins contribute to the event stream by subscribing to CDP events and/or injecting scripts in the browser.

---

## Packages

| Package | Description |
|---|---|
| [`@introspection/playwright`](packages/playwright/README.md) | Attach tracing to a Playwright page — the main integration point |
| [`introspect`](packages/cli/README.md) | CLI for querying traces: summary, events, list, plugins |
| [`@introspection/read`](packages/read/README.md) | Programmatic access to traces — adapter-based, environment-agnostic |
| [`@introspection/write`](packages/write/) | Session recording — creates sessions, appends events, writes assets |
| [`@introspection/utils`](packages/utils/) | Shared utilities: CDP normalizers, event bus, debug, snapshot |
| [`@introspection/types`](packages/types/README.md) | Shared TypeScript types for events, plugins, and session format |

## Plugins

Every capability is a plugin. If you don't wire it up, it won't log. Pass the plugins you want to `attach()` via the required `plugins` option.

| Plugin | Package | What it captures |
|---|---|---|
| `defaults()` | [`@introspection/plugin-defaults`](plugins/plugin-defaults/README.md) | Composition: `[network(), jsError(), debuggerPlugin(), consolePlugin()]` |
| `network()` | [`@introspection/plugin-network`](plugins/plugin-network/README.md) | HTTP requests, responses, and response bodies |
| `jsError()` | [`@introspection/plugin-js-error`](plugins/plugin-js-error/README.md) | JS exceptions and unhandled rejections |
| `debuggerPlugin()` | [`@introspection/plugin-debugger`](plugins/plugin-debugger/README.md) | Debugger pauses with scope locals and call stack |
| `consolePlugin()` | [`@introspection/plugin-console`](plugins/plugin-console/README.md) | Browser console output |
| `webgl()` | [`@introspection/plugin-webgl`](plugins/plugin-webgl/README.md) | WebGL state, uniforms, draw calls, textures, and canvas PNGs |
| `solidDevtools()` | [`@introspection/plugin-solid`](plugins/plugin-solid/README.md) | SolidJS component structure, reactive updates, and dependency graph |
| `redux()` | [`@introspection/plugin-redux`](plugins/plugin-redux/README.md) | Redux/Rematch store dispatches with optional state snapshots |
| `performance()` | [`@introspection/plugin-performance`](plugins/plugin-performance/README.md) | Core Web Vitals, resource timing, long tasks, layout shifts, and paint |

`defaults()` from `@introspection/plugin-defaults` returns `[network(), jsError(), debuggerPlugin(), consolePlugin()]` — the standard set for most tests. Add domain-specific plugins alongside:

```ts
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'
```

---

## Quick start

```bash
pnpm add -D @introspection/playwright introspect
```

```ts
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'

test('checkout flow', async ({ page }) => {
  const handle = await attach(page, { testTitle: 'checkout flow', plugins: defaults() })

  await handle.page.goto('/cart')
  await handle.page.getByRole('button', { name: 'Checkout' }).click()

  await handle.detach()
})
```

After the test runs, query the session:

```bash
introspect summary
introspect events --type js.error
introspect events --type network.*  # Prefix matching: all network.* events
introspect events --type network.response --filter 'event.metadata.status >= 400'
```

See [`@introspection/playwright`](packages/playwright/README.md) for the full API including plugins, fixtures, and options.

---

## Session format

Each test produces a session directory:

```
.introspect/
  <session-id>/
    meta.json        ← id, startedAt, endedAt, label
    events.ndjson    ← one JSON event per line
    assets/          ← response bodies, DOM snapshots, plugin captures
```

Events are plain JSON objects with a `type`, `source`, `ts` (ms since test start), and `data`. The format is stable and easy to parse or stream into an LLM context.

---

## Continuous releases

Every push to `main` publishes preview builds via [pkg.pr.new](https://pkg.pr.new). You can install any commit's build directly without waiting for a versioned release — useful for trying unreleased fixes or features.

The full list of published previews is tracked on the [`releases` branch](https://github.com/bigmistqke/introspection/tree/releases), with install commands for each package at every commit and a JSON list for use in `package.json` `overrides` (e.g. in a monorepo).

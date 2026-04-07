# @introspection

When an end-to-end test fails, the usual debugging loop is: read the error, guess what the app was doing, add more logs or breakpoints, re-run. This gets expensive fast — especially when failures are flaky, hard to reproduce, or happen deep in a render or network chain.

Introspection gives every Playwright test a structured, append-only event log: network requests and responses, JS errors with scope locals, DOM snapshots, and Playwright actions — all written to disk as NDJSON. When something goes wrong, you can query the trace instead of re-running the test.

The log is also designed to be consumed by AI assistants. Run `introspect summary` and paste the output into a conversation; the model has the full execution context to reason about.

---

## How it works

`attach(page, { plugins })` opens a CDP session alongside the Playwright test. Plugins (like `network()` and `jsErrors()`, bundled together as `defaults()`) subscribe to CDP events and translate them into a normalized event stream. A proxy-wrapped `page` object records Playwright actions into the same stream. Everything is appended to `events.ndjson` as it arrives — no batching, no end-of-test flush required.

On uncaught JS errors the debugger pauses, collects scope locals from the call stack, then resumes. The snapshot (DOM + scopes + globals) is written to `assets/` with a pointer in the event stream.

Plugins inject a browser-side script to intercept domain-specific APIs (e.g. WebGL calls) and push structured events back through a CDP binding into the same stream.

---

## Packages

| Package | Description |
|---|---|
| [`@introspection/playwright`](packages/playwright/README.md) | Attach tracing to a Playwright page — the main integration point |
| [`@introspection/plugin-webgl`](packages/plugin-webgl/README.md) | Browser-side WebGL interceptor: track uniforms, draws, textures, capture canvas PNGs |
| [`introspect`](packages/cli/README.md) | CLI for querying traces: summary, timeline, errors, network, dom, body, eval |
| [`@introspection/core`](packages/core/README.md) | CDP normalizers, session I/O, snapshot utilities (used internally) |
| [`@introspection/types`](packages/types/README.md) | Shared TypeScript types for events, plugins, and session format |

---

## Quick start

```bash
pnpm add -D @introspection/playwright introspect
```

```ts
import { attach, defaults } from '@introspection/playwright'

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
introspect errors
introspect network --failed
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

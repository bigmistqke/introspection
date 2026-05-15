---
name: introspect-debug
description: Use when a Playwright test fails or an app behaves unexpectedly and introspection is set up — guides querying the trace trace to identify root cause
---

# Debugging with introspect

When a test fails or something behaves unexpectedly, query the trace trace **before** reading source files, adding `page.on('console')`, or inserting `console.log` into test code. The trace already captures what actually happened at runtime: console output, network requests and response bodies, JS errors with stacks, Playwright actions, and plugin-specific data.

## Golden rule

**Don't add observation instrumentation to the test.** `page.on('console', ...)`, `page.on('pageerror', ...)`, `console.log` inside the test body — all redundant. The `defaults()` plugins already capture that information. Going to the trace after a failure is the expected workflow; re-running the test with extra handlers is a regression to pre-introspect habits.

If the CLI can't surface what you need in readable form, that's a gap in the CLI to fix — not a reason to fall back to raw `cat .introspect/*/events.ndjson | grep` or test-side handlers. File it / patch it.

## Always start here

```bash
introspect summary
```

Plain-language overview: trace label, failed network requests, JS errors. This usually points directly at the problem. Use `--trace-id <id>` to target a specific trace (default: most recent). Run `introspect list` to see all traces.

If `summary` doesn't surface the answer:

```bash
introspect events
```

Chronological, human-readable timeline of everything: `[timestamp] type detail`. Defaults to the latest trace. This is the introspect-native replacement for `page.on('console')` — it shows console output, Playwright actions, navigations, JS errors, and network events interleaved in order.

## Decision tree

### Test hung or timed out → look at what was happening when it stopped

```bash
introspect events --last 30
```

Shows the last 30 events before the trace ended. Often reveals: an infinite render loop (30 repeat console events in <100ms), a pending network request (request emitted, no response), a stuck Playwright action (action emitted, no subsequent events).

```bash
introspect events --type console                   # isolate console spam
introspect events --type playwright.action --last 5  # see what the test was trying to do
```

### JS error found → get the stack

```bash
introspect events --type js.error
```

Stack traces are included in the `js.error` event data.

### Network failure found → inspect the response

```bash
introspect events --type network.response --filter 'event.metadata.status >= 400'
introspect assets                                      # list every asset with its kind
introspect assets <path.json>                          # display a specific asset
```

Response bodies are attached to `network.response.body` events (see the event's `assets[0].path`); the body asset has `kind: 'json'` / `'html'` / `'text'` / `'binary'`.

### State looks wrong → filter events programmatically

```bash
introspect events --filter 'event.type === "mark"' --format json
introspect events --filter 'event.metadata.action === "CART/ADD"' --type redux.dispatch
```

`--filter <expr>` runs a boolean JS predicate against each event (`event` is in scope). Combine with `--format json` to pipe into `jq` for further shaping.

### WebGL plugin data

```bash
introspect events --type webgl.uniform
introspect events --type webgl.uniform --filter 'event.metadata.name === "u_time"'
introspect events --type webgl.draw-arrays,webgl.draw-elements
introspect assets                                      # canvas PNGs show up with kind: image
introspect assets <path.png>
```

### Scopes (from debugger plugin)

```bash
introspect assets                                      # scopes assets show up with kind: json
introspect assets <path.json>
```

Scopes assets contain local variables from call frames. Useful for seeing variable values at specific points, especially from `capture()` calls.

### Nothing obvious → browse events

```bash
introspect events                                          # all events in order
introspect events --type js.error,network.response        # filter by type
introspect events --type network.*                        # prefix matching: all network events
introspect events --since "form submitted"                # events after a mark
introspect events --filter 'event.metadata.status >= 400' --type network.response
introspect events --format json | jq '.[].metadata.url'  # extract fields
```

### Suspiciously repeated events

```bash
introspect events --type console | head -50
introspect events --type network.request --filter 'event.metadata.url.includes("/api/foo")'
```

Long runs of the same event in a short window usually mean something is looping: repeated console output, repeated identical fetches, repeated re-renders. Eyeball the first 50 lines or pipe to `| sort | uniq -c | sort -rn` to quantify duplicates.

## Event type reference

| Type | What it means |
|------|---------------|
| `network.request` | HTTP request — url, method, headers, postData |
| `network.response` | HTTP response — status, headers (body is a separate event) |
| `network.response.body` | Response body — attached as an asset; `initiator` points to the response event |
| `network.error` | Request failed at network level |
| `js.error` | JS exception with source-mapped stack |
| `console` | Console output (`log` / `warn` / `error` / `info` / `debug`) |
| `debugger.capture` | Scope snapshot from a `capture()` call or exception pause |
| `redux.dispatch` | Store dispatch from Redux, Zustand, Valtio, or Redux DevTools–compatible libraries — action type, optional payload/state |
| `perf.cwv` | Core Web Vitals (LCP, CLS, INP) |
| `perf.resource` / `perf.long-task` / `perf.layout-shift` / `perf.paint` | Timing-derived performance events |
| `webgl.context-created` / `.context-lost` / `.context-restored` | WebGL context lifecycle |
| `webgl.uniform` | `useProgram`/uniform set on a watched program |
| `webgl.draw-arrays` / `.draw-elements` | Draw calls (when `plugin.watch({ event: 'draw' })`) |
| `webgl.texture-bind` | Texture bind/unbind |
| `webgl.capture` | Canvas PNG capture — PNG is in `assets[0]` |
| `solid.detected` / `.warning` / `.capture` | SolidJS devtools events |
| `cdp.command` / `cdp.event` | Raw CDP (when `plugin-cdp` is attached) |
| `browser.navigate` | Page navigation |
| `playwright.action` | click, fill, goto, waitFor, etc. |
| `mark` | Semantic label placed by test code via `handle.mark('...')` |

Assets are attached to events via `event.assets: AssetRef[]`; there is no standalone `asset` event.

## Asset reference

`introspect assets` lists every asset across the trace; pass a path to print its contents:

```bash
introspect assets            # list all (columns: kind, path)
introspect assets <path>     # display asset content (text kinds as-is; images show size)
```

Filter by kind in shell if needed, e.g. `introspect assets | grep '^image'`.

## Notes

- All commands default to the most recent trace. Use `--trace-id <id>` to target a specific one.
- `introspect assets <path>` displays the asset. Text content (json, html) is shown as-is; images show dimensions.
- WebGL events only appear if the `plugin-webgl` plugin was attached and `plugin.watch(...)` was called.

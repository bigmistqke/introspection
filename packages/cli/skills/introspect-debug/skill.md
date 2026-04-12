---
name: introspect-debug
description: Use when a Playwright test fails or an app behaves unexpectedly and introspection is set up — guides querying the session trace to identify root cause
---

# Debugging with introspect

When a test fails or something behaves unexpectedly, use the `introspect` CLI to query the session trace before reading source files. The trace captures what actually happened at runtime: network requests and response bodies, JS errors with source-mapped stacks, and plugin-specific data.

## Always start here

```bash
introspect summary
```

Plain-language overview: session label, failed network requests, JS errors. This usually points directly at the problem. Use `--session-id <id>` to target a specific session (default: most recent). Run `introspect list` to see all sessions.

## Decision tree

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
| `redux.dispatch` | Redux/Rematch dispatch — action type, optional payload/state |
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

`introspect assets` lists every asset across the session; pass a path to print its contents:

```bash
introspect assets            # list all (columns: kind, path)
introspect assets <path>     # display asset content (text kinds as-is; images show size)
```

Filter by kind in shell if needed, e.g. `introspect assets | grep '^image'`.

## Notes

- All commands default to the most recent session. Use `--session-id <id>` to target a specific one.
- `introspect assets <path>` displays the asset. Text content (json, html) is shown as-is; images show dimensions.
- WebGL events only appear if the `plugin-webgl` plugin was attached and `plugin.watch(...)` was called.

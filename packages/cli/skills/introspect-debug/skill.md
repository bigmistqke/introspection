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

Plain-language overview: session label, failed network requests, JS errors. This usually points directly at the problem. Use `--session <id>` to target a specific session (default: most recent). Run `introspect list` to see all sessions.

## Decision tree

### JS error found → get the stack

```bash
introspect events --type js.error
```

Stack traces are included in the `js.error` event data.

### Network failure found → inspect the response

```bash
introspect events --type network.response --filter 'event.metadata.status >= 400'
introspect assets --kind body
introspect assets <path.json>
```

List assets to find the body file, then display it.

### State looks wrong → query events programmatically

```bash
introspect eval 'events.filter(event => event.type === "mark").map(event => event.metadata.label)'
```

`eval` runs a JS expression against `{ events, session, snapshots }`. Useful for: checking which marks fired, counting requests, inspecting event sequences.

### WebGL plugin data

```bash
introspect events --type webgl.uniform
introspect events --type webgl.uniform --filter 'event.metadata.name === "u_time"'
introspect events --type webgl.draw-arrays,webgl.draw-elements
introspect assets --kind webgl-canvas
introspect assets <path.png>
```

### Scopes (from debugger plugin)

```bash
introspect assets --kind scopes
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
| `network.response` | HTTP response — status, headers, body saved separately |
| `network.error` | Request failed at network level |
| `js.error` | JS exception with source-mapped stack |
| `browser.navigate` | Page navigation |
| `playwright.action` | click, fill, goto, waitFor, etc. |
| `mark` | Semantic label placed by test code via `handle.mark('...')` |
| `asset` | File written to disk — body, scopes, canvas, etc. |

## Asset reference

Use `introspect assets` to list and display assets. Filter by kind or content type:

```bash
introspect assets                    # list all
introspect assets --kind scopes      # filter by kind
introspect assets --kind webgl-canvas
introspect assets <path>            # display asset content
```

## Notes

- All commands default to the most recent session. Use `--session <id>` to target a specific one.
- `introspect assets <path>` displays the asset. Text content (json, html) is shown as-is; images show dimensions.
- WebGL events only appear if the `plugin-webgl` plugin was attached and `plugin.watch(...)` was called.

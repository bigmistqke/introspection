---
name: introspect-debug
description: Use when a Playwright test fails or an app behaves unexpectedly and introspection is set up — guides querying the session trace to identify root cause
---

# Debugging with introspect

When a test fails or something behaves unexpectedly, use the `introspect` CLI to query the session trace before reading source files. The trace captures what actually happened at runtime: network requests and response bodies, JS errors with source-mapped stacks, the variable scope at crash time, and WebGL plugin data.

## Always start here

```bash
introspect summary
```

Plain-language overview: session label, failed network requests, JS errors. This usually points directly at the problem. Use `--session <id>` to target a specific session (default: most recent). Run `introspect list` to see all sessions.

## Decision tree

### JS error found → get the stack and scope

```bash
introspect errors     # source-mapped stack traces
introspect snapshot   # variable scope chain at crash time (default: last snapshot)
```

`snapshot` shows locals at the error site. If `response.data` was `undefined`, you'll see it here. Use `--filter` to select a specific snapshot:

```bash
introspect snapshot --filter 'snapshot.trigger === "js.error"'
```

### Network failure found → inspect the response body

```bash
introspect network                          # table of all requests + event IDs
introspect body <eventId>                   # full response body
introspect body <eventId> --path "$.errors" # extract a field with JSONPath
```

Get the event ID from the last column of `introspect network` output.

### State looks wrong → query events programmatically

```bash
introspect eval 'events.filter(event => event.type === "mark").map(event => event.data.label)'
```

`eval` runs a JS expression against `{ events, session, snapshots }`. Useful for: checking which marks fired, counting requests, inspecting event sequences.

### WebGL plugin data

```bash
introspect events --type webgl.uniform
introspect events --type webgl.uniform --filter 'event.data.name === "u_time"'
introspect events --type webgl.draw-arrays,webgl.draw-elements
introspect eval 'events.filter(event => event.type === "webgl.texture-bind").length'
```

### Nothing obvious → browse the timeline

```bash
introspect timeline                                        # all events in order
introspect events --type js.error,network.response        # filter by type
introspect events --since "form submitted"                 # events after a mark
introspect events --filter 'event.data.status >= 400' --type network.response
```

## Investigation report (required)

**Always write your findings to `.introspect/<session-id>/reports/<uuid>.md`** before reporting back. Generate a short UUID for the filename. Use the session ID from `introspect list` output.

Include:
- Each command you ran and its exact output
- What each output told you and what you looked at next
- Root cause, location in code, and the fix

Co-locating the report inside the session directory keeps the working tree clean and allows multiple reports on the same session.

## Event type reference

| Type | What it means |
|------|---------------|
| `network.request` | HTTP request — url, method, headers, postData |
| `network.response` | HTTP response — status, headers, body saved separately |
| `network.error` | Request failed at network level |
| `js.error` | Uncaught exception with source-mapped stack |
| `browser.navigate` | Page navigation |
| `playwright.action` | click, fill, goto, waitFor, etc. |
| `mark` | Semantic label placed by test code via `handle.mark('...')` |
| `asset` | File written to disk: snapshot JSON, canvas PNG, response body |
| `webgl.context-created` | A WebGL context was created |
| `webgl.uniform` | `gl.uniform*()` call (requires watch subscription) |
| `webgl.draw-arrays` | `gl.drawArrays()` call (requires watch subscription) |
| `webgl.draw-elements` | `gl.drawElements()` call (requires watch subscription) |
| `webgl.texture-bind` | `gl.bindTexture()` call (requires watch subscription) |

## Notes

- All commands default to the most recent session. Use `--session <id>` to target a specific one.
- `introspect body <eventId>` retrieves the saved response body for a `network.response` event.
- `introspect snapshot` defaults to the most recent snapshot. Use `--filter` to select by trigger or other fields.
- WebGL events only appear if the `plugin-webgl` plugin was attached and `plugin.watch(...)` was called.

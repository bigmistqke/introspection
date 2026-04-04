---
name: introspect-debug
description: Use when a Playwright test fails or an app behaves unexpectedly and introspection is set up — guides querying the session trace to identify root cause
---

# Debugging with introspect

When a test fails or something behaves unexpectedly, use the `introspect` CLI to query the session trace before reading source files. The trace captures what actually happened at runtime: network requests and response bodies, JS errors with source-mapped stacks, the variable scope at crash time, and plugin data like Redux actions.

## Always start here

```bash
introspect summary
```

Plain-language overview: session label, failed network requests, JS errors. This usually points directly at the problem. Use `--session <id>` to target a specific session (default: most recent). Run `introspect list` to see all sessions.

## Decision tree

### JS error found → get the stack and scope

```bash
introspect errors     # source-mapped stack traces
introspect snapshot   # variable scope chain at crash time
```

`snapshot` shows locals at the error site. If `response.data` was `undefined`, you'll see it here.

### Network failure found → inspect the response body

```bash
introspect network                        # table of all requests + event IDs
introspect body <eventId>                 # full response body
introspect body <eventId> --path ".errors" # extract a field with JSONPath
```

Get the event ID from the last column of `introspect network` output.

### State looks wrong → query events programmatically

```bash
introspect eval 'events.filter(e => e.type === "plugin.redux.action").map(e => e.data.action.type)'
```

`eval` runs a JS expression against the trace. `events` is the full event array. Useful for: Redux action sequences, checking which marks fired, counting requests.

### Nothing obvious → browse the timeline

```bash
introspect timeline                        # all events in order
introspect events --type js.error,network.response   # filter by type
introspect events --since "form submitted"           # events after a mark
```

## Investigation report

When you find the bug, write your findings to `INVESTIGATION.md`:

- Each command you ran and its output
- What each output told you and what you looked at next
- Root cause, location in code, and the fix

This makes the reasoning reproducible and serves as documentation for the team.

## Event type reference

| Type | What it means |
|------|---------------|
| `network.request` | HTTP request — url, method, headers, postData |
| `network.response` | HTTP response — status, headers |
| `network.error` | Request failed at network level |
| `js.error` | Uncaught exception with source-mapped stack |
| `js.console` | console.log/warn/error output |
| `dom.snapshot` | DOM state at a point in time |
| `playwright.action` | click, fill, navigate, waitFor, etc. |
| `mark` | Semantic label placed by test code via `handle.mark('...')` |
| `plugin.*` | Framework data: `plugin.redux.action`, `plugin.react.commit`, etc. |

## Notes

- All commands default to the most recent session. Use `--session <id>` to target a specific one.
- `introspect body <eventId>` reads from `.introspect/<session-id>/bodies/`.
- `introspect snapshot` shows the `js.error` snapshot — captured automatically when an uncaught exception fires in the browser.

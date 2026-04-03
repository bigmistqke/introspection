---
name: introspect-debug
description: Use when a Playwright test fails — guides querying the trace to identify root cause
---

# Debugging a failing test with introspect

When a Playwright test fails, use the `introspect` CLI to query the trace.

## Start here

```bash
introspect summary
```

Plain-language overview: test status, Playwright actions, failed network requests, JS errors. Add `--trace <name>` to target a specific trace (default: most recent).

## Decision tree

### JS errors found
```bash
introspect errors              # source-mapped stack traces
introspect vars                # variable scope chain at error time
introspect vars --at <point>   # narrow to a specific function name or event id
```

### Network failures found
```bash
introspect network --failed          # table of 4xx/5xx responses
introspect network --url <pattern>   # filter by URL
introspect body <eventId>            # full response body (eventId from network output)
```

### Nothing obvious
```bash
introspect timeline   # chronological list of all events
```

### DOM issue suspected
```bash
introspect dom   # DOM snapshot captured at error time
```

## Event type reference

| Type | Source | What it means |
|------|--------|---------------|
| `network.request` | CDP | HTTP request — url, method, headers, postData |
| `network.response` | CDP | HTTP response — status, headers, bodyRef |
| `network.error` | CDP | Request failed at network level (DNS, timeout, etc.) |
| `js.error` | CDP | Uncaught exception with source-mapped stack |
| `js.console` | CDP | console.log/warn/error output |
| `dom.snapshot` | CDP | DOM state at a point in time |
| `variable.snapshot` | CDP | Scope chain captured at a debugger pause |
| `playwright.action` | Playwright | click, fill, navigate, waitFor, etc. |
| `mark` | browser agent | Semantic label placed by test code via `handle.mark('...')` |
| `plugin.*` | plugin | Framework data: `plugin.redux.action`, `plugin.react.commit`, etc. |

## Notes
- All commands default to the most recent trace. Use `--trace <name>` to target a specific one.
- `introspect body <eventId>` reads sidecar files from `.introspect/bodies/`.
- `introspect eval <expression>` evaluates JS in the live browser session — does not take `--trace`.

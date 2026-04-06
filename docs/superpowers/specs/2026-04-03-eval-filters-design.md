# `introspect events` Command Design

**Date:** 2026-04-03
**Status:** Draft

---

## Overview

A new `introspect events` command for filtering and transforming trace events. Sits between the fixed-format commands (`timeline`, `errors`, `network`) and the freeform `eval`.

The key idea: an optional JavaScript expression that receives each event as `e` and maps it — like `.map()` over the filtered event list. No array management, no `.filter().map()` boilerplate.

```bash
# default: filtered event list, formatted
introspect events --type redux.action

# with expression: JSON array of mapped results
introspect events --type redux.action '{ ts: e.ts, action: e.data.action.type }'
introspect events --type network.request,network.response --after 150 '{ url: e.data.url, status: e.data.status }'
introspect events --since before-checkout --type redux.action 'e.data.stateAfter?.cart'
```

`eval` stays unchanged — it remains the escape hatch for aggregations, `snapshot` access, and anything that needs the full context.

---

## Command Signature

```
introspect events [expression] [options]
```

`expression` is optional. When present, it is evaluated once per event with `e` bound to the full `TraceEvent` object. The return value of the expression is collected into an array and printed as formatted JSON.

When absent, events are printed in the same format as `introspect timeline` but scoped to the filtered set.

---

## Loading Options

### `--trace <name>`

Load a specific trace file instead of the most recent one. Accepts the same name format as other commands (with or without `.trace.json` suffix). Respects the global `--dir` flag.

```bash
introspect events --trace failing-run --type redux.action 'e.data.action.type'
```

---

---

## Filter Flags

All flags narrow the event set before the expression (if any) is applied.

### `--type <types>`

One or more comma-separated event types. Matches `e.type` exactly.

```bash
--type redux.action
--type network.request,network.response
--type "plugin.webgl.frame"
```

### `--source <source>`

One of `cdp`, `agent`, `plugin`, `playwright`. An unrecognised value exits with an error:

```
Error: unknown source "plugn". Valid values: cdp, agent, plugin, playwright
```

```bash
--source plugin
--source cdp
```

`--source` accepts a single value. `--type` accepts multiple because filtering to one event type is the dominant use case and multi-source filtering rarely comes up in practice.

### `--after <ms>`

Keep events where `e.ts > ms`.

### `--before <ms>`

Keep events where `e.ts < ms`.

`--after` and `--before` compose into a time window:

```bash
introspect events --type redux.action --after 150 --before 350
```

### `--since <mark-label>`

Keep events that occur after the named `mark` event. Finds the first `mark` event in the **unfiltered** event list whose `data.label` equals the argument, then keeps events where `e.ts > mark.ts`. The mark event itself is excluded.

Mark lookup always runs against the original full event list regardless of `--type` or `--source` — so `--type redux.action --since before-checkout` works even though `mark` events would be excluded by `--type`.

If `--since` and `--after` both apply, the effective lower bound is `Math.max(mark.ts, afterMs)`.

If no mark with the given label exists:
```
Error: no mark event with label "before-checkout" found
```

```bash
--since before-checkout
--since "user submitted form"
```

### `--last <n>`

After all other filters, keep only the last N events. Must be a positive integer (≥ 1).

```bash
--last 5
--last 1
```


## Filter Application Order

1. `--type`
2. `--source`
3. `--after` / `--before` / `--since` (time bounds, applied together)
4. `--last`

---

## Expression

The expression is a JavaScript snippet evaluated per event. `e` is the full `TraceEvent`:

```ts
interface TraceEvent {
  id: string
  type: string
  ts: number          // ms since test start
  source: 'cdp' | 'agent' | 'plugin' | 'playwright'
  data: Record<string, unknown>
  initiator?: string
}
```

The expression is run with `vm.runInNewContext({ event })`. The variable is `event` (singular) — consistent with how `eval` exposes `events` (plural) for the full array. Only `event` is in scope — `events`, `snapshot`, and `test` are intentionally absent (use `eval` for those). It can return any value: object, string, number, boolean, `null`. Returning `undefined` is treated as `null` in output.

If the expression throws for a specific event, that event's slot in the output array is `{ error: "<message>", event: e }` — the rest of the results are unaffected.

**Output:** a JSON array of the mapped results, formatted with 2-space indentation.

```bash
introspect events --type plugin.redux.action 'event.data.action.type'
# ["AUTH/LOGIN_SUCCESS", "CART/ADD_ITEM", "CART/ADD_ITEM", "CART/REMOVE_ITEM"]

introspect events --type plugin.redux.action '({ ts: event.ts, type: event.data.action.type })'
# [
#   { "ts": 183, "type": "AUTH/LOGIN_SUCCESS" },
#   { "ts": 840, "type": "CART/ADD_ITEM" }
# ]
```

---

## Default Output (no expression)

Reuses `formatTimeline` from `timeline.ts` on the filtered event set. Actual format (from existing code):

```
[   183ms] plugin     redux.action AUTH/LOGIN_SUCCESS
[   840ms] cdp        network.request POST /api/cart
[   860ms] plugin     redux.action CART/ADD_ITEM
```

If zero events match, nothing is printed (no output, exit 0).

---

## Error Handling

| Situation | Message | Exit code |
|-----------|---------|-----------|
| `--since <label>` — mark not found | `Error: no mark event with label "<label>" found` | 1 |
| `--source <value>` — unrecognised value | `Error: unknown source "<value>". Valid values: cdp, agent, plugin, playwright` | 1 |
| `--trace <name>` — file not found | `Error: trace "<name>" not found in <dir>` | 1 |
| `--last <n>` — not a positive integer | `Error: --last must be a positive integer` | 1 |
| Expression throws for an event | `{ error: "...", event: e }` in that result slot | 0 |
| Zero events match filters | No output (default mode); `[]` (expression mode) | 0 |

---

## What `eval` Is For

`introspect events` handles per-event filtering and mapping. `eval` handles everything else:

- Aggregations: `events.reduce(...)`, `events.length`, counting
- Cross-event logic: comparing events, finding pairs
- `snapshot` access: `snapshot.plugins.redux.state`
- `test` metadata: `test.duration`, `test.status`
- Anything that needs the full context at once

---

## Implementation

### New file: `packages/cli/src/commands/events.ts`

Exports `formatEvents(trace, opts, expression?)`.

`applyEventFilters(trace, opts)` — pure function that takes the full `TraceFile` (not pre-filtered events) so `--since` mark lookup can always run against `trace.events` before type/source filtering is applied. Returns the filtered `TraceEvent[]`.

`--type` value is split on commas before filtering: `opts.type?.split(',').map(s => s.trim())`.

### `packages/cli/src/index.ts`

Register the new command:

```ts
program
  .command('events [expression]')
  .option('--trace <name>')
  .option('--type <types>')
  .option('--source <source>')
  .option('--after <ms>', undefined, (v) => parseFloat(v))
  .option('--before <ms>', undefined, (v) => parseFloat(v))
  .option('--since <label>')
  .option('--last <n>', undefined, (v) => parseInt(v, 10))
  .action(async (expression, opts) => {
    const trace = await loadTrace(opts)
    console.log(formatEvents(trace, opts, expression))
  })
```

### `packages/cli/src/trace-reader.ts`

No changes.

### `packages/vite`, `packages/playwright`, `packages/browser`

No changes.

---

## Testing

`packages/cli/test/commands/events.test.ts`:

- No flags, no expression → all events, formatted
- `--type redux.action` → only redux.action events
- `--type a,b` → events of either type
- `--source plugin` → only plugin-sourced events
- `--source typo` → exits with error listing valid values
- `--after 150` → excludes events at or before 150ms
- `--before 350` → excludes events at or after 350ms
- `--after` + `--before` together form a window
- `--since before-add` finds the mark in unfiltered events and applies time filter
- `--since before-add` + `--type redux.action` — mark found even though type filter excludes marks
- `--since before-add` + `--after 50` — later timestamp wins
- `--since unknown` → exits with error
- `--last 3` → last 3 of filtered set
- `--last 3` on a set of 2 → returns 2, no error
- `--last 0` → exits with error (not a positive integer)
- Expression: maps each event, returns JSON array
- Expression throws on one event → that slot gets `{ error, event }`, rest unaffected
- Expression returning `undefined` → `null` in output
- `--trace <name>` loads from file, no socket
- `--trace` + filter flags compose correctly

---

## Out of Scope

- `--type` glob or prefix matching (`plugin.*`) — exact match only in v1
- A `--first <n>` flag — use expression or `eval` for head slicing
- Expression receiving `index` as a second argument
- Async expressions
- Output formats other than JSON (CSV, table) — use the expression to shape what you need

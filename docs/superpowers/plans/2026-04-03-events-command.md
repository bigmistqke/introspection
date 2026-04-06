# `introspect events` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `introspect events [expression]` — a new CLI command that filters trace events with composable flags and optionally maps them with a per-event JS expression.

**Architecture:** Two exported functions in a new `events.ts` command file: `applyEventFilters(trace, opts)` (pure, handles all flag logic) and `formatEvents(trace, opts, expression?)` (output layer). Wired into Commander in `index.ts`. No changes to any package outside `@introspection/cli`.

**Tech Stack:** Node.js `vm` (already used in `eval-socket.ts`), TypeScript, vitest, Commander.js

---

## File Map

| File | Change |
|------|--------|
| `packages/cli/src/commands/events.ts` | Create — `applyEventFilters` + `formatEvents` |
| `packages/cli/test/commands/events.test.ts` | Create — full test suite |
| `packages/cli/src/index.ts` | Modify — register the `events` command |

No changes to `trace-reader.ts`, `timeline.ts`, or any package outside `cli`.

---

### Task 1: `applyEventFilters` — core filtering logic

The pure function that takes the full `TraceFile` and filter options and returns a filtered `TraceEvent[]`. All flag semantics live here.

**Files:**
- Create: `packages/cli/src/commands/events.ts`
- Create: `packages/cli/test/commands/events.test.ts`

- [ ] **Step 1: Create the test file with a shared fixture**

`packages/cli/test/commands/events.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyEventFilters, formatEvents } from '../../src/commands/events.js'
import type { TraceFile } from '@introspection/types'

const trace: TraceFile = {
  version: '1',
  test: { title: 't', file: 'f', status: 'passed', duration: 500 },
  snapshots: {},
  events: [
    { id: 'e1', type: 'mark',                 ts: 50,  source: 'agent',      data: { label: 'before-add' } },
    { id: 'e2', type: 'plugin.redux.action',   ts: 100, source: 'plugin',     data: { action: { type: 'CART/ADD' } } },
    { id: 'e3', type: 'network.request',       ts: 200, source: 'cdp',        data: { url: '/api/cart', method: 'POST', headers: {} } },
    { id: 'e4', type: 'plugin.redux.action',   ts: 300, source: 'plugin',     data: { action: { type: 'CART/REMOVE' } } },
    { id: 'e5', type: 'playwright.action',     ts: 400, source: 'playwright', data: { method: 'click', args: ['button'] } },
  ],
}
```

- [ ] **Step 2: Write failing tests for `applyEventFilters` — no flags**

```ts
describe('applyEventFilters', () => {
  it('returns all events when no flags given', () => {
    expect(applyEventFilters(trace, {})).toHaveLength(5)
  })
```

- [ ] **Step 3: Write failing tests — `--type`**

```ts
  it('--type filters to exact type match', () => {
    const result = applyEventFilters(trace, { type: 'plugin.redux.action' })
    expect(result).toHaveLength(2)
    expect(result.every(e => e.type === 'plugin.redux.action')).toBe(true)
  })

  it('--type accepts comma-separated types', () => {
    const result = applyEventFilters(trace, { type: 'plugin.redux.action,mark' })
    expect(result).toHaveLength(3)
  })

  it('--type with unknown type returns empty array', () => {
    expect(applyEventFilters(trace, { type: 'nonexistent' })).toHaveLength(0)
  })
```

- [ ] **Step 4: Write failing tests — `--source`**

```ts
  it('--source filters by source field', () => {
    const result = applyEventFilters(trace, { source: 'plugin' })
    expect(result).toHaveLength(2)
    expect(result.every(e => e.source === 'plugin')).toBe(true)
  })

  it('--source throws on unrecognised value', () => {
    expect(() => applyEventFilters(trace, { source: 'typo' }))
      .toThrow('unknown source "typo"')
  })
```

- [ ] **Step 5: Write failing tests — `--after` / `--before`**

```ts
  it('--after keeps events with ts strictly greater than value', () => {
    const result = applyEventFilters(trace, { after: 100 })
    expect(result.map(e => e.id)).toEqual(['e3', 'e4', 'e5'])
  })

  it('--before keeps events with ts strictly less than value', () => {
    const result = applyEventFilters(trace, { before: 300 })
    expect(result.map(e => e.id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('--after and --before together form a window', () => {
    const result = applyEventFilters(trace, { after: 100, before: 350 })
    expect(result.map(e => e.id)).toEqual(['e3', 'e4'])
  })
```

- [ ] **Step 6: Write failing tests — `--since`**

```ts
  it('--since finds mark in full event list and filters by its ts', () => {
    const result = applyEventFilters(trace, { since: 'before-add' })
    // mark is at ts:50 — keep events with ts > 50
    expect(result.map(e => e.id)).toEqual(['e2', 'e3', 'e4', 'e5'])
  })

  it('--since works even when --type excludes mark events', () => {
    const result = applyEventFilters(trace, { type: 'plugin.redux.action', since: 'before-add' })
    expect(result.map(e => e.id)).toEqual(['e2', 'e4'])
  })

  it('--since and --after: Math.max(mark.ts, afterMs) wins', () => {
    // mark.ts=50, after=200 → lower bound is 200
    const result = applyEventFilters(trace, { since: 'before-add', after: 200 })
    expect(result.map(e => e.id)).toEqual(['e4', 'e5'])
  })

  it('--since throws when label not found', () => {
    expect(() => applyEventFilters(trace, { since: 'nonexistent' }))
      .toThrow('no mark event with label "nonexistent" found')
  })
```

- [ ] **Step 7: Write failing tests — `--last`**

```ts
  it('--last keeps only the last N events after other filters', () => {
    const result = applyEventFilters(trace, { last: 2 })
    expect(result.map(e => e.id)).toEqual(['e4', 'e5'])
  })

  it('--last larger than result set returns all', () => {
    const result = applyEventFilters(trace, { type: 'plugin.redux.action', last: 10 })
    expect(result).toHaveLength(2)
  })

  it('--last 0 throws', () => {
    expect(() => applyEventFilters(trace, { last: 0 }))
      .toThrow('--last must be a positive integer')
  })
})
```

- [ ] **Step 8: Run tests — confirm they all fail**

```bash
cd packages/cli && pnpm test -- --reporter=verbose 2>&1 | head -40
```

Expected: test file loads but all `applyEventFilters` tests fail with "not a function" or similar.

- [ ] **Step 9: Implement `applyEventFilters` in `events.ts`**

Create `packages/cli/src/commands/events.ts`:

```ts
import { runInNewContext } from 'vm'
import { formatTimeline } from './timeline.js'
import type { TraceFile, TraceEvent } from '@introspection/types'

const VALID_SOURCES = new Set(['cdp', 'agent', 'plugin', 'playwright'])

export interface EventFilterOpts {
  type?: string
  source?: string
  after?: number
  before?: number
  since?: string
  last?: number
}

export function applyEventFilters(trace: TraceFile, opts: EventFilterOpts): TraceEvent[] {
  if (opts.source !== undefined && !VALID_SOURCES.has(opts.source)) {
    throw new Error(`unknown source "${opts.source}". Valid values: cdp, agent, plugin, playwright`)
  }
  if (opts.last !== undefined && (!Number.isInteger(opts.last) || opts.last < 1)) {
    throw new Error('--last must be a positive integer')
  }

  // Resolve --since against the full unfiltered event list before any other filtering
  let lowerBound = opts.after ?? -Infinity
  if (opts.since !== undefined) {
    const mark = trace.events.find(
      e => e.type === 'mark' && (e.data as { label: string }).label === opts.since
    )
    if (!mark) throw new Error(`no mark event with label "${opts.since}" found`)
    lowerBound = Math.max(lowerBound, mark.ts)
  }

  const types = opts.type ? opts.type.split(',').map(s => s.trim()) : null

  let result = trace.events.filter(e => {
    if (types && !types.includes(e.type)) return false
    if (opts.source && e.source !== opts.source) return false
    if (e.ts <= lowerBound) return false
    if (opts.before !== undefined && e.ts >= opts.before) return false
    return true
  })

  if (opts.last !== undefined) result = result.slice(-opts.last)
  return result
}
```

- [ ] **Step 10: Run tests — confirm `applyEventFilters` tests pass**

```bash
cd packages/cli && pnpm test -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|✓|✗|applyEvent)"
```

Expected: all `applyEventFilters` describe block tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/cli/src/commands/events.ts packages/cli/test/commands/events.test.ts
git commit -m "feat(cli): add applyEventFilters with type/source/after/before/since/last flags"
```

---

### Task 2: `formatEvents` — default output (no expression)

Reuses `formatTimeline` on the filtered event set.

**Files:**
- Modify: `packages/cli/src/commands/events.ts`
- Modify: `packages/cli/test/commands/events.test.ts`

- [ ] **Step 1: Write failing tests for default output**

```ts
describe('formatEvents — default output (no expression)', () => {
  it('returns timeline-formatted string of all events when no flags', () => {
    const out = formatEvents(trace, {})
    expect(out).toContain('plugin.redux.action')
    expect(out).toContain('mark')
    expect(out).toContain('network.request')
  })

  it('returns only matching events when --type is given', () => {
    const out = formatEvents(trace, { type: 'plugin.redux.action' })
    expect(out).toContain('plugin.redux.action')
    expect(out).not.toContain('mark')
    expect(out).not.toContain('network.request')
  })

  it('returns empty string when no events match', () => {
    const out = formatEvents(trace, { type: 'nonexistent' })
    expect(out).toBe('')
  })
})
```

- [ ] **Step 2: Run — confirm they fail**

```bash
cd packages/cli && pnpm test -- --reporter=verbose 2>&1 | grep -E "(formatEvents|FAIL|✗)"
```

- [ ] **Step 3: Implement `formatEvents` default mode**

Add to `packages/cli/src/commands/events.ts`:

```ts
export function formatEvents(trace: TraceFile, opts: EventFilterOpts, expression?: string): string {
  const filtered = applyEventFilters(trace, opts)

  if (!expression) {
    return formatTimeline({ ...trace, events: filtered })
  }

  // expression mode — Task 3
  throw new Error('expression mode not yet implemented')
}
```

- [ ] **Step 4: Run — confirm default output tests pass**

```bash
cd packages/cli && pnpm test -- --reporter=verbose 2>&1 | grep -E "(✓|✗|default output)"
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/events.ts packages/cli/test/commands/events.test.ts
git commit -m "feat(cli): add formatEvents default output mode via formatTimeline"
```

---

### Task 3: `formatEvents` — expression mode

Per-event JS eval via `vm.runInNewContext`. The expression receives `event` (the full `TraceEvent`) — consistent with how `eval` uses `events` for the array. Returns a JSON array.

**Files:**
- Modify: `packages/cli/src/commands/events.ts`
- Modify: `packages/cli/test/commands/events.test.ts`

- [ ] **Step 1: Write failing tests for expression mode**

```ts
describe('formatEvents — expression mode', () => {
  it('maps each event with the expression using `event` as the variable', () => {
    const out = formatEvents(trace, { type: 'plugin.redux.action' }, 'event.data.action.type')
    const parsed = JSON.parse(out)
    expect(parsed).toEqual(['CART/ADD', 'CART/REMOVE'])
  })

  it('expression returning an object produces array of objects', () => {
    const out = formatEvents(trace, { type: 'plugin.redux.action' }, '({ ts: event.ts, action: event.data.action.type })')
    const parsed = JSON.parse(out)
    expect(parsed).toEqual([
      { ts: 100, action: 'CART/ADD' },
      { ts: 300, action: 'CART/REMOVE' },
    ])
  })

  it('expression returning undefined maps to null', () => {
    const out = formatEvents(trace, { type: 'plugin.redux.action' }, 'undefined')
    const parsed = JSON.parse(out)
    expect(parsed).toEqual([null, null])
  })

  it('expression that throws for one event produces error slot, rest unaffected', () => {
    // mark event has no .data.action — will throw; redux events work fine
    const out = formatEvents(trace, {}, 'event.data.action.type')
    const parsed = JSON.parse(out)
    // e2 and e4 are redux events — those should return the action type
    expect(parsed[1]).toBe('CART/ADD')
    expect(parsed[3]).toBe('CART/REMOVE')
    // e1 (mark), e3 (network.request), e5 (playwright) have no action — error slots
    expect(parsed[0]).toHaveProperty('error')
    expect(parsed[0]).toHaveProperty('event')
  })

  it('returns [] when no events match filters', () => {
    const out = formatEvents(trace, { type: 'nonexistent' }, 'event.id')
    expect(JSON.parse(out)).toEqual([])
  })

  it('only `event` is in scope — `events`, `snapshot`, `test` are undefined', () => {
    const out = formatEvents(trace, { type: 'mark' }, 'typeof events')
    expect(JSON.parse(out)).toEqual(['undefined'])
  })
})
```

- [ ] **Step 2: Run — confirm they fail**

```bash
cd packages/cli && pnpm test -- --reporter=verbose 2>&1 | grep -E "(expression mode|FAIL|✗)"
```

- [ ] **Step 3: Implement expression mode in `formatEvents`**

Replace the expression mode stub in `packages/cli/src/commands/events.ts`:

```ts
  const results = filtered.map(ev => {
    try {
      const raw = runInNewContext(expression, { event: ev })
      return raw === undefined ? null : raw
    } catch (err) {
      return { error: String(err), event: ev }
    }
  })
  return JSON.stringify(results, null, 2)
```

Note: the context variable is named `event` (singular), consistent with how `eval` exposes `events` (plural) for the full array.

- [ ] **Step 4: Run — confirm all expression mode tests pass**

```bash
cd packages/cli && pnpm test -- --reporter=verbose 2>&1 | grep -E "(✓|✗)"
```

Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/events.ts packages/cli/test/commands/events.test.ts
git commit -m "feat(cli): add formatEvents expression mode with per-event vm.runInNewContext"
```

---

### Task 4: Wire command into `index.ts`

Register `introspect events` in the CLI. Errors from `applyEventFilters` (bad `--source`, missing mark, bad `--last`) are caught and printed cleanly.

**Files:**
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Add the import**

In `packages/cli/src/index.ts`, add after the existing command imports:

```ts
import { formatEvents } from './commands/events.js'
```

- [ ] **Step 2: Register the command**

Add before `program.parseAsync()`:

```ts
program
  .command('events [expression]')
  .description('Filter and transform trace events')
  .option('--trace <name>')
  .option('--type <types>', 'Comma-separated event types to include')
  .option('--source <source>', 'Filter by source: cdp, agent, plugin, playwright')
  .option('--after <ms>', 'Keep events after this timestamp (ms)', (v) => parseFloat(v))
  .option('--before <ms>', 'Keep events before this timestamp (ms)', (v) => parseFloat(v))
  .option('--since <label>', 'Keep events after the named mark event')
  .option('--last <n>', 'Keep only the last N events', (v) => parseInt(v, 10))
  .action(async (expression: string | undefined, opts) => {
    let trace
    try {
      trace = await loadTrace(opts)
    } catch (err) {
      console.error(String(err))
      process.exit(1)
    }
    try {
      const out = formatEvents(trace, opts, expression)
      if (out) console.log(out)
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`)
      process.exit(1)
    }
  })
```

- [ ] **Step 3: Run the full test suite to confirm nothing is broken**

```bash
cd packages/cli && pnpm test 2>&1 | tail -10
```

Expected: all tests pass, no regressions.

- [ ] **Step 4: Smoke test the built CLI**

```bash
cd packages/cli && pnpm build 2>&1 && node dist/index.js events --help
```

Expected: help text listing the command and all flags.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): register introspect events command"
```

---

## Done

Verify the full test suite is green:

```bash
pnpm --filter introspect test
```

The `introspect events` command is now available with:
- `--type`, `--source`, `--after`, `--before`, `--since`, `--last` filter flags
- Optional JS expression for per-event mapping — variable is `event` (singular), consistent with `eval`'s `events` (plural)
- `--trace` for loading a specific trace file
- Clean errors for invalid flag values

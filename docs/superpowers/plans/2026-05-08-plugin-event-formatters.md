# Plugin-owned event formatters (parked)

> **Status:** in-flight (parked — spec captured, design later · 2026-05-08)

## Problem

`packages/cli/src/commands/events.ts:formatTimeline` is a hardcoded per-type dispatch:

```ts
if (event.type === 'network.request') detail += ` ${md.method} ${md.url}`
else if (event.type === 'network.response') detail += ` ${md.status} ${md.url}`
else if (event.type === 'js.error') detail += ` ${md.message}`
else if (event.type === 'mark') detail += ` "${md.label}"`
else if (event.type === 'playwright.action') detail += ` ${md.method}(${md.args[0] ?? ''})`
else if (event.type === 'console') detail += ` [${md.level}] ${summary}`
else if (event.type === 'browser.navigate') detail += ` ${md.from} → ${md.to}`
// every other event type falls through to bare `event.type`
```

Adding a new richly-typed plugin (e.g. `plugin-focus-element`'s `focus.changed`, or any future plugin) requires editing the CLI to teach it the new shape. That couples the CLI to every plugin in the repo and means out-of-tree plugins can never get inline pretty-printing — they're stuck with `[time] some.event` forever.

This violates the package boundary stated in `CONTRIBUTING.md`: plugins are the unit of feature capture; the read side is environment-agnostic and runs anywhere with a `StorageAdapter`. A plugin should own how its events are *captured* and how they're *presented*.

## Goal

Plugins declare their own per-event summary formatter. The CLI stays plugin-agnostic — it should be possible to add a new plugin without editing the CLI at all.

The read side must continue to work in environments where the plugin isn't installed (e.g. browsing a trace from a fetched URL with `createFetchAdapter`, or analysing someone else's trace). So formatting must not depend on dynamically importing plugin code at read time.

## Design

**Formatters run at capture time; their output is persisted into the trace.**

Add an optional `summary` field to every event:

```ts
// packages/types/src/index.ts
export interface BaseEvent {
  id: string
  timestamp: number
  type: string
  pageId?: string
  initiator?: string
  assets?: AssetRef[]
  summary?: string   // NEW — short single-line human-readable rendering of this event
}
```

Plugins declare a formatter alongside their existing `IntrospectionPlugin` shape:

```ts
// packages/types/src/index.ts (additions to IntrospectionPlugin)
export interface IntrospectionPlugin {
  name: string
  description?: string
  events?: Record<string, string>
  options?: Record<string, { description: string; value: unknown }>
  script?: string
  install(ctx: PluginContext): Promise<void>
  /**
   * Optional. Returns a short single-line rendering of an event this plugin owns.
   * Called by `attach()` at emit time; the result is persisted as `event.summary`.
   * Should return null/undefined for event types this plugin doesn't recognise.
   */
  formatEvent?(event: TraceEvent): string | null | undefined
}
```

`attach()` invokes `plugin.formatEvent(event)` for each emit, and stamps the result into `event.summary` before the event hits the write queue. Each plugin returns `null` for events that aren't theirs (cheap fall-through; plugins are trusted not to format other plugins' events).

The CLI's `formatTimeline` collapses to:

```ts
return events.map(event => {
  const detail = event.summary ?? event.type
  return `[${formatTimestamp(event.timestamp)}] ${detail}` + assetSuffix(event)
}).join('\n')
```

No per-type dispatch, no plugin knowledge. Same code path renders every plugin's events, in-tree or out-of-tree.

## Migration

1. **Add `summary?: string` to `BaseEvent`** (non-breaking — it's optional everywhere).
2. **Add `formatEvent?(event)` to `IntrospectionPlugin`** (also optional).
3. **Update `attach()`** in `packages/playwright/src/attach.ts` to invoke each plugin's `formatEvent` when emitting; first non-null result wins. Persist into `event.summary`.
4. **Move existing CLI per-type cases into the plugins:**
   - `network.request`, `network.response` → `plugin-network`
   - `js.error` → `plugin-js-error`
   - `console` → `plugin-console`
   - `mark`, `playwright.action`, `browser.navigate` → framework events; their formatters live in `@introspection/playwright` (these aren't plugin-owned today, so we'll need a lightweight equivalent — see open question below).
5. **Replace `formatTimeline`** with the simple `event.summary ?? event.type` form.
6. **Add `formatEvent` to `plugin-focus-element`** (this is the trigger that surfaced the problem).

Existing traces without `summary` continue to render as bare type — no breakage.

## Open questions

- **Framework events without a plugin.** `mark`, `browser.navigate`, `playwright.action`, `playwright.test.start`, etc. are emitted by `@introspection/playwright` itself, not by a plugin. They need a formatter too. Options: (a) `attach()` accepts a list of "framework formatters" the same shape as plugin formatters; (b) framework formatters are a fixed table inside `@introspection/playwright`, applied before the plugin chain; (c) the framework's emit calls fill `summary` at the call site. (c) is most pragmatic for the small fixed set of framework events.
- **Multiple plugins claiming the same event type.** Shouldn't happen in practice (event types are namespaced per plugin), but if two plugins both return non-null for the same event, first-wins is the simplest rule. Document it.
- **Performance.** Formatter runs once per event at emit time. If a formatter is expensive, it slows capture. Document: keep formatters trivial — string concatenation, not JSON serialisation of large objects.
- **Truncation policy.** Should `attach()` enforce a max length on `summary` (e.g. 200 chars) to keep traces compact? Probably yes — a misbehaving plugin shouldn't be able to bloat the trace via this channel.
- **JSON output.** `--format json` should still output the full event including `summary`. No change needed; `summary` is just another field.
- **CLI tests for existing per-type rendering.** `packages/cli/test/events.test.ts` (if it exists) currently asserts on the formatted strings for `network.request` etc. After the move, those assertions should live in each plugin's test suite, asserting that `formatEvent` returns the expected string. CLI tests reduce to "summary is rendered when present, type is rendered when absent".

## Example: `plugin-focus-element`'s formatter

```ts
formatEvent(event): string | null {
  if (event.type !== 'focus.changed') return null
  const md = event.metadata as FocusChangedEvent['metadata']
  if (md.target === null) {
    return `← left document (was ${md.previous?.selector ?? 'nothing'})`
  }
  const name = md.target.accessibleName ? ` (${md.target.accessibleName})` : ''
  const cause = md.cause === 'programmatic' ? ' [programmatic]' : ''
  return `→ ${md.target.selector}${name}${cause}`
}
```

Renders as:

```
[    24ms] focus.changed → input#beta (Beta)
[    48ms] focus.changed → input#alpha (Alpha)
[    50ms] focus.changed → button#go (Go) [programmatic]
[    62ms] focus.changed ← left document (was button#go)
```

vs. today's:

```
[    24ms] focus.changed
[    48ms] focus.changed
[    50ms] focus.changed
[    62ms] focus.changed
```

## Non-goals

- Not a multi-line / structured / colored renderer. `summary` is a single line. Richer rendering (a future TUI, the static report HTML, etc.) reads `event.metadata` directly and renders however it wants.
- Not a query DSL. Filtering still uses `--filter 'event.metadata.X === ...'`. `summary` is presentation only.
- Not a replacement for `--format json`. JSON dumps the full event; `summary` is for the human-skimming-a-terminal case.

## Next step

Pick this up after the focus-element plugin lands. The first formatter to add is `plugin-focus-element`'s; the migration of `network` / `console` / `js-error` / framework events can happen incrementally as a follow-up — there's no big-bang requirement, since `summary ?? event.type` is fully backwards-compatible.

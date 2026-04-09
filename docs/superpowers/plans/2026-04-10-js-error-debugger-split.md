# Split jsErrors into jsError + debugger Plugins

## Problem

The current `jsError()` plugin does two things that should be separate:
1. Detects JS errors via `Runtime.exceptionThrown` → emits `js.error`, emits bus event
2. Collects scope locals via `Debugger.paused` → emits `js.error` (duplicate!), emits `js.error.paused`

This results in:
- Duplicate `js.error` events for the same error
- Confusing event types (`js.error` vs `js.error.paused`)
- `pauseOnExceptions` config on the wrong plugin
- Tight coupling between error detection and scope capture

## Solution

Split into two independent plugins:

| Plugin | Listens to | Emits |
|--------|-----------|-------|
| `jsError()` | `Runtime.exceptionThrown` | `js.error` trace event, bus('js.error') |
| `debugger()` | `Debugger.paused` | `scopes` asset with full pause context |

## jsError() Plugin

### Responsibilities
- Listen to `Runtime.exceptionThrown`
- Emit `js.error` trace event
- Emit `bus.emit('js.error')` for plugin coordination

### API
```ts
jsError()  // no options
```

### Events

**`js.error` trace event:**
```ts
{
  type: 'js.error',
  source: 'cdp',
  data: {
    message: string
    name: string
    stack: StackFrame[]
    url: string
    line: number
    column: number
    timestamp: number
  }
}
```

---

## debugger() Plugin

### Responsibilities
- Enable `Debugger.enable`
- Set `Debugger.setPauseOnExceptions` (owns this config)
- Optionally set breakpoints via `Debugger.setBreakpoint`
- Listen to `Debugger.paused`
- Collect scope locals from call frames
- Resume debugger after collecting scopes
- Write `scopes` asset

### API
```ts
debugger({
  pauseOnExceptions?: 'uncaught' | 'all'  // default: 'uncaught'
  breakpoints?: Array<{
    url: string
    line: number
    condition?: string
  }>
})
```

### Assets

**`scopes` asset:**
```ts
{
  kind: 'scopes',
  trigger: 'debugger.paused',
  content: {
    reason: 'exception' | 'promiseRejection' | 'breakpoint' | 'step' | ...
    message?: string      // for exception/rejection
    stack: StackFrame[]
    url: string
    line: number
    column: number
    timestamp: number
    scopes: ScopeFrame[]
  }
}
```

---

## Changes by Package

| Package | Change |
|---------|--------|
| `@introspection/plugin-js-error` | Rename to `@introspection/plugin-js-error`. Remove debugger logic. Remove `pauseOnExceptions` option. |
| `@introspection/plugin-debugger` | **New package.** All debugger logic: `Debugger.paused`, scope collection, breakpoint management, `pauseOnExceptions` config. |
| `@introspection/types` | Add `'scopes'` to asset `kind` union. Add `'debugger.paused'` to snapshot `trigger` union. Add `ScopeFrame` type. Remove `JsErrorPausedEvent`. |
| `@introspection/plugin-solid` | Bus listener from `'js.error'` unchanged. |
| `@introspection/plugin-webgl` | Bus listener from `'js.error'` unchanged. |
| `@introspection/playwright` | Update `defaults()` to return `[network(), jsError(), debugger()]`. |
| `@introspection/core` | Add `'scopes'` asset handling to `writeAsset`. |
| CLI | `errors` command shows `js.error` events (unchanged). `timeline` shows `debugger.paused` as relevant. |

## Migration Path

### Deprecation
Keep `jsError()` as deprecated alias:
```ts
export function jsError() {
  console.warn('jsError() is deprecated. Use jsError() + debugger() instead.')
  return [jsError(), debugger()]
}
```

### defaults()
```ts
export function defaults() {
  return [network(), jsError(), debugger()]
}
```

## Future: dom() Plugin

The DOM snapshot currently in `jsError()` will be moved to a future `dom()` plugin:

```ts
dom()
// - listens to bus('js.error') → takes snapshot on error
// - listens to bus('manual') → takes snapshot on demand
// - writes 'snapshot' assets
```

See `.design/POSSIBILITIES.md` for details.

## Files to Create/Modify

### New files
- `packages/plugin-debugger/src/index.ts`
- `packages/plugin-debugger/src/browser.ts`
- `packages/plugin-debugger/README.md`
- `packages/plugin-debugger/package.json`
- `packages/plugin-debugger/tsconfig.json`
- `packages/plugin-debugger/tsup.browser.config.ts`
- `packages/plugin-debugger/tsup.node.config.ts`
- `docs/superpowers/plans/2026-04-10-js-error-debugger-split.md` (this file)

### Modified files
- `packages/plugin-js-error/src/index.ts` → `packages/plugin-js-error/src/index.ts`
- `packages/plugin-js-error/README.md` → `packages/plugin-js-error/README.md`
- `packages/plugin-js-error/package.json` → `packages/plugin-js-error/package.json`
- `packages/types/src/index.ts`
- `packages/playwright/src/attach.ts`
- CLI commands as needed
- Update imports across packages

### Delete
- `packages/plugin-js-error/src/browser.ts` (no longer needed)

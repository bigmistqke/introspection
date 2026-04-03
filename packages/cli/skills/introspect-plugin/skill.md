---
name: introspect-plugin
description: Use when writing a custom introspection plugin for a state manager or framework
---

# Writing a custom introspection plugin

Plugins capture framework-specific data (state manager actions, component lifecycles, etc.) alongside the standard trace events.

## The IntrospectionPlugin interface

```ts
interface IntrospectionPlugin {
  name: string        // used as event type prefix: plugin.<name>.*

  browser?: {
    // runs in the browser page — access window, DOM, framework internals
    setup(agent: BrowserAgent): void
    // called when an on-error snapshot is taken
    snapshot(): Record<string, unknown>
  }

  server?: {
    // runs in the Vite plugin — return null to drop event from trace
    transformEvent(event: TraceEvent): TraceEvent | null
    // called on snapshot — return additional server-side data
    extendSnapshot(snapshot: OnErrorSnapshot): Record<string, unknown>
  }
}

interface BrowserAgent {
  emit(event: { type: `plugin.${string}`; data: Record<string, unknown> }): void
}
```

## Minimal example

A plugin that tracks a custom global counter (`window.__myAppCounter`):

```ts
import type { IntrospectionPlugin } from '@introspection/types'

export function myCounterPlugin(): IntrospectionPlugin {
  return {
    name: 'my-counter',
    browser: {
      setup(agent) {
        let last = (window as any).__myAppCounter ?? 0
        setInterval(() => {
          const current = (window as any).__myAppCounter ?? 0
          if (current !== last) {
            agent.emit({ type: 'plugin.my-counter.change', data: { from: last, to: current } })
            last = current
          }
        }, 500)
      },
      snapshot() {
        return { counter: (window as any).__myAppCounter ?? 0 }
      },
    },
  }
}
```

Register in `vite.config.ts`:

```ts
introspection({ plugins: [myCounterPlugin()] })
```

Events appear in traces as `plugin.my-counter.change` and show up in `introspect timeline`.

## Tips

- **Naming:** use `plugin.<name>.<event>` — keep `<name>` short and consistent
- **Frequency:** high-frequency events bloat traces; debounce or emit on meaningful changes only
- **`transformEvent` returning `null`** drops the event — use this in `server` to filter noise
- **`snapshot()` / `extendSnapshot()`** are called on error — keep them synchronous and cheap

## Existing plugins as reference

- `packages/plugin-react` — hooks `__REACT_DEVTOOLS_GLOBAL_HOOK__` to capture component tree
- `packages/plugin-redux` — injects middleware to capture actions and state diffs

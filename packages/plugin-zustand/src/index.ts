import type { IntrospectionPlugin, BrowserAgent } from '@introspection/types'

interface ZustandStore {
  getState(): unknown
  subscribe(listener: (next: unknown, prev: unknown) => void): () => void
}

function shallowChangedKeys(before: unknown, after: unknown): string[] {
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return []
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  return [...keys].filter(k => b[k] !== a[k])
}

export function createZustandPlugin(store: ZustandStore): IntrospectionPlugin {
  return {
    name: 'zustand',
    browser: {
      setup(agent: BrowserAgent) {
        store.subscribe((next, prev) => {
          const changedKeys = shallowChangedKeys(prev, next)
          if (changedKeys.length === 0) return
          agent.emit({
            type: 'plugin.zustand.change',
            data: { state: next, changedKeys },
          })
        })
      },
      snapshot() {
        return { state: store.getState() }
      },
    },
  }
}

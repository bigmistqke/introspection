import type { IntrospectionPlugin, BrowserAgent } from '@introspection/types'
import { shallowChangedKeys } from '@introspection/types'

interface ZustandStore {
  getState(): unknown
  subscribe(listener: (next: unknown, prev: unknown) => void): () => void
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

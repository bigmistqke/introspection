import type { IntrospectionPlugin, BrowserAgent } from '@introspection/types'

interface ReduxStore {
  getState(): unknown
  dispatch(action: unknown): unknown
}

function shallowChangedKeys(before: unknown, after: unknown): string[] {
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return []
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  return [...keys].filter(k => b[k] !== a[k])
}

export function createReduxPlugin(store: ReduxStore): IntrospectionPlugin {
  return {
    name: 'redux',
    browser: {
      setup(agent: BrowserAgent) {
        const originalDispatch = store.dispatch.bind(store)
        store.dispatch = (action: unknown) => {
          const stateBefore = store.getState()
          const result = originalDispatch(action)
          const stateAfter = store.getState()
          agent.emit({
            type: 'plugin.redux.action',
            data: {
              action,
              changedKeys: shallowChangedKeys(stateBefore, stateAfter),
            },
          })
          return result
        }
      },
      snapshot() {
        return { state: store.getState() }
      },
    },
  }
}

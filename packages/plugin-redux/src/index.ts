import type { IntrospectionPlugin, BrowserAgent } from '@introspection/types'
import { shallowChangedKeys } from '@introspection/types'

interface ReduxStore {
  getState(): unknown
  dispatch(action: unknown): unknown
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

import { describe, it, expect, vi } from 'vitest'
import { createZustandPlugin } from '../src/index.js'
import type { BrowserAgent } from '@introspection/types'

function makeStore(initial: Record<string, unknown>) {
  let state = { ...initial }
  const listeners: ((next: unknown, prev: unknown) => void)[] = []

  return {
    getState: () => state,
    subscribe: (fn: (next: unknown, prev: unknown) => void) => {
      listeners.push(fn)
      return () => {
        const i = listeners.indexOf(fn)
        if (i !== -1) listeners.splice(i, 1)
      }
    },
    setState: (patch: Record<string, unknown>) => {
      const prev = state
      state = { ...state, ...patch }
      listeners.forEach(fn => fn(state, prev))
    },
  }
}

describe('createZustandPlugin()', () => {
  it('has name "zustand"', () => {
    const store = makeStore({ count: 0 })
    expect(createZustandPlugin(store).name).toBe('zustand')
  })

  it('emits plugin.zustand.change with changedKeys on state update', () => {
    const store = makeStore({ count: 0, name: 'alice' })
    const plugin = createZustandPlugin(store)
    const agent: BrowserAgent = { emit: vi.fn() }

    plugin.browser!.setup(agent)
    store.setState({ count: 1 })

    expect(agent.emit).toHaveBeenCalledOnce()
    const call = (agent.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.type).toBe('plugin.zustand.change')
    expect(call.data.changedKeys).toEqual(['count'])
    expect(call.data.state).toEqual({ count: 1, name: 'alice' })
  })

  it('does not emit when no keys changed', () => {
    const store = makeStore({ count: 0 })
    const plugin = createZustandPlugin(store)
    const agent: BrowserAgent = { emit: vi.fn() }

    plugin.browser!.setup(agent)
    store.setState({ count: 0 }) // same value

    expect(agent.emit).not.toHaveBeenCalled()
  })

  it('snapshot() returns current state', () => {
    const store = makeStore({ count: 42 })
    const plugin = createZustandPlugin(store)
    expect(plugin.browser!.snapshot()).toEqual({ state: { count: 42 } })
  })

  it('calls store.subscribe exactly once during setup', () => {
    const unsubFn = vi.fn()
    const fakeStore = {
      getState: () => ({}),
      subscribe: vi.fn().mockReturnValue(unsubFn),
    }
    const plugin = createZustandPlugin(fakeStore)
    const agent: BrowserAgent = { emit: vi.fn() }

    plugin.browser!.setup(agent)
    expect(fakeStore.subscribe).toHaveBeenCalledOnce()
  })
})

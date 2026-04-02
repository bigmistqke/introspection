import { describe, it, expect, vi } from 'vitest'
import { createReduxPlugin } from '../src/index.js'
import type { BrowserAgent } from '@introspection/types'

function makeStore(initialState: Record<string, unknown> = {}) {
  let state = { ...initialState }
  return {
    getState: () => state,
    dispatch: vi.fn((action: { type: string; payload?: Record<string, unknown> }) => {
      if (action.payload) state = { ...state, ...action.payload }
      return action
    }),
  }
}

function makeAgent(): { agent: BrowserAgent; emitted: unknown[] } {
  const emitted: unknown[] = []
  return { agent: { emit: vi.fn((e: unknown) => { emitted.push(e) }) }, emitted }
}

describe('createReduxPlugin', () => {
  it('emits plugin.redux.action on each dispatch', () => {
    const store = makeStore({ count: 0 })
    const plugin = createReduxPlugin(store)
    const { agent, emitted } = makeAgent()
    plugin.browser!.setup(agent)
    store.dispatch({ type: 'INCREMENT', payload: { count: 1 } })
    expect(emitted).toHaveLength(1)
    expect((emitted[0] as { type: string }).type).toBe('plugin.redux.action')
  })

  it('includes the action and changedKeys in event data', () => {
    const store = makeStore({ count: 0, name: 'alice' })
    const plugin = createReduxPlugin(store)
    const { agent, emitted } = makeAgent()
    plugin.browser!.setup(agent)
    store.dispatch({ type: 'UPDATE_COUNT', payload: { count: 5 } })
    const evt = emitted[0] as { data: { action: { type: string }; changedKeys: string[] } }
    expect(evt.data.action.type).toBe('UPDATE_COUNT')
    expect(evt.data.changedKeys).toEqual(['count'])
  })

  it('reports no changedKeys when state is unchanged', () => {
    const store = makeStore({ count: 0 })
    const plugin = createReduxPlugin(store)
    const { agent, emitted } = makeAgent()
    plugin.browser!.setup(agent)
    store.dispatch({ type: 'NOOP' })
    const evt = emitted[0] as { data: { changedKeys: string[] } }
    expect(evt.data.changedKeys).toEqual([])
  })

  it('snapshot returns current store state', () => {
    const store = makeStore({ user: 'alice', token: 'abc' })
    const plugin = createReduxPlugin(store)
    const { agent } = makeAgent()
    plugin.browser!.setup(agent)
    expect(plugin.browser!.snapshot()).toEqual({ state: { user: 'alice', token: 'abc' } })
  })

  it('snapshot reflects state after dispatch', () => {
    const store = makeStore({ count: 0 })
    const plugin = createReduxPlugin(store)
    const { agent } = makeAgent()
    plugin.browser!.setup(agent)
    store.dispatch({ type: 'INC', payload: { count: 99 } })
    expect((plugin.browser!.snapshot() as { state: { count: number } }).state.count).toBe(99)
  })
})

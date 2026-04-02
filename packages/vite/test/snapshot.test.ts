import { describe, it, expect, vi } from 'vitest'
import { takeSnapshot } from '../src/snapshot.js'

describe('takeSnapshot', () => {
  it('returns a snapshot with required fields', async () => {
    const mockCdp = {
      send: vi.fn().mockImplementation((method: string) => {
        if (method === 'DOM.getDocument') return Promise.resolve({ root: { nodeId: 1 } })
        if (method === 'DOM.getOuterHTML') return Promise.resolve({ outerHTML: '<html/>' })
        if (method === 'Runtime.evaluate') return Promise.resolve({ result: { value: '/home' } })
        if (method === 'Debugger.evaluateOnCallFrame') return Promise.resolve({ result: { value: null } })
        if (method === 'Runtime.getProperties') return Promise.resolve({ result: [] })
        return Promise.resolve({})
      })
    }

    const snapshot = await takeSnapshot({
      cdpSession: mockCdp as never,
      trigger: 'js.error',
      url: '/home',
      callFrames: [],
      plugins: [],
    })

    expect(snapshot.trigger).toBe('js.error')
    expect(snapshot.url).toBe('/home')
    expect(snapshot.dom).toBe('<html/>')
    expect(snapshot.scopes).toBeInstanceOf(Array)
    expect(snapshot.globals).toBeInstanceOf(Object)
    expect(snapshot.plugins).toBeInstanceOf(Object)
  })

  it('includes plugin data in snapshot', async () => {
    const mockCdp = {
      send: vi.fn().mockResolvedValue({ root: { nodeId: 1 }, outerHTML: '<html/>', result: { value: null } })
    }
    const mockPlugin = {
      name: 'redux',
      server: {
        transformEvent: (e: never) => e,
        extendSnapshot: () => ({ state: { count: 42 } })
      }
    }

    const snapshot = await takeSnapshot({
      cdpSession: mockCdp as never,
      trigger: 'manual',
      url: '/',
      callFrames: [],
      plugins: [mockPlugin as never],
    })

    expect(snapshot.plugins.redux).toEqual({ state: { count: 42 } })
  })
})

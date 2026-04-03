import { describe, it, expect, vi } from 'vitest'
import { takeSnapshot } from '../src/snapshot.js'

describe('takeSnapshot', () => {
  it('returns a snapshot with required fields', async () => {
    const mockCdp = {
      send: vi.fn().mockImplementation((method: string) => {
        if (method === 'DOM.getDocument') return Promise.resolve({ root: { nodeId: 1 } })
        if (method === 'DOM.getOuterHTML') return Promise.resolve({ outerHTML: '<html/>' })
        if (method === 'Runtime.evaluate') return Promise.resolve({ result: { value: '/home' } })
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

  it('resolves successfully when CDP calls fail (non-fatal)', async () => {
    const mockCdp = {
      send: vi.fn().mockRejectedValue(new Error('CDP error'))
    }

    const snapshot = await takeSnapshot({
      cdpSession: mockCdp as never,
      trigger: 'js.error',
      url: '/fail',
      callFrames: [],
      plugins: [],
    })

    expect(snapshot.dom).toBe('')
    expect(snapshot.scopes).toEqual([])
    expect(snapshot.globals).toEqual({})
  })

  it('traverses call frames and scope chain', async () => {
    const mockCdp = {
      send: vi.fn().mockImplementation((method: string) => {
        if (method === 'DOM.getDocument') return Promise.resolve({ root: { nodeId: 1 } })
        if (method === 'DOM.getOuterHTML') return Promise.resolve({ outerHTML: '<html/>' })
        if (method === 'Runtime.evaluate') return Promise.resolve({ result: { value: null } })
        if (method === 'Runtime.getProperties') return Promise.resolve({
          result: [{ name: 'x', value: { value: 42 } }]
        })
        return Promise.resolve({})
      })
    }

    const frame = {
      callFrameId: 'cf1',
      functionName: 'handleSubmit',
      url: 'auth.ts',
      location: { scriptId: 's1', lineNumber: 41, columnNumber: 0 },
      scopeChain: [{ type: 'local', object: { objectId: 'obj1' } }]
    }

    const snapshot = await takeSnapshot({
      cdpSession: mockCdp as never,
      trigger: 'js.error',
      url: '/login',
      callFrames: [frame],
      plugins: [],
    })

    expect(snapshot.scopes).toHaveLength(1)
    // CDP lineNumber is 0-based → displayed as 1-based
    expect(snapshot.scopes[0].frame).toBe('handleSubmit (auth.ts:42)')
    expect(snapshot.scopes[0].locals).toEqual({ x: 42 })
  })

  it('populates globals with distinct evaluated values', async () => {
    const mockCdp = {
      send: vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'DOM.getDocument') return Promise.resolve({ root: { nodeId: 1 } })
        if (method === 'DOM.getOuterHTML') return Promise.resolve({ outerHTML: '' })
        if (method === 'Runtime.evaluate') {
          const expr = params?.expression as string
          if (expr === 'location.pathname') return Promise.resolve({ result: { value: '/app' } })
          if (expr === 'localStorage') return Promise.resolve({ result: { value: { token: 'abc' } } })
          if (expr === 'sessionStorage') return Promise.resolve({ result: { value: {} } })
        }
        return Promise.resolve({})
      })
    }

    const snapshot = await takeSnapshot({
      cdpSession: mockCdp as never,
      trigger: 'js.error',
      url: '/app',
      callFrames: [],
      plugins: [],
    })

    expect(snapshot.globals['location.pathname']).toBe('/app')
    expect(snapshot.globals['localStorage']).toEqual({ token: 'abc' })
    expect(snapshot.globals['sessionStorage']).toEqual({})
  })
})

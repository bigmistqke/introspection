import { describe, it, expect, vi } from 'vitest'
import { takeSnapshot } from '../src/snapshot.js'

function makeMockCdp(overrides: Record<string, unknown> = {}) {
  return {
    send: vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      if (method === 'DOM.getDocument') return Promise.resolve({ root: { nodeId: 1 } })
      if (method === 'DOM.getOuterHTML') return Promise.resolve({ outerHTML: '<html/>' })
      if (method === 'Runtime.evaluate') {
        const expr = params?.expression as string
        if (expr === 'location.pathname') return Promise.resolve({ result: { value: '/home' } })
        return Promise.resolve({ result: { value: null } })
      }
      if (method === 'Runtime.getProperties') return Promise.resolve({ result: [] })
      return Promise.resolve({})
    }),
    ...overrides,
  }
}

describe('takeSnapshot', () => {
  it('returns a snapshot with required fields', async () => {
    const snap = await takeSnapshot({ cdpSession: makeMockCdp(), trigger: 'js.error', url: '/home' })
    expect(snap.trigger).toBe('js.error')
    expect(snap.url).toBe('/home')
    expect(snap.dom).toBe('<html/>')
    expect(snap.scopes).toEqual([])
    expect(snap.globals).toBeInstanceOf(Object)
  })

  it('omits plugins field entirely', async () => {
    const snap = await takeSnapshot({ cdpSession: makeMockCdp(), trigger: 'manual', url: '/' })
    expect('plugins' in snap).toBe(false)
  })

  it('resolves successfully when CDP calls fail (non-fatal)', async () => {
    const snap = await takeSnapshot({
      cdpSession: { send: vi.fn().mockRejectedValue(new Error('CDP error')) },
      trigger: 'js.error',
      url: '/fail',
    })
    expect(snap.dom).toBe('')
    expect(snap.scopes).toEqual([])
  })

  it('traverses call frames and scope chain when provided', async () => {
    const mockCdp = makeMockCdp({
      send: vi.fn().mockImplementation((method: string) => {
        if (method === 'DOM.getDocument') return Promise.resolve({ root: { nodeId: 1 } })
        if (method === 'DOM.getOuterHTML') return Promise.resolve({ outerHTML: '<html/>' })
        if (method === 'Runtime.evaluate') return Promise.resolve({ result: { value: null } })
        if (method === 'Runtime.getProperties') return Promise.resolve({ result: [{ name: 'x', value: { value: 42 } }] })
        return Promise.resolve({})
      })
    })
    const frame = {
      callFrameId: 'cf1', functionName: 'handleSubmit', url: 'auth.ts',
      location: { scriptId: 's1', lineNumber: 41, columnNumber: 0 },
      scopeChain: [{ type: 'local', object: { objectId: 'obj1' } }]
    }
    const snap = await takeSnapshot({ cdpSession: mockCdp, trigger: 'js.error', url: '/login', callFrames: [frame as never] })
    expect(snap.scopes).toHaveLength(1)
    expect(snap.scopes[0].frame).toBe('handleSubmit (auth.ts:42)')
    expect(snap.scopes[0].locals).toEqual({ x: 42 })
  })

  it('skips scope capture when callFrames is absent', async () => {
    const snap = await takeSnapshot({ cdpSession: makeMockCdp(), trigger: 'manual', url: '/' })
    expect(snap.scopes).toEqual([])
  })

  it('populates globals', async () => {
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
    const snap = await takeSnapshot({ cdpSession: mockCdp, trigger: 'js.error', url: '/app' })
    expect(snap.globals['location.pathname']).toBe('/app')
    expect(snap.globals['localStorage']).toEqual({ token: 'abc' })
  })
})

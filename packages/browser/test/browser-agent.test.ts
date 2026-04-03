import { describe, it, expect, vi } from 'vitest'
import { BrowserAgent } from '../src/index.js'

function makeMockServer() {
  return { event: vi.fn().mockResolvedValue(undefined) }
}

describe('BrowserAgent', () => {
  it('emit() calls server.event with sessionId and correct event shape', () => {
    const server = makeMockServer()
    const agent = new BrowserAgent('sess-1', server as any)
    agent.emit({ type: 'plugin.router', data: { route: '/home' } })
    expect(server.event).toHaveBeenCalledOnce()
    const [calledSessionId, calledEvent] = server.event.mock.calls[0]
    expect(calledSessionId).toBe('sess-1')
    expect(calledEvent.type).toBe('plugin.router')
    expect(calledEvent.source).toBe('plugin')
    expect(calledEvent.id).toBeTruthy()
  })

  it('registers and calls plugin setup', () => {
    const setup = vi.fn()
    const agent = new BrowserAgent('sess-1', makeMockServer() as any)
    agent.use({ name: 'test', browser: { setup, snapshot: () => ({}) } })
    expect(setup).toHaveBeenCalledWith(agent)
  })

  it('collects plugin snapshot data', () => {
    const agent = new BrowserAgent('sess-1', makeMockServer() as any)
    agent.use({ name: 'router', browser: { setup: vi.fn(), snapshot: () => ({ route: '/home' }) } })
    expect(agent.collectSnapshot()).toEqual({ router: { route: '/home' } })
  })

  it('collectSnapshot is non-fatal when a plugin snapshot throws', () => {
    const agent = new BrowserAgent('sess-1', makeMockServer() as any)
    agent.use({ name: 'bad', browser: { setup: vi.fn(), snapshot: () => { throw new Error('boom') } } })
    agent.use({ name: 'good', browser: { setup: vi.fn(), snapshot: () => ({ ok: true }) } })
    const snapData = agent.collectSnapshot()
    expect(snapData.bad).toBeUndefined()
    expect(snapData.good).toEqual({ ok: true })
  })
})

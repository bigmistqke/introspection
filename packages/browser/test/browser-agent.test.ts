import { describe, it, expect, vi } from 'vitest'
import { BrowserAgent } from '../src/index.js'

describe('BrowserAgent', () => {
  it('calls send when emit() is invoked', () => {
    const send = vi.fn()
    const agent = new BrowserAgent({ send })
    agent.emit({ type: 'plugin.router', data: { route: '/home' } })
    expect(send).toHaveBeenCalledOnce()
    const msg = JSON.parse(send.mock.calls[0][0])
    expect(msg.type).toBe('EVENT')
    expect(msg.event.type).toBe('plugin.router')
    // source is injected by the agent, not the caller
    expect(msg.event.source).toBe('plugin')
    expect(msg.event.id).toBeTruthy()
  })

  it('registers and calls plugin setup', () => {
    const setup = vi.fn()
    const agent = new BrowserAgent({ send: vi.fn() })
    agent.use({ name: 'test', browser: { setup, snapshot: () => ({}) } })
    expect(setup).toHaveBeenCalledWith(agent)
  })

  it('collects plugin snapshot data', () => {
    const agent = new BrowserAgent({ send: vi.fn() })
    agent.use({ name: 'router', browser: { setup: vi.fn(), snapshot: () => ({ route: '/home' }) } })
    const snapData = agent.collectSnapshot()
    expect(snapData.router).toEqual({ route: '/home' })
  })

  it('collectSnapshot is non-fatal when a plugin snapshot throws', () => {
    const agent = new BrowserAgent({ send: vi.fn() })
    agent.use({ name: 'bad', browser: { setup: vi.fn(), snapshot: () => { throw new Error('boom') } } })
    agent.use({ name: 'good', browser: { setup: vi.fn(), snapshot: () => ({ ok: true }) } })
    const snapData = agent.collectSnapshot()
    expect(snapData.bad).toBeUndefined()
    expect(snapData.good).toEqual({ ok: true })
  })
})

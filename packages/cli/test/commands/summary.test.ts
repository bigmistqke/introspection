import { describe, it, expect } from 'vitest'
import { buildSummary } from '../../src/commands/summary.js'
import type { TraceFile } from '@introspection/types'

const trace: TraceFile = {
  version: '2',
  session: { id: 'sess-1', startedAt: 1000, endedAt: 3000, label: 'login test' },
  events: [
    { id: 'e1', type: 'playwright.action', ts: 50, source: 'playwright', data: { method: 'goto', args: ['/login'] } },
    { id: 'e2', type: 'network.request', ts: 100, source: 'cdp', data: { url: '/api/auth/login', method: 'POST', headers: {} } },
    { id: 'e3', type: 'network.response', ts: 150, source: 'cdp', initiator: 'e2', data: { requestId: 'e2', url: '/api/auth/login', status: 401, headers: {} } },
    { id: 'e4', type: 'js.error', ts: 200, source: 'cdp', data: { message: 'TypeError: Cannot read properties', stack: [] } },
  ],
  snapshots: {},
}

describe('buildSummary', () => {
  it('includes session label and duration', () => {
    const out = buildSummary(trace)
    expect(out).toContain('login test')
    expect(out).toContain('2000ms')
  })

  it('mentions failed network requests', () => {
    const out = buildSummary(trace)
    expect(out).toContain('401')
    expect(out).toContain('/api/auth/login')
  })

  it('mentions JS errors', () => {
    const out = buildSummary(trace)
    expect(out).toContain('TypeError')
  })

  it('mentions Playwright actions taken', () => {
    const out = buildSummary(trace)
    expect(out).toContain('goto')
  })

  it('shows "ongoing" when session has no endedAt', () => {
    const ongoing: TraceFile = { ...trace, session: { ...trace.session, endedAt: undefined } }
    expect(buildSummary(ongoing)).toContain('ongoing')
  })
})

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

  it('omits sections when there are no actions, failures, or errors', () => {
    const clean: TraceFile = {
      version: '2',
      session: { id: 'sess-2', startedAt: 1000, endedAt: 2000, label: 'clean test' },
      events: [],
      snapshots: {},
    }
    const out = buildSummary(clean)
    expect(out).toContain('clean test')
    expect(out).not.toContain('Actions taken')
    expect(out).not.toContain('Failed network')
    expect(out).not.toContain('JS errors')
  })

  it('formats action with no args using empty string', () => {
    const noArgs: TraceFile = {
      ...trace,
      events: [
        { id: 'e1', type: 'playwright.action', ts: 50, source: 'playwright', data: { method: 'reload', args: [] } },
      ],
    }
    const out = buildSummary(noArgs)
    expect(out).toContain('reload()')
  })

  it('shows "ongoing" when session has no endedAt', () => {
    const ongoing: TraceFile = { ...trace, session: { ...trace.session, endedAt: undefined } }
    expect(buildSummary(ongoing)).toContain('ongoing')
  })
})

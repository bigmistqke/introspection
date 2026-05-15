import { describe, it, expect } from 'vitest'
import { buildSummary } from '../../src/commands/summary.js'
import type { TraceEvent } from '@introspection/types'
import type { TraceSummary } from '@introspection/read'

const trace: TraceSummary = { id: 'sess-1', startedAt: 1000, endedAt: 3000, label: 'login test' }
const events: TraceEvent[] = [
  { id: 'e1', type: 'playwright.action', timestamp: 50, metadata: { method: 'goto', args: ['/login'] } },
  { id: 'e2', type: 'network.request', timestamp: 100, metadata: { cdpRequestId: '1', cdpTimestamp: 0, cdpWallTime: 0, url: '/api/auth/login', method: 'POST', headers: {} } },
  { id: 'e3', type: 'network.response', timestamp: 150, initiator: 'e2', metadata: { cdpRequestId: '1', cdpTimestamp: 0, requestId: 'e2', url: '/api/auth/login', status: 401, headers: {} } },
  { id: 'e4', type: 'js.error', timestamp: 200, metadata: { cdpTimestamp: 0, message: 'TypeError: Cannot read properties', stack: [] } },
]

describe('buildSummary', () => {
  it('includes trace label and duration', () => {
    const out = buildSummary(trace, events)
    expect(out).toContain('login test')
    expect(out).toContain('2000ms')
  })

  it('mentions failed network requests', () => {
    const out = buildSummary(trace, events)
    expect(out).toContain('401')
    expect(out).toContain('/api/auth/login')
  })

  it('mentions JS errors', () => {
    const out = buildSummary(trace, events)
    expect(out).toContain('TypeError')
  })

  it('mentions Playwright actions taken', () => {
    const out = buildSummary(trace, events)
    expect(out).toContain('goto')
  })

  it('omits sections when there are no actions, failures, or errors', () => {
    const clean: TraceSummary = { id: 'sess-2', startedAt: 1000, endedAt: 2000, label: 'clean test' }
    const out = buildSummary(clean, [])
    expect(out).toContain('clean test')
    expect(out).not.toContain('Actions taken')
    expect(out).not.toContain('Failed network')
    expect(out).not.toContain('JS errors')
  })

  it('formats action with no args using empty string', () => {
    const noArgs: TraceEvent[] = [
      { id: 'e1', type: 'playwright.action', timestamp: 50, metadata: { method: 'reload', args: [] } },
    ]
    const out = buildSummary(trace, noArgs)
    expect(out).toContain('reload()')
  })

  it('shows "ongoing" when trace has no endedAt', () => {
    const ongoing: TraceSummary = { ...trace, endedAt: undefined }
    expect(buildSummary(ongoing, events)).toContain('ongoing')
  })
})

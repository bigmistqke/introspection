import { describe, it, expect } from 'vitest'
import { formatNetworkTable } from '../../src/commands/network.js'
import type { TraceFile } from '@introspection/types'

const trace: TraceFile = {
  version: '1',
  test: { title: 't', file: 'f', status: 'passed', duration: 100 },
  events: [
    { id: 'r1', type: 'network.request', ts: 10, source: 'cdp', data: { url: '/api/users', method: 'GET', headers: {} } },
    { id: 'r2', type: 'network.response', ts: 50, source: 'cdp', initiator: 'r1', data: { requestId: 'r1', url: '/api/users', status: 200, headers: {} } },
    { id: 'r3', type: 'network.request', ts: 60, source: 'cdp', data: { url: '/api/auth', method: 'POST', headers: {} } },
    { id: 'r4', type: 'network.response', ts: 100, source: 'cdp', initiator: 'r3', data: { requestId: 'r3', url: '/api/auth', status: 401, headers: {} } },
  ],
  snapshots: {},
}

describe('formatNetworkTable', () => {
  it('lists all requests', () => {
    const out = formatNetworkTable(trace.events, {})
    expect(out).toContain('/api/users')
    expect(out).toContain('/api/auth')
  })

  it('--failed filters to non-2xx only', () => {
    const out = formatNetworkTable(trace.events, { failed: true })
    expect(out).not.toContain('/api/users')
    expect(out).toContain('/api/auth')
    expect(out).toContain('401')
  })

  it('--url filters by pattern', () => {
    const out = formatNetworkTable(trace.events, { url: '/api/auth' })
    expect(out).not.toContain('/api/users')
    expect(out).toContain('/api/auth')
  })
})

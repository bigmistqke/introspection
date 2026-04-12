import { describe, it, expect } from 'vitest'
import { formatNetworkTable } from '../../src/commands/network.js'
import type { TraceEvent } from '@introspection/types'

const events: TraceEvent[] = [
  { id: 'evt-aaa1', type: 'network.request', timestamp: 10, metadata: { cdpRequestId: '1000.1', cdpTimestamp: 0, cdpWallTime: 0, url: '/api/users', method: 'GET', headers: {} } },
  { id: 'evt-aaa2', type: 'network.response', timestamp: 50, initiator: 'evt-aaa1', metadata: { cdpRequestId: '1000.1', cdpTimestamp: 0, requestId: '1000.1', url: '/api/users', status: 200, headers: {} } },
  { id: 'evt-bbb1', type: 'network.request', timestamp: 60, metadata: { cdpRequestId: '1000.2', cdpTimestamp: 0, cdpWallTime: 0, url: '/api/auth', method: 'POST', headers: {} } },
  { id: 'evt-bbb2', type: 'network.response', timestamp: 100, initiator: 'evt-bbb1', metadata: { cdpRequestId: '1000.2', cdpTimestamp: 0, requestId: '1000.2', url: '/api/auth', status: 401, headers: {} } },
  { id: 'evt-ccc1', type: 'network.request', timestamp: 110, metadata: { cdpRequestId: '1000.3', cdpTimestamp: 0, cdpWallTime: 0, url: '/api/slow', method: 'GET', headers: {} } },
  { id: 'evt-ccc2', type: 'network.error', timestamp: 200, metadata: { cdpRequestId: '1000.3', url: '/api/slow', errorText: 'net::ERR_CONNECTION_TIMED_OUT' } },
]

describe('formatNetworkTable', () => {
  it('lists all requests', () => {
    const out = formatNetworkTable(events, {})
    expect(out).toContain('/api/users')
    expect(out).toContain('/api/auth')
  })

  it('resolves method via cdpRequestId (not event id)', () => {
    const out = formatNetworkTable(events, {})
    expect(out).toContain('GET')
    expect(out).toContain('POST')
    expect(out).not.toContain('?')
  })

  it('--failed filters to non-2xx responses and includes network.error rows', () => {
    const out = formatNetworkTable(events, { failed: true })
    expect(out).not.toContain('/api/users')
    expect(out).toContain('/api/auth')
    expect(out).toContain('401')
    expect(out).toContain('ERR')
    expect(out).toContain('/api/slow')
  })

  it('--url filters by pattern', () => {
    const out = formatNetworkTable(events, { url: '/api/auth' })
    expect(out).not.toContain('/api/users')
    expect(out).toContain('/api/auth')
  })

  it('shows ? for method when response has no matching request', () => {
    const orphanEvents: TraceEvent[] = [
      { id: 'evt-1', type: 'network.response', timestamp: 50, metadata: { cdpRequestId: 'orphan', cdpTimestamp: 0, requestId: 'orphan', url: '/api/orphan', status: 200, headers: {} } },
    ]
    const out = formatNetworkTable(orphanEvents, {})
    expect(out).toContain('?')
    expect(out).toContain('/api/orphan')
  })

  it('returns empty message when no events match', () => {
    const out = formatNetworkTable(events, { url: '/nonexistent' })
    expect(out).toBe('(no matching network events)')
  })

  it('network.error rows appear without --failed flag', () => {
    const out = formatNetworkTable(events, {})
    expect(out).toContain('ERR')
    expect(out).toContain('/api/slow')
  })
})

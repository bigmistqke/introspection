import { describe, it, expect } from 'vitest'
import { evalExpression } from '../../src/commands/eval.js'
import type { TraceFile } from '@introspection/types'

const trace: TraceFile = {
  version: '2',
  session: { id: 'sess-1', startedAt: 1000, endedAt: 1800, label: 'checkout test' },
  snapshots: {},
  events: [
    { id: 'e1', type: 'plugin.redux.action', ts: 100, source: 'plugin', data: { action: { type: 'CART/ADD' } } },
    { id: 'e2', type: 'plugin.redux.action', ts: 200, source: 'plugin', data: { action: { type: 'CART/REMOVE' } } },
    { id: 'e3', type: 'network.request',     ts: 300, source: 'cdp',    data: { url: '/api/checkout', method: 'POST', headers: {} } },
  ],
}

describe('evalExpression', () => {
  it('evaluates expression against events', () => {
    const result = JSON.parse(evalExpression(trace, 'events.length'))
    expect(result).toBe(3)
  })

  it('exposes session object', () => {
    const result = JSON.parse(evalExpression(trace, 'session.label'))
    expect(result).toBe('checkout test')
  })

  it('exposes snapshots object', () => {
    const result = JSON.parse(evalExpression(trace, 'snapshots'))
    expect(result).toEqual({})
  })

  it('returns mapped array', () => {
    const result = JSON.parse(evalExpression(trace, 'events.map(e => e.type)'))
    expect(result).toEqual(['plugin.redux.action', 'plugin.redux.action', 'network.request'])
  })

  it('returns null for undefined result', () => {
    const result = JSON.parse(evalExpression(trace, 'undefined'))
    expect(result).toBeNull()
  })

  it('throws on expression error', () => {
    expect(() => evalExpression(trace, 'notDefined.foo')).toThrow()
  })
})

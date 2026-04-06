import { describe, it, expect } from 'vitest'
import { applyEventFilters, formatEvents } from '../../src/commands/events.js'
import type { TraceFile } from '@introspection/types'

const trace: TraceFile = {
  version: '1',
  test: { title: 't', file: 'f', status: 'passed', duration: 500 },
  snapshots: {},
  events: [
    { id: 'e1', type: 'mark',                 ts: 50,  source: 'agent',      data: { label: 'before-add' } },
    { id: 'e2', type: 'plugin.redux.action',   ts: 100, source: 'cdp',        data: { action: { type: 'CART/ADD' } } },
    { id: 'e3', type: 'network.request',       ts: 200, source: 'cdp',        data: { url: '/api/cart', method: 'POST', headers: {} } },
    { id: 'e4', type: 'plugin.redux.action',   ts: 300, source: 'cdp',        data: { action: { type: 'CART/REMOVE' } } },
    { id: 'e5', type: 'playwright.action',     ts: 400, source: 'playwright', data: { method: 'click', args: ['button'] } },
  ],
}

describe('applyEventFilters', () => {
  it('returns all events when no flags given', () => {
    expect(applyEventFilters(trace, {})).toHaveLength(5)
  })

  it('--type filters to exact type match', () => {
    const result = applyEventFilters(trace, { type: 'plugin.redux.action' })
    expect(result).toHaveLength(2)
    expect(result.every(e => e.type === 'plugin.redux.action')).toBe(true)
  })

  it('--type accepts comma-separated types', () => {
    const result = applyEventFilters(trace, { type: 'plugin.redux.action,mark' })
    expect(result).toHaveLength(3)
  })

  it('--type with unknown type returns empty array', () => {
    expect(applyEventFilters(trace, { type: 'nonexistent' })).toHaveLength(0)
  })

  it('--source filters by source field', () => {
    const result = applyEventFilters(trace, { source: 'playwright' })
    expect(result).toHaveLength(1)
    expect(result.every(e => e.source === 'playwright')).toBe(true)
  })

  it('--source throws on unrecognised value', () => {
    expect(() => applyEventFilters(trace, { source: 'typo' }))
      .toThrow('unknown source "typo"')
  })

  it('--after keeps events with ts strictly greater than value', () => {
    const result = applyEventFilters(trace, { after: 100 })
    expect(result.map(e => e.id)).toEqual(['e3', 'e4', 'e5'])
  })

  it('--before keeps events with ts strictly less than value', () => {
    const result = applyEventFilters(trace, { before: 300 })
    expect(result.map(e => e.id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('--after and --before together form a window', () => {
    const result = applyEventFilters(trace, { after: 100, before: 350 })
    expect(result.map(e => e.id)).toEqual(['e3', 'e4'])
  })

  it('--since finds mark in full event list and filters by its ts', () => {
    const result = applyEventFilters(trace, { since: 'before-add' })
    // mark is at ts:50 — keep events with ts > 50
    expect(result.map(e => e.id)).toEqual(['e2', 'e3', 'e4', 'e5'])
  })

  it('--since works even when --type excludes mark events', () => {
    const result = applyEventFilters(trace, { type: 'plugin.redux.action', since: 'before-add' })
    expect(result.map(e => e.id)).toEqual(['e2', 'e4'])
  })

  it('--since and --after: Math.max(mark.ts, afterMs) wins', () => {
    // mark.ts=50, after=200 → lower bound is 200
    const result = applyEventFilters(trace, { since: 'before-add', after: 200 })
    expect(result.map(e => e.id)).toEqual(['e4', 'e5'])
  })

  it('--since throws when label not found', () => {
    expect(() => applyEventFilters(trace, { since: 'nonexistent' }))
      .toThrow('no mark event with label "nonexistent" found')
  })

  it('--last keeps only the last N events after other filters', () => {
    const result = applyEventFilters(trace, { last: 2 })
    expect(result.map(e => e.id)).toEqual(['e4', 'e5'])
  })

  it('--last larger than result set returns all', () => {
    const result = applyEventFilters(trace, { type: 'plugin.redux.action', last: 10 })
    expect(result).toHaveLength(2)
  })

  it('--last 0 throws', () => {
    expect(() => applyEventFilters(trace, { last: 0 }))
      .toThrow('--last must be a positive integer')
  })
})

describe('formatEvents — default output (no expression)', () => {
  it('returns timeline-formatted string of all events when no flags', () => {
    const out = formatEvents(trace, {})
    expect(out).toContain('plugin.redux.action')
    expect(out).toContain('mark')
    expect(out).toContain('network.request')
  })

  it('returns only matching events when --type is given', () => {
    const out = formatEvents(trace, { type: 'plugin.redux.action' })
    expect(out).toContain('plugin.redux.action')
    expect(out).not.toContain('mark')
    expect(out).not.toContain('network.request')
  })

  it('returns empty string when no events match', () => {
    const out = formatEvents(trace, { type: 'nonexistent' })
    expect(out).toBe('')
  })
})

describe('formatEvents — expression mode', () => {
  it('maps each event with the expression using `event` as the variable', () => {
    const out = formatEvents(trace, { type: 'plugin.redux.action' }, 'event.data.action.type')
    const parsed = JSON.parse(out)
    expect(parsed).toEqual(['CART/ADD', 'CART/REMOVE'])
  })

  it('expression returning an object produces array of objects', () => {
    const out = formatEvents(trace, { type: 'plugin.redux.action' }, '({ ts: event.ts, action: event.data.action.type })')
    const parsed = JSON.parse(out)
    expect(parsed).toEqual([
      { ts: 100, action: 'CART/ADD' },
      { ts: 300, action: 'CART/REMOVE' },
    ])
  })

  it('expression returning undefined maps to null', () => {
    const out = formatEvents(trace, { type: 'plugin.redux.action' }, 'undefined')
    const parsed = JSON.parse(out)
    expect(parsed).toEqual([null, null])
  })

  it('expression that throws for one event produces error slot, rest unaffected', () => {
    // mark event has no .data.action — will throw; redux events work fine
    const out = formatEvents(trace, {}, 'event.data.action.type')
    const parsed = JSON.parse(out)
    // e2 and e4 are redux events — those should return the action type
    expect(parsed[1]).toBe('CART/ADD')
    expect(parsed[3]).toBe('CART/REMOVE')
    // e1 (mark), e3 (network.request), e5 (playwright) have no action — error slots
    expect(parsed[0]).toHaveProperty('error')
    expect(parsed[0]).toHaveProperty('event')
  })

  it('returns [] when no events match filters', () => {
    const out = formatEvents(trace, { type: 'nonexistent' }, 'event.id')
    expect(JSON.parse(out)).toEqual([])
  })

  it('only `event` is in scope — `events`, `snapshot`, `test` are undefined', () => {
    const out = formatEvents(trace, { type: 'mark' }, 'typeof events')
    expect(JSON.parse(out)).toEqual(['undefined'])
  })
})

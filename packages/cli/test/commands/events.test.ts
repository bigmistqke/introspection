import { describe, it, expect } from 'vitest'
import { applyEventFilters, formatEvents } from '../../src/commands/events.js'
import type { TraceFile } from '@introspection/types'

const trace: TraceFile = {
  version: '1',
  test: { title: 't', file: 'f', status: 'passed', duration: 500 },
  snapshots: {},
  events: [
    { id: 'e1', type: 'mark',                 ts: 50,  source: 'agent',      data: { label: 'before-add' } },
    { id: 'e2', type: 'plugin.redux.action',   ts: 100, source: 'plugin',     data: { action: { type: 'CART/ADD' } } },
    { id: 'e3', type: 'network.request',       ts: 200, source: 'cdp',        data: { url: '/api/cart', method: 'POST', headers: {} } },
    { id: 'e4', type: 'plugin.redux.action',   ts: 300, source: 'plugin',     data: { action: { type: 'CART/REMOVE' } } },
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
    const result = applyEventFilters(trace, { source: 'plugin' })
    expect(result).toHaveLength(2)
    expect(result.every(e => e.source === 'plugin')).toBe(true)
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

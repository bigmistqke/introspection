import { describe, it, expect } from 'vitest'
import { applyEventFilters, formatEvents } from '../../src/commands/events.js'
import type { TraceFile } from '@introspection/types'

const trace: TraceFile = {
  version: '1',
  test: { title: 't', file: 'f', status: 'passed', duration: 500 },
  snapshots: {},
  events: [
    { id: 'e1', type: 'mark',                 timestamp: 50,  source: 'agent',      data: { label: 'before-add' } },
    { id: 'e2', type: 'plugin.redux.action',   timestamp: 100, source: 'cdp',        data: { action: { type: 'CART/ADD' } } },
    { id: 'e3', type: 'network.request',       timestamp: 200, source: 'cdp',        data: { url: '/api/cart', method: 'POST', headers: {} } },
    { id: 'e4', type: 'plugin.redux.action',   timestamp: 300, source: 'cdp',        data: { action: { type: 'CART/REMOVE' } } },
    { id: 'e5', type: 'playwright.action',     timestamp: 400, source: 'playwright', data: { method: 'click', args: ['button'] } },
    { id: 'e6', type: 'webgl.uniform',         timestamp: 450, source: 'plugin',     data: { name: 'u_time', value: 1.5 } },
  ],
}

describe('applyEventFilters', () => {
  it('returns all events when no flags given', () => {
    expect(applyEventFilters(trace.events, {})).toHaveLength(6)
  })

  it('--type filters to exact type match', () => {
    const result = applyEventFilters(trace.events, { type: 'plugin.redux.action' })
    expect(result).toHaveLength(2)
    expect(result.every(e => e.type === 'plugin.redux.action')).toBe(true)
  })

  it('--type accepts comma-separated types', () => {
    const result = applyEventFilters(trace.events, { type: 'plugin.redux.action,mark' })
    expect(result).toHaveLength(3)
  })

  it('--type with unknown type returns empty array', () => {
    expect(applyEventFilters(trace.events, { type: 'nonexistent' })).toHaveLength(0)
  })

  it('--source filters by source field', () => {
    const result = applyEventFilters(trace.events, { source: 'playwright' })
    expect(result).toHaveLength(1)
    expect(result.every(e => e.source === 'playwright')).toBe(true)
  })

  it('--source plugin returns only plugin events', () => {
    const result = applyEventFilters(trace.events, { source: 'plugin' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('e6')
  })

  it('--source throws on unrecognised value', () => {
    expect(() => applyEventFilters(trace.events, { source: 'typo' }))
      .toThrow('unknown source "typo"')
  })

  it('--after keeps events with ts strictly greater than value', () => {
    const result = applyEventFilters(trace.events, { after: 100 })
    expect(result.map(e => e.id)).toEqual(['e3', 'e4', 'e5', 'e6'])
  })

  it('--before keeps events with ts strictly less than value', () => {
    const result = applyEventFilters(trace.events, { before: 300 })
    expect(result.map(e => e.id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('--after and --before together form a window', () => {
    const result = applyEventFilters(trace.events, { after: 100, before: 350 })
    expect(result.map(e => e.id)).toEqual(['e3', 'e4'])
  })

  it('--since finds mark in full event list and filters by its ts', () => {
    const result = applyEventFilters(trace.events, { since: 'before-add' })
    // mark is at ts:50 — keep events with ts > 50
    expect(result.map(e => e.id)).toEqual(['e2', 'e3', 'e4', 'e5', 'e6'])
  })

  it('--since works even when --type excludes mark events', () => {
    const result = applyEventFilters(trace.events, { type: 'plugin.redux.action', since: 'before-add' })
    expect(result.map(e => e.id)).toEqual(['e2', 'e4'])
  })

  it('--since and --after: Math.max(mark.ts, afterMs) wins', () => {
    // mark.ts=50, after=200 → lower bound is 200
    const result = applyEventFilters(trace.events, { since: 'before-add', after: 200 })
    expect(result.map(e => e.id)).toEqual(['e4', 'e5', 'e6'])
  })

  it('--since throws when label not found', () => {
    expect(() => applyEventFilters(trace.events, { since: 'nonexistent' }))
      .toThrow('no mark event with label "nonexistent" found')
  })

  it('--last keeps only the last N events after other filters', () => {
    const result = applyEventFilters(trace.events, { last: 2 })
    expect(result.map(e => e.id)).toEqual(['e5', 'e6'])
  })

  it('--last larger than result set returns all', () => {
    const result = applyEventFilters(trace.events, { type: 'plugin.redux.action', last: 10 })
    expect(result).toHaveLength(2)
  })

  it('--last 0 throws', () => {
    expect(() => applyEventFilters(trace.events, { last: 0 }))
      .toThrow('--last must be a positive integer')
  })
})

describe('formatEvents — text output (default)', () => {
  it('returns timeline-formatted string of all events when no flags', () => {
    const out = formatEvents(trace.events, {})
    expect(out).toContain('plugin.redux.action')
    expect(out).toContain('mark')
    expect(out).toContain('network.request')
  })

  it('returns only matching events when --type is given', () => {
    const out = formatEvents(trace.events, { type: 'plugin.redux.action' })
    expect(out).toContain('plugin.redux.action')
    expect(out).not.toContain('mark')
    expect(out).not.toContain('network.request')
  })

  it('returns empty string when no events match', () => {
    const out = formatEvents(trace.events, { type: 'nonexistent' })
    expect(out).toBe('')
  })
})

describe('formatEvents — --filter predicate', () => {
  it('keeps only events where predicate is truthy', () => {
    const out = formatEvents(trace.events, { filter: 'event.source === "cdp"' })
    expect(out).toContain('plugin.redux.action')
    expect(out).toContain('network.request')
    expect(out).not.toContain('mark')
    expect(out).not.toContain('playwright.action')
  })

  it('predicate that throws for an event excludes that event', () => {
    // Only redux events have data.action — others throw and are excluded
    const out = formatEvents(trace.events, { format: 'json', filter: 'event.data.action.type === "CART/ADD"' })
    const parsed = JSON.parse(out)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('e2')
  })

  it('returns empty string when no events match predicate', () => {
    const out = formatEvents(trace.events, { filter: 'false' })
    expect(out).toBe('')
  })

  it('only `event` is in scope — `events` is undefined', () => {
    // If `events` were in scope this would throw; since it's not, the predicate is false
    const out = formatEvents(trace.events, { filter: 'typeof events === "undefined"' })
    expect(out).toContain('mark')
  })
})

describe('formatEvents — --format json', () => {
  it('returns JSON array of full TraceEvent objects', () => {
    const out = formatEvents(trace.events, { format: 'json', type: 'mark' })
    const parsed = JSON.parse(out)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ id: 'e1', type: 'mark', source: 'agent' })
  })

  it('combined with --filter returns only matching events as JSON', () => {
    const out = formatEvents(trace.events, { format: 'json', filter: 'event.source === "cdp"' })
    const parsed = JSON.parse(out)
    expect(parsed.every((event: { source: string }) => event.source === 'cdp')).toBe(true)
  })

  it('returns empty array when no events match', () => {
    const out = formatEvents(trace.events, { format: 'json', type: 'nonexistent' })
    expect(JSON.parse(out)).toEqual([])
  })
})

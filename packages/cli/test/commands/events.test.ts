import { describe, it, expect } from 'vitest'
import { applyEventFilters, formatEvents } from '../../src/commands/events.js'
import type { TraceEvent } from '@introspection/types'

const events: TraceEvent[] = [
  { id: 'e1', type: 'mark',              timestamp: 50,  metadata: { label: 'before-add' } },
  { id: 'e2', type: 'redux.dispatch',    timestamp: 100, metadata: { action: 'CART/ADD',    diff: [] } },
  { id: 'e3', type: 'network.request',   timestamp: 200, metadata: { cdpRequestId: '1', cdpTimestamp: 0, cdpWallTime: 0, url: '/api/cart', method: 'POST', headers: {} } },
  { id: 'e4', type: 'redux.dispatch',    timestamp: 300, metadata: { action: 'CART/REMOVE', diff: [] } },
  { id: 'e5', type: 'playwright.action', timestamp: 400, metadata: { method: 'click', args: ['button'] } },
  { id: 'e6', type: 'webgl.uniform',     timestamp: 450, metadata: { contextId: 'ctx-1', name: 'u_time', value: 1.5, glType: 'FLOAT' } },
]

describe('applyEventFilters', () => {
  it('returns all events when no flags given', () => {
    expect(applyEventFilters(events, {})).toHaveLength(6)
  })

  it('--type filters to exact type match', () => {
    const result = applyEventFilters(events, { type: 'redux.dispatch' })
    expect(result).toHaveLength(2)
    expect(result.every(event => event.type === 'redux.dispatch')).toBe(true)
  })

  it('--type accepts comma-separated types', () => {
    const result = applyEventFilters(events, { type: 'redux.dispatch,mark' })
    expect(result).toHaveLength(3)
  })

  it('--type with unknown type returns empty array', () => {
    expect(applyEventFilters(events, { type: 'nonexistent' })).toHaveLength(0)
  })

  it('--type supports trailing .* for prefix match', () => {
    const result = applyEventFilters(events, { type: 'network.*' })
    expect(result.map(event => event.id)).toEqual(['e3'])
  })

  it('--type prefix matches event family across multiple types', () => {
    const mixed: TraceEvent[] = [
      ...events,
      { id: 'e7', type: 'network.response', timestamp: 250, metadata: { cdpRequestId: '1', cdpTimestamp: 0, requestId: '1', url: '/api/cart', status: 200, headers: {} } },
      { id: 'e8', type: 'network.error',    timestamp: 260, metadata: { url: '/api/cart', errorText: 'nope' } },
    ]
    const result = applyEventFilters(mixed, { type: 'network.*' })
    expect(result.map(event => event.id)).toEqual(['e3', 'e7', 'e8'])
  })

  it('--type mixes prefix and exact patterns', () => {
    const result = applyEventFilters(events, { type: 'network.*,mark' })
    expect(result.map(event => event.id)).toEqual(['e1', 'e3'])
  })

  it('--after keeps events with ts strictly greater than value', () => {
    const result = applyEventFilters(events, { after: 100 })
    expect(result.map(event => event.id)).toEqual(['e3', 'e4', 'e5', 'e6'])
  })

  it('--before keeps events with ts strictly less than value', () => {
    const result = applyEventFilters(events, { before: 300 })
    expect(result.map(event => event.id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('--after and --before together form a window', () => {
    const result = applyEventFilters(events, { after: 100, before: 350 })
    expect(result.map(event => event.id)).toEqual(['e3', 'e4'])
  })

  it('--since finds mark in full event list and filters by its ts', () => {
    const result = applyEventFilters(events, { since: 'before-add' })
    expect(result.map(event => event.id)).toEqual(['e2', 'e3', 'e4', 'e5', 'e6'])
  })

  it('--since works even when --type excludes mark events', () => {
    const result = applyEventFilters(events, { type: 'redux.dispatch', since: 'before-add' })
    expect(result.map(event => event.id)).toEqual(['e2', 'e4'])
  })

  it('--since and --after: Math.max(mark.ts, afterMs) wins', () => {
    const result = applyEventFilters(events, { since: 'before-add', after: 200 })
    expect(result.map(event => event.id)).toEqual(['e4', 'e5', 'e6'])
  })

  it('--since throws when label not found', () => {
    expect(() => applyEventFilters(events, { since: 'nonexistent' }))
      .toThrow('no mark event with label "nonexistent" found')
  })

  it('--last keeps only the last N events after other filters', () => {
    const result = applyEventFilters(events, { last: 2 })
    expect(result.map(event => event.id)).toEqual(['e5', 'e6'])
  })

  it('--last larger than result set returns all', () => {
    const result = applyEventFilters(events, { type: 'redux.dispatch', last: 10 })
    expect(result).toHaveLength(2)
  })

  it('--last 0 throws', () => {
    expect(() => applyEventFilters(events, { last: 0 }))
      .toThrow('--last must be a positive integer')
  })
})

describe('formatEvents — text output (default)', () => {
  it('returns timeline-formatted string of all events when no flags', () => {
    const out = formatEvents(events, {})
    expect(out).toContain('redux.dispatch')
    expect(out).toContain('mark')
    expect(out).toContain('network.request')
  })

  it('returns only matching events when --type is given', () => {
    const out = formatEvents(events, { type: 'redux.dispatch' })
    expect(out).toContain('redux.dispatch')
    expect(out).not.toContain('mark')
    expect(out).not.toContain('network.request')
  })

  it('renders console events with level and message', () => {
    const withConsole: TraceEvent[] = [
      { id: 'c1', type: 'console', timestamp: 120, metadata: { level: 'log', message: '[APP] rendering' } },
      { id: 'c2', type: 'console', timestamp: 130, metadata: { level: 'error', message: 'boom' } },
    ]
    const out = formatEvents(withConsole, {})
    expect(out).toContain('console [log] [APP] rendering')
    expect(out).toContain('console [error] boom')
  })

  it('renders browser.navigate with from → to', () => {
    const withNav: TraceEvent[] = [
      { id: 'n1', type: 'browser.navigate', timestamp: 10, metadata: { from: 'about:blank', to: 'http://localhost/' } },
    ]
    const out = formatEvents(withNav, {})
    expect(out).toContain('browser.navigate about:blank → http://localhost/')
  })

  it('returns empty string when no events match', () => {
    const out = formatEvents(events, { type: 'nonexistent' })
    expect(out).toBe('')
  })
})

describe('formatEvents — --filter predicate', () => {
  it('keeps only events where predicate is truthy', () => {
    const out = formatEvents(events, { filter: 'event.type.startsWith("redux.")' })
    expect(out).toContain('redux.dispatch')
    expect(out).not.toContain('mark')
    expect(out).not.toContain('network.request')
  })

  it('predicate that throws for an event excludes that event', () => {
    const out = formatEvents(events, { format: 'json', filter: 'event.metadata.action === "CART/ADD"' })
    const parsed = JSON.parse(out)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('e2')
  })

  it('returns empty string when no events match predicate', () => {
    const out = formatEvents(events, { filter: 'false' })
    expect(out).toBe('')
  })

  it('only `event` is in scope — `events` is undefined', () => {
    const out = formatEvents(events, { filter: 'typeof events === "undefined"' })
    expect(out).toContain('mark')
  })
})

describe('formatEvents — --format json', () => {
  it('returns JSON array of full TraceEvent objects', () => {
    const out = formatEvents(events, { format: 'json', type: 'mark' })
    const parsed = JSON.parse(out)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ id: 'e1', type: 'mark' })
  })

  it('combined with --filter returns only matching events as JSON', () => {
    const out = formatEvents(events, { format: 'json', filter: 'event.type.startsWith("redux.")' })
    const parsed = JSON.parse(out)
    expect(parsed.every((event: { type: string }) => event.type.startsWith('redux.'))).toBe(true)
  })

  it('returns empty array when no events match', () => {
    const out = formatEvents(events, { format: 'json', type: 'nonexistent' })
    expect(JSON.parse(out)).toEqual([])
  })
})

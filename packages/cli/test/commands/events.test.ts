import { describe, it, expect, vi } from 'vitest'
import { applyEventFilters, formatEvents } from '../../src/commands/events.js'
import type { PayloadRef, TraceEvent } from '@introspection/types'

const mockFiles: Record<string, string | Buffer> = {}
function mockReader(files: Record<string, string | Buffer>) {
  Object.assign(mockFiles, files)
  return {
    async resolvePayload(ref: PayloadRef): Promise<unknown> {
      if (ref.kind === 'inline') return ref.value
      const content = mockFiles[ref.path]
      if (content === undefined) throw new Error(`missing fixture: ${ref.path}`)
      switch (ref.format) {
        case 'json': return JSON.parse(content as string)
        case 'text':
        case 'html': return content as string
        case 'image':
        case 'binary': return content as Buffer
      }
    },
  }
}

const passthroughReader = { async resolvePayload(ref: PayloadRef): Promise<unknown> {
  if (ref.kind === 'inline') return ref.value
  throw new Error('no fixture')
} }

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
  it('returns timeline-formatted string of all events when no flags', async () => {
    const out = await formatEvents(events, {}, passthroughReader)
    expect(out).toContain('redux.dispatch')
    expect(out).toContain('mark')
    expect(out).toContain('network.request')
  })

  it('returns only matching events when --type is given', async () => {
    const out = await formatEvents(events, { type: 'redux.dispatch' }, passthroughReader)
    expect(out).toContain('redux.dispatch')
    expect(out).not.toContain('mark')
    expect(out).not.toContain('network.request')
  })

  it('renders event.summary when present', async () => {
    const withSummary: TraceEvent[] = [
      { id: 'c1', type: 'console', timestamp: 120, summary: '[log] [APP] rendering', metadata: { level: 'log', args: ['[APP] rendering'] } },
      { id: 'n1', type: 'browser.navigate', timestamp: 10, summary: 'about:blank → http://localhost/', metadata: { from: 'about:blank', to: 'http://localhost/' } },
    ]
    const out = await formatEvents(withSummary, {}, passthroughReader)
    expect(out).toContain('console [log] [APP] rendering')
    expect(out).toContain('browser.navigate about:blank → http://localhost/')
  })

  it('falls back to bare event type when summary is missing', async () => {
    const withoutSummary: TraceEvent[] = [
      { id: 'x1', type: 'console', timestamp: 5, metadata: { level: 'log', args: ['no summary here'] } },
    ]
    const out = await formatEvents(withoutSummary, {}, passthroughReader)
    expect(out).toContain('console')
    expect(out).not.toContain('no summary here')
  })

  it('returns empty string when no events match', async () => {
    const out = await formatEvents(events, { type: 'nonexistent' }, passthroughReader)
    expect(out).toBe('')
  })
})

describe('formatEvents — --filter predicate', () => {
  it('keeps only events where predicate is truthy', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await formatEvents(events, { filter: 'event.type.startsWith("redux.")' }, passthroughReader)
    expect(out).toContain('redux.dispatch')
    expect(out).not.toContain('mark')
    expect(out).not.toContain('network.request')
    errSpy.mockRestore()
  })

  it('predicate that throws for an event excludes that event', async () => {
    const out = await formatEvents(events, { format: 'json', filter: 'event.metadata.action === "CART/ADD"' }, passthroughReader)
    const parsed = JSON.parse(out)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('e2')
  })

  it('returns empty string when no events match predicate', async () => {
    const out = await formatEvents(events, { filter: 'false' }, passthroughReader)
    expect(out).toBe('')
  })

  it('only `event` is in scope — `events` is undefined', async () => {
    const out = await formatEvents(events, { filter: 'typeof events === "undefined"' }, passthroughReader)
    expect(out).toContain('mark')
  })
})

describe('formatEvents — --format json', () => {
  it('returns JSON array of full TraceEvent objects', async () => {
    const out = await formatEvents(events, { format: 'json', type: 'mark' }, passthroughReader)
    const parsed = JSON.parse(out)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ id: 'e1', type: 'mark' })
  })

  it('combined with --filter returns only matching events as JSON', async () => {
    const out = await formatEvents(events, { format: 'json', filter: 'event.type.startsWith("redux.")' }, passthroughReader)
    const parsed = JSON.parse(out)
    expect(parsed.every((event: { type: string }) => event.type.startsWith('redux.'))).toBe(true)
  })

  it('returns empty array when no events match', async () => {
    const out = await formatEvents(events, { format: 'json', type: 'nonexistent' }, passthroughReader)
    expect(JSON.parse(out)).toEqual([])
  })
})

describe('events command rendering and filter resolution', () => {
  it('text format renders compact payload summaries (no values) and includes event id', async () => {
    const reader = mockReader({ 'assets/a.json': '{"user":"alice"}' })
    const events: TraceEvent[] = [
      {
        id: 'e1',
        type: 'redux.snapshot',
        timestamp: 100,
        payloads: { state: { kind: 'asset', format: 'json', path: 'assets/a.json', size: 17 } },
      } as any,
    ]
    const out = await formatEvents(events, { format: 'text' }, reader)
    expect(out).toContain('redux.snapshot')
    expect(out).toContain('e1')
    expect(out).toMatch(/state: json, 0\.0KB/)
    expect(out).not.toContain('alice')
  })

  it('text format renders inline payloads with <inline ...> summary', async () => {
    const reader = mockReader({})
    const events: TraceEvent[] = [
      {
        id: 'e1',
        type: 'web-storage.snapshot',
        timestamp: 100,
        payloads: { state: { kind: 'inline', value: { theme: 'dark' } } },
      } as any,
    ]
    const out = await formatEvents(events, { format: 'text' }, reader)
    expect(out).toMatch(/state: <inline/)
    expect(out).not.toContain('"theme":')
  })

  it('json format augments asset payloads with resolved value', async () => {
    const reader = mockReader({ 'assets/a.json': '{"user":"alice"}' })
    const events: TraceEvent[] = [
      {
        id: 'e1',
        type: 'redux.snapshot',
        timestamp: 100,
        payloads: { state: { kind: 'asset', format: 'json', path: 'assets/a.json', size: 17 } },
      } as any,
    ]
    const out = await formatEvents(events, { format: 'json' }, reader)
    const parsed = JSON.parse(out)
    expect(parsed[0].payloads.state).toMatchObject({
      kind: 'asset',
      format: 'json',
      path: 'assets/a.json',
      value: { user: 'alice' },
    })
  })

  it('json format does not augment binary payloads with a value field', async () => {
    const reader = mockReader({ 'assets/x.png': Buffer.from([0xff, 0xd8, 0xff]) })
    const events: TraceEvent[] = [
      {
        id: 'e1',
        type: 'playwright.screenshot',
        timestamp: 100,
        payloads: { image: { kind: 'asset', format: 'image', path: 'assets/x.png', size: 3 } },
      } as any,
    ]
    const out = await formatEvents(events, { format: 'json' }, reader)
    const parsed = JSON.parse(out)
    expect(parsed[0].payloads.image).toEqual({
      kind: 'asset',
      format: 'image',
      path: 'assets/x.png',
      size: 3,
    })
    expect('value' in parsed[0].payloads.image).toBe(false)
  })

  it('filter expressions match on resolved payload values', async () => {
    const reader = mockReader({
      'assets/a.json': '{"user":{"id":42}}',
      'assets/b.json': '{"user":{"id":7}}',
    })
    const events: TraceEvent[] = [
      { id: 'e1', type: 'redux.snapshot', timestamp: 1, payloads: { state: { kind: 'asset', format: 'json', path: 'assets/a.json', size: 18 } } } as any,
      { id: 'e2', type: 'redux.snapshot', timestamp: 2, payloads: { state: { kind: 'asset', format: 'json', path: 'assets/b.json', size: 18 } } } as any,
    ]
    const out = await formatEvents(events, { format: 'json', filter: 'event.payloads.state.value.user.id === 42' }, reader)
    expect(JSON.parse(out).map((e: any) => e.id)).toEqual(['e1'])
  })

  it('filter eval errors surface to stderr, not silent false', async () => {
    const reader = mockReader({})
    const events: TraceEvent[] = [
      { id: 'e1', type: 'mark', timestamp: 1, metadata: { label: 'x' } } as any,
    ]
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await formatEvents(events, { format: 'json', filter: 'this.is.bogus()' }, reader)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('filter error'))
    errSpy.mockRestore()
  })

  it('--payload limits resolution and rendering', async () => {
    const reader = mockReader({
      'assets/a.json': '{"x":1}',
      'assets/b.json': '{"y":2}',
    })
    const resolved: string[] = []
    reader.resolvePayload = async (ref: any) => {
      resolved.push(ref.path)
      const content = mockFiles[ref.path]
      return JSON.parse(content as string)
    }
    const events: TraceEvent[] = [
      {
        id: 'e1',
        type: 'solid-devtools.capture',
        timestamp: 1,
        payloads: {
          structure: { kind: 'asset', format: 'json', path: 'assets/a.json', size: 7 },
          dgraph:    { kind: 'asset', format: 'json', path: 'assets/b.json', size: 7 },
        },
      } as any,
    ]
    const out = await formatEvents(events, { format: 'json', payload: ['dgraph'] }, reader)
    expect(resolved).toEqual(['assets/b.json'])
    const parsed = JSON.parse(out)
    expect(parsed[0].payloads.dgraph.value).toEqual({ y: 2 })
    expect(parsed[0].payloads.structure).toBeUndefined()
  })
})

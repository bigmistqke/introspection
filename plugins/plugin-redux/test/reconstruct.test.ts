import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reconstruct, ReduxError } from '../src/reconstruct.js'
import type { TraceEvent, SessionReader, PayloadRef } from '@introspection/types'

describe('reconstruct', () => {
  let reader: SessionReader
  let events: TraceEvent[]

  beforeEach(() => {
    events = []
    reader = {
      async resolvePayload(ref: PayloadRef): Promise<unknown> {
        if ('path' in ref && ref.path === 'snapshot-0.json') {
          return { count: 0, items: [] }
        }
        throw new Error(`Unknown ref: ${JSON.stringify(ref)}`)
      },
    } as unknown as SessionReader
  })

  it('throws ReduxError for non-existent event', async () => {
    await expect(reconstruct({ events, reader, eventId: 'unknown' }))
      .rejects.toThrow(ReduxError)
  })

  it('throws ReduxError when no snapshot exists before event', async () => {
    events.push({
      id: 'dispatch-0',
      timestamp: 100,
      type: 'redux.dispatch',
      metadata: { action: 'INCREMENT', diff: [{ op: 'replace', path: '/count', value: 1 }] },
    } as TraceEvent)

    await expect(reconstruct({ events, reader, eventId: 'dispatch-0' }))
      .rejects.toThrow(ReduxError)
  })

  it('returns same state for non-dispatch events', async () => {
    events.push({
      id: 'snapshot-0',
      timestamp: 0,
      type: 'redux.snapshot',
      payloads: { state: { kind: 'asset', format: 'json', path: 'snapshot-0.json' } },
    } as TraceEvent)

    events.push({
      id: 'console-0',
      timestamp: 100,
      type: 'console',
      metadata: { level: 'log', args: ['test'] },
    } as TraceEvent)

    const result = await reconstruct({ events, reader, eventId: 'console-0' })
    expect(result.beforeState).toEqual({ count: 0, items: [] })
    expect(result.afterState).toEqual({ count: 0, items: [] })
  })

  it('reconstructs state before and after dispatch', async () => {
    events.push({
      id: 'snapshot-0',
      timestamp: 0,
      type: 'redux.snapshot',
      payloads: { state: { kind: 'asset', format: 'json', path: 'snapshot-0.json' } },
    } as TraceEvent)

    events.push({
      id: 'dispatch-0',
      timestamp: 100,
      type: 'redux.dispatch',
      metadata: {
        action: 'INCREMENT',
        diff: [{ op: 'replace', path: '/count', value: 1 }],
      },
    } as TraceEvent)

    const result = await reconstruct({ events, reader, eventId: 'dispatch-0' })
    expect(result.beforeState).toEqual({ count: 0, items: [] })
    expect(result.afterState).toEqual({ count: 1, items: [] })
  })

  it('accumulates patches from multiple dispatches', async () => {
    events.push({
      id: 'snapshot-0',
      timestamp: 0,
      type: 'redux.snapshot',
      payloads: { state: { kind: 'asset', format: 'json', path: 'snapshot-0.json' } },
    } as TraceEvent)

    events.push({
      id: 'dispatch-0',
      timestamp: 100,
      type: 'redux.dispatch',
      metadata: { action: 'INCREMENT', diff: [{ op: 'replace', path: '/count', value: 1 }] },
    } as TraceEvent)

    events.push({
      id: 'dispatch-1',
      timestamp: 200,
      type: 'redux.dispatch',
      metadata: { action: 'ADD_ITEM', diff: [{ op: 'add', path: '/items/0', value: 'item' }] },
    } as TraceEvent)

    const result = await reconstruct({ events, reader, eventId: 'dispatch-1' })
    expect(result.beforeState).toEqual({ count: 1, items: [] })
    expect(result.afterState).toEqual({ count: 1, items: ['item'] })
  })

  it('handles dispatch with empty diff', async () => {
    events.push({
      id: 'snapshot-0',
      timestamp: 0,
      type: 'redux.snapshot',
      payloads: { state: { kind: 'asset', format: 'json', path: 'snapshot-0.json' } },
    } as TraceEvent)

    events.push({
      id: 'dispatch-0',
      timestamp: 100,
      type: 'redux.dispatch',
      metadata: { action: 'NOOP', diff: [] },
    } as TraceEvent)

    const result = await reconstruct({ events, reader, eventId: 'dispatch-0' })
    expect(result.beforeState).toEqual({ count: 0, items: [] })
    expect(result.afterState).toEqual({ count: 0, items: [] })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reconstruct, ReduxError } from '../src/reconstruct.js'
import type { TraceEvent, AssetsAPI } from '@introspection/types'

describe('reconstruct', () => {
  let assets: AssetsAPI
  let events: TraceEvent[]

  beforeEach(() => {
    events = []
    assets = {
      async readJSON<T>(path: string): Promise<T> {
        if (path === 'snapshot-0.json') {
          return { count: 0, items: [] } as T
        }
        throw new Error(`Unknown path: ${path}`)
      },
      async readText() { return '' },
      async ls() { return [] },
      async metadata() { return undefined },
    }
  })

  it('throws ReduxError for non-existent event', async () => {
    await expect(reconstruct({ events, assets, eventId: 'unknown' }))
      .rejects.toThrow(ReduxError)
  })

  it('throws ReduxError when no snapshot exists before event', async () => {
    events.push({
      id: 'dispatch-0',
      timestamp: 100,
      type: 'redux.dispatch',
      metadata: { action: 'INCREMENT', diff: [{ op: 'replace', path: '/count', value: 1 }] },
    } as TraceEvent)

    await expect(reconstruct({ events, assets, eventId: 'dispatch-0' }))
      .rejects.toThrow(ReduxError)
  })

  it('returns same state for non-dispatch events', async () => {
    events.push({
      id: 'snapshot-0',
      timestamp: 0,
      type: 'redux.snapshot',
      assets: [{ path: 'snapshot-0.json', kind: 'json' }],
    } as TraceEvent)

    events.push({
      id: 'console-0',
      timestamp: 100,
      type: 'console',
      metadata: { level: 'log', message: 'test' },
    } as TraceEvent)

    const result = await reconstruct({ events, assets, eventId: 'console-0' })
    expect(result.beforeState).toEqual({ count: 0, items: [] })
    expect(result.afterState).toEqual({ count: 0, items: [] })
  })

  it('reconstructs state before and after dispatch', async () => {
    events.push({
      id: 'snapshot-0',
      timestamp: 0,
      type: 'redux.snapshot',
      assets: [{ path: 'snapshot-0.json', kind: 'json' }],
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

    const result = await reconstruct({ events, assets, eventId: 'dispatch-0' })
    expect(result.beforeState).toEqual({ count: 0, items: [] })
    expect(result.afterState).toEqual({ count: 1, items: [] })
  })

  it('accumulates patches from multiple dispatches', async () => {
    events.push({
      id: 'snapshot-0',
      timestamp: 0,
      type: 'redux.snapshot',
      assets: [{ path: 'snapshot-0.json', kind: 'json' }],
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

    const result = await reconstruct({ events, assets, eventId: 'dispatch-1' })
    expect(result.beforeState).toEqual({ count: 1, items: [] })
    expect(result.afterState).toEqual({ count: 1, items: ['item'] })
  })

  it('handles dispatch with empty diff', async () => {
    events.push({
      id: 'snapshot-0',
      timestamp: 0,
      type: 'redux.snapshot',
      assets: [{ path: 'snapshot-0.json', kind: 'json' }],
    } as TraceEvent)

    events.push({
      id: 'dispatch-0',
      timestamp: 100,
      type: 'redux.dispatch',
      metadata: { action: 'NOOP', diff: [] },
    } as TraceEvent)

    const result = await reconstruct({ events, assets, eventId: 'dispatch-0' })
    expect(result.beforeState).toEqual({ count: 0, items: [] })
    expect(result.afterState).toEqual({ count: 0, items: [] })
  })
})

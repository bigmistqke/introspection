import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { TraceEvent } from '@introspection/types'
import { createSessionReader } from '../src/node.js'
import { writeFixtureSession, markEvent, networkRequestEvent } from './helpers.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-read-reader-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('createSessionReader — selection & meta', () => {
  it('selects the most recent session when no id is given', async () => {
    await writeFixtureSession(dir, { id: 'old', startedAt: 100 })
    await writeFixtureSession(dir, { id: 'new', startedAt: 999 })
    const reader = await createSessionReader(dir)
    expect(reader.id).toBe('new')
  })

  it('selects a specific session when sessionId is given', async () => {
    await writeFixtureSession(dir, { id: 'a', startedAt: 100 })
    await writeFixtureSession(dir, { id: 'b', startedAt: 200 })
    const reader = await createSessionReader(dir, { sessionId: 'a' })
    expect(reader.id).toBe('a')
  })

  it('throws when no sessions exist', async () => {
    await expect(createSessionReader(dir)).rejects.toThrow(/No sessions found/)
  })

  it('exposes meta including label and plugins', async () => {
    await writeFixtureSession(dir, { id: 's', startedAt: 10, label: 'hi' })
    const reader = await createSessionReader(dir)
    expect(reader.meta.id).toBe('s')
    expect(reader.meta.label).toBe('hi')
  })
})

describe('events.ls', () => {
  it('returns all events', async () => {
    await writeFixtureSession(dir, {
      id: 's',
      startedAt: 0,
      events: [markEvent('e1', 10, 'a'), markEvent('e2', 20, 'b')],
    })
    const reader = await createSessionReader(dir)
    const events = await reader.events.ls()
    expect(events.map(event => event.id)).toEqual(['e1', 'e2'])
  })

  it('returns empty array for a session with no events', async () => {
    await writeFixtureSession(dir, { id: 's', startedAt: 0 })
    const reader = await createSessionReader(dir)
    expect(await reader.events.ls()).toEqual([])
  })
})

describe('events.query', () => {
  let reader: Awaited<ReturnType<typeof createSessionReader>>

  beforeEach(async () => {
    await writeFixtureSession(dir, {
      id: 's',
      startedAt: 0,
      events: [
        markEvent('e1', 10, 'start'),
        networkRequestEvent('e2', 20, '/api/a'),
        { id: 'e3', type: 'network.response', timestamp: 25, initiator: 'e2', metadata: { cdpRequestId: '2', cdpTimestamp: 0, requestId: '2', url: '/api/a', status: 200, headers: {} } } as TraceEvent,
        markEvent('e4', 30, 'end'),
      ],
    })
    reader = await createSessionReader(dir)
  })

  it('filters by exact type', async () => {
    const events = await reader.events.query({ type: 'mark' })
    expect(events.map(event => event.id)).toEqual(['e1', 'e4'])
  })

  it('filters by array of types', async () => {
    const events = await reader.events.query({ type: ['mark', 'network.request'] })
    expect(events.map(event => event.id)).toEqual(['e1', 'e2', 'e4'])
  })

  it('filters by type prefix with .*', async () => {
    const events = await reader.events.query({ type: 'network.*' })
    expect(events.map(event => event.id)).toEqual(['e2', 'e3'])
  })

  it('filters by since (inclusive lower bound)', async () => {
    const events = await reader.events.query({ since: 25 })
    expect(events.map(event => event.id)).toEqual(['e3', 'e4'])
  })

  it('filters by until (inclusive upper bound)', async () => {
    const events = await reader.events.query({ until: 20 })
    expect(events.map(event => event.id)).toEqual(['e1', 'e2'])
  })

  it('filters by initiator', async () => {
    const events = await reader.events.query({ initiator: 'e2' })
    expect(events.map(event => event.id)).toEqual(['e3'])
  })

  it('combines filters with AND semantics', async () => {
    const events = await reader.events.query({ type: 'network.*', since: 22 })
    expect(events.map(event => event.id)).toEqual(['e3'])
  })
})

describe('events.push + reactive watch', () => {
  it('ls.watch() yields an initial snapshot then updates on push', async () => {
    await writeFixtureSession(dir, {
      id: 's',
      startedAt: 0,
      events: [markEvent('e1', 10, 'a')],
    })
    const reader = await createSessionReader(dir)
    const iterator = reader.events.ls.watch()[Symbol.asyncIterator]()

    const initial = await iterator.next()
    expect(initial.done).toBe(false)
    expect((initial.value as TraceEvent[]).map(event => event.id)).toEqual(['e1'])

    const nextPromise = iterator.next()
    reader.events.push(markEvent('e2', 20, 'b'))
    const second = await nextPromise
    expect((second.value as TraceEvent[]).map(event => event.id)).toEqual(['e1', 'e2'])

    await iterator.return?.(undefined as unknown as TraceEvent[])
  })

  it('query.watch(filter) only yields filtered events and skips non-matching pushes', async () => {
    await writeFixtureSession(dir, {
      id: 's',
      startedAt: 0,
      events: [markEvent('e1', 10, 'a')],
    })
    const reader = await createSessionReader(dir)
    const iterator = reader.events.query.watch({ type: 'mark' })[Symbol.asyncIterator]()

    const initial = await iterator.next()
    expect((initial.value as TraceEvent[]).map(event => event.id)).toEqual(['e1'])

    // Push a non-matching event, then a matching one. The non-match still notifies,
    // but the filtered snapshot reflects only matching events. Then the matching
    // push updates the filtered set to include e3.
    const first = iterator.next()
    reader.events.push(networkRequestEvent('e2', 15, '/ignored'))
    const afterNonMatch = await first
    expect((afterNonMatch.value as TraceEvent[]).map(event => event.id)).toEqual(['e1'])

    const second = iterator.next()
    reader.events.push(markEvent('e3', 20, 'c'))
    const afterMatch = await second
    expect((afterMatch.value as TraceEvent[]).map(event => event.id)).toEqual(['e1', 'e3'])

    await iterator.return?.(undefined as unknown as TraceEvent[])
  })

  it('return() stops the watch', async () => {
    await writeFixtureSession(dir, { id: 's', startedAt: 0 })
    const reader = await createSessionReader(dir)
    const iterator = reader.events.ls.watch()[Symbol.asyncIterator]()
    await iterator.next()
    const end = await iterator.return!(undefined as unknown as TraceEvent[])
    expect(end.done).toBe(true)
  })
})

describe('resolvePayload', () => {
  it('returns the inline value verbatim', async () => {
    await writeFixtureSession(dir, { id: 's', startedAt: 0 })
    const reader = await createSessionReader(dir)
    const value = await reader.resolvePayload({ kind: 'inline', value: { hello: 'world' } })
    expect(value).toEqual({ hello: 'world' })
  })

  it('reads and parses a json asset by format', async () => {
    await writeFixtureSession(dir, {
      id: 's',
      startedAt: 0,
      assets: [{ path: 'assets/hello.json', content: '{"hello":"world"}' }],
    })
    const reader = await createSessionReader(dir)
    const value = await reader.resolvePayload({
      kind: 'asset',
      format: 'json',
      path: 'assets/hello.json',
    })
    expect(value).toEqual({ hello: 'world' })
  })

  it('returns raw bytes for binary assets', async () => {
    await writeFixtureSession(dir, {
      id: 's',
      startedAt: 0,
      assets: [{ path: 'assets/blob.bin', content: Buffer.from([1, 2, 3]) }],
    })
    const reader = await createSessionReader(dir)
    const value = await reader.resolvePayload({
      kind: 'asset',
      format: 'binary',
      path: 'assets/blob.bin',
    })
    expect(Buffer.isBuffer(value)).toBe(true)
    expect(Array.from(value as Buffer)).toEqual([1, 2, 3])
  })
})

describe('assets API', () => {
  it('ls collects AssetRefs from every event', async () => {
    await writeFixtureSession(dir, {
      id: 's',
      startedAt: 0,
      events: [
        networkRequestEvent('e1', 10, '/a', [{ path: 'assets/a1.json', kind: 'json', size: 3 }]),
        networkRequestEvent('e2', 20, '/b', [{ path: 'assets/b1.json', kind: 'json', size: 4 }]),
        markEvent('e3', 30, 'no-assets'),
      ],
    })
    const reader = await createSessionReader(dir)
    const refs = await reader.assets.ls()
    expect(refs.map(ref => ref.path)).toEqual(['assets/a1.json', 'assets/b1.json'])
  })

  it('metadata returns the ref for a path or undefined', async () => {
    await writeFixtureSession(dir, {
      id: 's',
      startedAt: 0,
      events: [
        networkRequestEvent('e1', 10, '/a', [{ path: 'assets/a1.json', kind: 'json', size: 7 }]),
      ],
    })
    const reader = await createSessionReader(dir)
    expect(await reader.assets.metadata('assets/a1.json')).toEqual({
      path: 'assets/a1.json',
      kind: 'json',
      size: 7,
    })
    expect(await reader.assets.metadata('assets/does-not-exist.json')).toBeUndefined()
  })

  it('readText reads the asset file contents', async () => {
    await writeFixtureSession(dir, {
      id: 's',
      startedAt: 0,
      assets: [{ path: 'assets/a1.json', content: '{"x":1}' }],
    })
    const reader = await createSessionReader(dir)
    expect(await reader.assets.readText('assets/a1.json')).toBe('{"x":1}')
  })

  it('readBinary returns a Uint8Array of the asset bytes', async () => {
    await writeFixtureSession(dir, {
      id: 's',
      startedAt: 0,
      assets: [{ path: 'assets/bin', content: Buffer.from([9, 8, 7]) }],
    })
    const reader = await createSessionReader(dir)
    const bytes = await reader.assets.readBinary!('assets/bin')
    expect(Array.from(bytes)).toEqual([9, 8, 7])
  })
})

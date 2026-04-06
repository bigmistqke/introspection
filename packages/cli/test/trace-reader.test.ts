import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { TraceReader } from '../src/trace-reader.js'
import type { Snapshot } from '@introspection/types'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'trace-reader-test-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function writeSession(id: string, opts: {
  label?: string
  startedAt?: number
  endedAt?: number
  events?: object[]
  snapshot?: Snapshot
} = {}) {
  const sessionDir = join(dir, id)
  await mkdir(sessionDir, { recursive: true })
  const meta = {
    version: '2', id,
    startedAt: opts.startedAt ?? 1000,
    endedAt: opts.endedAt,
    label: opts.label,
  }
  await writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta))
  const events = opts.events ? [...opts.events] : []
  if (opts.snapshot) {
    const uuid = opts.snapshot.trigger
    await mkdir(join(sessionDir, 'assets'), { recursive: true })
    await writeFile(join(sessionDir, 'assets', `${uuid}.snapshot.json`), JSON.stringify(opts.snapshot))
    events.push({
      id: `asset-${uuid}`, type: 'asset', timestamp: opts.snapshot.timestamp, source: 'agent',
      data: { path: `${uuid}.snapshot.json`, kind: 'snapshot' },
    })
  }
  const ndjson = events.map(e => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '')
  await writeFile(join(sessionDir, 'events.ndjson'), ndjson)
}

describe('TraceReader', () => {
  it('load() reads session directory and returns TraceFile', async () => {
    await writeSession('sess-abc', { label: 'my test', events: [
      { id: 'e1', type: 'mark', timestamp: 10, source: 'agent', data: { label: 'start' } },
    ]})
    const trace = await new TraceReader(dir).load('sess-abc')
    expect(trace.session.id).toBe('sess-abc')
    expect(trace.session.label).toBe('my test')
    expect(trace.events).toHaveLength(1)
    expect(trace.events[0].type).toBe('mark')
  })

  it('load() returns no test field', async () => {
    await writeSession('sess-1')
    const trace = await new TraceReader(dir).load('sess-1')
    expect((trace as Record<string, unknown>).test).toBeUndefined()
  })

  it('load() handles empty events.ndjson', async () => {
    await writeSession('sess-empty')
    const trace = await new TraceReader(dir).load('sess-empty')
    expect(trace.events).toHaveLength(0)
  })

  it('load() reads snapshot from assets/ dir via asset events', async () => {
    const snap: Snapshot = {
      timestamp: 100, trigger: 'manual', url: 'http://localhost/', dom: '<html/>', scopes: [], globals: {},
    }
    await writeSession('sess-snap', { snapshot: snap })
    const trace = await new TraceReader(dir).load('sess-snap')
    expect(trace.snapshots['manual']).toBeDefined()
    expect(trace.snapshots['manual']!.trigger).toBe('manual')
  })

  it('loadLatest() returns session with highest startedAt', async () => {
    await writeSession('sess-old', { label: 'old', startedAt: 1000 })
    await writeSession('sess-new', { label: 'new', startedAt: 9000 })
    const trace = await new TraceReader(dir).loadLatest()
    expect(trace.session.label).toBe('new')
  })

  it('listSessions() returns session directory names', async () => {
    await writeSession('sess-1')
    await writeSession('sess-2')
    const sessions = await new TraceReader(dir).listSessions()
    expect(sessions).toContain('sess-1')
    expect(sessions).toContain('sess-2')
  })

  it('readBody() reads from session assets directory', async () => {
    await writeSession('sess-body')
    const assetsDir = join(dir, 'sess-body', 'assets')
    await mkdir(assetsDir, { recursive: true })
    await writeFile(join(assetsDir, 'evt-123.body.json'), '{"ok":true}')
    const body = await new TraceReader(dir).readBody('sess-body', 'evt-123')
    expect(body).toBe('{"ok":true}')
  })

  it('throws on malformed JSON line in events.ndjson', async () => {
    const sessionDir = join(dir, 'sess-bad')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'meta.json'), JSON.stringify({ version: '2', id: 'sess-bad', startedAt: 1000 }))
    await writeFile(join(sessionDir, 'events.ndjson'), '{"id":"e1","type":"mark"}\nnot valid json\n')
    await expect(new TraceReader(dir).load('sess-bad')).rejects.toThrow()
  })

  it('filterEvents --url ignores non-network event types', async () => {
    await writeSession('sess-url', { events: [
      { id: 'e1', type: 'mark', timestamp: 10, source: 'agent', data: { label: 'x' } },
      { id: 'e2', type: 'network.request', timestamp: 20, source: 'cdp', data: { url: '/api/match', method: 'GET', headers: {} } },
      { id: 'e3', type: 'network.request', timestamp: 30, source: 'cdp', data: { url: '/other', method: 'GET', headers: {} } },
    ]})
    const trace = await new TraceReader(dir).load('sess-url')
    const result = new TraceReader(dir).filterEvents(trace, { url: '/api/match' })
    // mark event passes through (not a network type), plus the matching request
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('mark')
    expect(result[1].type).toBe('network.request')
  })

  it('throws if session directory does not exist', async () => {
    await expect(new TraceReader(dir).load('nonexistent')).rejects.toThrow()
  })

  it('loadLatest() throws if no sessions', async () => {
    await expect(new TraceReader(dir).loadLatest()).rejects.toThrow('No sessions found')
  })

  it('filterEvents() filters by type', async () => {
    await writeSession('sess-filter', { events: [
      { id: 'e1', type: 'mark', timestamp: 10, source: 'agent', data: { label: 'x' } },
      { id: 'e2', type: 'network.request', timestamp: 20, source: 'cdp', data: { url: '/api', method: 'GET', headers: {} } },
    ]})
    const trace = await new TraceReader(dir).load('sess-filter')
    const result = new TraceReader(dir).filterEvents(trace, { type: 'mark' })
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('mark')
  })
})

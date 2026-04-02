import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TraceReader } from '../src/trace-reader.js'
import { mkdtemp, writeFile, mkdir, rm, utimes } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { TraceFile } from '@introspection/types'

const sampleTrace: TraceFile = {
  version: '1',
  test: { title: 'login test', file: 'login.spec.ts', status: 'failed', duration: 2000, error: 'expected /dashboard' },
  events: [
    { id: 'e1', type: 'network.request', ts: 100, source: 'cdp', data: { url: '/api/auth', method: 'POST', headers: {} } },
    { id: 'e2', type: 'network.response', ts: 200, source: 'cdp', initiator: 'e1', data: { requestId: 'e1', url: '/api/auth', status: 401, headers: {}, bodyRef: 'e2' } },
    { id: 'e3', type: 'network.response', ts: 210, source: 'cdp', initiator: 'e1', data: { requestId: 'e1', url: '/api/users', status: 200, headers: {} } },
    { id: 'e4', type: 'network.error', ts: 220, source: 'cdp', data: { url: '/api/images', errorText: 'net::ERR_NAME_NOT_RESOLVED' } },
    { id: 'e5', type: 'js.error', ts: 300, source: 'cdp', data: { message: 'Uncaught TypeError', stack: [{ functionName: 'handleAuth', file: 'auth.ts', line: 42, column: 0 }] } },
  ],
  snapshots: {},
}

describe('TraceReader', () => {
  let dir: string

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-cli-')) })
  afterEach(async () => { await rm(dir, { recursive: true }) })

  async function writeTestTrace(name = 'login-test--w0.trace.json') {
    await writeFile(join(dir, name), JSON.stringify(sampleTrace))
  }

  it('loads the most recent trace file', async () => {
    await writeTestTrace()
    const reader = new TraceReader(dir)
    const trace = await reader.loadLatest()
    expect(trace.test.title).toBe('login test')
  })

  it('loadLatest returns the file with the newest mtime', async () => {
    const older: TraceFile = { ...sampleTrace, test: { ...sampleTrace.test, title: 'older test' } }
    const newer: TraceFile = { ...sampleTrace, test: { ...sampleTrace.test, title: 'newer test' } }
    const olderPath = join(dir, 'older--w0.trace.json')
    const newerPath = join(dir, 'newer--w0.trace.json')
    await writeFile(olderPath, JSON.stringify(older))
    await writeFile(newerPath, JSON.stringify(newer))
    // Set mtime: older file is 10 seconds in the past
    const past = new Date(Date.now() - 10000)
    await utimes(olderPath, past, past)
    const reader = new TraceReader(dir)
    const trace = await reader.loadLatest()
    expect(trace.test.title).toBe('newer test')
  })

  it('loads a specific trace by name', async () => {
    await writeTestTrace('my-test--w0.trace.json')
    const reader = new TraceReader(dir)
    const trace = await reader.load('my-test--w0')
    expect(trace.test.title).toBe('login test')
  })

  it('filters events by type', async () => {
    await writeTestTrace()
    const reader = new TraceReader(dir)
    const trace = await reader.loadLatest()
    const errors = reader.filterEvents(trace, { type: 'js.error' })
    expect(errors).toHaveLength(1)
    expect(errors[0].type).toBe('js.error')
  })

  it('filterEvents url: removes network events not matching the URL; non-network events pass through', async () => {
    await writeTestTrace()
    const reader = new TraceReader(dir)
    const trace = await reader.loadLatest()
    const filtered = reader.filterEvents(trace, { url: '/api/auth' })
    // e1 (request /api/auth) and e2 (response /api/auth) match; e3 (/api/users) and e4 (/api/images) do not
    expect(filtered.some(e => e.id === 'e1')).toBe(true)
    expect(filtered.some(e => e.id === 'e2')).toBe(true)
    expect(filtered.some(e => e.id === 'e3')).toBe(false)
    expect(filtered.some(e => e.id === 'e4')).toBe(false)
  })

  it('filterEvents failed: removes successful responses; keeps 4xx+ responses and network.error', async () => {
    await writeTestTrace()
    const reader = new TraceReader(dir)
    const trace = await reader.loadLatest()
    const failed = reader.filterEvents(trace, { failed: true })
    // 401 response kept; 200 response removed
    expect(failed.some(e => e.id === 'e2')).toBe(true)
    expect(failed.some(e => e.id === 'e3')).toBe(false)
    // network.error events are always included
    expect(failed.some(e => e.id === 'e4')).toBe(true)
  })

  it('readBody returns null for a missing file', async () => {
    const reader = new TraceReader(dir)
    const result = await reader.readBody('nonexistent')
    expect(result).toBeNull()
  })

  it('reads a sidecar body file', async () => {
    await writeTestTrace()
    await mkdir(join(dir, 'bodies'), { recursive: true })
    await writeFile(join(dir, 'bodies', 'e2.json'), '{"error":"invalid_credentials"}')
    const reader = new TraceReader(dir)
    const body = await reader.readBody('e2')
    expect(JSON.parse(body!)).toEqual({ error: 'invalid_credentials' })
  })
})

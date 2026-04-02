import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TraceReader } from '../src/trace-reader.js'
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { TraceFile } from '@introspection/types'

const sampleTrace: TraceFile = {
  version: '1',
  test: { title: 'login test', file: 'login.spec.ts', status: 'failed', duration: 2000, error: 'expected /dashboard' },
  events: [
    { id: 'e1', type: 'network.request', ts: 100, source: 'cdp', data: { url: '/api/auth', method: 'POST', headers: {} } },
    { id: 'e2', type: 'network.response', ts: 200, source: 'cdp', initiator: 'e1', data: { requestId: 'e1', url: '/api/auth', status: 401, headers: {}, bodyRef: 'e2' } },
    { id: 'e3', type: 'js.error', ts: 300, source: 'cdp', data: { message: 'Uncaught TypeError', stack: [{ functionName: 'handleAuth', file: 'auth.ts', line: 42, column: 0 }] } },
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

  it('reads a sidecar body file', async () => {
    await writeTestTrace()
    await mkdir(join(dir, 'bodies'), { recursive: true })
    await writeFile(join(dir, 'bodies', 'e2.json'), '{"error":"invalid_credentials"}')
    const reader = new TraceReader(dir)
    const body = await reader.readBody('e2')
    expect(JSON.parse(body!)).toEqual({ error: 'invalid_credentials' })
  })
})

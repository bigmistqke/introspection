import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initSessionDir,
  appendEvent,
  writeSnapshot,
  finalizeSession,
} from '../src/session-writer.js'
import type { TraceEvent, OnErrorSnapshot } from '@introspection/types'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-test-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const initParams = { id: 'sess-1', startedAt: 1000, label: 'my test' }

describe('initSessionDir', () => {
  it('creates session directory and writes meta.json', async () => {
    await initSessionDir(dir, initParams)
    const raw = await readFile(join(dir, 'sess-1', 'meta.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.id).toBe('sess-1')
    expect(parsed.version).toBe('2')
    expect(parsed.startedAt).toBe(1000)
    expect(parsed.label).toBe('my test')
  })

  it('creates an empty events.ndjson', async () => {
    await initSessionDir(dir, initParams)
    const raw = await readFile(join(dir, 'sess-1', 'events.ndjson'), 'utf-8')
    expect(raw).toBe('')
  })

  it('creates snapshots directory', async () => {
    await initSessionDir(dir, initParams)
    const entries = await readdir(join(dir, 'sess-1'))
    expect(entries).toContain('snapshots')
  })
})

describe('appendEvent', () => {
  it('appends events as newline-terminated JSON lines', async () => {
    await initSessionDir(dir, initParams)
    const e1: TraceEvent = { id: 'e1', type: 'mark', ts: 10, source: 'agent', data: { label: 'start' } }
    const e2: TraceEvent = { id: 'e2', type: 'mark', ts: 20, source: 'agent', data: { label: 'end' } }
    await appendEvent(dir, 'sess-1', e1)
    await appendEvent(dir, 'sess-1', e2)
    const raw = await readFile(join(dir, 'sess-1', 'events.ndjson'), 'utf-8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toMatchObject({ id: 'e1', type: 'mark' })
    expect(JSON.parse(lines[1])).toMatchObject({ id: 'e2', type: 'mark' })
  })

  it('writes body sidecar and adds bodySummary for network.response with bodyMap', async () => {
    await initSessionDir(dir, initParams)
    const e: TraceEvent = { id: 'e-resp', type: 'network.response', ts: 30, source: 'cdp', initiator: 'e-req', data: { requestId: 'e-req', url: '/api', status: 200, headers: {} } }
    const bodyMap = new Map([['e-resp', '{"ok":true}']])
    await appendEvent(dir, 'sess-1', e, bodyMap)
    // body sidecar written
    const body = await readFile(join(dir, 'sess-1', 'bodies', 'e-resp.json'), 'utf-8')
    expect(body).toBe('{"ok":true}')
    // bodySummary added to event in ndjson
    const raw = await readFile(join(dir, 'sess-1', 'events.ndjson'), 'utf-8')
    const parsed = JSON.parse(raw.trim())
    expect(parsed.data.bodySummary).toBeDefined()
    expect(parsed.data.bodySummary.scalars.ok).toBe(true)
  })
})

describe('writeSnapshot', () => {
  it('writes snapshot to snapshots/<trigger>.json', async () => {
    await initSessionDir(dir, initParams)
    const snap: OnErrorSnapshot = {
      ts: 100, trigger: 'manual', url: 'http://localhost/', dom: '<html/>', scopes: [], globals: {}, plugins: {},
    }
    await writeSnapshot(dir, 'sess-1', snap)
    const raw = await readFile(join(dir, 'sess-1', 'snapshots', 'manual.json'), 'utf-8')
    expect(JSON.parse(raw).trigger).toBe('manual')
  })

  it('uses trigger as filename', async () => {
    await initSessionDir(dir, initParams)
    const snap: OnErrorSnapshot = {
      ts: 100, trigger: 'js.error', url: 'http://localhost/', dom: '<html/>', scopes: [], globals: {}, plugins: {},
    }
    await writeSnapshot(dir, 'sess-1', snap)
    const entries = await readdir(join(dir, 'sess-1', 'snapshots'))
    expect(entries).toContain('js.error.json')
  })
})

describe('finalizeSession', () => {
  it('updates meta.json with endedAt', async () => {
    await initSessionDir(dir, initParams)
    await finalizeSession(dir, 'sess-1', 2000)
    const raw = await readFile(join(dir, 'sess-1', 'meta.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.endedAt).toBe(2000)
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeTrace } from '../src/trace-writer.js'
import type { Session } from '../src/server.js'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

describe('writeTrace', () => {
  let dir: string

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-')) })
  afterEach(async () => { await rm(dir, { recursive: true }) })

  it('writes a .trace.json file', async () => {
    const session: Partial<Session> = {
      id: 'sess-1',
      testTitle: 'login > redirects on success',
      testFile: 'tests/login.spec.ts',
      startedAt: Date.now() - 1000,
      events: [],
    }
    await writeTrace(session as Session, { status: 'passed' }, dir, 0)
    const files = await import('fs/promises').then(fs => fs.readdir(dir))
    expect(files.some(f => f.endsWith('.trace.json'))).toBe(true)
  })

  it('slugifies the test title in the filename', async () => {
    const session: Partial<Session> = {
      id: 'sess-2', testTitle: 'login > redirects', testFile: 'f', startedAt: Date.now(), events: []
    }
    await writeTrace(session as Session, { status: 'passed' }, dir, 1)
    const files = await import('fs/promises').then(fs => fs.readdir(dir))
    const traceFile = files.find(f => f.endsWith('.trace.json'))!
    expect(traceFile).toBe('login-redirects--w1.trace.json')
  })

  it('writes response body to a sidecar file', async () => {
    const event = {
      id: 'evt-1', type: 'network.response' as const, ts: 100, source: 'cdp' as const,
      data: { requestId: 'r1', url: '/api', status: 200, headers: {}, bodyRef: 'evt-1', bodySummary: undefined }
    }
    const session = {
      id: 'sess-3', testTitle: 'test', testFile: 'f', startedAt: Date.now(),
      events: [event as never], bodyMap: new Map([['evt-1', '{"ok":true}']])
    }
    await writeTrace(session as never, { status: 'passed' }, dir, 0)
    const bodyFile = join(dir, 'bodies', 'evt-1.json')
    const body = await readFile(bodyFile, 'utf-8')
    expect(JSON.parse(body)).toEqual({ ok: true })
  })

  it('replaces raw body with bodySummary including scalar values', async () => {
    const event = {
      id: 'evt-1', type: 'network.response' as const, ts: 100, source: 'cdp' as const,
      data: { requestId: 'r1', url: '/api', status: 200, headers: {}, bodyRef: 'evt-1' }
    }
    const body = { token: 'abc123', count: 42, nested: { x: 1 }, items: [{ id: 1 }] }
    const session = {
      id: 'sess-4', testTitle: 'test', testFile: 'f', startedAt: Date.now(),
      events: [event as never], bodyMap: new Map([['evt-1', JSON.stringify(body)]])
    }
    await writeTrace(session as never, { status: 'passed' }, dir, 0)
    const files = await import('fs/promises').then(fs => fs.readdir(dir))
    const traceFile = files.find(f => f.endsWith('.trace.json'))!
    const trace = JSON.parse(await readFile(join(dir, traceFile), 'utf-8'))
    const summary = trace.events[0].data.bodySummary
    // All top-level keys listed
    expect(summary.keys).toEqual(['token', 'count', 'nested', 'items'])
    // Scalar values captured (including non-error fields)
    expect(summary.scalars).toEqual({ token: 'abc123', count: 42 })
    // Arrays summarised, not inlined
    expect(summary.arrays.items).toEqual({ length: 1, itemKeys: ['id'] })
    // Nested objects not in scalars
    expect(summary.scalars.nested).toBeUndefined()
    // Nested object content not inlined in trace
    expect(JSON.stringify(trace)).not.toContain('"x":1')
  })

  it('captures errorFields in bodySummary', async () => {
    const event = {
      id: 'evt-1', type: 'network.response' as const, ts: 100, source: 'cdp' as const,
      data: { requestId: 'r1', url: '/api', status: 401, headers: {}, bodyRef: 'evt-1' }
    }
    const body = { error: 'unauthorized', message: 'Token expired', code: 401, extra: [1, 2] }
    const session = {
      id: 'sess-5', testTitle: 'test', testFile: 'f', startedAt: Date.now(),
      events: [event as never], bodyMap: new Map([['evt-1', JSON.stringify(body)]])
    }
    await writeTrace(session as never, { status: 'failed' }, dir, 0)
    const files = await import('fs/promises').then(fs => fs.readdir(dir))
    const traceFile = files.find(f => f.endsWith('.trace.json'))!
    const trace = JSON.parse(await readFile(join(dir, traceFile), 'utf-8'))
    const summary = trace.events[0].data.bodySummary
    expect(summary.errorFields).toMatchObject({ error: 'unauthorized', message: 'Token expired', code: 401 })
    // non-error-named fields are not captured in errorFields
    expect(summary.errorFields.extra).toBeUndefined()
  })

  it('produces empty summary for JSON array body', async () => {
    const event = {
      id: 'evt-1', type: 'network.response' as const, ts: 100, source: 'cdp' as const,
      data: { requestId: 'r1', url: '/api', status: 200, headers: {}, bodyRef: 'evt-1' }
    }
    const session = {
      id: 'sess-7', testTitle: 'test', testFile: 'f', startedAt: Date.now(),
      events: [event as never], bodyMap: new Map([['evt-1', '[1,2,3]']])
    }
    await writeTrace(session as never, { status: 'passed' }, dir, 0)
    const files = await import('fs/promises').then(fs => fs.readdir(dir))
    const traceFile = files.find(f => f.endsWith('.trace.json'))!
    const trace = JSON.parse(await readFile(join(dir, traceFile), 'utf-8'))
    expect(trace.events[0].data.bodySummary).toEqual({ keys: [], scalars: {}, arrays: {}, errorFields: {} })
  })

  it('produces empty summary for non-JSON body', async () => {
    const event = {
      id: 'evt-1', type: 'network.response' as const, ts: 100, source: 'cdp' as const,
      data: { requestId: 'r1', url: '/api', status: 200, headers: {}, bodyRef: 'evt-1' }
    }
    const session = {
      id: 'sess-6', testTitle: 'test', testFile: 'f', startedAt: Date.now(),
      events: [event as never], bodyMap: new Map([['evt-1', 'not json']])
    }
    await writeTrace(session as never, { status: 'passed' }, dir, 0)
    const files = await import('fs/promises').then(fs => fs.readdir(dir))
    const traceFile = files.find(f => f.endsWith('.trace.json'))!
    const trace = JSON.parse(await readFile(join(dir, traceFile), 'utf-8'))
    const summary = trace.events[0].data.bodySummary
    expect(summary).toEqual({ keys: [], scalars: {}, arrays: {}, errorFields: {} })
  })
})

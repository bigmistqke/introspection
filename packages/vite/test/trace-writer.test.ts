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
    expect(traceFile).toContain('login')
    expect(traceFile).toContain('w1')
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

  it('does not include body content inside the trace file events', async () => {
    const event = {
      id: 'evt-1', type: 'network.response' as const, ts: 100, source: 'cdp' as const,
      data: { requestId: 'r1', url: '/api', status: 200, headers: {}, bodyRef: 'evt-1' }
    }
    const session = {
      id: 'sess-4', testTitle: 'test', testFile: 'f', startedAt: Date.now(),
      events: [event as never], bodyMap: new Map([['evt-1', '{"secret":"value"}']])
    }
    await writeTrace(session as never, { status: 'passed' }, dir, 0)
    const files = await import('fs/promises').then(fs => fs.readdir(dir))
    const traceFile = files.find(f => f.endsWith('.trace.json'))!
    const trace = JSON.parse(await readFile(join(dir, traceFile), 'utf-8'))
    const raw = JSON.stringify(trace)
    expect(raw).not.toContain('secret')
  })
})

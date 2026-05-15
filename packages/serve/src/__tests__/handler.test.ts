import { describe, it, expect } from 'vitest'
import { createHandler } from '../index.js'
import type { StorageAdapter } from '@introspection/types'
import { TraversalError } from '@introspection/read/node'

function stubAdapter(overrides: Partial<StorageAdapter> = {}): StorageAdapter {
  return {
    async listDirectories(subPath?: string) {
      if (overrides.listDirectories) return overrides.listDirectories(subPath)
      return []
    },
    async readText(path: string) {
      if (overrides.readText) return overrides.readText(path)
      throw new Error('not found')
    },
    async readBinary(path: string) {
      if (overrides.readBinary) return overrides.readBinary(path)
      throw new Error('not found')
    },
    async readJSON<T = unknown>(path: string): Promise<T> {
      if (overrides.readJSON) return overrides.readJSON<T>(path)
      throw new Error('not found')
    },
  }
}

describe('createHandler — protocol', () => {
  it('returns null when the URL does not start with prefix', async () => {
    const handler = createHandler({ adapter: stubAdapter() })
    const response = await handler({ url: '/other/path' })
    expect(response).toBeNull()
  })

  it('GET /dirs/ calls listDirectories(undefined) and returns a JSON array', async () => {
    const calls: Array<string | undefined> = []
    const adapter = stubAdapter({
      async listDirectories(sub) { calls.push(sub); return ['run-a', 'run-b'] },
    })
    const handler = createHandler({ adapter })
    const response = await handler({ url: '/_introspect/dirs/' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('application/json')
    expect(await response!.json()).toEqual(['run-a', 'run-b'])
    expect(calls).toEqual([undefined])
  })

  it('GET /dirs/<sub> calls listDirectories with subPath', async () => {
    const calls: Array<string | undefined> = []
    const adapter = stubAdapter({
      async listDirectories(sub) { calls.push(sub); return ['sess-1'] },
    })
    const handler = createHandler({ adapter })
    const response = await handler({ url: '/_introspect/dirs/run-a' })
    expect(await response!.json()).toEqual(['sess-1'])
    expect(calls).toEqual(['run-a'])
  })

  it('GET /file/<path> calls readBinary and returns the bytes', async () => {
    const calls: string[] = []
    const adapter = stubAdapter({
      async readBinary(path) { calls.push(path); return new TextEncoder().encode('{"hello":"world"}') },
    })
    const handler = createHandler({ adapter })
    const response = await handler({ url: '/_introspect/file/run-a/meta.json' })
    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('application/json')
    expect(await response!.text()).toBe('{"hello":"world"}')
    expect(calls).toEqual(['run-a/meta.json'])
  })

  it('Content-Type is derived from file extension', async () => {
    const adapter = stubAdapter({ async readBinary() { return new Uint8Array() } })
    const handler = createHandler({ adapter })
    const cases: Array<[string, string]> = [
      ['/_introspect/file/x/events.ndjson', 'application/x-ndjson'],
      ['/_introspect/file/x/a.png', 'image/png'],
      ['/_introspect/file/x/a.jpg', 'image/jpeg'],
      ['/_introspect/file/x/a.jpeg', 'image/jpeg'],
      ['/_introspect/file/x/unknown.bin', 'application/octet-stream'],
    ]
    for (const [url, type] of cases) {
      const response = await handler({ url })
      expect(response!.headers.get('content-type')).toBe(type)
    }
  })

  it('returns 403 when the adapter throws TraversalError', async () => {
    const adapter = stubAdapter({
      async readBinary() { throw new TraversalError('nope') },
    })
    const handler = createHandler({ adapter })
    const response = await handler({ url: '/_introspect/file/../etc' })
    expect(response!.status).toBe(403)
    expect(await response!.json()).toEqual({ error: 'Forbidden' })
  })

  it('returns 404 when readBinary throws (missing file)', async () => {
    const adapter = stubAdapter({
      async readBinary() { throw new Error('ENOENT') },
    })
    const handler = createHandler({ adapter })
    const response = await handler({ url: '/_introspect/file/missing' })
    expect(response!.status).toBe(404)
  })

  it('returns 404 for unknown verb under the prefix', async () => {
    const handler = createHandler({ adapter: stubAdapter() })
    const response = await handler({ url: '/_introspect/garbage' })
    expect(response!.status).toBe(404)
  })

  it('honours a custom prefix', async () => {
    const handler = createHandler({ adapter: stubAdapter({ async listDirectories() { return ['x'] } }), prefix: '/api/trace' })
    expect(await handler({ url: '/api/trace/dirs/' })).not.toBeNull()
    expect(await handler({ url: '/_introspect/dirs/' })).toBeNull()
  })

  it('returns 500 when listDirectories throws unexpectedly (non-traversal)', async () => {
    const adapter = stubAdapter({
      async listDirectories() { throw new Error('database is on fire') },
    })
    const handler = createHandler({ adapter })
    const response = await handler({ url: '/_introspect/dirs/run-a' })
    expect(response!.status).toBe(500)
    expect(await response!.json()).toEqual({ error: 'database is on fire' })
  })
})

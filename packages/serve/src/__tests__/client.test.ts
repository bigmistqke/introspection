import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHttpReadAdapter } from '../client.js'

const calls: Array<string> = []

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString()
      calls.push(url)
      if (url.endsWith('/dirs/')) return new Response(JSON.stringify(['run-a']), { status: 200 })
      if (url.endsWith('/dirs/run-a')) return new Response(JSON.stringify(['trace-1']), { status: 200 })
      if (url.endsWith('/file/run-a/trace-1/meta.json')) return new Response('{"id":"trace-1"}', { status: 200 })
      if (url.endsWith('/file/missing')) return new Response('not found', { status: 404 })
      return new Response('', { status: 404 })
    }) as unknown as typeof globalThis.fetch,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createHttpReadAdapter', () => {
  it('listDirectories() hits /dirs/', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect')
    expect(await adapter.listDirectories()).toEqual(['run-a'])
    expect(calls).toEqual(['https://h/_introspect/dirs/'])
  })

  it('listDirectories(subPath) hits /dirs/<subPath>', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect')
    expect(await adapter.listDirectories('run-a')).toEqual(['trace-1'])
    expect(calls).toEqual(['https://h/_introspect/dirs/run-a'])
  })

  it('readText hits /file/<path>', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect')
    expect(await adapter.readText('run-a/trace-1/meta.json')).toBe('{"id":"trace-1"}')
    expect(calls).toEqual(['https://h/_introspect/file/run-a/trace-1/meta.json'])
  })

  it('readJSON parses client-side via readText', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect')
    expect(await adapter.readJSON('run-a/trace-1/meta.json')).toEqual({ id: 'trace-1' })
  })

  it('readBinary returns a Uint8Array', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect')
    const bytes = await adapter.readBinary('run-a/trace-1/meta.json')
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(bytes)).toBe('{"id":"trace-1"}')
  })

  it('listDirectories THROWS on a non-OK response (resolved decision, not [])', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const adapter = createHttpReadAdapter('https://h/_introspect')
    await expect(adapter.listDirectories()).rejects.toThrow(/listDirectories.*404/)
  })

  it('read* throws on a non-OK response', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect')
    await expect(adapter.readText('missing')).rejects.toThrow(/Failed to fetch missing: 404/)
  })

  it('strips a trailing slash from baseUrl', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect/')
    await adapter.listDirectories()
    expect(calls).toEqual(['https://h/_introspect/dirs/'])
  })
})

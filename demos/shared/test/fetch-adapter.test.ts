import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFetchAdapter } from '../src/fetch-adapter.js'

const calls: Array<string> = []
let stubFetch: typeof globalThis.fetch

beforeEach(() => {
  calls.length = 0
  stubFetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push(url)
    if (url.endsWith('/dirs/'))         return new Response(JSON.stringify(['run-a']), { status: 200 })
    if (url.endsWith('/dirs/run-a'))    return new Response(JSON.stringify(['sess-1']), { status: 200 })
    if (url.endsWith('/file/run-a/sess-1/meta.json')) return new Response('{"id":"sess-1"}', { status: 200 })
    if (url.endsWith('/file/missing')) return new Response('not found', { status: 404 })
    return new Response('', { status: 404 })
  }) as unknown as typeof globalThis.fetch
  vi.stubGlobal('fetch', stubFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createFetchAdapter', () => {
  it('listDirectories() hits /dirs/', async () => {
    const adapter = createFetchAdapter('https://h/_introspect')
    expect(await adapter.listDirectories()).toEqual(['run-a'])
    expect(calls).toEqual(['https://h/_introspect/dirs/'])
  })

  it('listDirectories(subPath) hits /dirs/<subPath>', async () => {
    const adapter = createFetchAdapter('https://h/_introspect')
    expect(await adapter.listDirectories('run-a')).toEqual(['sess-1'])
    expect(calls).toEqual(['https://h/_introspect/dirs/run-a'])
  })

  it('readText hits /file/<path>', async () => {
    const adapter = createFetchAdapter('https://h/_introspect')
    expect(await adapter.readText('run-a/sess-1/meta.json')).toBe('{"id":"sess-1"}')
    expect(calls).toEqual(['https://h/_introspect/file/run-a/sess-1/meta.json'])
  })

  it('readJSON parses client-side via readText', async () => {
    const adapter = createFetchAdapter('https://h/_introspect')
    expect(await adapter.readJSON('run-a/sess-1/meta.json')).toEqual({ id: 'sess-1' })
  })

  it('readBinary returns a Uint8Array', async () => {
    const adapter = createFetchAdapter('https://h/_introspect')
    const bytes = await adapter.readBinary('run-a/sess-1/meta.json')
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(bytes)).toBe('{"id":"sess-1"}')
  })

  it('listDirectories returns [] on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const adapter = createFetchAdapter('https://h/_introspect')
    expect(await adapter.listDirectories()).toEqual([])
  })

  it('read* throws on a non-OK response', async () => {
    const adapter = createFetchAdapter('https://h/_introspect')
    await expect(adapter.readText('missing')).rejects.toThrow(/Failed to fetch missing: 404/)
  })

  it('strips a trailing slash from baseUrl', async () => {
    const adapter = createFetchAdapter('https://h/_introspect/')
    await adapter.listDirectories()
    expect(calls).toEqual(['https://h/_introspect/dirs/'])
  })
})

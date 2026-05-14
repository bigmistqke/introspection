import { describe, it, expect } from 'vitest'
import { createMemoryReadAdapter } from '../src/memory.js'
import { createSessionReader } from '../src/index.js'
import { createMemoryWriteAdapter, createSessionWriter } from '@introspection/write'

describe('createMemoryReadAdapter', () => {
  it('listDirectories returns unique directories', async () => {
    const store = new Map<string, string | Uint8Array>([
      ['dir1/file.txt', 'a'],
      ['dir2/file.txt', 'b'],
      ['dir1/file2.txt', 'c'],
    ])
    const reader = createMemoryReadAdapter(store)
    const dirs = await reader.listDirectories()
    expect(dirs.sort()).toEqual(['dir1', 'dir2'])
  })

  it('readText returns string content', async () => {
    const store = new Map<string, string | Uint8Array>([['test.txt', 'hello']])
    const reader = createMemoryReadAdapter(store)
    expect(await reader.readText('test.txt')).toBe('hello')
  })

  it('readText throws for missing file', async () => {
    const reader = createMemoryReadAdapter(new Map())
    await expect(reader.readText('missing.txt')).rejects.toThrow('File not found')
  })

  it('readText throws for binary file', async () => {
    const store = new Map<string, string | Uint8Array>([['data.bin', new Uint8Array(4)]])
    const reader = createMemoryReadAdapter(store)
    await expect(reader.readText('data.bin')).rejects.toThrow('Not a text file')
  })

  it('readBinary returns Uint8Array content', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const store = new Map<string, string | Uint8Array>([['data.bin', bytes]])
    const reader = createMemoryReadAdapter(store)
    expect(await reader.readBinary('data.bin')).toEqual(bytes)
  })

  it('readBinary throws for text file', async () => {
    const store = new Map<string, string | Uint8Array>([['file.txt', 'text']])
    const reader = createMemoryReadAdapter(store)
    await expect(reader.readBinary('file.txt')).rejects.toThrow('Not a binary file')
  })

  it('readJSON parses JSON content', async () => {
    const store = new Map<string, string | Uint8Array>([['data.json', '{"foo":"bar"}']])
    const reader = createMemoryReadAdapter(store)
    expect(await reader.readJSON('data.json')).toEqual({ foo: 'bar' })
  })

  it('reflects external store mutations', async () => {
    const store = new Map<string, string | Uint8Array>()
    const reader = createMemoryReadAdapter(store)
    store.set('file.txt', 'added later')
    expect(await reader.readText('file.txt')).toBe('added later')
  })

  it('listDirectories(subPath) lists directories nested under subPath', async () => {
    const store = new Map<string, string | Uint8Array>([
      ['run-a/meta.json', '{}'],
      ['run-a/sess-1/meta.json', '{}'],
      ['run-a/sess-2/events.ndjson', ''],
      ['run-b/sess-x/meta.json', '{}'],
    ])
    const adapter = createMemoryReadAdapter(store)
    expect((await adapter.listDirectories()).sort()).toEqual(['run-a', 'run-b'])
    expect((await adapter.listDirectories('run-a')).sort()).toEqual(['sess-1', 'sess-2'])
    expect(await adapter.listDirectories('run-b')).toEqual(['sess-x'])
    expect(await adapter.listDirectories('missing')).toEqual([])
  })
})

describe('createSessionReader + createSessionWriter (memory)', () => {
  it('reads events written by createSessionWriter', async () => {
    const store = new Map<string, string | Uint8Array>()
    const writeAdapter = createMemoryWriteAdapter(store)
    const readAdapter = createMemoryReadAdapter(store)

    const writer = await createSessionWriter({ adapter: writeAdapter, id: 'run-1/test-session' })
    await writer.emit({ type: 'mark', metadata: { label: 'first', extra: { foo: 'bar' } } })
    await writer.emit({ type: 'playwright.result', metadata: {} })
    await writer.finalize()

    const reader = await createSessionReader(readAdapter, { runId: 'run-1', sessionId: 'test-session' })
    const events = await reader.events.ls()

    expect(events).toHaveLength(2)
    expect(events[0]!.type).toBe('mark')
    expect(events[1]!.type).toBe('playwright.result')
    expect(events[0]!.metadata).toEqual({ label: 'first', extra: { foo: 'bar' } })
  })

  it('appends events correctly (no duplication)', async () => {
    const store = new Map<string, string | Uint8Array>()
    const writer = await createSessionWriter({ adapter: createMemoryWriteAdapter(store), id: 'run-1/test' })

    await writer.emit({ type: 'browser.navigate', metadata: { from: '/', to: '/about' } })
    await writer.emit({ type: 'mark', metadata: { label: 'mid' } })
    await writer.emit({ type: 'playwright.result', metadata: {} })
    await writer.finalize()

    const reader = await createSessionReader(createMemoryReadAdapter(store), { runId: 'run-1', sessionId: 'test' })
    const events = await reader.events.ls()

    expect(events).toHaveLength(3)
    expect(events.map((e) => e.type)).toEqual(['browser.navigate', 'mark', 'playwright.result'])
  })
})

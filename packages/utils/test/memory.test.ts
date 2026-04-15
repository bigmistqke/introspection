import { describe, it, expect } from 'vitest'
import { createMemoryAdapters } from '../src/memory.js'
import { createSessionWriter } from '@introspection/write'
import { createSessionReader } from '@introspection/read'

describe('createMemoryAdapters', () => {
  it('creates separate reader and writer sharing same store', async () => {
    const { reader, write } = createMemoryAdapters()
    await write.writeText('test.txt', 'hello')
    const content = await reader.readText('test.txt')
    expect(content).toBe('hello')
  })

  it('listDirectories returns unique directories', async () => {
    const { reader, write } = createMemoryAdapters()
    await write.writeText('dir1/file.txt', 'a')
    await write.writeText('dir2/file.txt', 'b')
    await write.writeText('dir1/file2.txt', 'c')
    const dirs = await reader.listDirectories()
    expect(dirs.sort()).toEqual(['dir1', 'dir2'])
  })

  it('throws for missing files', async () => {
    const { reader } = createMemoryAdapters()
    await expect(reader.readText('missing.txt')).rejects.toThrow('File not found')
  })

  it('handles binary content', async () => {
    const { reader, write } = createMemoryAdapters()
    const buffer = new ArrayBuffer(8)
    const view = new Uint8Array(buffer)
    view.set([1, 2, 3, 4])
    await write.writeBinary('data.bin', buffer)
    const result = await reader.readBinary('data.bin')
    expect(result).toEqual(buffer)
  })

  it('shares store when provided', async () => {
    const store = new Map<string, string | ArrayBuffer>()
    const { reader, write } = createMemoryAdapters(store)
    await write.writeText('shared.txt', 'shared content')
    const content = await reader.readText('shared.txt')
    expect(content).toBe('shared content')
    expect(store.get('shared.txt')).toBe('shared content')
  })

  it('writeAsset stores content correctly', async () => {
    const { reader, write } = createMemoryAdapters()
    await write.writeAsset('assets/file.json', JSON.stringify({ foo: 'bar' }))
    const content = await reader.readText('assets/file.json')
    expect(JSON.parse(content)).toEqual({ foo: 'bar' })
  })

  it('appendText appends to existing file', async () => {
    const { reader, write } = createMemoryAdapters()
    await write.appendText('log.txt', 'first\n')
    await write.appendText('log.txt', 'second\n')
    const content = await reader.readText('log.txt')
    expect(content).toBe('first\nsecond\n')
  })
})

describe('memory adapter with createSessionWriter + createSessionReader', () => {
  it('writer emits events and reader can read them', async () => {
    const { reader, write } = createMemoryAdapters()
    const writer = await createSessionWriter({ adapter: write, id: 'test-session' })
    
    await writer.emit({ type: 'test.event', metadata: { foo: 'bar' } })
    await writer.emit({ type: 'another.event', metadata: { baz: 123 } })
    await writer.finalize()
    
    const sessionReader = await createSessionReader(reader, { sessionId: 'test-session' })
    const events = await sessionReader.events.ls()
    
    expect(events).toHaveLength(2)
    expect(events[0]!.type).toBe('test.event')
    expect(events[1]!.type).toBe('another.event')
    expect(events[0]!.metadata).toEqual({ foo: 'bar' })
  })

  it('appends events correctly (no duplication)', async () => {
    const { reader, write } = createMemoryAdapters()
    const writer = await createSessionWriter({ adapter: write, id: 'test' })
    
    await writer.emit({ type: 'event.1', metadata: {} })
    await writer.emit({ type: 'event.2', metadata: {} })
    await writer.emit({ type: 'event.3', metadata: {} })
    await writer.finalize()
    
    const sessionReader = await createSessionReader(reader, { sessionId: 'test' })
    const events = await sessionReader.events.ls()
    
    expect(events).toHaveLength(3)
    expect(events.map((e) => e.type)).toEqual(['event.1', 'event.2', 'event.3'])
  })
})

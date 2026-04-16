import { describe, it, expect } from 'vitest'
import { createMemoryWriteAdapter } from '../src/memory.js'

describe('createMemoryWriteAdapter', () => {
  it('writeText and readText share the same store', async () => {
    const adapter = createMemoryWriteAdapter()
    await adapter.writeText('test.txt', 'hello')
    expect(await adapter.readText('test.txt')).toBe('hello')
  })

  it('listDirectories returns unique directories', async () => {
    const adapter = createMemoryWriteAdapter()
    await adapter.writeText('dir1/file.txt', 'a')
    await adapter.writeText('dir2/file.txt', 'b')
    await adapter.writeText('dir1/file2.txt', 'c')
    const dirs = await adapter.listDirectories()
    expect(dirs.sort()).toEqual(['dir1', 'dir2'])
  })

  it('throws for missing files', async () => {
    const adapter = createMemoryWriteAdapter()
    await expect(adapter.readText('missing.txt')).rejects.toThrow('File not found')
  })

  it('handles binary content', async () => {
    const adapter = createMemoryWriteAdapter()
    const bytes = new Uint8Array([1, 2, 3, 4])
    await adapter.writeBinary!('data.bin', bytes)
    expect(await adapter.readBinary('data.bin')).toEqual(bytes)
  })

  it('accepts non-Uint8Array views (Int8Array, Buffer) for binary writes', async () => {
    const adapter = createMemoryWriteAdapter()
    const int8 = new Int8Array([1, -2, 3])
    await adapter.writeBinary!('int8.bin', int8)
    const back = await adapter.readBinary('int8.bin')
    expect(Array.from(back)).toEqual([1, 254, 3])

    const buffer = Buffer.from([10, 20, 30])
    await adapter.writeAsset('asset.bin', buffer)
    const assetBack = await adapter.readBinary('asset.bin')
    expect(Array.from(assetBack)).toEqual([10, 20, 30])
  })

  it('snapshots bytes on write (mutations to source do not affect stored data)', async () => {
    const adapter = createMemoryWriteAdapter()
    const source = new Uint8Array([1, 2, 3])
    await adapter.writeBinary!('snap.bin', source)
    source[0] = 99
    const stored = await adapter.readBinary('snap.bin')
    expect(stored[0]).toBe(1)
  })

  it('uses provided store', async () => {
    const store = new Map<string, string | Uint8Array>()
    const adapter = createMemoryWriteAdapter(store)
    await adapter.writeText('shared.txt', 'shared content')
    expect(store.get('shared.txt')).toBe('shared content')
  })

  it('writeAsset stores content', async () => {
    const adapter = createMemoryWriteAdapter()
    await adapter.writeAsset('assets/file.json', JSON.stringify({ foo: 'bar' }))
    expect(JSON.parse(await adapter.readText('assets/file.json'))).toEqual({ foo: 'bar' })
  })

  it('appendText appends to existing file', async () => {
    const adapter = createMemoryWriteAdapter()
    await adapter.appendText('log.txt', 'first\n')
    await adapter.appendText('log.txt', 'second\n')
    expect(await adapter.readText('log.txt')).toBe('first\nsecond\n')
  })
})

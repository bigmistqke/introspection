import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createNodeAdapter } from '../src/node.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-read-adapter-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('createNodeAdapter', () => {
  it('listDirectories returns subdirectory names only', async () => {
    await mkdir(join(dir, 'session-a'))
    await mkdir(join(dir, 'session-b'))
    await writeFile(join(dir, 'not-a-session'), 'ignored')

    const adapter = createNodeAdapter(dir)
    const directories = await adapter.listDirectories()
    expect(directories.sort()).toEqual(['session-a', 'session-b'])
  })

  it('listDirectories returns [] when the directory does not exist', async () => {
    const adapter = createNodeAdapter(join(dir, 'missing'))
    expect(await adapter.listDirectories()).toEqual([])
  })

  it('readText reads a UTF-8 file relative to base directory', async () => {
    await mkdir(join(dir, 's'))
    await writeFile(join(dir, 's', 'meta.json'), '{"x":1}')
    const adapter = createNodeAdapter(dir)
    expect(await adapter.readText('s/meta.json')).toBe('{"x":1}')
  })

  it('readBinary returns a Uint8Array of the file bytes', async () => {
    await mkdir(join(dir, 's'))
    await writeFile(join(dir, 's', 'data.bin'), Buffer.from([1, 2, 3, 255]))
    const adapter = createNodeAdapter(dir)
    const bytes = await adapter.readBinary!('s/data.bin')
    expect(Array.from(bytes)).toEqual([1, 2, 3, 255])
  })

  it('listDirectories(subPath) lists directories nested under subPath', async () => {
    await mkdir(join(dir, 'run-a', 'sess-1'), { recursive: true })
    await mkdir(join(dir, 'run-a', 'sess-2'), { recursive: true })
    await writeFile(join(dir, 'run-a', 'meta.json'), '{}')
    const adapter = createNodeAdapter(dir)
    expect((await adapter.listDirectories('run-a')).sort()).toEqual(['sess-1', 'sess-2'])
  })

  it('listDirectories(subPath) returns [] when subPath does not exist', async () => {
    const adapter = createNodeAdapter(dir)
    expect(await adapter.listDirectories('nope')).toEqual([])
  })
})

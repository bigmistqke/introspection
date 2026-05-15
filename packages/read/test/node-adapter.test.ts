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
    await mkdir(join(dir, 'trace-a'))
    await mkdir(join(dir, 'trace-b'))
    await writeFile(join(dir, 'not-a-trace'), 'ignored')

    const adapter = createNodeAdapter(dir)
    const directories = await adapter.listDirectories()
    expect(directories.sort()).toEqual(['trace-a', 'trace-b'])
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

describe('node convenience wrappers', () => {
  it('listRuns(dir) and listTraces(dir, runId) read the on-disk hierarchy', async () => {
    const { writeFixtureRun } = await import('./helpers.js')
    await writeFixtureRun(dir, {
      id: 'run-1', startedAt: 200, status: 'passed',
      traces: [{ id: 'sess-a', startedAt: 210, project: 'p' }],
    })
    const { listRuns, listTraces } = await import('../src/node.js')
    const runs = await listRuns(dir)
    expect(runs.map(r => r.id)).toEqual(['run-1'])
    expect(runs[0].traceCount).toBe(1)
    const traces = await listTraces(dir, 'run-1')
    expect(traces.map(s => s.id)).toEqual(['sess-a'])
    expect(traces[0].project).toBe('p')
  })
})

describe('createNodeAdapter — traversal guard', () => {
  it('throws TraversalError on .. in listDirectories', async () => {
    const adapter = createNodeAdapter(dir)
    await expect(adapter.listDirectories('..')).rejects.toThrow(/escapes base directory/)
  })

  it('throws TraversalError on absolute path in listDirectories', async () => {
    const adapter = createNodeAdapter(dir)
    await expect(adapter.listDirectories('/etc')).rejects.toThrow(/escapes base directory/)
  })

  it('throws TraversalError on .. in readText', async () => {
    const adapter = createNodeAdapter(dir)
    await expect(adapter.readText('../secret.txt')).rejects.toThrow(/escapes base directory/)
  })

  it('throws TraversalError on absolute path in readText', async () => {
    const adapter = createNodeAdapter(dir)
    await expect(adapter.readText('/etc/passwd')).rejects.toThrow(/escapes base directory/)
  })

  it('throws TraversalError on traversal inside compound path in readBinary', async () => {
    const adapter = createNodeAdapter(dir)
    await expect(adapter.readBinary('safe/../../escape')).rejects.toThrow(/escapes base directory/)
  })

  it('throws TraversalError on .. in readJSON', async () => {
    const adapter = createNodeAdapter(dir)
    await expect(adapter.readJSON('../other.json')).rejects.toThrow(/escapes base directory/)
  })

  it('errors are TraversalError instances (name)', async () => {
    const adapter = createNodeAdapter(dir)
    await expect(adapter.readText('../x')).rejects.toMatchObject({ name: 'TraversalError' })
  })

  it('valid nested paths still work', async () => {
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'sub', 'x.txt'), 'ok')
    const adapter = createNodeAdapter(dir)
    expect(await adapter.readText('sub/x.txt')).toBe('ok')
    expect(await adapter.listDirectories('sub')).toEqual([])
  })

  it("treats '.' as the base directory itself (no escape)", async () => {
    await mkdir(join(dir, 'a'))
    await mkdir(join(dir, 'b'))
    const adapter = createNodeAdapter(dir)
    expect((await adapter.listDirectories('.')).sort()).toEqual(['a', 'b'])
  })

  it("accepts './'-prefixed paths that stay inside the base", async () => {
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'sub', 'x.txt'), 'ok')
    const adapter = createNodeAdapter(dir)
    expect(await adapter.readText('./sub/x.txt')).toBe('ok')
  })
})

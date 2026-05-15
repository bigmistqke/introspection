import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { serve } from '../node.js'
import type { Server } from 'http'

let server: Server | undefined
let dir: string | undefined

afterEach(async () => {
  await new Promise<void>((resolveFn) => server?.close(() => resolveFn()))
  server = undefined
  if (dir) {
    await rm(dir, { recursive: true, force: true })
    dir = undefined
  }
})

describe('serve() node helper', () => {
  it('serves a directory tree end-to-end over HTTP', async () => {
    dir = await mkdtemp(join(tmpdir(), 'introspect-serve-'))
    await mkdir(join(dir, 'run-1', 'sess-1'), { recursive: true })
    await writeFile(join(dir, 'run-1', 'meta.json'), '{"version":"1","id":"run-1","startedAt":1}')
    await writeFile(join(dir, 'run-1', 'sess-1', 'meta.json'), '{"version":"2","id":"sess-1","startedAt":1}')

    server = serve({ directory: dir, port: 0, host: '127.0.0.1' })
    await new Promise<void>((r) => server!.on('listening', r))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const rootList = await fetch(`http://127.0.0.1:${port}/_introspect/dirs/`).then((r) => r.json())
    expect(rootList).toEqual(['run-1'])

    const runList = await fetch(`http://127.0.0.1:${port}/_introspect/dirs/run-1`).then((r) => r.json())
    expect(runList).toEqual(['sess-1'])

    const meta = await fetch(`http://127.0.0.1:${port}/_introspect/file/run-1/sess-1/meta.json`).then((r) => r.json())
    expect(meta).toMatchObject({ version: '2', id: 'sess-1' })
  })
})

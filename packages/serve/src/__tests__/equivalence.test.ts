import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createHandler } from '../index.js'
import { createNodeAdapter } from '@introspection/read/node'
import { createTraceReader, listRuns, listTraces } from '@introspection/read'
import { createHttpReadAdapter } from '../client.js'

const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'introspect',
)

const PREFIX = '/_introspect'
const BASE = `http://localhost${PREFIX}`

beforeEach(() => {
  const nodeAdapter = createNodeAdapter(fixtureDir)
  const handler = createHandler({ adapter: nodeAdapter, prefix: PREFIX })

  // Stub global fetch: turn the URL into the request shape createHandler expects.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    if (!url.startsWith('http://localhost')) {
      throw new Error(`Unexpected fetch in equivalence test: ${url}`)
    }
    const parsed = new URL(url)
    const path = parsed.pathname + parsed.search
    const response = await handler({ url: path })
    if (response === null) return new Response('', { status: 404 })
    return response
  }) as unknown as typeof globalThis.fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

let runId: string
beforeAll(async () => {
  const runs = await listRuns(createNodeAdapter(fixtureDir))
  runId = runs[0].id
})

describe('createHttpReadAdapter ≡ createNodeAdapter through createHandler', () => {
  it('listRuns returns identical results', async () => {
    const fs = await listRuns(createNodeAdapter(fixtureDir))
    const http = await listRuns(createHttpReadAdapter(BASE))
    expect(http).toEqual(fs)
  })

  it('listTraces returns identical results for a run', async () => {
    const fs = await listTraces(createNodeAdapter(fixtureDir), runId)
    const http = await listTraces(createHttpReadAdapter(BASE), runId)
    expect(http).toEqual(fs)
  })

  it('createTraceReader.meta is identical', async () => {
    const fs = await createTraceReader(createNodeAdapter(fixtureDir), { runId })
    const http = await createTraceReader(createHttpReadAdapter(BASE), { runId })
    expect(http.meta).toEqual(fs.meta)
  })

  it('createTraceReader.events.ls() is identical', async () => {
    const fs = await createTraceReader(createNodeAdapter(fixtureDir), { runId })
    const http = await createTraceReader(createHttpReadAdapter(BASE), { runId })
    expect(await http.events.ls()).toEqual(await fs.events.ls())
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { initSessionDir, appendEvent, writeAsset, finalizeSession, summariseBody } from '../src/session-writer.js'
import type { TraceEvent } from '@introspection/types'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-sw-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const initParams = { id: 'sess-1', startedAt: 1000, label: 'my test' }

describe('initSessionDir', () => {
  it('creates session directory, meta.json, and empty events.ndjson', async () => {
    await initSessionDir(dir, initParams)
    const meta = JSON.parse(await readFile(join(dir, 'sess-1', 'meta.json'), 'utf-8'))
    expect(meta.id).toBe('sess-1')
    expect(meta.version).toBe('2')
    expect(meta.startedAt).toBe(1000)
    const ndjson = await readFile(join(dir, 'sess-1', 'events.ndjson'), 'utf-8')
    expect(ndjson).toBe('')
  })

  it('creates assets directory', async () => {
    await initSessionDir(dir, initParams)
    const entries = await readdir(join(dir, 'sess-1'))
    expect(entries).toContain('assets')
  })

  it('writes plugin metadata to meta.json when provided', async () => {
    await initSessionDir(dir, {
      ...initParams,
      plugins: [
        {
          name: 'js-errors',
          description: 'Captures errors',
          events: { 'js.error': 'Uncaught exception' },
          options: { pauseOnExceptions: { description: 'Pause mode', value: 'uncaught' } },
        },
      ],
    })
    const meta = JSON.parse(await readFile(join(dir, 'sess-1', 'meta.json'), 'utf-8'))
    expect(meta.plugins).toHaveLength(1)
    expect(meta.plugins[0].name).toBe('js-errors')
    expect(meta.plugins[0].events['js.error']).toBe('Uncaught exception')
    expect(meta.plugins[0].options.pauseOnExceptions.value).toBe('uncaught')
  })

  it('omits plugins from meta.json when not provided', async () => {
    await initSessionDir(dir, initParams)
    const meta = JSON.parse(await readFile(join(dir, 'sess-1', 'meta.json'), 'utf-8'))
    expect(meta.plugins).toBeUndefined()
  })
})

describe('appendEvent', () => {
  it('appends events as newline-terminated JSON lines', async () => {
    await initSessionDir(dir, initParams)
    const e1: TraceEvent = { id: 'e1', type: 'mark', timestamp: 10, source: 'agent', data: { label: 'start' } }
    const e2: TraceEvent = { id: 'e2', type: 'mark', timestamp: 20, source: 'agent', data: { label: 'end' } }
    await appendEvent(dir, 'sess-1', e1)
    await appendEvent(dir, 'sess-1', e2)
    const lines = (await readFile(join(dir, 'sess-1', 'events.ndjson'), 'utf-8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toMatchObject({ id: 'e1' })
    expect(JSON.parse(lines[1])).toMatchObject({ id: 'e2' })
  })
})

describe('writeAsset', () => {
  it('writes content to assets/<uuid>.<kind>.json and returns the relative path', async () => {
    await initSessionDir(dir, initParams)
    const path = await writeAsset({ directory: dir, name: 'sess-1', kind: 'body', content: '{"ok":true}', metadata: { timestamp: 10 } })
    expect(path).toMatch(/^assets\/[a-f0-9]+\.body\.json$/)
    const content = await readFile(join(dir, 'sess-1', path), 'utf-8')
    expect(content).toBe('{"ok":true}')
  })

  it('appends an asset event to events.ndjson', async () => {
    await initSessionDir(dir, initParams)
    const path = await writeAsset({ directory: dir, name: 'sess-1', kind: 'snapshot', content: '{}', metadata: { timestamp: 50, trigger: 'js.error', url: '/login', scopeCount: 2 } })
    const lines = (await readFile(join(dir, 'sess-1', 'events.ndjson'), 'utf-8')).trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    const event = JSON.parse(lines[0])
    expect(event.type).toBe('asset')
    expect(event.timestamp).toBe(50)
    expect(event.data.path).toBe(path)
    expect(event.data.kind).toBe('snapshot')
    expect(event.data.trigger).toBe('js.error')
    expect(event.data.scopeCount).toBe(2)
  })

  it('generates unique paths for multiple assets of the same kind', async () => {
    await initSessionDir(dir, initParams)
    const p1 = await writeAsset({ directory: dir, name: 'sess-1', kind: 'snapshot', content: '{"a":1}', metadata: { timestamp: 1 } })
    const p2 = await writeAsset({ directory: dir, name: 'sess-1', kind: 'snapshot', content: '{"b":2}', metadata: { timestamp: 2 } })
    expect(p1).not.toBe(p2)
  })

  it('filename contains the kind segment', async () => {
    await initSessionDir(dir, initParams)
    const path = await writeAsset({ directory: dir, name: 'sess-1', kind: 'webgl-state', content: '{}', metadata: { timestamp: 0 } })
    expect(path).toContain('.webgl-state.json')
  })

  it('writeAsset emits asset event with source: plugin when passed', async () => {
    await initSessionDir(dir, { id: 'sid', startedAt: 0 })
    await writeAsset({
      directory: dir, name: 'sid', kind: 'webgl-state',
      content: '{}', metadata: { timestamp: 10 }, source: 'plugin',
    })
    const ndjson = await readFile(join(dir, 'sid', 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').map(l => JSON.parse(l))
    const asset = events.find((e: { type: string }) => e.type === 'asset')
    expect(asset.source).toBe('plugin')
  })
})

describe('summariseBody', () => {
  it('returns empty summary for primitive arrays', () => {
    const result = summariseBody('[1,2,3]')
    expect(result.keys).toEqual([])
    expect(result.arrays).toEqual({})
  })

  it('returns empty summary for non-JSON input', () => {
    const result = summariseBody('not json at all')
    expect(result.keys).toEqual([])
  })

  it('returns empty summary for JSON null', () => {
    const result = summariseBody('null')
    expect(result.keys).toEqual([])
  })

  it('extracts itemKeys from nested object arrays', () => {
    const result = summariseBody('{"users":[{"id":1,"name":"Alice"}]}')
    expect(result.arrays.users.length).toBe(1)
    expect(result.arrays.users.itemKeys).toEqual(['id', 'name'])
  })

  it('extracts empty itemKeys from primitive arrays in objects', () => {
    const result = summariseBody('{"tags":["a","b","c"]}')
    expect(result.arrays.tags.length).toBe(3)
    expect(result.arrays.tags.itemKeys).toEqual([])
  })

  it('extracts error fields matching ERROR_KEYS', () => {
    const result = summariseBody('{"error":"bad request","code":400,"name":"test"}')
    expect(result.errorFields.error).toBe('bad request')
    expect(result.errorFields.code).toBe(400)
    expect(result.errorFields).not.toHaveProperty('name')
  })
})

describe('writeAsset (Buffer)', () => {
  it('writes Buffer content to asset file', async () => {
    await initSessionDir(dir, initParams)
    const buf = Buffer.from('binary content here')
    const path = await writeAsset({ directory: dir, name: 'sess-1', kind: 'raw', content: buf, metadata: { timestamp: 0 } })
    const content = await readFile(join(dir, 'sess-1', path))
    expect(content.toString()).toBe('binary content here')
  })
})

describe('finalizeSession', () => {
  it('updates meta.json with endedAt', async () => {
    await initSessionDir(dir, initParams)
    await finalizeSession(dir, 'sess-1', 2000)
    const meta = JSON.parse(await readFile(join(dir, 'sess-1', 'meta.json'), 'utf-8'))
    expect(meta.endedAt).toBe(2000)
  })
})

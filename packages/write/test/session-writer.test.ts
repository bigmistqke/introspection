import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createSessionWriter } from '../src/index.js'

let outDir: string

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-write-'))
})

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

async function readEvents(dir: string, sessionId: string) {
  const ndjson = await readFile(join(dir, sessionId, 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

async function readMeta(dir: string, sessionId: string) {
  return JSON.parse(await readFile(join(dir, sessionId, 'meta.json'), 'utf-8'))
}

describe('createSessionWriter', () => {
  it('creates session directory with meta.json and empty events.ndjson', async () => {
    const writer = await createSessionWriter({ outDir, id: 'session-a' })
    expect(writer.id).toBe('session-a')

    const meta = await readMeta(outDir, 'session-a')
    expect(meta.version).toBe('2')
    expect(meta.id).toBe('session-a')
    expect(typeof meta.startedAt).toBe('number')
    expect(meta.endedAt).toBeUndefined()

    const ndjson = await readFile(join(outDir, 'session-a', 'events.ndjson'), 'utf-8')
    expect(ndjson).toBe('')

    const assetsStat = await stat(join(outDir, 'session-a', 'assets'))
    expect(assetsStat.isDirectory()).toBe(true)
  })

  it('generates a UUID id when none supplied', async () => {
    const writer = await createSessionWriter({ outDir })
    expect(writer.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('persists label and plugins into meta', async () => {
    await createSessionWriter({
      outDir,
      id: 's',
      label: 'my-test',
      plugins: [{ name: 'plugin-x', description: 'x' }],
    })
    const meta = await readMeta(outDir, 's')
    expect(meta.label).toBe('my-test')
    expect(meta.plugins).toEqual([{ name: 'plugin-x', description: 'x' }])
  })

  it('throws when session directory already exists', async () => {
    await createSessionWriter({ outDir, id: 'dup' })
    await expect(createSessionWriter({ outDir, id: 'dup' })).rejects.toThrow(/already exists/)
  })
})

describe('SessionWriter.emit', () => {
  it('appends NDJSON events with generated id and relative timestamp', async () => {
    const writer = await createSessionWriter({ outDir, id: 's' })
    await writer.emit({ type: 'mark', metadata: { label: 'a' } })
    await writer.emit({ type: 'mark', metadata: { label: 'b' } })
    await writer.flush()

    const events = await readEvents(outDir, 's')
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('mark')
    expect(events[0].metadata.label).toBe('a')
    expect(events[0].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof events[0].timestamp).toBe('number')
    expect(events[0].timestamp).toBeGreaterThanOrEqual(0)
    expect(events[1].timestamp).toBeGreaterThanOrEqual(events[0].timestamp)
  })

  it('preserves event ordering under concurrent emits', async () => {
    const writer = await createSessionWriter({ outDir, id: 's' })
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        writer.emit({ type: 'mark', metadata: { label: `e${index}` } })
      )
    )
    await writer.flush()

    const events = await readEvents(outDir, 's')
    expect(events).toHaveLength(20)
    expect(events.map(event => event.metadata.label)).toEqual(
      Array.from({ length: 20 }, (_, index) => `e${index}`)
    )
  })

  it('fires on the bus synchronously with the event type', async () => {
    const writer = await createSessionWriter({ outDir, id: 's' })
    const seen: string[] = []
    writer.bus.on('mark', payload => { seen.push(payload.metadata.label) })
    await writer.emit({ type: 'mark', metadata: { label: 'one' } })
    await writer.emit({ type: 'mark', metadata: { label: 'two' } })
    expect(seen).toEqual(['one', 'two'])
  })
})

describe('SessionWriter.writeAsset', () => {
  it('writes content to assets/ and returns an AssetRef with size', async () => {
    const writer = await createSessionWriter({ outDir, id: 's' })
    const ref = await writer.writeAsset({ kind: 'json', content: '{"hello":"world"}' })

    expect(ref.kind).toBe('json')
    expect(ref.path).toMatch(/^assets\/[0-9a-f]{8}\.json$/)
    expect(ref.size).toBe(17)

    const onDisk = await readFile(join(outDir, 's', ref.path), 'utf-8')
    expect(onDisk).toBe('{"hello":"world"}')
  })

  it('respects the ext option', async () => {
    const writer = await createSessionWriter({ outDir, id: 's' })
    const ref = await writer.writeAsset({ kind: 'html', content: '<h1>x</h1>', ext: 'html' })
    expect(ref.path.endsWith('.html')).toBe(true)
  })

  it('writes binary Buffers and reports byte length', async () => {
    const writer = await createSessionWriter({ outDir, id: 's' })
    const buffer = Buffer.from([1, 2, 3, 4, 5])
    const ref = await writer.writeAsset({ kind: 'binary', content: buffer, ext: 'bin' })
    expect(ref.size).toBe(5)

    const onDisk = await readFile(join(outDir, 's', ref.path))
    expect(Array.from(onDisk)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('SessionWriter.track and flush', () => {
  it('flush awaits tracked async operations', async () => {
    const writer = await createSessionWriter({ outDir, id: 's' })
    let completed = false
    writer.track(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
      await writer.emit({ type: 'mark', metadata: { label: 'late' } })
      completed = true
    })

    await writer.flush()
    expect(completed).toBe(true)

    const events = await readEvents(outDir, 's')
    expect(events).toHaveLength(1)
    expect(events[0].metadata.label).toBe('late')
  })

  it('flush drains nested tracked operations', async () => {
    const writer = await createSessionWriter({ outDir, id: 's' })
    let innerDone = false
    writer.track(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      writer.track(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        innerDone = true
      })
    })
    await writer.flush()
    expect(innerDone).toBe(true)
  })
})

describe('SessionWriter.timestamp', () => {
  it('returns ms since session start', async () => {
    const writer = await createSessionWriter({ outDir, id: 's' })
    const first = writer.timestamp()
    await new Promise(resolve => setTimeout(resolve, 25))
    const second = writer.timestamp()
    expect(second).toBeGreaterThanOrEqual(first + 20)
  })
})

describe('SessionWriter.finalize', () => {
  it('writes endedAt into meta.json', async () => {
    const writer = await createSessionWriter({ outDir, id: 's' })
    await writer.finalize()
    const meta = await readMeta(outDir, 's')
    expect(typeof meta.endedAt).toBe('number')
    expect(meta.endedAt).toBeGreaterThanOrEqual(meta.startedAt)
  })

  it('emits a detach bus event before draining', async () => {
    const writer = await createSessionWriter({ outDir, id: 's' })
    let detached: { trigger: string; timestamp: number } | null = null
    writer.bus.on('detach', payload => { detached = payload })
    await writer.finalize()
    expect(detached).not.toBeNull()
    expect(detached!.trigger).toBe('detach')
    expect(typeof detached!.timestamp).toBe('number')
  })

  it('awaits outstanding tracked work before finalizing', async () => {
    const writer = await createSessionWriter({ outDir, id: 's' })
    writer.track(async () => {
      await new Promise(resolve => setTimeout(resolve, 30))
      await writer.emit({ type: 'mark', metadata: { label: 'tail' } })
    })
    await writer.finalize()
    const events = await readEvents(outDir, 's')
    expect(events).toHaveLength(1)
    expect(events[0].metadata.label).toBe('tail')
  })
})

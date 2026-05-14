import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createSessionWriter } from '@introspection/write'
import { summaryReporter } from '../src/index.js'

let outDir: string

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-summary-'))
})

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

describe('summaryReporter', () => {
  it('appends one JSON line per test to outFile with the default shape', async () => {
    const writer = await createSessionWriter({
      outDir,
      id: 's',
      reporters: [summaryReporter({ outFile: 'tests.jsonl' })],
    })
    await writer.emit({ type: 'test.start', metadata: { label: 'one', titlePath: ['suite', 'one'] } })
    await writer.emit({ type: 'mark', metadata: { label: 'a' } })
    await writer.emit({ type: 'test.end', metadata: { label: 'one', titlePath: ['suite', 'one'], status: 'passed', duration: 100 } })

    await writer.emit({ type: 'test.start', metadata: { label: 'two', titlePath: ['suite', 'two'] } })
    await writer.emit({ type: 'test.end', metadata: { label: 'two', titlePath: ['suite', 'two'], status: 'failed', duration: 200, error: 'nope' } })

    await writer.finalize()

    const contents = await readFile(join(outDir, 'tests.jsonl'), 'utf-8')
    const lines = contents.trim().split('\n').map(line => JSON.parse(line))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      titlePath: ['suite', 'one'],
      status: 'passed',
      duration: 100,
      error: null,
      eventCount: 3,
    })
    expect(typeof lines[0].startedAt).toBe('number')
    expect(typeof lines[0].endedAt).toBe('number')
    expect(lines[1]).toMatchObject({
      titlePath: ['suite', 'two'],
      status: 'failed',
      duration: 200,
      error: 'nope',
      eventCount: 2,
    })
    expect(typeof lines[1].startedAt).toBe('number')
    expect(typeof lines[1].endedAt).toBe('number')
  })

  it('uses a custom format projector when provided', async () => {
    const writer = await createSessionWriter({
      outDir,
      id: 's',
      reporters: [summaryReporter({
        outFile: 'custom.jsonl',
        format: (info) => ({ path: info.titlePath.join(' > '), ok: info.status === 'passed' }),
      })],
    })
    await writer.emit({ type: 'test.start', metadata: { label: 't', titlePath: ['s', 't'] } })
    await writer.emit({ type: 'test.end', metadata: { label: 't', titlePath: ['s', 't'], status: 'passed', duration: 1 } })
    await writer.finalize()

    const contents = await readFile(join(outDir, 'custom.jsonl'), 'utf-8')
    const lines = contents.trim().split('\n').map(line => JSON.parse(line))
    expect(lines).toEqual([{ path: 's > t', ok: true }])
  })

  // POSIX O_APPEND guarantees atomic appends below PIPE_BUF (~4KB); summary
  // lines are well under that. This test is POSIX-only in spirit — on Windows
  // the atomicity guarantee differs. The repo currently targets POSIX dev/CI.
  it('produces non-interleaved lines when two writers append concurrently', async () => {
    async function runWriter(id: string, label: string, count: number) {
      const writer = await createSessionWriter({
        outDir,
        id,
        reporters: [summaryReporter({ outFile: 'tests.jsonl' })],
      })
      for (let index = 0; index < count; index++) {
        await writer.emit({ type: 'test.start', metadata: { label: `${label}-${index}`, titlePath: [label, String(index)] } })
        await writer.emit({ type: 'test.end', metadata: { label: `${label}-${index}`, titlePath: [label, String(index)], status: 'passed', duration: 1 } })
      }
      await writer.finalize()
    }

    await Promise.all([
      runWriter('a', 'alpha', 50),
      runWriter('b', 'beta', 50),
    ])

    const contents = await readFile(join(outDir, 'tests.jsonl'), 'utf-8')
    const lines = contents.trim().split('\n')
    expect(lines).toHaveLength(100)
    const parsed = lines.map(line => JSON.parse(line))
    const alpha = parsed.filter(p => p.titlePath[0] === 'alpha')
    const beta = parsed.filter(p => p.titlePath[0] === 'beta')
    expect(alpha).toHaveLength(50)
    expect(beta).toHaveLength(50)
  })
})

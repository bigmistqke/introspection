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
  })
})

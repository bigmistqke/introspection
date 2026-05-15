import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { listRuns, listTraces } from '../src/index.js'
import { createNodeAdapter } from '../src/node.js'
import { writeFixtureRun } from './helpers.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-read-list-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('listRuns', () => {
  it('returns empty array when no runs exist', async () => {
    expect(await listRuns(createNodeAdapter(dir))).toEqual([])
  })

  it('returns empty array when directory does not exist', async () => {
    expect(await listRuns(createNodeAdapter(join(dir, 'missing')))).toEqual([])
  })

  it('reads runs, orders by startedAt descending, counts traces', async () => {
    await writeFixtureRun(dir, {
      id: 'old', startedAt: 100, endedAt: 150, status: 'passed', branch: 'main',
      traces: [{ id: 's1', startedAt: 110 }],
    })
    await writeFixtureRun(dir, {
      id: 'new', startedAt: 300, status: 'failed',
      traces: [{ id: 's1', startedAt: 310 }, { id: 's2', startedAt: 320 }],
    })

    const runs = await listRuns(createNodeAdapter(dir))
    expect(runs.map(run => run.id)).toEqual(['new', 'old'])
    expect(runs[0]).toMatchObject({ id: 'new', status: 'failed', traceCount: 2 })
    expect(runs[1]).toMatchObject({ id: 'old', status: 'passed', branch: 'main', traceCount: 1 })
  })

  it('skips runs with unreadable meta.json', async () => {
    await writeFixtureRun(dir, { id: 'ok', startedAt: 100 })
    await mkdir(join(dir, 'broken'))
    await writeFile(join(dir, 'broken', 'meta.json'), 'not-json{')

    const runs = await listRuns(createNodeAdapter(dir))
    expect(runs.map(run => run.id)).toEqual(['ok'])
  })
})

describe('listTraces', () => {
  it('returns traces of a run, ordered by startedAt descending', async () => {
    await writeFixtureRun(dir, {
      id: 'run', startedAt: 100,
      traces: [
        { id: 'old', startedAt: 110, project: 'browser-mobile', status: 'passed' },
        { id: 'new', startedAt: 130, project: 'browser-desktop', status: 'failed' },
        { id: 'mid', startedAt: 120 },
      ],
    })

    const traces = await listTraces(createNodeAdapter(dir), 'run')
    expect(traces.map(s => s.id)).toEqual(['new', 'mid', 'old'])
    expect(traces[0]).toMatchObject({ id: 'new', project: 'browser-desktop', status: 'failed' })
  })

  it('computes duration when endedAt is present', async () => {
    await writeFixtureRun(dir, {
      id: 'run', startedAt: 100,
      traces: [
        { id: 'done', startedAt: 100, endedAt: 450 },
        { id: 'open', startedAt: 500 },
      ],
    })

    const traces = await listTraces(createNodeAdapter(dir), 'run')
    expect(traces.find(s => s.id === 'done')!.duration).toBe(350)
    expect(traces.find(s => s.id === 'open')!.duration).toBeUndefined()
  })

  it('returns empty array for a run with no traces', async () => {
    await writeFixtureRun(dir, { id: 'run', startedAt: 100 })
    expect(await listTraces(createNodeAdapter(dir), 'run')).toEqual([])
  })

  it('skips traces with unreadable meta.json', async () => {
    await writeFixtureRun(dir, { id: 'run', startedAt: 100, traces: [{ id: 'ok', startedAt: 110 }] })
    await mkdir(join(dir, 'run', 'broken'))
    await writeFile(join(dir, 'run', 'broken', 'meta.json'), 'not-json{')

    const traces = await listTraces(createNodeAdapter(dir), 'run')
    expect(traces.map(s => s.id)).toEqual(['ok'])
  })
})

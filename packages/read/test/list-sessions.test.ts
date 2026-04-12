import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { listSessions } from '../src/index.js'
import { createNodeAdapter } from '../src/node.js'
import { writeFixtureSession } from './helpers.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-read-list-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('listSessions', () => {
  it('returns empty array when no sessions exist', async () => {
    const sessions = await listSessions(createNodeAdapter(dir))
    expect(sessions).toEqual([])
  })

  it('returns empty array when directory does not exist', async () => {
    const sessions = await listSessions(createNodeAdapter(join(dir, 'missing')))
    expect(sessions).toEqual([])
  })

  it('reads sessions and orders by startedAt descending', async () => {
    await writeFixtureSession(dir, { id: 'old', startedAt: 100 })
    await writeFixtureSession(dir, { id: 'new', startedAt: 300 })
    await writeFixtureSession(dir, { id: 'mid', startedAt: 200 })

    const sessions = await listSessions(createNodeAdapter(dir))
    expect(sessions.map(session => session.id)).toEqual(['new', 'mid', 'old'])
  })

  it('computes duration when endedAt is present', async () => {
    await writeFixtureSession(dir, { id: 'done', startedAt: 100, endedAt: 450 })
    await writeFixtureSession(dir, { id: 'open', startedAt: 500 })

    const sessions = await listSessions(createNodeAdapter(dir))
    const done = sessions.find(session => session.id === 'done')!
    const open = sessions.find(session => session.id === 'open')!
    expect(done.duration).toBe(350)
    expect(open.duration).toBeUndefined()
  })

  it('surfaces label when set', async () => {
    await writeFixtureSession(dir, { id: 's', startedAt: 1, label: 'my-run' })
    const sessions = await listSessions(createNodeAdapter(dir))
    expect(sessions[0].label).toBe('my-run')
  })

  it('skips sessions with unreadable meta.json', async () => {
    await writeFixtureSession(dir, { id: 'ok', startedAt: 100 })
    await mkdir(join(dir, 'broken'))
    await writeFile(join(dir, 'broken', 'meta.json'), 'not-json{')

    const sessions = await listSessions(createNodeAdapter(dir))
    expect(sessions.map(session => session.id)).toEqual(['ok'])
  })
})

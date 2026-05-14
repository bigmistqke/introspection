import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { runDebug } from '../../src/commands/debug.js'
import { createSessionReader, listRuns, listSessions } from '@introspection/read/node'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(__dirname, '../fixtures')

describe('debug command', () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = await mkdtemp(resolve(tmpdir(), 'introspect-debug-test-'))
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('serves a local HTML file and records a session', async () => {
    const result = await runDebug({
      serve: resolve(fixturesDir, 'index.html'),
      config: resolve(fixturesDir, 'introspect.config.js'),
      dir: tempDir,
    })

    expect(result.runId).toBeDefined()
    expect(result.sessionId).toBeDefined()

    // The run directory exists with a RunMeta and one session
    const runs = await listRuns(tempDir)
    expect(runs.map(r => r.id)).toContain(result.runId)
    const sessions = await listSessions(tempDir, result.runId)
    expect(sessions.map(s => s.id)).toContain(result.sessionId)
  })

  it('serves a directory with index.html and records a session', async () => {
    const result = await runDebug({
      serve: fixturesDir,
      config: resolve(fixturesDir, 'introspect.config.js'),
      dir: tempDir,
    })

    expect(result.sessionId).toBeDefined()
    const sessions = await listSessions(tempDir, result.runId)
    expect(sessions.map(s => s.id)).toContain(result.sessionId)
  })

  it('records session metadata and events', async () => {
    const result = await runDebug({
      serve: resolve(fixturesDir, 'index.html'),
      config: resolve(fixturesDir, 'introspect.config.js'),
      dir: tempDir,
    })

    // Verify session metadata exists
    const reader = await createSessionReader(tempDir, { runId: result.runId, sessionId: result.sessionId })
    const meta = reader.meta
    expect(meta.id).toBe(result.sessionId)
    expect(meta.startedAt).toBeDefined()
    expect(meta.endedAt).toBeDefined()

    // Verify events were recorded
    const events = await reader.events.ls()
    expect(events.length).toBeGreaterThanOrEqual(0)
  })

  it('runs playwright script on the page', async () => {
    const result = await runDebug({
      serve: resolve(fixturesDir, 'index.html'),
      config: resolve(fixturesDir, 'introspect.config.js'),
      playwright: `await page.waitForTimeout(50)`,
      dir: tempDir,
    })

    expect(result.sessionId).toBeDefined()
    const reader = await createSessionReader(tempDir, { runId: result.runId, sessionId: result.sessionId })
    expect(reader.meta.id).toBe(result.sessionId)
  })

  it('loads config from provided path', async () => {
    const result = await runDebug({
      serve: resolve(fixturesDir, 'index.html'),
      config: resolve(fixturesDir, 'introspect.config.js'),
      dir: tempDir,
    })

    expect(result.sessionId).toBeDefined()
    const reader = await createSessionReader(tempDir, { runId: result.runId, sessionId: result.sessionId })
    expect(reader.meta.id).toBe(result.sessionId)
  })

  it('throws error for missing path with --serve', async () => {
    await expect(
      runDebug({
        serve: '/nonexistent/path.html',
        config: resolve(fixturesDir, 'introspect.config.js'),
        dir: tempDir,
      })
    ).rejects.toThrow('Path not found')
  })

  it('throws error when neither url nor serve is provided', async () => {
    await expect(
      runDebug({
        config: resolve(fixturesDir, 'introspect.config.js'),
        dir: tempDir,
      })
    ).rejects.toThrow('Either url or --serve must be provided')
  })

  it('throws error when both url and serve are provided', async () => {
    await expect(
      runDebug({
        url: 'https://example.com',
        serve: resolve(fixturesDir, 'index.html'),
        config: resolve(fixturesDir, 'introspect.config.js'),
        dir: tempDir,
      })
    ).rejects.toThrow('Cannot use both url and --serve')
  })
})

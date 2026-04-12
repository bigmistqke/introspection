import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { runDebug } from '../../src/commands/debug.js'
import { createSessionReader, listSessions } from '@introspection/read/node'
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
    const sessionId = await runDebug({
      serve: resolve(fixturesDir, 'index.html'),
      config: resolve(fixturesDir, 'introspect.config.js'),
      dir: tempDir,
    })

    expect(sessionId).toBeDefined()
    expect(typeof sessionId).toBe('string')

    // Verify session was recorded
    const sessions = await listSessions(tempDir)
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.some(s => s.id === sessionId)).toBe(true)
  })

  it('serves a directory with index.html and records a session', async () => {
    const sessionId = await runDebug({
      serve: fixturesDir,
      config: resolve(fixturesDir, 'introspect.config.js'),
      dir: tempDir,
    })

    expect(sessionId).toBeDefined()
    const sessions = await listSessions(tempDir)
    expect(sessions.some(s => s.id === sessionId)).toBe(true)
  })

  it('runs playwright script on the page', async () => {
    const sessionId = await runDebug({
      serve: resolve(fixturesDir, 'index.html'),
      config: resolve(fixturesDir, 'introspect.config.js'),
      playwright: `await page.waitForTimeout(50)`,
      dir: tempDir,
    })

    expect(sessionId).toBeDefined()
    const reader = await createSessionReader(tempDir, { sessionId })
    const meta = reader.meta
    expect(meta.id).toBe(sessionId)
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

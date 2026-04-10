import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { createServer, type ViteDevServer } from 'vite'
import { solidDevtools } from '../dist/index.js'
import { attach } from '@introspection/playwright'
import type { IntrospectHandle, SolidDevtoolsOptions } from '../dist/index.js'

const directory = fileURLToPath(new URL('..', import.meta.url))

// ─── Vite dev server helper ──────────────────────────────────────────────────

let viteServer: ViteDevServer | null = null
let viteUrl: string

async function startVite(): Promise<void> {
  viteServer = await createServer({
    configFile: join(directory, 'test-app', 'vite.config.ts'),
    server: { port: 0, strictPort: false },
    logLevel: 'silent',
  })
  await viteServer.listen()
  const address = viteServer.httpServer?.address()
  if (!address || typeof address === 'string') {
    throw new Error('Vite server did not bind to a port')
  }
  viteUrl = `http://localhost:${address.port}`
}

async function stopVite(): Promise<void> {
  if (viteServer) {
    await viteServer.close()
    viteServer = null
  }
}

// ─── Session helpers ─────────────────────────────────────────────────────────

async function makeSession(page: Page, options?: SolidDevtoolsOptions) {
  const outDir = await mkdtemp(join(tmpdir(), 'introspect-solid-'))
  const plugin = solidDevtools(options)
  const handle = await attach(page, { outDir, plugins: [plugin] })
  return { outDir, plugin, handle }
}

async function endSession(handle: IntrospectHandle, outDir: string) {
  await handle.detach()
  try {
    const [sessionId] = await readdir(outDir)
    const raw = await readFile(join(outDir, sessionId, 'events.ndjson'), 'utf-8')
    return raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('solid devtools plugin', () => {
  test.beforeAll(async () => {
    await startVite()
  })

  test.afterAll(async () => {
    await stopVite()
  })

  test('streams structure updates for a SolidJS app', async ({ page }) => {
    const { outDir, handle } = await makeSession(page, { structureUpdates: 'stream' })

    await page.goto(viteUrl)
    await page.waitForSelector('button', { timeout: 10_000 })
    await page.waitForTimeout(2_000)

    const events = await endSession(handle, outDir)
    const structureEvents = events.filter(
      (event: { type: string }) => event.type === 'solid.structure',
    )
    expect(structureEvents.length).toBeGreaterThanOrEqual(1)
    expect(structureEvents[0].source).toBe('plugin')
  })

  test('captures structure asset on manual trigger', async ({ page }) => {
    const { outDir, handle } = await makeSession(page, {
      structureUpdates: 'trigger',
      nodeUpdates: 'off',
      dependencyGraph: 'off',
    })

    await page.goto(viteUrl)
    await page.waitForSelector('button', { timeout: 10_000 })
    await page.waitForTimeout(2_000)

    await handle.snapshot()

    const events = await endSession(handle, outDir)
    const structureAssets = events.filter(
      (event: { type: string; data?: { kind: string } }) =>
        event.type === 'asset' && event.data?.kind === 'solid-structure',
    )
    expect(structureAssets.length).toBeGreaterThanOrEqual(1)
  })

  test('emits warning when SolidDevtools$$ is missing', async ({ page }) => {
    const { outDir, handle } = await makeSession(page)

    // Navigate to a page served by Vite but without Solid — use a static HTML file
    // page.setContent doesn't trigger addInitScript, so navigate to about:blank first
    // then wait for the detection timeout
    await page.goto('data:text/html,<html><body><p>No Solid here</p></body></html>')

    // Wait for the 3s detection timeout plus buffer
    await page.waitForTimeout(5_000)

    const events = await endSession(handle, outDir)
    const warnings = events.filter(
      (event: { type: string }) => event.type === 'solid.warning',
    )
    expect(warnings.length).toBeGreaterThanOrEqual(1)
    expect(warnings[0].source).toBe('plugin')
    expect(warnings[0].data.message).toContain('@introspection/plugin-solid/setup')
  })
})

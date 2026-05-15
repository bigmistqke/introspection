import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { createServer, type ViteDevServer } from 'vite'
import { solidDevtools } from '../dist/index.js'
import { attach } from '@introspection/playwright'
import type { IntrospectHandle } from '@introspection/types'
import type { SolidDevtoolsOptions } from '../src/types.js'

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

// ─── Trace helpers ─────────────────────────────────────────────────────────

async function makeTrace(page: Page, options?: SolidDevtoolsOptions) {
  const outDir = await mkdtemp(join(tmpdir(), 'introspect-solid-'))
  const plugin = solidDevtools(options)
  const handle = await attach(page, { outDir, plugins: [plugin] })
  return { outDir, plugin, handle }
}

async function endTrace(handle: IntrospectHandle, outDir: string) {
  await handle.detach()
  try {
    const [traceId] = await readdir(outDir)
    const raw = await readFile(join(outDir, traceId, 'events.ndjson'), 'utf-8')
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
    const { outDir, handle } = await makeTrace(page, { structureUpdates: 'stream' })

    await page.goto(viteUrl)
    await page.waitForSelector('button', { timeout: 10_000 })
    await page.waitForTimeout(2_000)

    const events = await endTrace(handle, outDir)
    const structureEvents = events.filter(
      (event: { type: string }) => event.type === 'solid-devtools.structure',
    )
    expect(structureEvents.length).toBeGreaterThanOrEqual(1)
  })

  test('captures structure asset on manual trigger', async ({ page }) => {
    const { outDir, handle } = await makeTrace(page, {
      structureUpdates: 'trigger',
      nodeUpdates: 'off',
      dependencyGraph: 'off',
    })

    await page.goto(viteUrl)
    await page.waitForSelector('button', { timeout: 10_000 })
    await page.waitForTimeout(2_000)

    await handle.snapshot()

    const events = await endTrace(handle, outDir)
    // Look for solid.capture events with assets
    const solidCaptures = events.filter((event: { type: string; payloads?: Record<string, unknown> }) =>
      event.type === 'solid-devtools.capture' && event.payloads && Object.keys(event.payloads).length > 0)
    expect(solidCaptures.length).toBeGreaterThanOrEqual(1)
  })

  test('emits warning when SolidDevtools$$ is missing', async ({ page }) => {
    const { outDir, handle } = await makeTrace(page)

    // Navigate to a page served by Vite but without Solid — use a static HTML file
    // page.setContent doesn't trigger addInitScript, so navigate to about:blank first
    // then wait for the detection timeout
    await page.goto('data:text/html,<html><body><p>No Solid here</p></body></html>')

    // Wait for the 3s detection timeout plus buffer
    await page.waitForTimeout(5_000)

    const events = await endTrace(handle, outDir)
    const warnings = events.filter(
      (event: { type: string }) => event.type === 'solid-devtools.warning',
    )
    expect(warnings.length).toBeGreaterThanOrEqual(1)
    expect(warnings[0].metadata.message).toContain('@introspection/plugin-solid-devtools/setup')
  })
})

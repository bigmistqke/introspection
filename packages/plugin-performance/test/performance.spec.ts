import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { performance } from '../dist/index.js'
import { attach } from '@introspection/playwright'
import type { IntrospectHandle } from '@introspection/types'

async function makeSession(page: Page, options?: Parameters<typeof performance>[0]) {
  const outDir = await mkdtemp(join(tmpdir(), 'introspect-perf-'))
  const plugin = performance(options)
  const handle = await attach(page, { outDir, plugins: [plugin] })
  return { outDir, handle }
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

test('emits perf.paint events for FP and FCP on navigation', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><h1>Hello</h1></body></html>',
    })
  )

  const { outDir, handle } = await makeSession(page)
  await handle.page.goto('http://localhost:9999/')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const paintEvents = events.filter((event: { type: string }) => event.type === 'perf.paint')

  expect(paintEvents.length).toBeGreaterThanOrEqual(1)
  const fcp = paintEvents.find((event: { data: { name: string } }) => event.data.name === 'first-contentful-paint')
  expect(fcp).toBeDefined()
  expect(fcp.source).toBe('plugin')
  expect(typeof fcp.data.startTime).toBe('number')
})

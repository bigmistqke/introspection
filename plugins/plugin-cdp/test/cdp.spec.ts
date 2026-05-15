import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '@introspection/playwright'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { cdp } from '../dist/index.js'

let outDir: string

test.beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-cdp-'))
})

test.afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

async function readEvents(outDirectory: string) {
  const entries = await readdir(outDirectory)
  const ndjson = await readFile(join(outDirectory, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('captures CDP commands issued after install', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [cdp()] })

  // This goto triggers several CDP events (Page.frameNavigated, etc.) and
  // commands internally. We also issue an explicit Runtime.evaluate so we have
  // a predictable command to assert on.
  await page.goto('data:text/html,<html><body>hi</body></html>')
  await page.evaluate(() => 1 + 1)

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const commands = events.filter((event: { type: string }) => event.type === 'cdp.command')
  const cdpEvents = events.filter((event: { type: string }) => event.type === 'cdp.event')

  expect(commands.length).toBeGreaterThan(0)
  expect(cdpEvents.length).toBeGreaterThan(0)

  const evaluateCommand = commands.find((event: { metadata: { method: string } }) =>
    event.metadata.method === 'Runtime.evaluate')
  expect(evaluateCommand).toBeDefined()
  expect(typeof evaluateCommand.metadata.durationMs).toBe('number')
  expect(evaluateCommand.metadata.result).toBeDefined()
})

test('filter option excludes methods', async ({ page }) => {
  const handle = await attach(page, {
    outDir,
    plugins: [cdp({ filter: (method) => method.startsWith('Page.') })],
  })

  await page.goto('data:text/html,<html><body>hi</body></html>')
  await page.evaluate(() => 1 + 1)
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const cdpSessionEvents = events.filter((event: { type: string }) =>
    event.type === 'cdp.command' || event.type === 'cdp.event')

  expect(cdpSessionEvents.length).toBeGreaterThan(0)
  for (const event of cdpSessionEvents) {
    expect(event.metadata.method).toMatch(/^Page\./)
  }
})

test('captureResults: false omits result payloads', async ({ page }) => {
  const handle = await attach(page, {
    outDir,
    plugins: [cdp({ captureResults: false })],
  })

  await page.evaluate(() => 'hello')
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const evaluateCommand = events.find((event: { type: string; metadata: { method: string } }) =>
    event.type === 'cdp.command' && event.metadata.method === 'Runtime.evaluate')

  expect(evaluateCommand).toBeDefined()
  expect(evaluateCommand.metadata.result).toBeUndefined()
})

test('captures command errors', async ({ page }) => {
  // Second plugin that intentionally issues a bad CDP command via the shared
  // trace, so the cdp plugin has a chance to capture a failure.
  const badCaller: IntrospectionPlugin = {
    name: 'bad-caller',
    async install(ctx: PluginContext) {
      await ctx.cdpSession.send('Network.getResponseBody', { requestId: 'nonexistent-request-id' }).catch(() => {})
    },
  }

  const handle = await attach(page, { outDir, plugins: [cdp(), badCaller] })
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const errorCommand = events.find((event: { type: string; metadata: { method: string; error?: string } }) =>
    event.type === 'cdp.command'
    && event.metadata.method === 'Network.getResponseBody'
    && event.metadata.error)

  expect(errorCommand).toBeDefined()
  expect(errorCommand.metadata.error).toBeTruthy()
})

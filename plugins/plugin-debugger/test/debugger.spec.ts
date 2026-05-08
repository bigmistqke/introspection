import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '@introspection/playwright'
import { debuggerPlugin } from '../dist/index.js'
import type { IntrospectHandle, PayloadAsset } from '@introspection/types'

let outDir: string

test.beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-debugger-'))
})

test.afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

async function readEvents(outDirectory: string) {
  const entries = await readdir(outDirectory)
  const ndjson = await readFile(join(outDirectory, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

async function getSessionId(outDirectory: string) {
  const entries = await readdir(outDirectory)
  return entries[0]
}

test('captures exception pause', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>test</body></html>' })
  )
  await page.goto('http://localhost:9999/')
  const handle = await attach(page, {
    outDir,
    plugins: [debuggerPlugin({ pauseOnExceptions: 'uncaught' })],
  })

  await page.evaluate(() => new Promise<void>((resolve) => {
    window.addEventListener('error', () => resolve(), { once: true })
    setTimeout(() => { throw new Error('boom') }, 0)
  }))
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const captureEvent = events.find((event: { type: string }) => event.type === 'debugger.capture')

  expect(captureEvent).toBeDefined()
  const ref = captureEvent.payloads!.value
  expect(ref).toMatchObject({ kind: 'asset' })

  const sessionId = await getSessionId(outDir)
  const assetPath = (ref as PayloadAsset).path
  const assetContent = await readFile(
    join(outDir, sessionId, assetPath),
    'utf-8'
  )
  const capture = JSON.parse(assetContent)

  expect(capture.reason).toBe('exception')
  expect(capture.message).toContain('boom')
  expect(capture.stack).toBeDefined()
  expect(Array.isArray(capture.stack)).toBe(true)
  expect(capture.stack.length).toBeGreaterThan(0)
  expect(capture.stack[0]).toHaveProperty('functionName')
})

test('captures debugger statement pause', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>test</body></html>' })
  )
  await page.goto('http://localhost:9999/')
  const handle = await attach(page, { outDir, plugins: [debuggerPlugin()] })

  await page.evaluate(() => {
    // eslint-disable-next-line no-debugger
    debugger
  })
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const captureEvent = events.find((event: { type: string }) => event.type === 'debugger.capture')

  expect(captureEvent).toBeDefined()
  const ref = captureEvent.payloads!.value
  expect(ref).toMatchObject({ kind: 'asset' })

  const sessionId = await getSessionId(outDir)
  const assetPath = (ref as PayloadAsset).path
  const assetContent = await readFile(
    join(outDir, sessionId, assetPath),
    'utf-8'
  )
  const capture = JSON.parse(assetContent)

  expect(capture.reason).toBe('debuggerStatement')
})

test('captures manual capture via client binding', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>test</body></html>' })
  )
  await page.goto('http://localhost:9999/')
  const handle = await attach(page, { outDir, plugins: [debuggerPlugin()] })

  await page.evaluate(() => {
    window.__introspect_plugin_debugger_capture__(
      JSON.stringify({ label: 'my-label' })
    )
  })
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const captureEvent = events.find((event: { type: string }) => event.type === 'debugger.capture')

  expect(captureEvent).toBeDefined()
  const ref = captureEvent.payloads!.value
  expect(ref).toMatchObject({ kind: 'asset' })

  const sessionId = await getSessionId(outDir)
  const assetPath = (ref as PayloadAsset).path
  const assetContent = await readFile(
    join(outDir, sessionId, assetPath),
    'utf-8'
  )
  const capture = JSON.parse(assetContent)

  expect(capture.reason).toBe('capture')
  expect(capture.message).toBe('my-label')
})

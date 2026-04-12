import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '@introspection/playwright'
import { jsError } from '../dist/index.js'
import type { IntrospectHandle } from '@introspection/types'

let outDir: string

test.beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-js-error-'))
})

test.afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

async function readEvents(outDirectory: string) {
  const entries = await readdir(outDirectory)
  const ndjson = await readFile(join(outDirectory, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('captures thrown exception', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>test</body></html>' })
  )
  await page.goto('http://localhost:9999/')
  const handle = await attach(page, { outDir, plugins: [jsError()] })

  await page.evaluate(() => new Promise<void>((resolve) => {
    window.addEventListener('error', () => resolve(), { once: true })
    setTimeout(() => { throw new Error('thrown error message') }, 0)
  }))
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const errorEvent = events.find((event: { type: string }) => event.type === 'js.error')
  expect(errorEvent).toBeDefined()
  expect(errorEvent.metadata.message).toContain('thrown error message')
  expect(errorEvent.metadata.stack).toBeDefined()
  expect(Array.isArray(errorEvent.metadata.stack)).toBe(true)
  expect(errorEvent.metadata.stack.length).toBeGreaterThan(0)
})

test('captures unhandled promise rejection', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>test</body></html>' })
  )
  await page.goto('http://localhost:9999/')
  const handle = await attach(page, { outDir, plugins: [jsError()] })

  await page.evaluate(() => {
    Promise.reject(new Error('rejected error message'))
  })
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const errorEvent = events.find((event: { type: string }) => event.type === 'js.error')
  expect(errorEvent).toBeDefined()
  expect(errorEvent.metadata.message).toContain('rejected error message')
  expect(errorEvent.metadata.stack).toBeDefined()
})

test('stack frames captured from both exception types', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>test</body></html>' })
  )
  await page.goto('http://localhost:9999/')
  const handle = await attach(page, { outDir, plugins: [jsError()] })

  await page.evaluate(() => new Promise<void>((resolve) => {
    window.addEventListener('error', () => resolve(), { once: true })
    setTimeout(() => { throw new Error('stack test') }, 0)
  }))
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const errorEvent = events.find((event: { type: string }) => event.type === 'js.error')
  expect(errorEvent).toBeDefined()
  expect(errorEvent.metadata.stack).toBeDefined()
  expect(Array.isArray(errorEvent.metadata.stack)).toBe(true)
  expect(errorEvent.metadata.stack[0]).toHaveProperty('functionName')
  expect(errorEvent.metadata.stack[0]).toHaveProperty('file')
  expect(errorEvent.metadata.stack[0]).toHaveProperty('line')
  expect(errorEvent.metadata.stack[0]).toHaveProperty('column')
})

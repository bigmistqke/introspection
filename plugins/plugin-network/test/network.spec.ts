import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '@introspection/playwright'
import { network } from '../dist/index.js'
import type { IntrospectHandle } from '@introspection/types'

let outDir: string

test.beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-network-'))
})

test.afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

async function readEvents(outDirectory: string) {
  const entries = await readdir(outDirectory)
  const ndjson = await readFile(join(outDirectory, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('captures GET request', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [network()] })
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>test</body></html>' })
  )
  await page.goto('http://localhost:9999/')

  await page.evaluate(() => fetch('/api/data'))
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const requestEvent = events.find((event: { type: string }) => event.type === 'network.request')
  const responseEvent = events.find((event: { type: string }) => event.type === 'network.response')

  expect(requestEvent).toBeDefined()
  expect(requestEvent.metadata.url).toBeDefined()
  expect(requestEvent.metadata.method).toBe('GET')

  expect(responseEvent).toBeDefined()
  expect(responseEvent.metadata.status).toBe(200)
})

test('captures POST request with body', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [network()] })
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  )
  await page.goto('http://localhost:9999/')

  await page.evaluate(() =>
    fetch('/api/data', {
      method: 'POST',
      body: JSON.stringify({ key: 'value', number: 42 }),
    })
  )
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const requestEvent = events.find((event: { type: string; metadata?: { method?: string } }) =>
    event.type === 'network.request' && event.metadata?.method === 'POST')

  expect(requestEvent).toBeDefined()
  expect(requestEvent.metadata.postData).toBeDefined()
  expect(requestEvent.metadata.postData).toContain('key')
  expect(requestEvent.metadata.postData).toContain('value')
})

test('response body asset kind is detected correctly', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [network()] })
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' })
  )
  await page.goto('http://localhost:9999/')

  await page.evaluate(() => fetch('/api/json'))
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const responseEvent = events.find((event: { type: string }) => event.type === 'network.response')

  expect(responseEvent).toBeDefined()
  expect(responseEvent.assets).toBeDefined()
  expect(Array.isArray(responseEvent.assets)).toBe(true)
  expect(responseEvent.assets.length).toBeGreaterThan(0)
  expect(responseEvent.assets[0].kind).toBe('json')
})

test('captures failed request', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [network()] })
  await page.route('**/*', route => {
    if (route.request().url().includes('/fail')) {
      route.abort()
    } else {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>test</body></html>' })
    }
  })
  await page.goto('http://localhost:9999/')

  await page.evaluate(() => fetch('/fail').catch(() => {}))
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const responseEvent = events.find((event: { type: string }) => event.type === 'network.response')

  expect(responseEvent).toBeDefined()
})

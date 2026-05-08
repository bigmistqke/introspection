import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createServer, Server } from 'http'
import { attach } from '@introspection/playwright'
import { network } from '../dist/index.js'
import type { IntrospectHandle } from '@introspection/types'

let outDir: string
let server: Server
let baseUrl: string

// A real HTTP server is needed because Chromium's Network.getResponseBody
// returns "No data found" for requests served via Playwright's route.fulfill.
// The /stream route opens a text/event-stream that never completes — used to
// verify that a never-ending request doesn't hang handle.flush().
const openStreams = new Set<{ destroy(): void }>()
test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = request.url ?? '/'
    if (url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<html><body>test</body></html>')
    } else if (url === '/api/data') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{"users":[{"id":1}]}')
    } else if (url === '/api/json') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{"status":"ok"}')
    } else if (url === '/stream') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      response.write('data: hello\n\n')
      openStreams.add(request.socket)
      request.socket.on('close', () => openStreams.delete(request.socket))
      // Intentionally never call response.end() — this is the streaming case.
    } else if (url === '/fail') {
      request.socket.destroy()
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  for (const socket of openStreams) socket.destroy()
  openStreams.clear()
  await new Promise<void>(resolve => server.close(() => resolve()))
})

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
  await page.goto(baseUrl)

  await page.evaluate(async (url) => { await fetch(url).then(r => r.text()) }, `${baseUrl}/api/data`)
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const requestEvent = events.find((event: { type: string; metadata?: { url?: string } }) =>
    event.type === 'network.request' && event.metadata?.url?.includes('/api/data'))
  const responseEvent = events.find((event: { type: string; metadata?: { url?: string } }) =>
    event.type === 'network.response' && event.metadata?.url?.includes('/api/data'))
  const bodyEvent = events.find((event: { type: string; initiator?: string }) =>
    event.type === 'network.response.body' && event.initiator === responseEvent?.id)

  expect(requestEvent).toBeDefined()
  expect(requestEvent.metadata.url).toContain('/api/data')
  expect(requestEvent.metadata.method).toBe('GET')

  expect(responseEvent).toBeDefined()
  expect(responseEvent.metadata.status).toBe(200)

  expect(bodyEvent).toBeDefined()
  expect(bodyEvent.payloads?.body).toMatchObject({ kind: 'asset', format: 'json' })
})

test('captures POST request with body', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [network()] })
  await page.goto(baseUrl)

  await page.evaluate(async (url) => {
    await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ key: 'value', number: 42 }),
    }).then(r => r.text())
  }, `${baseUrl}/api/data`)
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
  await page.goto(baseUrl)

  await page.evaluate(async (url) => { await fetch(url).then(r => r.text()) }, `${baseUrl}/api/json`)
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const responseEvent = events.find((event: { type: string; metadata?: { url?: string } }) =>
    event.type === 'network.response' && event.metadata?.url?.includes('/api/json'))
  const bodyEvent = events.find((event: { type: string; initiator?: string }) =>
    event.type === 'network.response.body' && event.initiator === responseEvent?.id)

  expect(responseEvent).toBeDefined()
  expect(bodyEvent).toBeDefined()
  expect(bodyEvent.payloads?.body).toMatchObject({ kind: 'asset', format: 'json' })
})

test('streaming response does not hang flush', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [network()] })
  await page.goto(baseUrl)

  // Start an SSE request and read enough to confirm the response is open, but
  // don't wait for it to finish — the server never calls end() on /stream.
  await page.evaluate(async (url) => {
    const response = await fetch(url)
    const reader = response.body!.getReader()
    await reader.read()
    // Intentionally leave the reader open — mirrors a real streaming consumer.
  }, `${baseUrl}/stream`)

  // flush() must return promptly even though /stream is still open.
  const flushTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('flush hung')), 2000))
  await Promise.race([handle.flush(), flushTimeout])

  await handle.detach()

  const events = await readEvents(outDir)
  const responseEvent = events.find((event: { type: string; metadata?: { url?: string } }) =>
    event.type === 'network.response' && event.metadata?.url?.includes('/stream'))
  const bodyEvent = events.find((event: { type: string; initiator?: string }) =>
    event.type === 'network.response.body' && event.initiator === responseEvent?.id)

  // Response emitted immediately on responseReceived.
  expect(responseEvent).toBeDefined()
  // Body event only fires on loadingFinished, which never happens for this stream.
  expect(bodyEvent).toBeUndefined()
})

test('captures failed request', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [network()] })
  await page.goto(baseUrl)

  await page.evaluate(async (url) => { await fetch(url).then(r => r.text()).catch(() => {}) }, `${baseUrl}/fail`)
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const errorEvent = events.find((event: { type: string }) => event.type === 'network.error')

  expect(errorEvent).toBeDefined()
})

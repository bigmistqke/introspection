import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '@introspection/playwright'
import { consolePlugin } from '../src/index.js'

let dir: string
test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-console-'))
})
test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function readEvents(outDir: string) {
  const entries = await readdir(outDir)
  const ndjson = await readFile(join(outDir, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('captures console.log', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' })
  )
  await page.goto('http://localhost:9999/')
  const handle = await attach(page, { outDir: dir, plugins: [consolePlugin()] })

  await page.evaluate(() => console.log('hello world'))
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const consoleEvent = events.find((e: { type: string }) => e.type === 'console')
  expect(consoleEvent).toBeDefined()
  expect(consoleEvent.data.level).toBe('log')
  expect(consoleEvent.data.message).toBe('hello world')
})

test('captures console.warn and console.error', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' })
  )
  await page.goto('http://localhost:9999/')
  const handle = await attach(page, { outDir: dir, plugins: [consolePlugin()] })

  await page.evaluate(() => console.warn('careful'))
  await new Promise(r => setTimeout(r, 50))
  await page.evaluate(() => console.error('oops'))
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const consoleEvents = events.filter((e: { type: string }) => e.type === 'console')
  expect(consoleEvents.length).toBe(2)
  expect(consoleEvents[0].data.level).toBe('warn')
  expect(consoleEvents[0].data.message).toBe('careful')
  expect(consoleEvents[1].data.level).toBe('error')
  expect(consoleEvents[1].data.message).toBe('oops')
})

test('filters levels when levels option is set', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' })
  )
  await page.goto('http://localhost:9999/')
  const handle = await attach(page, { outDir: dir, plugins: [consolePlugin({ levels: ['error'] })] })

  await page.evaluate(() => {
    console.log('ignore me')
    console.error('capture me')
  })
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const consoleEvents = events.filter((e: { type: string }) => e.type === 'console')
  expect(consoleEvents.length).toBe(1)
  expect(consoleEvents[0].data.level).toBe('error')
  expect(consoleEvents[0].data.message).toBe('capture me')
})

test('source is plugin', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' })
  )
  await page.goto('http://localhost:9999/')
  const handle = await attach(page, { outDir: dir, plugins: [consolePlugin()] })

  await page.evaluate(() => console.log('test'))
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const consoleEvent = events.find((e: { type: string }) => e.type === 'console')
  expect(consoleEvent.source).toBe('plugin')
})

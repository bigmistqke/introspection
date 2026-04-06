import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '../src/attach.js'

let dir: string
test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-proxy-'))
})
test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function readEvents(outDir: string) {
  const entries = await readdir(outDir)
  const ndjson = await readFile(join(outDir, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
}

test('proxied page emits playwright.action event for tracked methods', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><button id="btn">click</button></body></html>' })
  )
  const handle = await attach(page, { outDir: dir })
  await handle.page.goto('http://localhost:9999/')
  await handle.page.click('#btn')
  await new Promise(r => setTimeout(r, 50))
  await handle.detach()

  const events = await readEvents(dir)
  const actions = events.filter((e: { type: string }) => e.type === 'playwright.action')
  const gotoAction = actions.find((e: { data: { method: string } }) => e.data.method === 'goto')
  const clickAction = actions.find((e: { data: { method: string } }) => e.data.method === 'click')

  expect(gotoAction).toBeDefined()
  expect(gotoAction.source).toBe('playwright')
  expect(clickAction).toBeDefined()
  expect(clickAction.data.args[0]).toBe('#btn')
})

test('proxied page still performs the original action', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>hello</body></html>' })
  )
  const handle = await attach(page, { outDir: dir })
  await handle.page.goto('http://localhost:9999/')
  const text = await handle.page.evaluate(() => document.body.textContent)
  expect(text).toBe('hello')
  await handle.detach()
})

test('non-tracked methods pass through without emitting events', async ({ page }) => {
  const handle = await attach(page, { outDir: dir })
  await handle.page.waitForTimeout(10)
  await handle.detach()

  const events = await readEvents(dir)
  const actions = events.filter((e: { type: string }) => e.type === 'playwright.action')
  expect(actions).toHaveLength(0)
})

test('function args in evaluate are sanitized to [function]', async ({ page }) => {
  const handle = await attach(page, { outDir: dir })
  await handle.page.evaluate(() => 'hello')
  await new Promise(r => setTimeout(r, 50))
  await handle.detach()

  const events = await readEvents(dir)
  const evalAction = events.find(
    (e: { type: string; data?: { method: string } }) =>
      e.type === 'playwright.action' && e.data?.method === 'evaluate',
  )
  expect(evalAction).toBeDefined()
  expect(evalAction.data.args[0]).toBe('[function]')
})

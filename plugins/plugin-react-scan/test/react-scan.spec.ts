import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { attach } from '@introspection/playwright'
import { reactScanPlugin } from '../dist/index.js'

let outDir: string

test.beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-react-scan-'))
})

test.afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

async function readEvents(directory: string) {
  const entries = await readdir(directory)
  const ndjson = await readFile(join(directory, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('captures mount render events', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [reactScanPlugin()] })
  await page.goto('http://localhost:8766/counter/index.html')
  await expect(page.locator('#count')).toHaveText('Count: 0')
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const renders = events.filter((event: { type: string }) => event.type === 'react-scan.render')
  const commits = events.filter((event: { type: string }) => event.type === 'react-scan.commit')

  expect(commits.length).toBeGreaterThan(0)
  expect(renders.length).toBeGreaterThan(0)

  const componentNames = renders.map((event: { metadata: { component: string } }) => event.metadata.component)
  expect(componentNames).toContain('App')
  expect(componentNames).toContain('Counter')

  const mountPhases = renders.map((event: { metadata: { phase: string } }) => event.metadata.phase)
  expect(mountPhases).toContain('mount')
})

test('captures update renders after state change', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [reactScanPlugin()] })
  await page.goto('http://localhost:8766/counter/index.html')
  await expect(page.locator('#count')).toHaveText('Count: 0')

  await page.click('#increment')
  await expect(page.locator('#count')).toHaveText('Count: 1')
  await page.click('#increment')
  await expect(page.locator('#count')).toHaveText('Count: 2')

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const counterRenders = events.filter((event: { type: string; metadata?: { component?: string } }) =>
    event.type === 'react-scan.render' && event.metadata?.component === 'Counter')

  expect(counterRenders.length).toBeGreaterThanOrEqual(3)
})

test('commits bracket renders', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [reactScanPlugin()] })
  await page.goto('http://localhost:8766/counter/index.html')
  await expect(page.locator('#count')).toHaveText('Count: 0')
  await page.click('#increment')
  await expect(page.locator('#count')).toHaveText('Count: 1')

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const commitStarts = events.filter((event: { type: string; metadata?: { phase?: string } }) =>
    event.type === 'react-scan.commit' && event.metadata?.phase === 'start')
  const commitFinishes = events.filter((event: { type: string; metadata?: { phase?: string } }) =>
    event.type === 'react-scan.commit' && event.metadata?.phase === 'finish')

  expect(commitStarts.length).toEqual(commitFinishes.length)
  expect(commitStarts.length).toBeGreaterThanOrEqual(2)
})

test('render metadata includes didCommit, forget, fps', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [reactScanPlugin()] })
  await page.goto('http://localhost:8766/counter/index.html')
  await expect(page.locator('#count')).toHaveText('Count: 0')
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const render = events.find((event: { type: string }) => event.type === 'react-scan.render')
  expect(render).toBeDefined()
  expect(render.metadata).toHaveProperty('didCommit')
  expect(render.metadata).toHaveProperty('forget')
  expect(render.metadata).toHaveProperty('fps')
  expect(typeof render.metadata.didCommit).toBe('boolean')
  expect(typeof render.metadata.forget).toBe('boolean')
  expect(typeof render.metadata.fps).toBe('number')
})

test('plugin.report() returns aggregate data and emits event', async ({ page }) => {
  const plugin = reactScanPlugin()
  const handle = await attach(page, { outDir, plugins: [plugin] })
  await page.goto('http://localhost:8766/counter/index.html')
  await expect(page.locator('#count')).toHaveText('Count: 0')
  await page.click('#increment')
  await expect(page.locator('#count')).toHaveText('Count: 1')

  const report = await plugin.report()
  await handle.flush()
  await handle.detach()

  expect(report).not.toBeNull()
  expect(typeof report).toBe('object')

  const events = await readEvents(outDir)
  const reportEvent = events.find((event: { type: string }) => event.type === 'react-scan.report')
  expect(reportEvent).toBeDefined()
  expect(reportEvent.metadata.report).toEqual(report)
})

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
  const renders = events.filter((event: { type: string }) => event.type === 'react.render')
  const commits = events.filter((event: { type: string }) => event.type === 'react.commit')

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
    event.type === 'react.render' && event.metadata?.component === 'Counter')

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
    event.type === 'react.commit' && event.metadata?.phase === 'start')
  const commitFinishes = events.filter((event: { type: string; metadata?: { phase?: string } }) =>
    event.type === 'react.commit' && event.metadata?.phase === 'finish')

  expect(commitStarts.length).toEqual(commitFinishes.length)
  expect(commitStarts.length).toBeGreaterThanOrEqual(2)
})

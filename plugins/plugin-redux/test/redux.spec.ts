import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '@introspection/playwright'
import { redux } from '../dist/index.js'

let outDir: string

test.beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-redux-'))
})

test.afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

async function readEvents(directory: string) {
  const entries = await readdir(directory)
  const ndjson = await readFile(join(directory, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('redux: composeWithDevTools pattern captures dispatches', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/redux.html')

  await page.click('#increment')
  await page.waitForTimeout(100)
  await page.click('#add-item')
  await page.waitForTimeout(100)

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatches = events.filter((e: any) => e.type === 'redux.dispatch')
  expect(dispatches.length).toBeGreaterThanOrEqual(2)

  const incrementEvent = dispatches.find((e: any) => e.metadata.action === 'INCREMENT')
  expect(incrementEvent).toBeDefined()

  const addItemEvent = dispatches.find((e: any) => e.metadata.action === 'ADD_ITEM')
  expect(addItemEvent).toBeDefined()
  expect(addItemEvent.metadata.payload).toMatch(/^item-/)
})

test('redux: payload serialization', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/redux.html')

  await page.click('#add-item')
  await page.waitForTimeout(100)

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const addItemEvent = events.find(
    (e: any) => e.type === 'redux.dispatch' && e.metadata.action === 'ADD_ITEM'
  )
  expect(addItemEvent).toBeDefined()
  expect(typeof addItemEvent.metadata.payload).toBe('string')
})

test('zustand: devtools middleware integration', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/zustand.html')

  await page.click('#increment')
  await page.waitForTimeout(100)
  await page.click('#add-item')
  await page.waitForTimeout(100)

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatches = events.filter((e: any) => e.type === 'redux.dispatch')
  expect(dispatches.length).toBeGreaterThanOrEqual(2)

  // Zustand sends 'setStateImpl' action types
  const zustandEvents = dispatches.filter((e: any) => e.metadata.instance === 'zustand-store')
  expect(zustandEvents.length).toBeGreaterThanOrEqual(2)
})

test('valtio: devtools middleware integration', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/valtio.html')

  await page.click('#increment')
  await page.waitForTimeout(100)
  await page.click('#add-item')
  await page.waitForTimeout(100)

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatches = events.filter((e: any) => e.type === 'redux.dispatch')
  expect(dispatches.length).toBeGreaterThanOrEqual(2)

  const valtioEvents = dispatches.filter((e: any) => e.metadata.instance === 'valtio-store')
  expect(valtioEvents.length).toBeGreaterThanOrEqual(2)
})

test('jotai: manual connect integration', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/jotai.html')

  await page.click('#increment')
  await page.waitForTimeout(100)

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatches = events.filter((e: any) => e.type === 'redux.dispatch')
  expect(dispatches.length).toBeGreaterThanOrEqual(1)

  const jotaiEvent = dispatches.find((e: any) => e.metadata.instance === 'jotai-store')
  expect(jotaiEvent).toBeDefined()
})

test('captureState option: state snapshots', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux({ captureState: true })] })
  await page.goto('http://localhost:8765/redux.html')

  await page.click('#increment')
  await page.waitForTimeout(100)

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const incrementEvent = events.find(
    (e: any) => e.type === 'redux.dispatch' && e.metadata.action === 'INCREMENT'
  )
  expect(incrementEvent).toBeDefined()
  expect(incrementEvent.metadata.stateBefore).toBeDefined()
  expect(incrementEvent.metadata.stateAfter).toBeDefined()
  expect(incrementEvent.metadata.stateBefore.count).toBe(0)
  expect(incrementEvent.metadata.stateAfter.count).toBe(1)
})

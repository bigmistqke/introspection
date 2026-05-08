import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '@introspection/playwright'
import { redux } from '../dist/index.js'
import type { PayloadAsset } from '@introspection/types'

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

test('redux + react: captures dispatches with devtools composition', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/redux-react/index.html')

  await page.click('#increment')
  await page.waitForTimeout(50)
  await page.click('#increment')
  await page.waitForTimeout(50)
  await page.click('#add-item')
  await page.waitForTimeout(50)

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatches = events.filter((e: any) => e.type === 'redux.dispatch')
  expect(dispatches.length).toBeGreaterThanOrEqual(3)

  const incrementEvents = dispatches.filter((e: any) => e.metadata.action === 'INCREMENT')
  expect(incrementEvents.length).toBe(2)

  const addItemEvent = dispatches.find((e: any) => e.metadata.action === 'ADD_ITEM')
  expect(addItemEvent).toBeDefined()
  expect(addItemEvent.metadata.payload).toMatch(/^item-/)
})

test('redux + react: payload serialization', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/redux-react/index.html')

  await page.click('#add-item')
  await page.waitForTimeout(50)

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const addItemEvent = events.find(
    (e: any) => e.type === 'redux.dispatch' && e.metadata.action === 'ADD_ITEM'
  )
  expect(addItemEvent).toBeDefined()
  expect(typeof addItemEvent.metadata.payload).toBe('string')
  expect(addItemEvent.metadata.payload).toMatch(/^item-\d+$/)
})

test('zustand + react: devtools middleware integration', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/zustand-react/index.html')

  await page.click('#increment')
  await page.waitForTimeout(50)
  await page.click('#decrement')
  await page.waitForTimeout(50)
  await page.click('#add-item')
  await page.waitForTimeout(50)

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatches = events.filter((e: any) => e.type === 'redux.dispatch')
  expect(dispatches.length).toBeGreaterThanOrEqual(3)

  const zustandEvents = dispatches.filter((e: any) => e.metadata.instance === 'zustand-store')
  expect(zustandEvents.length).toBeGreaterThanOrEqual(3)
})

test('valtio + react: devtools middleware integration', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/valtio-react/index.html')

  await page.click('#increment')
  await page.waitForTimeout(50)
  await page.click('#decrement')
  await page.waitForTimeout(50)
  await page.click('#add-item')
  await page.waitForTimeout(50)

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatches = events.filter((e: any) => e.type === 'redux.dispatch')
  expect(dispatches.length).toBeGreaterThanOrEqual(3)

  const valtioEvents = dispatches.filter((e: any) => e.metadata.instance === 'valtio-store')
  expect(valtioEvents.length).toBeGreaterThanOrEqual(3)
})

test('zustand + react: emits redux.snapshot on store creation via devtools middleware', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/zustand-react/index.html')

  await page.waitForTimeout(100)
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const snapshots = events.filter((e: any) => e.type === 'redux.snapshot')

  expect(snapshots.length).toBeGreaterThanOrEqual(1)
  const snapshot = snapshots[0]
  const ref = snapshot.payloads!.state
  expect(ref).toMatchObject({ kind: 'asset', format: 'json' })

  const entries = await readdir(outDir)
  const sessionDir = join(outDir, entries[0])
  const state = JSON.parse(await readFile(join(sessionDir, (ref as PayloadAsset).path), 'utf-8'))
  expect(state).toHaveProperty('count')
  expect(state).toHaveProperty('items')
})

test('valtio + react: emits redux.snapshot on store creation via devtools', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/valtio-react/index.html')

  await page.waitForTimeout(100)
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const snapshots = events.filter((e: any) => e.type === 'redux.snapshot')

  expect(snapshots.length).toBeGreaterThanOrEqual(1)
  const snapshot = snapshots[0]
  const ref = snapshot.payloads!.state
  expect(ref).toMatchObject({ kind: 'asset', format: 'json' })

  const entries = await readdir(outDir)
  const sessionDir = join(outDir, entries[0])
  const state = JSON.parse(await readFile(join(sessionDir, (ref as PayloadAsset).path), 'utf-8'))
  expect(state).toHaveProperty('count')
  expect(state).toHaveProperty('items')
})

test('snapshots store state and dispatches compute diffs', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/redux-react/index.html')

  await page.click('#increment')
  await page.waitForTimeout(50)

  await handle.flush()
  await handle.detach()

  const entries = await readdir(outDir)
  const sessionDir = join(outDir, entries[0])
  const events = await readEvents(outDir)

  const snapshotEvent = events.find((e: any) => e.type === 'redux.snapshot')
  expect(snapshotEvent).toBeDefined()
  const ref = snapshotEvent.payloads!.state
  expect(ref).toMatchObject({ kind: 'asset', format: 'json' })
  const initialState = JSON.parse(await readFile(join(sessionDir, (ref as PayloadAsset).path), 'utf-8'))
  expect(initialState.count).toBe(0)

  const incrementEvent = events.find(
    (e: any) => e.type === 'redux.dispatch' && e.metadata.action === 'INCREMENT'
  )
  expect(incrementEvent).toBeDefined()

  expect(incrementEvent.metadata.stateBefore).toBeUndefined()
  expect(incrementEvent.metadata.stateAfter).toBeUndefined()
  expect(incrementEvent.assets).toBeUndefined()

  expect(incrementEvent.metadata.diff).toBeDefined()
  expect(incrementEvent.metadata.diff).toHaveLength(1)
  expect(incrementEvent.metadata.diff[0].op).toBe('replace')
  expect(incrementEvent.metadata.diff[0].path).toBe('/count')
  expect(incrementEvent.metadata.diff[0].value).toBe(1)
})

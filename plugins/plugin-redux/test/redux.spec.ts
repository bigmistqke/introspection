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

const minimalStore = `
  window.__REDUX_STORE__ = (function() {
    var state = { count: 0, items: [] };
    var listeners = [];
    return {
      getState: function() { return state; },
      dispatch: function(action) {
        if (action.type === 'INCREMENT') state = { count: state.count + 1, items: state.items };
        else if (action.type === 'ADD_ITEM') state = { count: state.count, items: state.items.concat(action.payload) };
        listeners.forEach(function(listener) { listener(); });
        return action;
      },
      subscribe: function(listener) { listeners.push(listener); return function() {}; }
    };
  })();
`

async function setupPage(page: import('@playwright/test').Page, storeSetup: string = minimalStore) {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' })
  )
  await page.goto('http://localhost:9999/')
  await page.evaluate(storeSetup)
}

test('captures dispatch with action type', async ({ page }) => {
  await setupPage(page)
  const handle = await attach(page, { outDir, plugins: [redux()] })

  await page.evaluate(() => (window as any).__REDUX_STORE__.dispatch({ type: 'INCREMENT' }))
  await new Promise(resolve => setTimeout(resolve, 100))
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatchEvent = events.find((event: { type: string }) => event.type === 'redux.dispatch')
  expect(dispatchEvent).toBeDefined()
  expect(dispatchEvent.metadata.action).toBe('INCREMENT')
})

test('captures payload when present', async ({ page }) => {
  await setupPage(page)
  const handle = await attach(page, { outDir, plugins: [redux()] })

  await page.evaluate(() =>
    (window as any).__REDUX_STORE__.dispatch({ type: 'ADD_ITEM', payload: { id: 42, name: 'widget' } })
  )
  await new Promise(resolve => setTimeout(resolve, 100))
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatchEvent = events.find((event: { type: string }) =>
    event.type === 'redux.dispatch' && event.metadata.action === 'ADD_ITEM'
  )
  expect(dispatchEvent).toBeDefined()
  expect(dispatchEvent.metadata.payload).toEqual({ id: 42, name: 'widget' })
})

test('does not capture state when captureState is false (default)', async ({ page }) => {
  await setupPage(page)
  const handle = await attach(page, { outDir, plugins: [redux()] })

  await page.evaluate(() => (window as any).__REDUX_STORE__.dispatch({ type: 'INCREMENT' }))
  await new Promise(resolve => setTimeout(resolve, 100))
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatchEvent = events.find((event: { type: string }) => event.type === 'redux.dispatch')
  expect(dispatchEvent.metadata.stateBefore).toBeUndefined()
  expect(dispatchEvent.metadata.stateAfter).toBeUndefined()
})

test('captures stateBefore and stateAfter when captureState is true', async ({ page }) => {
  await setupPage(page)
  const handle = await attach(page, { outDir, plugins: [redux({ captureState: true })] })

  await page.evaluate(() => (window as any).__REDUX_STORE__.dispatch({ type: 'INCREMENT' }))
  await new Promise(resolve => setTimeout(resolve, 100))
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatchEvent = events.find((event: { type: string }) => event.type === 'redux.dispatch')
  expect(dispatchEvent).toBeDefined()
  expect(dispatchEvent.metadata.stateBefore).toEqual({ count: 0, items: [] })
  expect(dispatchEvent.metadata.stateAfter).toEqual({ count: 1, items: [] })
})

test('captures multiple dispatches in order', async ({ page }) => {
  await setupPage(page)
  const handle = await attach(page, { outDir, plugins: [redux()] })

  await page.evaluate(() => {
    const store = (window as any).__REDUX_STORE__
    store.dispatch({ type: 'INCREMENT' })
    store.dispatch({ type: 'ADD_ITEM', payload: 'a' })
    store.dispatch({ type: 'INCREMENT' })
  })
  await new Promise(resolve => setTimeout(resolve, 100))
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatches = events.filter((event: { type: string }) => event.type === 'redux.dispatch')
  expect(dispatches.map((event: { metadata: { action: string } }) => event.metadata.action)).toEqual([
    'INCREMENT',
    'ADD_ITEM',
    'INCREMENT',
  ])
})

test('patches store set after the init script runs', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' })
  )
  await page.goto('http://localhost:9999/')
  const handle = await attach(page, { outDir, plugins: [redux()] })

  await page.evaluate(storeSetup => {
    eval(storeSetup)
  }, minimalStore)
  await page.evaluate(() => (window as any).__REDUX_STORE__.dispatch({ type: 'INCREMENT' }))
  await new Promise(resolve => setTimeout(resolve, 100))
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatchEvent = events.find((event: { type: string }) => event.type === 'redux.dispatch')
  expect(dispatchEvent).toBeDefined()
  expect(dispatchEvent.metadata.action).toBe('INCREMENT')
})

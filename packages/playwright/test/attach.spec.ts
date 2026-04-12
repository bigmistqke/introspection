import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '../src/attach.js'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { defaults } from '@introspection/plugin-defaults'
import { network } from '@introspection/plugin-network'
import { jsError } from '@introspection/plugin-js-error'
import { redux } from '@introspection/plugin-redux'

let dir: string
test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-pw-'))
})
test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function readEvents(outDir: string) {
  const entries = await readdir(outDir)
  const ndjson = await readFile(join(outDir, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('creates session directory with meta.json and events.ndjson', async ({ page }) => {
  const handle = await attach(page, { outDir: dir, testTitle: 'my test', plugins: [] })
  await handle.detach()
  const entries = await readdir(dir)
  expect(entries.length).toBe(1)
  const sessionDir = join(dir, entries[0])
  const meta = JSON.parse(await readFile(join(sessionDir, 'meta.json'), 'utf-8'))
  expect(meta.label).toBe('my test')
  expect(meta.endedAt).toBeDefined()
  const ndjson = await readFile(join(sessionDir, 'events.ndjson'), 'utf-8')
  expect(typeof ndjson).toBe('string')
})

test('mark() appends a mark event to events.ndjson', async ({ page }) => {
  const handle = await attach(page, { outDir: dir, plugins: [] })
  handle.mark('step 1', { extra: true })
  await new Promise(r => setTimeout(r, 50))
  await handle.detach()
  const events = await readEvents(dir)
  const mark = events.find((event: { type: string }) => event.type === 'mark')
  expect(mark).toBeDefined()
  expect(mark.data.label).toBe('step 1')
})

test('detach() writes playwright.result event when result is passed', async ({ page }) => {
  const handle = await attach(page, { outDir: dir, plugins: [] })
  await handle.detach({ status: 'failed', error: 'assertion failed' })
  const events = await readEvents(dir)
  const resultEvent = events.find((event: { type: string }) => event.type === 'playwright.result')
  expect(resultEvent).toBeDefined()
  expect(resultEvent.data.status).toBe('failed')
})

test('network request appends network.request event', async ({ page }) => {
  const handle = await attach(page, { outDir: dir, plugins: [network()] })
  await page.route('**/*', route => {
    if (route.request().url().includes('/api/test')) {
      route.fulfill({ status: 200, body: 'ok' })
    } else {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' })
    }
  })
  await page.goto('http://localhost:9999/')
  await page.evaluate(() => fetch('/api/test'))
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()
  const events = await readEvents(dir)
  const networkRequest = events.find((event: { type: string; data?: { url: string } }) =>
    event.type === 'network.request' && event.data?.url?.includes('/api/test'))
  expect(networkRequest).toBeDefined()
})

test('Runtime.exceptionThrown appends js.error event', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' })
  )
  await page.goto('http://localhost:9999/')
  const handle = await attach(page, { outDir: dir, plugins: [jsError()] })
  // Use addScriptTag so the error happens in a proper browsing context
  await page.evaluate(() => {
    setTimeout(() => { throw new TypeError('oops') }, 0)
  })
  // Wait for CDP to process the exception + debugger pause/resume cycle
  await new Promise(r => setTimeout(r, 500))
  await handle.detach()
  const events = await readEvents(dir)
  const errorEvent = events.find((event: { type: string }) => event.type === 'js.error')
  expect(errorEvent).toBeDefined()
  expect(errorEvent.data.message).toContain('oops')
})

test('network response body is captured as an asset', async ({ page }) => {
  const handle = await attach(page, { outDir: dir, plugins: [network()] })
  await page.route('**/*', route => {
    if (route.request().url().includes('/api/data')) {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"users":[{"id":1}]}' })
    } else {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' })
    }
  })
  await page.goto('http://localhost:9999/')
  await page.evaluate(() => fetch('/api/data'))
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const response = events.find((event: { type: string; data?: { url: string } }) =>
    event.type === 'network.response' && event.data?.url?.includes('/api/data'))
  expect(response).toBeDefined()
  const bodyAsset = events.find((event: { type: string; data?: { kind: string } }) =>
    event.type === 'asset' && event.data?.kind === 'body')
  expect(bodyAsset).toBeDefined()
})

test('malformed plugin push is silently discarded', async ({ page }) => {
  const plugin: IntrospectionPlugin = {
    name: 'test', script: '', install: async () => {},
  }
  const handle = await attach(page, { outDir: dir, plugins: [plugin] })

  await page.evaluate(() => {
    ;(window as unknown as Record<string, Function>).__introspect_push__('not valid json{{{')
  })
  await new Promise(r => setTimeout(r, 50))
  await handle.detach()

  const events = await readEvents(dir)
  // Only page lifecycle + playwright.result from detach, no malformed event
  const nonLifecycle = events.filter((event: { type: string }) =>
    event.type !== 'playwright.result' && event.type !== 'mark'
    && event.type !== 'page.attach' && event.type !== 'page.detach')
  expect(nonLifecycle).toHaveLength(0)
})

test('plugin subscriptions survive navigation', async ({ page }) => {
  let savedCtx: PluginContext
  const pushes: string[] = []
  const plugin: IntrospectionPlugin = {
    name: 'test',
    // Browser script that registers a plugin with a watch function
    script: `
      window.__introspect_plugins__ = window.__introspect_plugins__ || {};
      window.__introspect_plugins__.test = {
        watch(spec) {
          const id = Math.random().toString(36).slice(2);
          // Push an event immediately to confirm subscription is active
          window.__introspect_push__(JSON.stringify({ type: 'test.subscribed', data: { id } }));
          return id;
        },
        unwatch(id) {}
      };
    `,
    async install(ctx) { savedCtx = ctx },
  }

  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>page</body></html>' })
  )

  const handle = await attach(page, { outDir: dir, plugins: [plugin] })
  await handle.page.goto('http://localhost:9999/')
  await savedCtx!.addSubscription('test', { event: 'something' })
  await new Promise(r => setTimeout(r, 50))

  // Navigate again — subscriptions should be re-applied on load
  await handle.page.goto('http://localhost:9999/other')
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const subscribed = events.filter((event: { type: string }) => event.type === 'test.subscribed')
  // At least 2: one from initial addSubscription, one from re-apply after navigation
  expect(subscribed.length).toBeGreaterThanOrEqual(2)
})

test('does not create a .socket file inside session directory', async ({ page }) => {
  const handle = await attach(page, { outDir: dir, plugins: [] })
  const entries = await readdir(dir)
  const socketPath = join(dir, entries[0], '.socket')
  expect(existsSync(socketPath)).toBe(false)
  await handle.detach()
})

test('push event from browser appears in events.ndjson with source: plugin', async ({ page }) => {
  const plugin: IntrospectionPlugin = {
    name: 'test', script: '', install: async () => {},
  }
  const handle = await attach(page, { outDir: dir, plugins: [plugin] })

  await page.evaluate(() => {
    ;(window as unknown as Record<string, Function>).__introspect_push__(
      JSON.stringify({ type: 'webgl.uniform', data: { name: 'u_time', value: 1.5, glType: 'float' } })
    )
  })
  await new Promise(r => setTimeout(r, 50))
  await handle.detach()

  const events = await readEvents(dir)
  const pushed = events.find((event: { type: string }) => event.type === 'webgl.uniform')
  expect(pushed).toBeDefined()
  expect(pushed.source).toBe('plugin')
  expect(pushed.data.name).toBe('u_time')
  expect(pushed.data.value).toBe(1.5)
})

test('ctx.writeAsset writes file and returns AssetRef', async ({ page }) => {
  let savedCtx: PluginContext
  const plugin: IntrospectionPlugin = {
    name: 'test', script: '',
    async install(ctx) { savedCtx = ctx },
  }
  const handle = await attach(page, { outDir: dir, plugins: [plugin] })
  const asset = await savedCtx!.writeAsset({ kind: 'webgl-state', contentType: 'json', content: '{"ok":true}' })
  await handle.detach()

  expect(asset.kind).toBe('webgl-state')
  expect(asset.contentType).toBe('json')
  expect(asset.size).toBeGreaterThan(0)
  expect(asset.path).toMatch(/^assets\/.*\.webgl-state\.json$/)
})

test('custom session ID is used as directory name', async ({ page }) => {
  const customId = 'browser-desktop--loading--prepare-page'
  const handle = await attach(page, { outDir: dir, id: customId, plugins: [] })
  await handle.detach()
  const entries = await readdir(dir)
  expect(entries).toContain(customId)
  const meta = JSON.parse(await readFile(join(dir, customId, 'meta.json'), 'utf-8'))
  expect(meta.id).toBe(customId)
})

test('duplicate session ID throws an error', async ({ page }) => {
  const customId = 'duplicate-test'
  const handle1 = await attach(page, { outDir: dir, id: customId, plugins: [] })
  await handle1.detach()
  await expect(attach(page, { outDir: dir, id: customId, plugins: [] }))
    .rejects.toThrow()
})

test('plugin-redux captures dispatch events via push bridge', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' })
  )
  const handle = await attach(page, { outDir: dir, plugins: [redux()] })
  await handle.page.goto('http://localhost:9999/')

  // Simulate a Redux store in the browser
  await page.evaluate(() => {
    const store = {
      dispatch(action: { type: string; payload?: unknown }) { return action },
      getState() { return { count: 0 } },
    };
    (window as unknown as Record<string, unknown>).__REDUX_STORE__ = store
    // Give the defineProperty setter time to patch
    setTimeout(() => {
      store.dispatch({ type: 'INCREMENT', payload: { amount: 1 } })
    }, 50)
  })

  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const dispatch = events.find((event: { type: string }) => event.type === 'redux.dispatch')
  expect(dispatch).toBeDefined()
  expect(dispatch.data.action).toBe('INCREMENT')
  expect(dispatch.data.payload).toEqual({ amount: 1 })
})

test('bus "detach" handler is called and can write assets', async ({ page }) => {
  let detachCalled = false
  const plugin: IntrospectionPlugin = {
    name: 'test',
    async install(ctx) {
      ctx.bus.on('detach', async () => {
        detachCalled = true
        await ctx.writeAsset({
          kind: 'webgl-state',
          contentType: 'json',
          content: '{"detached":true}',
        })
      })
    },
  }
  const handle = await attach(page, { outDir: dir, plugins: [plugin] })
  await handle.detach()

  expect(detachCalled).toBe(true)
  // Verify the asset file was written to the session's assets directory
  const sessionEntries = await readdir(dir)
  const sessionDir = sessionEntries.find(entry => entry.length > 30)
  expect(sessionDir).toBeDefined()
  const assetFiles = await readdir(join(dir, sessionDir!, 'assets'))
  expect(assetFiles.some(f => f.includes('webgl-state'))).toBe(true)
})

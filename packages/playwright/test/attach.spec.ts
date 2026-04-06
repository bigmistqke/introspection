import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '../src/attach.js'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'

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
  return ndjson.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
}

test('creates session directory with meta.json and events.ndjson', async ({ page }) => {
  const handle = await attach(page, { outDir: dir, testTitle: 'my test' })
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
  const handle = await attach(page, { outDir: dir })
  handle.mark('step 1', { extra: true })
  await new Promise(r => setTimeout(r, 50))
  await handle.detach()
  const events = await readEvents(dir)
  const mark = events.find((e: { type: string }) => e.type === 'mark')
  expect(mark).toBeDefined()
  expect(mark.data.label).toBe('step 1')
})

test('detach() writes playwright.result event when result is passed', async ({ page }) => {
  const handle = await attach(page, { outDir: dir })
  await handle.detach({ status: 'failed', error: 'assertion failed' })
  const events = await readEvents(dir)
  const result = events.find((e: { type: string }) => e.type === 'playwright.result')
  expect(result).toBeDefined()
  expect(result.data.status).toBe('failed')
})

test('network request appends network.request event', async ({ page }) => {
  const handle = await attach(page, { outDir: dir })
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
  const req = events.find((e: { type: string; data?: { url: string } }) =>
    e.type === 'network.request' && e.data?.url?.includes('/api/test'))
  expect(req).toBeDefined()
})

test('Runtime.exceptionThrown appends js.error event', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' })
  )
  await page.goto('http://localhost:9999/')
  const handle = await attach(page, { outDir: dir })
  // Use addScriptTag so the error happens in a proper browsing context
  await page.evaluate(() => {
    setTimeout(() => { throw new TypeError('oops') }, 0)
  })
  // Wait for CDP to process the exception + debugger pause/resume cycle
  await new Promise(r => setTimeout(r, 500))
  await handle.detach()
  const events = await readEvents(dir)
  const err = events.find((e: { type: string }) => e.type === 'js.error')
  expect(err).toBeDefined()
  expect(err.data.message).toContain('oops')
})

test('network response body is captured as an asset', async ({ page }) => {
  const handle = await attach(page, { outDir: dir })
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
  const response = events.find((e: { type: string; data?: { url: string } }) =>
    e.type === 'network.response' && e.data?.url?.includes('/api/data'))
  expect(response).toBeDefined()
  const bodyAsset = events.find((e: { type: string; data?: { kind: string } }) =>
    e.type === 'asset' && e.data?.kind === 'body')
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
  // Only playwright.result from detach, no malformed event
  const nonResult = events.filter((e: { type: string }) =>
    e.type !== 'playwright.result' && e.type !== 'mark')
  expect(nonResult).toHaveLength(0)
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
  const subscribed = events.filter((e: { type: string }) => e.type === 'test.subscribed')
  // At least 2: one from initial addSubscription, one from re-apply after navigation
  expect(subscribed.length).toBeGreaterThanOrEqual(2)
})

test('does not create a .socket file inside session directory', async ({ page }) => {
  const handle = await attach(page, { outDir: dir })
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
  const pushed = events.find((e: { type: string }) => e.type === 'webgl.uniform')
  expect(pushed).toBeDefined()
  expect(pushed.source).toBe('plugin')
  expect(pushed.data.name).toBe('u_time')
  expect(pushed.data.value).toBe(1.5)
})

test('ctx.writeAsset produces an asset event with source: plugin in events.ndjson', async ({ page }) => {
  let savedCtx: PluginContext
  const plugin: IntrospectionPlugin = {
    name: 'test', script: '',
    async install(ctx) { savedCtx = ctx },
  }
  const handle = await attach(page, { outDir: dir, plugins: [plugin] })
  await savedCtx!.writeAsset({ kind: 'webgl-state', content: '{"ok":true}', metadata: { timestamp: 5 } })
  await handle.detach()

  const events = await readEvents(dir)
  const asset = events.find((e: { type: string }) => e.type === 'asset')
  expect(asset).toBeDefined()
  expect(asset.source).toBe('plugin')
  expect(asset.data.kind).toBe('webgl-state')
})

test('detach() triggers plugin.capture("detach") and writes resulting assets', async ({ page }) => {
  const plugin: IntrospectionPlugin = {
    name: 'test', script: '', install: async () => {},
    async capture(trigger) {
      if (trigger !== 'detach') return []
      return [{ kind: 'webgl-state', content: '{"detached":true}', summary: { contextId: 'ctx_0' } }]
    },
  }
  await attach(page, { outDir: dir, plugins: [plugin] }).then(h => h.detach())

  const events = await readEvents(dir)
  const asset = events.find((e: { type: string; data?: { kind: string } }) =>
    e.type === 'asset' && e.data?.kind === 'webgl-state')
  expect(asset).toBeDefined()
  expect(asset.source).toBe('plugin')
})

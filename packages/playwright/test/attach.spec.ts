import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '../src/attach.js'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'

// Tests in this file focus on the playwright attach/detach API.
// Plugin-specific integration tests are in their respective plugin directories.

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
  await handle.mark('step 1')
  await handle.detach()
  const events = await readEvents(dir)
  const mark = events.find((event: { type: string }) => event.type === 'mark')
  expect(mark).toBeDefined()
  expect(mark.metadata.label).toBe('step 1')
})

test('detach() writes playwright.result event when result is passed', async ({ page }) => {
  const handle = await attach(page, { outDir: dir, plugins: [] })
  await handle.detach({ status: 'failed', error: 'assertion failed' })
  const events = await readEvents(dir)
  const resultEvent = events.find((event: { type: string }) => event.type === 'playwright.result')
  expect(resultEvent).toBeDefined()
  expect(resultEvent.metadata.status).toBe('failed')
})




test('malformed plugin push is silently discarded', async ({ page }) => {
  const plugin: IntrospectionPlugin = {
    name: 'test', script: '', install: async () => {},
  }
  const handle = await attach(page, { outDir: dir, plugins: [plugin] })

  await page.evaluate(() => {
    ;(window as unknown as Record<string, Function>).__introspect_push__('not valid json{{{')
  })
  await handle.flush()
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
  await handle.flush()

  // Navigate again — subscriptions should be re-applied on load
  await handle.page.goto('http://localhost:9999/other')
  await handle.flush()
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

test('push event from browser appears in events.ndjson', async ({ page }) => {
  const plugin: IntrospectionPlugin = {
    name: 'test', script: '', install: async () => {},
  }
  const handle = await attach(page, { outDir: dir, plugins: [plugin] })

  await page.evaluate(() => {
    ;(window as unknown as Record<string, Function>).__introspect_push__(
      JSON.stringify({ type: 'webgl.uniform', metadata: { name: 'u_time', value: 1.5, glType: 'float', contextId: 'ctx-1' } })
    )
  })
  await handle.flush()
  await handle.detach()

  const events = await readEvents(dir)
  const pushed = events.find((event: { type: string }) => event.type === 'webgl.uniform')
  expect(pushed).toBeDefined()
  expect(pushed.metadata.name).toBe('u_time')
  expect(pushed.metadata.value).toBe(1.5)
})

test('ctx.writeAsset writes file and returns AssetRef', async ({ page }) => {
  let savedCtx: PluginContext
  const plugin: IntrospectionPlugin = {
    name: 'test', script: '',
    async install(ctx) { savedCtx = ctx },
  }
  const handle = await attach(page, { outDir: dir, plugins: [plugin] })
  const asset = await savedCtx!.writeAsset({ kind: 'json', content: '{"ok":true}' })
  await handle.detach()

  expect(asset.kind).toBe('json')
  expect(asset.size).toBeGreaterThan(0)
  expect(asset.path).toMatch(/^assets\/.*\.json$/)
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


test('bus "detach" handler is called and can write assets', async ({ page }) => {
  let detachCalled = false
  const plugin: IntrospectionPlugin = {
    name: 'test',
    async install(ctx) {
      ctx.bus.on('detach', async () => {
        detachCalled = true
        await ctx.writeAsset({
          kind: 'json',
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
  expect(assetFiles.some(f => f.endsWith('.json'))).toBe(true)
})

test('framework formatter populates summary for mark events', async ({ page }) => {
  const handle = await attach(page, { outDir: dir, plugins: [] })
  await handle.mark('hello')
  await handle.detach()

  const events = await readEvents(dir) as Array<{ type: string; metadata: { label: string }; summary?: string }>
  const mark = events.find((event) => event.type === 'mark')
  expect(mark?.summary).toBe('"hello"')
})

test('plugin formatEvent runs when framework formatter returns null', async ({ page }) => {
  // Emit a custom event type via push; framework formatter doesn't recognise it
  // so plugin formatter wins.
  const plugin: IntrospectionPlugin = {
    name: 'demo',
    async install() { /* no listeners */ },
    formatEvent(event) {
      if (event.type === 'js.error') return `js.error: ${(event.metadata as { message: string }).message}`
      return null
    },
  }
  const handle = await attach(page, { outDir: dir, plugins: [plugin] })
  await handle.emit({ type: 'js.error', metadata: { cdpTimestamp: 0, message: 'boom', stack: [] } })
  await handle.detach()

  const events = await readEvents(dir) as Array<{ type: string; summary?: string }>
  const error = events.find((event) => event.type === 'js.error')
  expect(error?.summary).toBe('js.error: boom')
})

test('summary is undefined when no formatter matches', async ({ page }) => {
  const handle = await attach(page, { outDir: dir, plugins: [] })
  // js.error has no framework formatter and no plugin to format it.
  await handle.emit({ type: 'js.error', metadata: { cdpTimestamp: 0, message: 'boom', stack: [] } })
  await handle.detach()

  const events = await readEvents(dir) as Array<{ type: string; summary?: string }>
  const error = events.find((event) => event.type === 'js.error')
  expect(error?.summary).toBeUndefined()
})

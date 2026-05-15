import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '@introspection/playwright'
import { jsError } from '@introspection/plugin-js-error'
import { cookies } from '../src/index.js'
import { startFixtureServer, type FixtureServer } from './server.js'

let dir: string
let fixture: FixtureServer

test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-cookies-'))
  fixture = await startFixtureServer()
})
test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await fixture.close()
})

async function readEvents(outDir: string) {
  const entries = await readdir(outDir)
  const ndjson = await readFile(join(outDir, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('emits an install snapshot containing pre-existing cookies', async ({ page, context }) => {
  const url = new URL(fixture.url)
  await context.addCookies([
    { name: 'trace', value: 'abc', domain: url.hostname, path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
    { name: 'theme', value: 'dark', domain: url.hostname, path: '/' },
  ])

  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies()] })
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const installSnapshot = events.find((e: { type: string; metadata: { trigger: string } }) =>
    e.type === 'cookie.snapshot' && e.metadata.trigger === 'install'
  )
  expect(installSnapshot).toBeDefined()

  const trace = installSnapshot.metadata.cookies.find((c: { name: string }) => c.name === 'trace')
  expect(trace).toBeDefined()
  expect(trace.value).toBe('abc')
  expect(trace.httpOnly).toBe(true)
  expect(trace.sameSite).toBe('Lax')

  const theme = installSnapshot.metadata.cookies.find((c: { name: string }) => c.name === 'theme')
  expect(theme).toBeDefined()
  expect(theme.value).toBe('dark')
})

test('binding bootstrap exposes the emit helper', async ({ page }) => {
  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies()] })

  const ok = await page.evaluate(() => typeof (window as unknown as { __introspection_plugin_cookies_emit?: unknown }).__introspection_plugin_cookies_emit === 'function')
  expect(ok).toBe(true)

  await handle.detach()
})

test('captures document.cookie writes (set, multi-attribute, delete)', async ({ page }) => {
  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies()] })

  await page.evaluate(() => {
    document.cookie = 'a=1'
    document.cookie = 'b=2; path=/sub; secure; samesite=strict'
    document.cookie = 'a=; max-age=0'
  })
  await new Promise(r => setTimeout(r, 150))
  await handle.detach()

  const events = await readEvents(dir)
  const writes = events.filter((e: { type: string }) => e.type === 'cookie.write')
  expect(writes).toHaveLength(3)

  expect(writes[0].metadata).toMatchObject({
    operation: 'set',
    source: 'document.cookie',
    name: 'a',
    value: '1',
  })

  expect(writes[1].metadata).toMatchObject({
    operation: 'set',
    source: 'document.cookie',
    name: 'b',
    value: '2',
    path: '/sub',
    secure: true,
    sameSite: 'Strict',
  })

  expect(writes[2].metadata).toMatchObject({
    operation: 'delete',
    source: 'document.cookie',
    name: 'a',
  })
})

test('captures CookieStore.set and delete (Chromium)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CookieStore is Chromium-only')
  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies()] })

  await page.evaluate(async () => {
    await window.cookieStore.set('cs-name', 'cs-val')
    await window.cookieStore.delete('cs-name')
  })
  await new Promise(r => setTimeout(r, 150))
  await handle.detach()

  const events = await readEvents(dir)
  const writes = events.filter((e: { type: string; metadata: { source?: string } }) =>
    e.type === 'cookie.write' && e.metadata.source === 'CookieStore'
  )
  expect(writes).toHaveLength(2)
  expect(writes[0].metadata).toMatchObject({ operation: 'set', name: 'cs-name', value: 'cs-val' })
  expect(writes[1].metadata).toMatchObject({ operation: 'delete', name: 'cs-name' })
})

test('captures HTTP Set-Cookie as cookie.http events', async ({ page }) => {
  fixture.respond('/login', (_req, res) => {
    res.writeHead(200, {
      'set-cookie': [
        'sid=abc123; HttpOnly; Path=/',
        'theme=dark; Max-Age=3600; SameSite=Lax',
      ],
      'content-type': 'text/plain',
    })
    res.end('ok')
  })

  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies()] })

  await page.evaluate((url) => fetch(url + '/login').then(r => r.text()), fixture.url)
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const httpEvents = events.filter((e: { type: string }) => e.type === 'cookie.http')
  expect(httpEvents).toHaveLength(2)

  const sid = httpEvents.find((e: { metadata: { name: string } }) => e.metadata.name === 'sid')
  expect(sid).toBeDefined()
  expect(sid.metadata.httpOnly).toBe(true)
  expect(sid.metadata.path).toBe('/')
  expect(sid.metadata.url).toBe(fixture.url + '/login')
  expect(typeof sid.metadata.requestId).toBe('string')

  const theme = httpEvents.find((e: { metadata: { name: string } }) => e.metadata.name === 'theme')
  expect(theme).toBeDefined()
  expect(theme.metadata.sameSite).toBe('Lax')
  expect(typeof theme.metadata.expires).toBe('number')
})

test('emits a snapshot on handle.snapshot()', async ({ page }) => {
  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies()] })

  await page.evaluate(() => { document.cookie = 'after=attach' })
  await handle.snapshot()
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'cookie.snapshot')

  const manual = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'manual')
  expect(manual).toBeDefined()
  expect(manual.metadata.cookies.some((c: { name: string }) => c.name === 'after')).toBe(true)

  const detach = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'detach')
  expect(detach).toBeDefined()
})

test('emits a snapshot on js.error', async ({ page }) => {
  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies(), jsError()] })

  await page.evaluate(() => { setTimeout(() => { throw new Error('boom') }, 0) })
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'cookie.snapshot')
  const onError = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'js.error')
  expect(onError).toBeDefined()
})

test('names option filters writes and snapshot entries', async ({ page, context }) => {
  const url = new URL(fixture.url)
  await context.addCookies([
    { name: 'trace', value: 'abc', domain: url.hostname, path: '/' },
    { name: 'tracker', value: 'xyz', domain: url.hostname, path: '/' },
  ])

  await page.goto(fixture.url)
  const handle = await attach(page, { outDir: dir, plugins: [cookies({ names: ['trace'] })] })

  await page.evaluate(() => {
    document.cookie = 'trace=fresh'
    document.cookie = 'tracker=t2'
  })
  await new Promise(r => setTimeout(r, 150))
  await handle.detach()

  const events = await readEvents(dir)

  const writes = events.filter((e: { type: string }) => e.type === 'cookie.write')
  expect(writes).toHaveLength(1)
  expect(writes[0].metadata.name).toBe('trace')

  const installSnapshot = events.find((e: { type: string; metadata: { trigger: string } }) =>
    e.type === 'cookie.snapshot' && e.metadata.trigger === 'install'
  )
  expect(installSnapshot.metadata.cookies.map((c: { name: string }) => c.name)).toEqual(['trace'])
})

test('origins option filters cookies whose domain does not match', async ({ page, context }) => {
  const url = new URL(fixture.url)
  await context.addCookies([
    { name: 'mine', value: 'v', domain: url.hostname, path: '/' },
  ])

  await page.goto(fixture.url)
  const handle = await attach(page, {
    outDir: dir,
    plugins: [cookies({ origins: ['https://other.example'] })],
  })

  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const installSnapshot = events.find((e: { type: string; metadata: { trigger: string } }) =>
    e.type === 'cookie.snapshot' && e.metadata.trigger === 'install'
  )
  expect(installSnapshot.metadata.cookies).toEqual([])
})

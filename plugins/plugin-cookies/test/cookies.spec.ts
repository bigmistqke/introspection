import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '@introspection/playwright'
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
    { name: 'session', value: 'abc', domain: url.hostname, path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
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

  const session = installSnapshot.metadata.cookies.find((c: { name: string }) => c.name === 'session')
  expect(session).toBeDefined()
  expect(session.value).toBe('abc')
  expect(session.httpOnly).toBe(true)
  expect(session.sameSite).toBe('Lax')

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

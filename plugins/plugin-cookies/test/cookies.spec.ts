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

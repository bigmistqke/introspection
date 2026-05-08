import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { attach } from '@introspection/playwright'
import { webStorage } from '../src/index.js'

const FIXTURE = 'file://' + fileURLToPath(new URL('./fixtures/index.html', import.meta.url))

let dir: string
test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-web-storage-'))
})
test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function readEvents(outDir: string) {
  const entries = await readdir(outDir)
  const ndjson = await readFile(join(outDir, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('emits an install snapshot containing pre-existing keys', async ({ page }) => {
  await page.goto(FIXTURE)

  const handle = await attach(page, { outDir: dir, plugins: [webStorage()] })
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'webStorage.snapshot')
  const installSnapshot = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'install')

  expect(installSnapshot).toBeDefined()
  expect(installSnapshot.metadata.localStorage).toEqual({ 'preexisting-local': 'l-1' })
  expect(installSnapshot.metadata.sessionStorage).toEqual({ 'preexisting-session': 's-1' })
  expect(typeof installSnapshot.metadata.origin).toBe('string')
})

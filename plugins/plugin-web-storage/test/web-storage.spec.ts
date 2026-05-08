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

test('captures setItem, removeItem, and clear with old/new values', async ({ page }) => {
  await page.goto(FIXTURE)

  const handle = await attach(page, { outDir: dir, plugins: [webStorage()] })

  await page.evaluate(() => {
    localStorage.setItem('foo', 'bar')           // new key
    localStorage.setItem('foo', 'baz')           // overwrite
    sessionStorage.setItem('s', '1')
    localStorage.removeItem('foo')
    sessionStorage.clear()                       // clears 'preexisting-session' and 's'
  })
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const writes = events.filter((e: { type: string }) => e.type === 'webStorage.write')

  expect(writes).toHaveLength(5)

  expect(writes[0].metadata).toMatchObject({
    storageType: 'localStorage',
    operation: 'set',
    key: 'foo',
    newValue: 'bar',
  })
  expect(writes[0].metadata.oldValue).toBeUndefined()

  expect(writes[1].metadata).toMatchObject({
    storageType: 'localStorage',
    operation: 'set',
    key: 'foo',
    oldValue: 'bar',
    newValue: 'baz',
  })

  expect(writes[2].metadata).toMatchObject({
    storageType: 'sessionStorage',
    operation: 'set',
    key: 's',
    newValue: '1',
  })

  expect(writes[3].metadata).toMatchObject({
    storageType: 'localStorage',
    operation: 'remove',
    key: 'foo',
    oldValue: 'baz',
  })

  expect(writes[4].metadata).toMatchObject({
    storageType: 'sessionStorage',
    operation: 'clear',
  })
  expect(new Set(writes[4].metadata.clearedKeys)).toEqual(new Set(['preexisting-session', 's']))
})

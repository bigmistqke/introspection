import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { attach } from '@introspection/playwright'
import { jsError } from '@introspection/plugin-js-error'
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

test('captures getItem when reads option is enabled', async ({ page }) => {
  await page.goto(FIXTURE)

  const handle = await attach(page, { outDir: dir, plugins: [webStorage({ reads: true })] })

  const result = await page.evaluate(() => ({
    hit:  localStorage.getItem('preexisting-local'),
    miss: localStorage.getItem('does-not-exist'),
  }))
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  expect(result).toEqual({ hit: 'l-1', miss: null })

  const events = await readEvents(dir)
  const reads = events.filter((e: { type: string }) => e.type === 'webStorage.read')

  expect(reads).toHaveLength(2)
  expect(reads[0].metadata).toMatchObject({ storageType: 'localStorage', key: 'preexisting-local', value: 'l-1' })
  expect(reads[1].metadata).toMatchObject({ storageType: 'localStorage', key: 'does-not-exist', value: null })
})

test('does not capture reads by default', async ({ page }) => {
  await page.goto(FIXTURE)

  const handle = await attach(page, { outDir: dir, plugins: [webStorage()] })
  await page.evaluate(() => localStorage.getItem('preexisting-local'))
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const reads = events.filter((e: { type: string }) => e.type === 'webStorage.read')
  expect(reads).toHaveLength(0)
})

test('emits a snapshot on handle.snapshot()', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [webStorage()] })

  await page.evaluate(() => localStorage.setItem('after', 'attach'))
  await handle.snapshot()
  await new Promise(r => setTimeout(r, 100))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'webStorage.snapshot')

  const manual = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'manual')
  expect(manual).toBeDefined()
  expect(manual.metadata.localStorage).toMatchObject({ 'preexisting-local': 'l-1', 'after': 'attach' })

  const detach = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'detach')
  expect(detach).toBeDefined()
})

test('emits a snapshot on js.error', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [webStorage(), jsError()] })

  await page.evaluate(() => { setTimeout(() => { throw new Error('boom') }, 0) })
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'webStorage.snapshot')
  const onError = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'js.error')
  expect(onError).toBeDefined()
})

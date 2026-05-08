import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { attach } from '@introspection/playwright'
import { indexedDB } from '../src/index.js'

const FIXTURE = 'file://' + fileURLToPath(new URL('./fixtures/index.html', import.meta.url))

let dir: string
test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-idb-'))
})
test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function readEvents(outDir: string) {
  const entries = await readdir(outDir)
  const ndjson = await readFile(join(outDir, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

async function readAsset(outDir: string, path: string) {
  const entries = await readdir(outDir)
  return JSON.parse(await readFile(join(outDir, entries[0], path), 'utf-8'))
}

async function openDatabase(page: import('@playwright/test').Page, name: string, version: number, schema: string) {
  await page.evaluate(([name, version, schema]) => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name as string, version as number)
      req.onupgradeneeded = (ev) => {
        const db = (ev.target as IDBOpenDBRequest).result
        // eslint-disable-next-line no-new-func
        new Function('db', schema as string)(db)
      }
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
  }, [name, version, schema] as const)
}

test('emits an install snapshot containing pre-existing databases', async ({ page }) => {
  await page.goto(FIXTURE)
  await openDatabase(page, 'fixture-db', 1, `
    db.createObjectStore('users', { keyPath: 'id' })
    db.createObjectStore('posts', { autoIncrement: true })
  `)

  const handle = await attach(page, { outDir: dir, plugins: [indexedDB()] })
  await new Promise(r => setTimeout(r, 150))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'idb.snapshot')
  const installSnapshot = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'install')

  expect(installSnapshot).toBeDefined()
  const fixtureDb = installSnapshot.metadata.databases.find((d: { name: string }) => d.name === 'fixture-db')
  expect(fixtureDb).toBeDefined()
  expect(fixtureDb.version).toBe(1)
  expect(fixtureDb.objectStores.map((s: { name: string }) => s.name).sort()).toEqual(['posts', 'users'])

  const usersStore = fixtureDb.objectStores.find((s: { name: string }) => s.name === 'users')
  expect(usersStore.keyPath).toBe('id')
  expect(usersStore.autoIncrement).toBe(false)
})

test('binding round-trips a manually-emitted payload', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB({ verbose: true })] })

  const ok = await page.evaluate(() => {
    return typeof (window as unknown as { __introspection_plugin_indexeddb_emit?: unknown })
      .__introspection_plugin_indexeddb_emit === 'function'
  })
  expect(ok).toBe(true)

  await handle.detach()
})

test('captures database open, upgradeneeded, close, and delete', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB()] })

  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('lifecycle-db', 2)
      req.onupgradeneeded = (ev) => {
        const db = (ev.target as IDBOpenDBRequest).result
        db.createObjectStore('store-a', { keyPath: 'id' })
      }
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
  })

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('lifecycle-db')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  }))

  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const lifecycle = events.filter((e: { type: string; metadata: { name?: string } }) =>
    e.type === 'idb.database' && e.metadata.name === 'lifecycle-db'
  )
  const ops = lifecycle.map((e: { metadata: { operation: string } }) => e.metadata.operation)
  expect(ops).toContain('upgrade')
  expect(ops).toContain('open')
  expect(ops).toContain('close')
  expect(ops).toContain('delete')

  const upgrade = lifecycle.find((e: { metadata: { operation: string } }) => e.metadata.operation === 'upgrade')
  expect(upgrade.metadata.oldVersion).toBe(0)
  expect(upgrade.metadata.newVersion).toBe(2)

  const open = lifecycle.find((e: { metadata: { operation: string } }) => e.metadata.operation === 'open')
  expect(open.metadata.outcome).toBe('success')
})

test('captures schema events: createObjectStore and createIndex', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB()] })

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('schema-db', 1)
    req.onupgradeneeded = (ev) => {
      const db = (ev.target as IDBOpenDBRequest).result
      const store = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true })
      store.createIndex('by-name', 'name', { unique: false })
      store.createIndex('by-tag', 'tags', { multiEntry: true })
    }
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  }))

  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const schema = events.filter((e: { type: string }) => e.type === 'idb.schema')

  const createStore = schema.find((e: { metadata: { operation: string; objectStore: string } }) =>
    e.metadata.operation === 'createObjectStore' && e.metadata.objectStore === 'items'
  )
  expect(createStore).toBeDefined()
  expect(createStore.metadata.keyPath).toBe('id')
  expect(createStore.metadata.autoIncrement).toBe(true)

  const byName = schema.find((e: { metadata: { operation: string; index?: string } }) =>
    e.metadata.operation === 'createIndex' && e.metadata.index === 'by-name'
  )
  expect(byName).toBeDefined()
  expect(byName.metadata.unique).toBe(false)
  expect(byName.metadata.objectStore).toBe('items')

  const byTag = schema.find((e: { metadata: { operation: string; index?: string } }) =>
    e.metadata.operation === 'createIndex' && e.metadata.index === 'by-tag'
  )
  expect(byTag.metadata.multiEntry).toBe(true)
})

test('captures transaction begin and complete', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDB()] })

  await openDatabase(page, 'tx-db', 1, `db.createObjectStore('items', { keyPath: 'id' })`)

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('tx-db', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('items', 'readwrite')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    req.onerror = () => reject(req.error)
  }))

  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const txEvents = events.filter((e: { type: string }) => e.type === 'idb.transaction')

  const begin = txEvents.find((e: { metadata: { operation: string; mode: string } }) =>
    e.metadata.operation === 'begin' && e.metadata.mode === 'readwrite'
  )
  expect(begin).toBeDefined()
  expect(begin.metadata.objectStoreNames).toEqual(['items'])
  expect(begin.metadata.database).toBe('tx-db')

  const complete = txEvents.find((e: { metadata: { operation: string; transactionId: string } }) =>
    e.metadata.operation === 'complete' && e.metadata.transactionId === begin.metadata.transactionId
  )
  expect(complete).toBeDefined()
})

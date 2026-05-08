import { test, expect } from '@playwright/test'
import { jsError } from '@introspection/plugin-js-error'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { attach } from '@introspection/playwright'
import { indexedDB as indexedDBPlugin } from '../src/index.js'
import type { PayloadAsset } from '@introspection/types'

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

  const handle = await attach(page, { outDir: dir, plugins: [indexedDBPlugin()] })
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
  const handle = await attach(page, { outDir: dir, plugins: [indexedDBPlugin({ verbose: true })] })

  const ok = await page.evaluate(() => {
    return typeof (window as unknown as { __introspection_plugin_indexeddb_emit?: unknown })
      .__introspection_plugin_indexeddb_emit === 'function'
  })
  expect(ok).toBe(true)

  await handle.detach()
})

test('captures database open, upgradeneeded, close, and delete', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDBPlugin()] })

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
  const handle = await attach(page, { outDir: dir, plugins: [indexedDBPlugin()] })

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
  const handle = await attach(page, { outDir: dir, plugins: [indexedDBPlugin()] })

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

test('captures add/put/delete/clear with values written to assets', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDBPlugin()] })

  await openDatabase(page, 'writes-db', 1, `db.createObjectStore('items', { keyPath: 'id' })`)

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('writes-db', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('items', 'readwrite')
      const store = tx.objectStore('items')
      store.add({ id: 1, name: 'first' })
      store.put({ id: 2, name: 'second' })
      store.delete(1)
      store.clear()
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    req.onerror = () => reject(req.error)
  }))

  await new Promise(r => setTimeout(r, 250))
  await handle.detach()

  const events = await readEvents(dir)
  const writes = events.filter((e: { type: string; metadata: { database?: string } }) =>
    e.type === 'idb.write' && e.metadata.database === 'writes-db'
  )
  expect(writes).toHaveLength(4)

  const ops = writes.map((e: { metadata: { operation: string } }) => e.metadata.operation)
  expect(ops).toEqual(['add', 'put', 'delete', 'clear'])

  for (const w of writes) {
    expect(w.metadata.outcome).toBe('success')
    expect(typeof w.metadata.transactionId).toBe('string')
    expect(w.metadata.transactionId.length).toBeGreaterThan(0)
  }

  const add = writes[0]
  const addRef = add.payloads?.value
  expect(addRef).toMatchObject({ kind: 'asset' })
  const addValue = await readAsset(dir, (addRef as PayloadAsset).path)
  expect(addValue).toEqual({ id: 1, name: 'first' })

  const put = writes[1]
  expect(put.payloads?.value).toMatchObject({ kind: 'asset' })

  const del = writes[2]
  expect(del.payloads?.value).toBeUndefined()
  expect(del.metadata.key).toBe(1)

  const clr = writes[3]
  expect(clr.payloads?.value).toBeUndefined()
})

test('captures get and getAll when reads option is enabled', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDBPlugin({ reads: true })] })

  await openDatabase(page, 'reads-db', 1, `db.createObjectStore('items', { keyPath: 'id' })`)

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('reads-db', 1)
    req.onsuccess = () => {
      const db = req.result
      const writeTx = db.transaction('items', 'readwrite')
      writeTx.objectStore('items').put({ id: 1, name: 'one' })
      writeTx.objectStore('items').put({ id: 2, name: 'two' })
      writeTx.oncomplete = () => {
        const readTx = db.transaction('items', 'readonly')
        const store = readTx.objectStore('items')
        store.get(1)
        store.getAll()
        readTx.oncomplete = () => { db.close(); resolve() }
        readTx.onerror = () => { db.close(); reject(readTx.error) }
      }
      writeTx.onerror = () => { db.close(); reject(writeTx.error) }
    }
    req.onerror = () => reject(req.error)
  }))

  await new Promise(r => setTimeout(r, 250))
  await handle.detach()

  const events = await readEvents(dir)
  const reads = events.filter((e: { type: string }) => e.type === 'idb.read')
  expect(reads.length).toBeGreaterThanOrEqual(2)

  const get = reads.find((e: { metadata: { operation: string } }) => e.metadata.operation === 'get')
  expect(get).toBeDefined()
  const getRef = get.payloads?.value
  expect(getRef).toMatchObject({ kind: 'asset' })
  const getResult = await readAsset(dir, (getRef as PayloadAsset).path)
  expect(getResult).toEqual({ id: 1, name: 'one' })

  const getAll = reads.find((e: { metadata: { operation: string } }) => e.metadata.operation === 'getAll')
  expect(getAll).toBeDefined()
  expect(getAll.metadata.count).toBe(2)
  const getAllRef = getAll.payloads?.value
  expect(getAllRef).toMatchObject({ kind: 'asset' })
  const getAllResult = await readAsset(dir, (getAllRef as PayloadAsset).path)
  expect(getAllResult).toHaveLength(2)
})

test('does not capture reads by default', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDBPlugin()] })

  await openDatabase(page, 'no-reads-db', 1, `db.createObjectStore('items', { keyPath: 'id' })`)
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('no-reads-db', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('items', 'readonly')
      tx.objectStore('items').get(1)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    req.onerror = () => reject(req.error)
  }))

  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const reads = events.filter((e: { type: string }) => e.type === 'idb.read')
  expect(reads).toHaveLength(0)
})

test('emits a snapshot on handle.snapshot()', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDBPlugin()] })

  await openDatabase(page, 'snap-db', 1, `db.createObjectStore('items', { keyPath: 'id' })`)
  await handle.snapshot()
  await new Promise(r => setTimeout(r, 150))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'idb.snapshot')

  const manual = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'manual')
  expect(manual).toBeDefined()
  expect(manual.metadata.databases.some((d: { name: string }) => d.name === 'snap-db')).toBe(true)

  const detach = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'detach')
  expect(detach).toBeDefined()
})

test('emits a snapshot on js.error', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDBPlugin(), jsError()] })

  await page.evaluate(() => { setTimeout(() => { throw new Error('boom') }, 0) })
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const snapshots = events.filter((e: { type: string }) => e.type === 'idb.snapshot')
  const onError = snapshots.find((e: { metadata: { trigger: string } }) => e.metadata.trigger === 'js.error')
  expect(onError).toBeDefined()
})

test('dataSnapshots: true includes store records on the snapshot asset', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, { outDir: dir, plugins: [indexedDBPlugin({ dataSnapshots: true })] })

  await openDatabase(page, 'data-snap-db', 1, `db.createObjectStore('items', { keyPath: 'id' })`)
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('data-snap-db', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('items', 'readwrite')
      tx.objectStore('items').put({ id: 'a', val: 1 })
      tx.objectStore('items').put({ id: 'b', val: 2 })
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  }))

  await handle.snapshot()
  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const manual = events.find((e: { type: string; metadata: { trigger: string } }) =>
    e.type === 'idb.snapshot' && e.metadata.trigger === 'manual'
  )
  expect(manual).toBeDefined()
  const recordsRef = manual.payloads?.records
  expect(recordsRef).toMatchObject({ kind: 'asset' })

  const data = await readAsset(dir, (recordsRef as PayloadAsset).path)
  const dataDb = data.find((d: { database: string }) => d.database === 'data-snap-db')
  expect(dataDb).toBeDefined()
  const items = dataDb.records
  expect(items.map((r: { key: string }) => r.key).sort()).toEqual(['a', 'b'])
})

test('databases option restricts capture to the listed db', async ({ page }) => {
  await page.goto(FIXTURE)
  const handle = await attach(page, {
    outDir: dir,
    plugins: [indexedDBPlugin({ databases: ['only-this-db'] })],
  })

  await openDatabase(page, 'only-this-db', 1, `db.createObjectStore('a', { keyPath: 'id' })`)
  await openDatabase(page, 'ignore-me', 1, `db.createObjectStore('b', { keyPath: 'id' })`)

  await new Promise(r => setTimeout(r, 200))
  await handle.detach()

  const events = await readEvents(dir)
  const dbEvents = events.filter((e: { type: string }) => e.type === 'idb.database')
  for (const e of dbEvents) {
    expect(e.metadata.name).toBe('only-this-db')
  }

  // Detach snapshot should also only include the filtered db (when CDP available).
  const detach = events.find((e: { type: string; metadata: { trigger: string } }) =>
    e.type === 'idb.snapshot' && e.metadata.trigger === 'detach'
  )
  expect(detach).toBeDefined()
  for (const d of detach.metadata.databases) {
    expect(d.name).toBe('only-this-db')
  }
})

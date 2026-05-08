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

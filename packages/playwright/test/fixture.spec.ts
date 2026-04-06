import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { introspectFixture } from '../src/fixture.js'

const outDir = mkdtempSync(join(tmpdir(), 'introspect-fixture-'))
const { test, expect } = introspectFixture({ outDir })

test('fixture auto-attaches and records mark events', async ({ introspect }) => {
  introspect.mark('step 1', { extra: true })
})

test.afterAll(() => {
  const entries = readdirSync(outDir).filter(e => !e.startsWith('.'))
  expect(entries.length).toBeGreaterThan(0)
  const sessionDir = join(outDir, entries[0])
  const meta = JSON.parse(readFileSync(join(sessionDir, 'meta.json'), 'utf-8'))
  expect(meta.endedAt).toBeDefined()

  const ndjson = readFileSync(join(sessionDir, 'events.ndjson'), 'utf-8')
  const events = ndjson.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))

  const mark = events.find((e: { type: string }) => e.type === 'mark')
  expect(mark).toBeDefined()
  expect(mark.data.label).toBe('step 1')

  const result = events.find((e: { type: string }) => e.type === 'playwright.result')
  expect(result).toBeDefined()
  expect(result.data.status).toBe('passed')

  rmSync(outDir, { recursive: true, force: true })
})

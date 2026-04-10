import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { introspectFixture } from '../src/fixture.js'
import { defaults } from '@introspection/plugin-defaults'

const outDir = mkdtempSync(join(tmpdir(), 'introspect-fixture-'))
const { test, expect } = introspectFixture({ outDir, plugins: defaults() })

test('fixture auto-attaches and records mark events', async ({ introspect }) => {
  introspect.mark('step 1', { extra: true })
})

test.afterAll(() => {
  const entries = readdirSync(outDir).filter(entry => !entry.startsWith('.'))
  expect(entries.length).toBeGreaterThan(0)
  const sessionDir = join(outDir, entries[0])
  const meta = JSON.parse(readFileSync(join(sessionDir, 'meta.json'), 'utf-8'))
  expect(meta.endedAt).toBeDefined()

  const ndjson = readFileSync(join(sessionDir, 'events.ndjson'), 'utf-8')
  const events = ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))

  const mark = events.find((event: { type: string }) => event.type === 'mark')
  expect(mark).toBeDefined()
  expect(mark.data.label).toBe('step 1')

  const playwrightResult = events.find((event: { type: string }) => event.type === 'playwright.result')
  expect(playwrightResult).toBeDefined()
  expect(playwrightResult.data.status).toBe('passed')

  rmSync(outDir, { recursive: true, force: true })
})

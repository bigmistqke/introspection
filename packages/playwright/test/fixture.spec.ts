import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { introspectFixture } from '../src/fixture.js'
import { defaults } from '@introspection/plugin-defaults'

const outDir = mkdtempSync(join(tmpdir(), 'introspect-fixture-'))
const { test, expect } = introspectFixture({ outDir, plugins: defaults() })

test('fixture auto-attaches and records events', async ({ introspect }) => {
  await introspect.emit({ type: 'mark', metadata: { label: 'step 1', extra: true } })
})

test('fixture emits playwright.test.start with titlePath', async ({ introspect }) => {
  // just needs to run — the afterAll checks the events across all sessions
})

test.afterAll(() => {
  const entries = readdirSync(outDir).filter(entry => !entry.startsWith('.'))
  expect(entries.length).toBeGreaterThan(0)

  // Collect events from all sessions
  const allEvents: Record<string, unknown>[] = []
  for (const entry of entries) {
    const sessionDir = join(outDir, entry)
    const meta = JSON.parse(readFileSync(join(sessionDir, 'meta.json'), 'utf-8'))
    expect(meta.endedAt).toBeDefined()
    const ndjson = readFileSync(join(sessionDir, 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    allEvents.push(...events)
  }

  const mark = allEvents.find((event: Record<string, unknown>) => event.type === 'mark') as Record<string, unknown> | undefined
  expect(mark).toBeDefined()
  expect((mark!.metadata as Record<string, unknown>).label).toBe('step 1')

  const playwrightResult = allEvents.find((event: Record<string, unknown>) => event.type === 'playwright.result') as Record<string, unknown> | undefined
  expect(playwrightResult).toBeDefined()
  expect((playwrightResult!.metadata as Record<string, unknown>).status).toBe('passed')
  expect((playwrightResult!.metadata as Record<string, unknown>).titlePath).toBeDefined()

  const testStart = allEvents.find((event: Record<string, unknown>) => event.type === 'playwright.test.start') as Record<string, unknown> | undefined
  expect(testStart).toBeDefined()
  expect((testStart!.metadata as Record<string, unknown>).titlePath).toBeDefined()
  expect(Array.isArray((testStart!.metadata as Record<string, unknown>).titlePath)).toBe(true)

  rmSync(outDir, { recursive: true, force: true })
})

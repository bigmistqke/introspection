import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { attach } from '@introspection/playwright'
import { focusElement } from '../dist/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

let outDir: string

test.beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-focus-'))
})

test.afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

async function readEvents(outDirectory: string): Promise<Array<Record<string, unknown>>> {
  const entries = await readdir(outDirectory)
  const ndjson = await readFile(join(outDirectory, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

async function gotoFixture(page: import('@playwright/test').Page, name: string) {
  await page.goto('file://' + join(HERE, 'fixtures', name))
}

test('emits initial focus snapshot for autofocused element', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [focusElement()] })
  await gotoFixture(page, 'simple.html')
  await page.waitForFunction(() => document.activeElement?.id === 'beta')
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const focusEvents = events.filter((e) => e.type === 'focus.changed')
  expect(focusEvents.length).toBeGreaterThanOrEqual(1)
  const initial = focusEvents[0] as { metadata: { previous: unknown; target: { id: string }; cause: string } }
  expect(initial.metadata.previous).toBeNull()
  expect(initial.metadata.target.id).toBe('beta')
  expect(initial.metadata.cause).toBe('unknown')
})

test('tracks user-driven focus moves with previous chain', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [focusElement()] })
  await gotoFixture(page, 'simple.html')
  await page.waitForFunction(() => document.activeElement?.id === 'beta')
  await page.locator('#alpha').focus()
  await page.locator('#go').focus()
  await handle.flush()
  await handle.detach()

  const events = (await readEvents(outDir)).filter((e) => e.type === 'focus.changed') as Array<{
    metadata: { target: { id: string } | null; previous: { id: string } | null; cause: string }
  }>
  // initial + 2 transitions = 3
  expect(events.length).toBe(3)
  expect(events[1].metadata.previous?.id).toBe('beta')
  expect(events[1].metadata.target?.id).toBe('alpha')
  expect(events[2].metadata.previous?.id).toBe('alpha')
  expect(events[2].metadata.target?.id).toBe('go')
})

test('classifies .focus() calls as programmatic with callSite', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [focusElement()] })
  await gotoFixture(page, 'simple.html')
  await page.waitForFunction(() => document.activeElement?.id === 'beta')

  await page.evaluate(() => {
    function focusAlphaFromHelper() {
      (document.getElementById('alpha') as HTMLInputElement).focus()
    }
    focusAlphaFromHelper()
  })
  await handle.flush()
  await handle.detach()

  const events = (await readEvents(outDir)).filter((e) => e.type === 'focus.changed') as Array<{
    metadata: { target: { id: string } | null; cause: string; callSite?: string }
  }>
  const programmatic = events.find((e) => e.metadata.target?.id === 'alpha')
  expect(programmatic).toBeDefined()
  expect(programmatic!.metadata.cause).toBe('programmatic')
  expect(programmatic!.metadata.callSite).toBeDefined()
  expect(programmatic!.metadata.callSite).toMatch(/focusAlphaFromHelper/)
})

test('captures role, accessibleName, testid, selector, text on target', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [focusElement()] })
  await gotoFixture(page, 'simple.html')
  await page.waitForFunction(() => document.activeElement?.id === 'beta')
  await page.locator('#go').focus()
  await handle.flush()
  await handle.detach()

  const events = (await readEvents(outDir)).filter((e) => e.type === 'focus.changed') as Array<{
    metadata: { target: {
      tag: string; id: string | null; testid: string | null; role: string | null;
      accessibleName: string | null; text: string | null; selector: string
    } | null }
  }>
  const buttonEvent = events.find((e) => e.metadata.target?.id === 'go')
  expect(buttonEvent).toBeDefined()
  const { target } = buttonEvent!.metadata
  expect(target!.tag).toBe('button')
  expect(target!.testid).toBe('go-btn')
  expect(target!.role).toBe('button')          // implicit role from tag
  expect(target!.accessibleName).toBe('Go')    // from innerText fallback
  expect(target!.text).toBe('Go')
  expect(target!.selector).toBe('button#go')

  const inputEvent = events.find((e) => e.metadata.target?.id === 'beta')
  expect(inputEvent!.metadata.target!.role).toBe('textbox')
  expect(inputEvent!.metadata.target!.accessibleName).toBe('Beta')  // from aria-label
})

test('walks shadow DOM and reports shadowPath on target', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [focusElement()] })
  await gotoFixture(page, 'shadow.html')
  await page.locator('#trigger').click()
  await page.waitForFunction(() => {
    const host = document.getElementById('card') as HTMLElement & { shadowRoot: ShadowRoot }
    return host.shadowRoot?.activeElement?.id === 'inner-input'
  })
  await handle.flush()
  await handle.detach()

  const events = (await readEvents(outDir)).filter((e) => e.type === 'focus.changed') as Array<{
    metadata: { target: { id: string | null; tag: string; shadowPath: string[] | null } | null }
  }>
  const inner = events.find((e) => e.metadata.target?.id === 'inner-input')
  expect(inner).toBeDefined()
  expect(inner!.metadata.target!.tag).toBe('input')
  expect(inner!.metadata.target!.shadowPath).toEqual(['my-card#card'])
})

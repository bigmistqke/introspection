import { test, expect } from '@playwright/test'
import { attachRun } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'
import { reactScanPlugin } from '@introspection/plugin-react-scan'
import { createTraceReader } from '@introspection/read/node'
import { join } from 'node:path'

test('captures react renders from the demo', async ({ page }) => {
  // Capture into a run directory (.introspect/<run-id>/<trace-id>/)
  const handle = await attachRun(page, {
    plugins: [...defaults(), reactScanPlugin({ verbose: true })],
    testTitle: 'react-plugin-capture',
  })

  await handle.page.goto('/')
  // Tighten: verify the captured trace is rendered in the trace list.
  // The app renders summary.label ?? summary.id; testTitle sets the label to
  // 'react-plugin-capture', so that's what appears in the DOM (not the UUID).
  const testTitle = 'react-plugin-capture'
  await expect(page.locator('body')).toContainText(testTitle, { timeout: 10000 })

  await handle.detach({ status: 'passed' })

  const reader = await createTraceReader(join(process.cwd(), '.introspect'), {
    runId: handle.runId,
    traceId: handle.trace.id,
  })
  const events = await reader.events.ls()

  const renders = events.filter(event => event.type === 'react-scan.render')
  const commits = events.filter(event => event.type === 'react-scan.commit')

  expect(renders.length).toBeGreaterThan(0)
  expect(commits.length).toBeGreaterThan(0)
  expect(renders.some(event => String(event.metadata?.component ?? '').includes('App'))).toBe(true)
})

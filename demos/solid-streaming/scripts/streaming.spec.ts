import { test, expect } from '@playwright/test'
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'

test('streaming demo auto-connects and streams events', async ({ page }) => {
  const handle = await attach(page, {
    testTitle: 'streaming demo',
    plugins: defaults(),
    outDir: '.introspect',
  })

  await handle.page.goto('/')

  // Should auto-connect and start streaming
  await expect(handle.page.locator('.status')).toHaveText('connected', { timeout: 5000 })

  // Wait for events to stream in
  await handle.page.waitForSelector('.event', { timeout: 10000 })

  // Should have multiple events in the timeline
  const eventCount = await handle.page.locator('.event').count()
  expect(eventCount).toBeGreaterThan(0)

  // Wait for stream to complete
  await expect(handle.page.locator('.status')).toHaveText('done', { timeout: 15000 })

  // Click an event to see detail
  await handle.page.locator('.event').first().click()

  // Detail panel should show event data
  await expect(handle.page.locator('.detail h3')).toBeVisible()

  await handle.detach({ status: 'passed', duration: 0 })
})

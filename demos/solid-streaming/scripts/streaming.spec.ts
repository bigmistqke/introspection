import { test, expect } from '@playwright/test'
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'
import { solidDevtools } from '@introspection/plugin-solid'

test('streaming demo auto-connects and streams events', async ({ page }) => {
  const handle = await attach(page, {
    testTitle: 'streaming demo',
    plugins: [...defaults(), solidDevtools()],
    outDir: '.introspect',
  })

  await handle.page.goto('/')

  // Should auto-connect and start streaming
  await expect(handle.page.locator('.status')).toHaveText('connected', { timeout: 5000 })

  // Wait a bit for SSE events to push
  await handle.page.waitForTimeout(3000)

  // Capture solid state + snapshot for debugging
  await handle.snapshot()

  // Check what the UI shows
  const eventsText = await handle.page.locator('.count').first().textContent()
  const allCounts = await handle.page.locator('.count').allTextContents()

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

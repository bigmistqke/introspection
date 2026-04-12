import { test, expect } from '@playwright/test'
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'

test('renders trace session in timeline viewer', async ({ page }) => {
  // Set up a simple fixture page
  await page.route('/fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<html><head><title>Test Fixture</title></head><body><button id="test-btn">Click me</button></body></html>',
  }))

  // Attach introspection and generate events
  const handle = await attach(page, {
    plugins: [...defaults()],
    outDir: '.introspect',
  })

  await handle.page.goto('/fixture')
  await handle.page.click('#test-btn')

  await handle.detach({ status: 'passed' })

  // Navigate to the demo to view the trace
  await page.goto('/')

  // Wait for the demo to load and display the session with events
  await expect(page.locator('#timeline .event').first()).toBeVisible({ timeout: 10000 })

  // Verify multiple events are displayed
  const eventCount = await page.locator('#timeline .event').count()
  expect(eventCount).toBeGreaterThan(0)

  // Verify the detail panel exists
  const detailPanel = page.locator('#detail')
  await expect(detailPanel).toBeVisible()
})

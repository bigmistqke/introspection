import { test, expect } from '@playwright/test'
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'

test('renders session cards with event counts', async ({ page }) => {
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

  // Wait for session to be fully written to disk before navigating
  // This is important because the demo will try to fetch from /__introspect/
  await page.waitForTimeout(2000)

  // Navigate to the demo to view the session
  await page.goto('/', { waitUntil: 'networkidle' })

  // Wait a moment for the page to settle
  await page.waitForTimeout(500)

  // Check what we have
  const content = await page.locator('body').textContent()
  console.log('Page text:', content)

  // Check for any console errors
  page.on('console', msg => console.log('Browser console:', msg.type(), msg.text()))
  page.on('pageerror', err => console.error('Page error:', err))

  // Wait for the h1 with "Sessions" to appear (should load quickly)
  await page.waitForSelector('h1', { timeout: 5000 })

  // Verify that the page loaded properly
  const heading = await page.locator('h1').textContent()
  expect(heading).toContain('Sessions')

  // The page should eventually show sessions (might need time for Suspense to resolve)
  await expect(page.locator('text=actions')).toBeVisible({ timeout: 10000 })
})

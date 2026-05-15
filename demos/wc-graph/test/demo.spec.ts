import { test, expect } from '@playwright/test'
import { attachRun } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'

test('renders event graph visualization', async ({ page }) => {
  // Set up a simple fixture page
  await page.route('/fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<html><head><title>Test Fixture</title></head><body><button id="test-btn">Click me</button></body></html>',
  }))

  // Capture into a run directory (.introspect/<run-id>/<trace-id>/)
  const handle = await attachRun(page, {
    plugins: [...defaults()],
  })

  await handle.page.goto('/fixture')
  await handle.page.click('#test-btn')

  await handle.detach({ status: 'passed' })

  // Navigate to the demo to view the trace as a graph
  await page.goto('/')

  // Wait for the demo to load and display the graph
  // The event-graph web component should be visible
  const eventGraph = page.locator('event-graph')
  await expect(eventGraph).toBeVisible({ timeout: 10000 })

  // Verify the graph contains a canvas element for rendering
  const canvas = eventGraph.locator('canvas')
  await expect(canvas).toBeVisible()

  // Verify the select for trace selection exists and has options
  const selectElement = page.locator('select')
  await expect(selectElement).toBeVisible()
  const options = selectElement.locator('option')
  expect(await options.count()).toBeGreaterThan(0)

  // Tighten: verify the captured trace id is actually surfaced.
  // Poll because vite's file watcher may need a tick to pick up the new
  // .introspect/ data written by attachRun.
  const captured = handle.trace.id
  await expect(async () => {
    const optionTexts = await options.allTextContents()
    expect(optionTexts.some(t => t.includes(captured))).toBe(true)
  }).toPass({ timeout: 5000 })
})

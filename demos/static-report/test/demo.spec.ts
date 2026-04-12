import { test, expect } from 'vitest'
import { chromium } from 'playwright'
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'
import { execa } from 'execa'
import { readFileSync } from 'fs'
import { resolve } from 'path'

test('generates HTML report from trace', async () => {
  // Create a session using introspection
  const browser = await chromium.launch()
  const page = await browser.newPage()

  // Set up a simple fixture
  await page.route('/fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<html><head><title>Test</title></head><body><h1>Test Page</h1></body></html>',
  }))

  const handle = await attach(page, {
    plugins: [...defaults()],
    outDir: '.introspect',
  })

  await handle.page.goto('/fixture')
  await handle.detach({ status: 'passed' })

  await browser.close()

  // Run the generate script
  const outDir = resolve('.')
  const reportPath = resolve(outDir, 'test-report.html')

  await execa('tsx', ['generate.ts', outDir, reportPath])

  // Verify the output HTML
  const html = readFileSync(reportPath, 'utf-8')

  expect(html).toContain('<h2')
  expect(html).toContain('</h2>')
  expect(html).toMatch(/<table[^>]*>/)
  expect(html).toMatch(/<tr[^>]*>/)
  expect(html).toMatch(/<td[^>]*>/)

  // Verify it contains event-related content
  expect(html).toMatch(/browser\.navigate|page\.attach|passed/)
})

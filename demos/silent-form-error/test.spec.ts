import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { attach } from '@introspection/playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(__dirname, 'app.html'), 'utf-8')

// Serve the app and its API entirely via Playwright route interception —
// no dev server needed.
const APP_URL = 'http://demo.test'

test('shows validation error on invalid card number', async ({ page }) => {
  await page.route(`${APP_URL}/`, route =>
    route.fulfill({ body: html, contentType: 'text/html' })
  )
  await page.route(`${APP_URL}/api/payment/validate`, route =>
    route.fulfill({
      status: 422,
      body: JSON.stringify({ errors: [{ field: 'card_number', message: 'Must be 16 digits' }] }),
      headers: { 'content-type': 'application/json' },
    })
  )

  const handle = await attach(page, {
    outDir: join(__dirname, '.introspect'),
    label: 'silent-form-error',
  })

  await page.goto(APP_URL)
  await page.fill('[name=card]', '1234')
  await page.click('[type=submit]')

  await expect(page.getByTestId('card-error')).toBeVisible({ timeout: 2000 })

  await handle.detach()
})

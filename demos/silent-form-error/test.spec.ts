import { test, expect } from '@playwright/test'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { attach, defaults } from '@introspection/playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('shows validation error on invalid card number', async ({ page }) => {
  await page.route('**/api/payment/validate', route =>
    route.fulfill({
      status: 422,
      body: JSON.stringify({ errors: [{ field: 'card_number', message: 'Must be 16 digits' }] }),
      headers: { 'content-type': 'application/json' },
    })
  )

  const handle = await attach(page, {
    outDir: join(__dirname, '.introspect'),
    testTitle: 'silent-form-error',
    plugins: defaults(),
  })

  await page.goto('/')
  await page.fill('[name=card]', '1234')
  await page.click('[type=submit]')

  await expect(page.getByTestId('card-error')).toBeVisible({ timeout: 2000 })

  await handle.detach()
})

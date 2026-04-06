import { test, expect } from '@introspection/playwright/fixture'

test('shows validation error on invalid card number', async ({ page }) => {
  await page.route('/api/payment/validate', route =>
    route.fulfill({
      status: 422,
      body: JSON.stringify({ errors: [{ field: 'card_number', message: 'Must be 16 digits' }] }),
      headers: { 'content-type': 'application/json' },
    }),
  )
  await page.goto('/checkout')
  await page.fill('[name=card]', '1234')
  await page.click('[type=submit]')
  await expect(page.getByTestId('card-error')).toBeVisible()
})

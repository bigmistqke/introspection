import { test, expect } from '@playwright/test'

test('profile loads after login', async ({ page }) => {
  await page.route('**/api/auth', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'secret-token' }),
    })
  )
  await page.route('**/api/profile', route => {
    const auth = route.request().headers()['authorization']
    if (!auth) {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unauthorized' }),
      })
    } else {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ name: 'Alice', role: 'Admin' }),
      })
    }
  })

  await page.goto('/')
  await page.waitForTimeout(500)

  await expect(page.locator('#profile-name')).toBeVisible()
})

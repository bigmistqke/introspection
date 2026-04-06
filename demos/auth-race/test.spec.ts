import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(__dirname, 'app.html'), 'utf-8')

const APP_URL = 'http://demo.test'

test('profile loads after login', async ({ page }) => {
  await page.route(`${APP_URL}/api/auth`, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'secret-token' }),
    })
  )
  await page.route(`${APP_URL}/api/profile`, route => {
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
  await page.route(`${APP_URL}/`, route =>
    route.fulfill({ body: html, contentType: 'text/html' })
  )

  await page.goto(APP_URL)
  await page.waitForTimeout(500)

  await expect(page.locator('#profile-name')).toBeVisible()
})

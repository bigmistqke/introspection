import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { attach } from '@introspection/playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(__dirname, 'app.html'), 'utf-8')

const APP_URL = 'http://demo.test'

test('leaderboard shows scores', async ({ page }) => {
  await page.route(`${APP_URL}/api/scores`, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: [
          { name: 'Alice', points: 980 },
          { name: 'Bob', points: 850 },
          { name: 'Carol', points: 720 },
        ],
      }),
    })
  )
  await page.route(`${APP_URL}/`, route =>
    route.fulfill({ body: html, contentType: 'text/html' })
  )

  const handle = await attach(page, {
    outDir: join(__dirname, '.introspect'),
    testTitle: 'missing-scores',
  })

  await page.goto(APP_URL)
  await page.waitForTimeout(300)

  await handle.snapshot()
  await handle.detach()

  await expect(page.locator('.score-entry').first()).toBeVisible()
})

import { test, expect } from '@playwright/test'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('leaderboard shows scores', async ({ page }) => {
  await page.route('**/api/scores', route =>
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

  const handle = await attach(page, {
    outDir: join(__dirname, '.introspect'),
    testTitle: 'missing-scores',
    plugins: defaults(),
  })

  await page.goto('/')
  await page.waitForTimeout(300)

  await handle.snapshot()
  await handle.detach()

  await expect(page.locator('.score-entry').first()).toBeVisible()
})

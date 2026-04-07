import { test, expect } from '@playwright/test'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { attach, defaults } from '@introspection/playwright'
import { webgl } from '@introspection/plugin-webgl'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('animation plays at correct speed', async ({ page }) => {
  const plugin = webgl()
  const handle = await attach(page, {
    outDir: join(__dirname, '.introspect'),
    testTitle: 'webgl-animation',
    plugins: [...defaults(), plugin],
  })

  await plugin.watch({ event: 'uniform', name: 'u_time', valueChanged: true })

  await page.goto('/')

  await page.waitForTimeout(2500)

  const frame1 = await page.screenshot()
  await page.waitForTimeout(500)
  const frame2 = await page.screenshot()

  expect(frame2).not.toEqual(frame1)

  await handle.detach()
})

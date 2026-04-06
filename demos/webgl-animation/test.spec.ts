import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { attach } from '@introspection/playwright'
import { webgl } from '@introspection/plugin-webgl'

const __dirname = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(__dirname, 'app.html'), 'utf-8')

const APP_URL = 'http://demo.test'

test('animation plays at correct speed', async ({ page }) => {
  await page.route(`${APP_URL}/`, route =>
    route.fulfill({ body: html, contentType: 'text/html' })
  )

  const plugin = webgl()
  const handle = await attach(page, {
    outDir: join(__dirname, '.introspect'),
    label: 'webgl-animation',
    plugins: [plugin],
  })

  // Watch u_time — only emit events when the value actually changes so we
  // can detect when the animation freezes.
  await plugin.watch({ event: 'uniform', name: 'u_time', valueChanged: true })

  await page.goto(APP_URL)

  await page.waitForTimeout(2500)

  const frame1 = await page.screenshot()
  await page.waitForTimeout(500)
  const frame2 = await page.screenshot()

  expect(frame2).not.toEqual(frame1)

  await handle.detach()
})

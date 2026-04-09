import { test, expect } from '@playwright/test'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'
import { webgl } from '@introspection/plugin-webgl'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('scene renders after data load', async ({ page }) => {
  await page.route('**/api/scene/1', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        nodes: [],
        geometry: [{ name: 'main', position: [0, 0.8, -0.7, -0.5, 0.7, -0.5] }],
      }),
    })
  )

  const plugin = webgl()
  const handle = await attach(page, {
    outDir: join(__dirname, '.introspect'),
    testTitle: 'black-canvas',
    plugins: [...defaults(), plugin],
  })

  await plugin.watch({ event: 'draw' })

  await page.goto('/')
  await page.waitForTimeout(500)

  await handle.snapshot()

  const centerPixel = await page.evaluate(() => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement
    const offscreen = document.createElement('canvas')
    offscreen.width = 1
    offscreen.height = 1
    const ctx = offscreen.getContext('2d')!
    ctx.drawImage(canvas, 200, 200, 1, 1, 0, 0, 1, 1)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data)
  })

  await handle.detach()

  const [r, g, b] = centerPixel
  expect(r > 0 || g > 0 || b > 0).toBe(true)
})

import { test, expect } from '@introspection/playwright'

test('sample test with a step', async ({ page }) => {
  await page.goto('about:blank')
  await test.step('do a thing', async () => {
    expect(1 + 1).toBe(2)
  })
})

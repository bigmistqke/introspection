import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/fixtures/**',
  use: {
    headless: true,
  },
})

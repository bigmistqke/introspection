import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  use: {
    headless: true,
  },
})

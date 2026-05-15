import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  retries: 2,
  workers: 1,
  use: {
    headless: true,
  },
})

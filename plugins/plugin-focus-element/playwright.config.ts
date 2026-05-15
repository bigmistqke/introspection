import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  retries: 2,
  workers: 1,
  use: { headless: true },
})

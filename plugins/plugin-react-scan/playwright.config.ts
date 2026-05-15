import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  retries: 2,
  workers: 1,
  use: { headless: true },
  webServer: {
    command: 'pnpm fixtures',
    port: 8766,
    reuseExistingServer: false,
  },
})

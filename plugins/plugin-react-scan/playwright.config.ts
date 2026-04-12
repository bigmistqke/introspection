import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  use: { headless: true },
  webServer: {
    command: 'pnpm fixtures',
    port: 8766,
    reuseExistingServer: true,
  },
})

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  use: {
    baseURL: 'http://localhost:5175',
  },
  webServer: {
    command: 'pnpm dev',
    port: 5175,
    reuseExistingServer: !process.env.CI,
  },
})

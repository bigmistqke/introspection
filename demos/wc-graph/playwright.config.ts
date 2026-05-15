import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:5176',
  },
  webServer: {
    command: 'pnpm dev',
    port: 5176,
    reuseExistingServer: !process.env.CI,
  },
})

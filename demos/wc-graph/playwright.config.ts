import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  timeout: 60000,
  retries: 2,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5176',
  },
  webServer: {
    command: 'pnpm dev',
    port: 5176,
    reuseExistingServer: false,
  },
})

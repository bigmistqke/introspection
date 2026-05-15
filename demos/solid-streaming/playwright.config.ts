import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './scripts',
  timeout: 60000,
  retries: 2,
  workers: 1,
  webServer: {
    command: 'pnpm dev',
    port: 5177,
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://localhost:5177',
  },
})

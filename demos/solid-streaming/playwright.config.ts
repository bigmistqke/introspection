import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './scripts',
  timeout: 60000,
  webServer: {
    command: 'pnpm dev',
    port: 5177,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:5177',
  },
})

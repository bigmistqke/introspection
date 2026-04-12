import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './scripts',
  webServer: {
    command: 'pnpm dev',
    port: 5177,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:5177',
  },
})

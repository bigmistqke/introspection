import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  use: {
    baseURL: 'http://localhost:5174',
  },
  webServer: {
    command: 'pnpm dev',
    port: 5174,
    reuseExistingServer: !process.env.CI,
  },
})

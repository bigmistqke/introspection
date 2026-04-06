import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  use: { headless: true, baseURL: 'http://localhost:5182' },
  webServer: { command: 'vite', url: 'http://localhost:5182', reuseExistingServer: !process.env.CI },
})

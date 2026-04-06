import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  use: { headless: true, baseURL: 'http://localhost:5183' },
  webServer: { command: 'vite', url: 'http://localhost:5183', reuseExistingServer: !process.env.CI },
})

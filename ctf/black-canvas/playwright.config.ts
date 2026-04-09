import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  use: {
    headless: true,
    baseURL: 'http://localhost:5185',
    launchOptions: {
      args: ['--enable-webgl', '--use-gl=swiftshader'],
    },
  },
  webServer: { command: 'vite', url: 'http://localhost:5185', reuseExistingServer: !process.env.CI },
})

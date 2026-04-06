import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  use: {
    headless: true,
    launchOptions: {
      args: ['--enable-webgl', '--use-gl=swiftshader'],
    },
  },
})

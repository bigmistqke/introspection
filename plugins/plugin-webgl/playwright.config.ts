import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  use: {
    headless: true,
    launchOptions: {
      args: ['--enable-webgl', '--use-gl=swiftshader'],
    },
  },
})

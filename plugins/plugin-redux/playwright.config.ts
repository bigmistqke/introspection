import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  retries: 2,
  workers: 1,
  use: {
    headless: true,
  },
  webServer: {
    command: `npx vite --config ${join(__dirname, 'test/fixtures/vite.config.ts')} --port 8765`,
    port: 8765,
    reuseExistingServer: false,
  },
})

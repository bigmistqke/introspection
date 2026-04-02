import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@introspection/playwright': path.resolve(__dirname, '../playwright/src/attach.ts'),
      '@introspection/types': path.resolve(__dirname, '../types/src/index.ts'),
    },
  },
  test: { globals: true },
})

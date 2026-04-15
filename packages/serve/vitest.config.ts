import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@introspection/serve': resolve(__dirname, 'src/index.ts'),
      '@introspection/serve/node': resolve(__dirname, 'src/node.ts'),
    },
  },
})
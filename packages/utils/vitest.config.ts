import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: { globals: true },
  resolve: {
    alias: {
      '@introspection/write': resolve(__dirname, '../write/src/index.ts'),
      '@introspection/read': resolve(__dirname, '../read/src/index.ts'),
      '@introspection/read/node': resolve(__dirname, '../read/src/node.ts'),
    },
  },
})

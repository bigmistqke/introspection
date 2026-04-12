import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  external: ['@playwright/test', '@introspection/playwright', '@introspection/write'],
})

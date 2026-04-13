import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/fixture.ts'],
  format: ['esm'],
  dts: true,
  external: ['@playwright/test'],
})

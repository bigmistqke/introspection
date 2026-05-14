import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/global-setup.ts', 'src/global-teardown.ts'],
  format: ['esm'],
  dts: true,
  external: ['@playwright/test'],
})

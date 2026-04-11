import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  dts: true,
  esbuildOptions(options) {
    options.loader = { ...options.loader, '.iife.js': 'text' }
  },
})

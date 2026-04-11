import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  dts: true,
  esbuildOptions(o) {
    o.loader = { ...o.loader, '.iife.js': 'text' }
  },
})

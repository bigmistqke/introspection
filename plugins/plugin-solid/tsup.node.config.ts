import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', setup: 'src/setup.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  dts: true,
  external: ['solid-js', '@solid-devtools/debugger'],
  esbuildOptions(options) {
    options.loader = { ...options.loader, '.iife.js': 'text' }
  },
})

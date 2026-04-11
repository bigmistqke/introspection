import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/client.ts'],
  format: ['esm'],
  outDir: 'dist',
  splitting: false,
  sourcemap: false,
  minify: false,
  dts: false,
})

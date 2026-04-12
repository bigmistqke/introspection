import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: 'esm',
    dts: true,
  },
  {
    entry: ['src/browser.ts'],
    format: 'iife',
    minify: true,
    target: 'es2020',
    noExternal: [/.*/],
    env: { NODE_ENV: 'development' },
  },
])

import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { browser: 'src/browser.ts' },
  outDir: 'dist',
  format: ['iife'],
  globalName: '__introspect_solid_browser__',
  platform: 'browser',
  minify: false,
  outExtension: () => ({ js: '.iife.js' }),
})

import { defineConfig } from 'tsup'
import { readFileSync } from 'fs'
import { resolve } from 'path'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  dts: false,
  esbuildPlugins: [
    {
      name: 'embed-browser-script',
      setup(build) {
        build.onLoad({ filter: /src\/index\.ts$/ }, async (args) => {
          const src = readFileSync(args.path, 'utf-8')
          const browserScript = readFileSync(resolve('dist/browser.iife.js'), 'utf-8')
          const result = src.replace("'__BROWSER_SCRIPT_PLACEHOLDER__'", JSON.stringify(browserScript))
          return { contents: result, loader: 'ts' }
        })
      },
    },
  ],
})

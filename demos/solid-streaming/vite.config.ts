import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { introspectionServe } from '@introspection/demo-shared/vite-plugin'
import { introspectionServeSSE } from './scripts/vite-plugin-sse.js'

export default defineConfig({
  plugins: [solid(), introspectionServe(), introspectionServeSSE()],
  server: {
    port: 5177,
    strictPort: true,
  },
})

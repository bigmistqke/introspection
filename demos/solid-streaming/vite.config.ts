import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { introspectionServe } from '@introspection/demo-shared/vite-plugin'

export default defineConfig({
  plugins: [solid(), introspectionServe()],
  server: {
    port: 5177,
    strictPort: true,
  },
})

import { defineConfig } from 'vite'
import { introspectionServe } from '@introspection/demo-shared/vite-plugin'

export default defineConfig({
  plugins: [introspectionServe()],
  server: {
    port: 5174,
  },
})

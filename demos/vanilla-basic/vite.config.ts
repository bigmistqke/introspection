import { defineConfig } from 'vite'
import { introspectionServe } from '@introspection/demo-shared/vite-plugin'

export default defineConfig({
  plugins: [introspectionServe()],
})

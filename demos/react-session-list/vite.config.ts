import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { introspectionServe } from '@introspection/demo-shared/vite-plugin'

export default defineConfig({
  plugins: [react(), introspectionServe()],
  server: {
    port: 5175,
  },
})

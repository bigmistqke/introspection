import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: __dirname,
  server: {
    port: 8765,
    middlewareMode: false,
  },
  build: {
    target: 'esnext',
  },
})

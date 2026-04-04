import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { introspection } from '@introspection/vite'

export default defineConfig({
  plugins: [react(), introspection()],
})

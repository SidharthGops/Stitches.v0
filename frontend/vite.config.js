import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const devApiProxy = process.env.VITE_DEV_API_PROXY || 'http://localhost:8787'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': devApiProxy,
      '/uploads': devApiProxy,
      '/avatars': devApiProxy
    },
    allowedHosts: ['fraying-overreact-eraser.ngrok-free.dev']
  }
})

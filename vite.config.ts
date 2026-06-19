import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Editor + Player live in /client. API + uploads are served by the Express
// server (server/index.js) on PORT 5174. In dev we proxy to it; in prod the
// server serves the built assets from /dist directly.
const SERVER_PORT = process.env.SERVER_PORT || 5174

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    host: true, // expose on LAN so terminals can reach the dev server too
    port: 5173,
    proxy: {
      '/api': `http://localhost:${SERVER_PORT}`,
      '/uploads': `http://localhost:${SERVER_PORT}`,
      '/pair': `http://localhost:${SERVER_PORT}`,
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The backend defaults to 8010 (port 8000 is commonly already in use).
// start.ps1 -Port <n> passes the choice through API_PORT.
const apiPort = process.env.API_PORT || '8010'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The API and its SSE streams live on the FastAPI server.
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
  },
})


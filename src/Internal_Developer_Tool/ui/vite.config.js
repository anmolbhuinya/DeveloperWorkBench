import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function buildInfoPlugin() {
  return {
    name: 'build-info',
    closeBundle() {
      const out = path.resolve(__dirname, '../static/build-info.json')
      fs.writeFileSync(out, JSON.stringify({ built: Date.now() }))
    }
  }
}

export default defineConfig({
  plugins: [react(), buildInfoPlugin()],
  server: {
    proxy: {
      '/api': 'http://localhost:5556',
      '/ws': {
        target: 'ws://localhost:5556',
        ws: true,
        rewriteWsOrigin: true,
      },
    }
  },
  build: {
    outDir: '../static',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  }
})

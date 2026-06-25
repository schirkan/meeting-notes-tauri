import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const host = process.env.TAURI_DEV_HOST

// Vite root is `src/renderer/` so that `index.html` can reference
// `/src/main.tsx` directly. Output goes to the workspace-level `dist/`.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: false,
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  clearScreen: false,
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**', '**/sidecar/**']
    }
  }
})

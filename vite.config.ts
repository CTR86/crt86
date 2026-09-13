import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// StonkFun API sends `Access-Control-Allow-Origin: *`, so the browser talks to it
// directly. If that ever changes, uncomment the proxy and point lib/stonkfun.ts
// at the relative path instead.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Ember's API lacks CORS headers — proxy it same-origin in dev
      // (prod uses the /ember rewrite in vercel.json)
      '/ember': {
        target: 'https://embercurve.fun',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ember/, ''),
      },
    },
  },
})

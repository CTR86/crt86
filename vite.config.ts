import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import bpHandler from './api/bp.mjs'

function loadServerEnv() {
  const p = path.resolve('.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    const k = t.slice(0, i).trim()
    if (k.startsWith('VITE_')) continue
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}

function backpackApiPlugin(): Plugin {
  return {
    name: 'crt86-bp-api',
    configureServer(server) {
      loadServerEnv()
      server.middlewares.use('/api/bp', (req: IncomingMessage, res: ServerResponse, next) => {
        void Promise.resolve(bpHandler(req, res)).catch(next)
      })
    },
  }
}

// StonkFun API sends `Access-Control-Allow-Origin: *`, so the browser talks to it
// directly. If that ever changes, uncomment the proxy and point lib/stonkfun.ts
// at the relative path instead.
export default defineConfig({
  plugins: [react(), backpackApiPlugin()],
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
      '/backpack': {
        target: 'https://api.backpack.exchange',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/backpack/, ''),
      },
    },
  },
})

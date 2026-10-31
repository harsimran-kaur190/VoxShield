import { existsSync, readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Two-computer testing: `VOXSHIELD_LAN=1 npm run dev` listens on the local network over https (browsers only allow the
// microphone on https or localhost). The certificate is made by scripts/make_lan_cert.sh. The backend stays on
// 127.0.0.1: the second computer reaches it only through this server's /api proxy.
const lan = process.env.VOXSHIELD_LAN === '1'
const https =
  lan && existsSync('.certs/lan.key') && existsSync('.certs/lan.crt')
    ? { key: readFileSync('.certs/lan.key'), cert: readFileSync('.certs/lan.crt') }
    : undefined
if (lan && !https) console.warn('VOXSHIELD_LAN=1 but .certs/lan.key is missing: run scripts/make_lan_cert.sh. Serving plain http, so other computers cannot use the microphone.')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: lan ? true : undefined,
    https,
    proxy: {
      // ws: live calls open a WebSocket under /api/v1/calls.
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true, ws: true },
    },
  },
})

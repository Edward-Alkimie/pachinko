import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const DEV_PORT = 5180

/** Django dev server (backend/: `python manage.py runserver`). */
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'

// Inside code-server the page is served through its path proxy
// (e.g. http://host:port/absproxy/5173/), so Vite must know the prefix.
const isCodeServer = Boolean(process.env.VSCODE_PROXY_URI)

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const base = command === 'serve' && isCodeServer ? `/absproxy/${DEV_PORT}/` : '/'

  return {
    plugins: [react()],
    base,
    // Two pages: the game, and the determinism test (determinism.html, plain DOM).
    build: { rollupOptions: { input: { main: 'index.html', determinism: 'determinism.html' } } },
    // Read the repo-root .env (one file for the whole project). Only VITE_* values reach the page,
    // so keys like SUI_PRIVATE_KEY stay server-side. Used for VITE_PACHINKO_DEPLOYMENT.
    envDir: '..',
    server: {
      // 127.0.0.1 (IPv4) so code-server's proxy can reach it; still not exposed to the network
      host: '127.0.0.1',
      port: DEV_PORT,
      strictPort: true,
      proxy: {
        // `<base>api/...` → Django `/api/...`. Same origin as the page, so the
        // session + CSRF cookies just work (see src/services/api.ts).
        [`${base}api`]: {
          target: BACKEND_URL,
          changeOrigin: true,
          rewrite: (path) => path.slice(base.length - 1), // drop the code-server prefix
          configure: (proxy) => {
            // Django compares the browser's Origin header with its own host. Through
            // this dev proxy they always differ, so present the request as coming from
            // the backend's own origin. The CSRF token check itself still applies.
            proxy.on('proxyReq', (proxyReq) => {
              if (proxyReq.getHeader('origin')) proxyReq.setHeader('origin', BACKEND_URL)
            })
          },
        },
      },
    },
  }
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const DEV_PORT = 5180

// Inside code-server the page is served through its path proxy
// (e.g. http://host:port/absproxy/5173/), so Vite must know the prefix.
const isCodeServer = Boolean(process.env.VSCODE_PROXY_URI)

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'serve' && isCodeServer ? `/absproxy/${DEV_PORT}/` : '/',
  server: {
    // 127.0.0.1 (IPv4) so code-server's proxy can reach it; still not exposed to the network
    host: '127.0.0.1',
    port: DEV_PORT,
    strictPort: true,
  },
}))
